import type { FastifyInstance } from 'fastify';
import { transcribe, SttError } from '../stt.js';
import { synthesize, TtsError } from '../tts.js';
import { gradePteOpen, LlmError } from '../llm.js';
import {
  OPEN,
  OPEN_MAX_LEVEL,
  OPEN_TYPES,
  OPEN_WRITING,
  RUBRICS,
  buildPrompt,
  chamForm,
  getOpen,
  materialAfter,
  pickOpen,
  spokenText,
  toView,
  type OpenItem,
  type OpenType,
} from '../pte-open.js';
import { countFillers } from './presentation.js';
import { pteDoneItemIds, pteLevelState, recentPteAttempts, recordPteAttempt } from '../store.js';

const TEN_VI: Record<OpenType, string> = {
  di: 'Mô tả hình',
  rl: 'Kể lại bài giảng',
  rts: 'Ứng xử tình huống',
  sgd: 'Tóm tắt thảo luận nhóm',
  swt: 'Tóm tắt bài đọc',
  sst: 'Tóm tắt bài nghe',
  we: 'Viết luận',
};

function loaiHopLe(v: unknown): OpenType | null {
  return OPEN_TYPES.includes(v as OpenType) ? (v as OpenType) : null;
}

export default async function pteOpenRoutes(app: FastifyInstance) {
  /**
   * Cham mot bai: Form (app, chinh xac) + cac tieu chi con lai (Gemini, uoc luong).
   * Ap luat Pearson: Content = 0 hoac Form = 0 thi moi tieu chi khac = 0.
   */
  async function cham(it: OpenItem, response: string, extra: string, stats: Record<string, unknown> | null) {
    const form = chamForm(it.type, response);
    const { system, user, traits } = buildPrompt(it, response, extra);
    const fb = await gradePteOpen(system, user);

    const bang = traits.map((t) => {
      const g = fb.traits.find((x) => x.name.toLowerCase() === t.name.toLowerCase());
      const band = Math.max(0, Math.min(t.max, Math.round(Number(g?.band) || 0)));
      return { name: t.name, max: t.max, band, who: 'ai' as const, why_vi: g?.why_vi ?? '' };
    });
    const content = bang.find((t) => t.name === 'Content');
    // Memorised/template material is irrelevant (Pearson) — enforce here, not only in the prompt.
    if (fb.template_like && content) content.band = 0;
    const catHet = (content && content.band === 0) || (form && form.band === 0);
    if (catHet) for (const t of bang) if (t.name !== 'Content') t.band = 0;

    const tong = bang.reduce((a, t) => a + t.max, 0) + (form?.max ?? 0);
    const diem = catHet ? 0 : bang.reduce((a, t) => a + t.band, 0) + (form?.band ?? 0);
    const khong = (RUBRICS?.types[it.type]?.traits ?? []).filter((t) => t.who === 'none').map((t) => t.name);

    return {
      id: it.id,
      type: it.type,
      level: it.level,
      pte_score: tong ? Math.round((diem / tong) * 100) : 0,
      correct: diem,
      total: tong,
      cut_off: !!catHet,
      form,
      traits: bang,
      not_scored: khong,
      key_points: fb.key_points,
      template_like: fb.template_like,
      template_vi: fb.template_vi,
      fixes: fb.fixes,
      better_en: fb.better_en,
      summary_vi: fb.summary_vi,
      response: response.trim(),
      stats,
      material: materialAfter(it),
      source: it.source,
      license: it.license,
    };
  }

  const ghi = (r: Awaited<ReturnType<typeof cham>>) => {
    try {
      recordPteAttempt({
        task: r.type,
        itemId: r.id,
        level: r.level,
        score: r.pte_score,
        correct: r.correct,
        total: r.total,
        transcript: r.response,
        detail: { form: r.form, traits: r.traits.map((t) => [t.name, t.band]), template_like: r.template_like, stats: r.stats, ai: true },
      });
    } catch (e) {
      app.log.warn(`[pte-open] khong ghi duoc lich su: ${(e as Error).message}`);
    }
  };

  const loiAi = (e: unknown) =>
    e instanceof LlmError
      ? `AI tạm không góp ý được (${e.message}). Bài của anh vẫn còn trên màn — bấm Nộp lại.`
      : (e as Error).message;

  app.get('/pte/open/progress', async () => ({
    max_level: OPEN_MAX_LEVEL,
    types: OPEN_TYPES.map((t) => ({
      type: t,
      name_vi: TEN_VI[t],
      writing: OPEN_WRITING.has(t),
      progress: pteLevelState(t, OPEN_MAX_LEVEL),
      bank: [1, 2, 3].map((l) => ({ level: l, n: OPEN.filter((x) => x.type === t && x.level === l).length })),
      recent: recentPteAttempts(t, 5).map((r) => ({
        id: r.id,
        item_id: r.item_id,
        level: r.level,
        score: r.score,
        correct: r.correct,
        total: r.total,
        created_at: r.created_at,
      })),
    })),
  }));

  app.get<{ Querystring: { type?: string; level?: string; n?: string } }>('/pte/open/items', async (req, reply) => {
    const type = loaiHopLe(req.query.type);
    if (!type) return reply.code(400).send({ error: `Dạng bài phải là một trong: ${OPEN_TYPES.join(', ')}.` });
    const state = pteLevelState(type, OPEN_MAX_LEVEL);
    const xin = Number(req.query.level);
    const level = Number.isInteger(xin) && xin >= 1 && xin <= state.unlocked_max ? xin : state.unlocked_max;
    const n = Number(req.query.n);
    const items = pickOpen(type, level, Number.isFinite(n) && n > 0 ? Math.min(n, 10) : 3, pteDoneItemIds(type));
    return {
      type,
      level,
      progress: state,
      total_bank: OPEN.filter((x) => x.type === type && x.level === level).length,
      rubric_source: RUBRICS?.source ?? null,
      items: items.map(toView),
    };
  });

  /** GET /pte/open/say/:id?turn=n — audio (sgd: tung luot, giong rieng). */
  app.get<{ Params: { id: string }; Querystring: { turn?: string } }>('/pte/open/say/:id', async (req, reply) => {
    const it = getOpen(req.params.id);
    if (!it) return reply.code(404).send({ error: 'Không có bài này.' });
    const turn = Number(req.query.turn ?? 0);
    const s = spokenText(it, Number.isInteger(turn) && turn >= 0 ? turn : 0);
    if (!s) return reply.code(404).send({ error: 'Bài này không có audio.' });
    try {
      const buf = await synthesize(s.text, 'en', s.voice);
      return reply.header('Content-Type', 'audio/mpeg').header('Cache-Control', 'private, max-age=86400').send(buf);
    } catch (e) {
      return reply.code(502).send({ error: e instanceof TtsError ? e.message : (e as Error).message });
    }
  });

  /** POST /pte/open/answer { id, text } — ba dang Viet. */
  app.post<{ Body: { id?: string; text?: unknown } }>('/pte/open/answer', async (req, reply) => {
    const it = getOpen(String(req.body?.id ?? ''));
    if (!it) return reply.code(404).send({ error: 'Không có bài này.' });
    if (!OPEN_WRITING.has(it.type)) return reply.code(400).send({ error: 'Dạng Nói phải nộp bằng giọng nói.' });
    const text = typeof req.body?.text === 'string' ? req.body.text.slice(0, 6000) : '';
    if (!text.trim()) return reply.code(400).send({ error: 'Chưa viết gì.' });
    try {
      const r = await cham(it, text, '', null);
      ghi(r);
      return { ...r, progress: pteLevelState(it.type, OPEN_MAX_LEVEL) };
    } catch (e) {
      return reply.code(502).send({ error: loiAi(e) });
    }
  });

  /** POST /pte/open/answer/voice — multipart: id, audio. Bon dang Noi. */
  app.post('/pte/open/answer/voice', async (req, reply) => {
    let audio: Buffer | null = null;
    let filename = 'open.webm';
    let mimetype = 'audio/webm';
    let id = '';
    try {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          audio = await part.toBuffer();
          filename = part.filename || filename;
          mimetype = part.mimetype || mimetype;
        } else if (part.fieldname === 'id') {
          id = String(part.value);
        }
      }
    } catch (e) {
      return reply.code(413).send({ error: `Đọc file thất bại: ${(e as Error).message}` });
    }
    const it = getOpen(id);
    if (!it || OPEN_WRITING.has(it.type)) return reply.code(404).send({ error: 'Không có bài Nói này.' });
    if (!audio?.length) return reply.code(400).send({ error: 'Thiếu file audio.' });

    let said;
    try {
      // KHONG truyen prompt chua bai goc vao Whisper — cung ly do moi route cham giong noi.
      said = await transcribe(audio, filename, mimetype, { words: true });
    } catch (e) {
      return reply.code(502).send({ error: e instanceof SttError ? e.message : (e as Error).message, where: 'stt' });
    }
    const words = said.words.length;
    const dur = said.duration_s > 0 ? said.duration_s : 0;
    let ngung = 0;
    for (let i = 1; i < said.words.length; i += 1) if (said.words[i]!.start - said.words[i - 1]!.end > 1) ngung += 1;
    const stats = {
      duration_s: Math.round(dur),
      words,
      wpm: dur > 0 ? Math.round((words / dur) * 60) : 0,
      long_pauses: ngung,
      fillers: countFillers(said.text).total,
    };
    const extra = `MEASURED (for context only, do not rate fluency): ${stats.words} words in ${stats.duration_s} s (${stats.wpm} words per minute), ${stats.long_pauses} pauses over 1 s.`;
    try {
      const r = await cham(it, said.text, extra, stats);
      ghi(r);
      return { ...r, progress: pteLevelState(it.type, OPEN_MAX_LEVEL) };
    } catch (e) {
      return reply.code(502).send({ error: loiAi(e), transcript: said.text.trim() });
    }
  });
}
