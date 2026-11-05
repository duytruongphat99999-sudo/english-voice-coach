import type { FastifyInstance } from 'fastify';
import { transcribe, SttError } from '../stt.js';
import { synthesize, TtsError } from '../tts.js';
import {
  LISTENING,
  LISTENING_MAX_LEVEL,
  LISTENING_TYPES,
  getListening,
  gradeAsq,
  gradeListening,
  pickListening,
  spokenText,
  toView,
  type ListeningResult,
  type ListeningType,
} from '../pte-listening.js';
import { pteDoneItemIds, pteLevelState, recentPteAttempts, recordPteAttempt } from '../store.js';

const TEN_VI: Record<ListeningType, string> = {
  fibl: 'Nghe điền từ',
  hiw: 'Tìm từ sai',
  smw: 'Chọn từ còn thiếu',
  mcsa_l: 'Chọn một đáp án (Nghe)',
  mcma_l: 'Chọn nhiều đáp án (Nghe)',
  hcs: 'Chọn tóm tắt đúng',
  asq: 'Trả lời câu ngắn',
};

function loaiHopLe(v: unknown): ListeningType | null {
  return LISTENING_TYPES.includes(v as ListeningType) ? (v as ListeningType) : null;
}

export default async function pteListeningRoutes(app: FastifyInstance) {
  const ghi = (r: ListeningResult, detail: unknown, transcript = '') => {
    // Ghi that bai KHONG duoc lam hong luot hoc.
    try {
      recordPteAttempt({
        task: r.type,
        itemId: r.id,
        level: r.level,
        score: r.pte_score,
        correct: r.correct,
        total: r.total,
        transcript,
        detail,
      });
    } catch (e) {
      app.log.warn(`[pte-listening] khong ghi duoc lich su: ${(e as Error).message}`);
    }
  };

  /** GET /pte/listening/progress — cap do tung dang, so de moi cap, vai lan gan nhat. */
  app.get('/pte/listening/progress', async () => ({
    max_level: LISTENING_MAX_LEVEL,
    types: LISTENING_TYPES.map((t) => ({
      type: t,
      name_vi: TEN_VI[t],
      progress: pteLevelState(t, LISTENING_MAX_LEVEL),
      bank: [1, 2, 3].map((l) => ({ level: l, n: LISTENING.filter((x) => x.type === t && x.level === l).length })),
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

  /** GET /pte/listening/items?type=&level=&n= — KHONG dap an, KHONG van ban nghe (xem toView). */
  app.get<{ Querystring: { type?: string; level?: string; n?: string } }>('/pte/listening/items', async (req, reply) => {
    const type = loaiHopLe(req.query.type);
    if (!type) return reply.code(400).send({ error: `Dạng bài phải là một trong: ${LISTENING_TYPES.join(', ')}.` });
    const state = pteLevelState(type, LISTENING_MAX_LEVEL);
    const xin = Number(req.query.level);
    const level = Number.isInteger(xin) && xin >= 1 && xin <= state.unlocked_max ? xin : state.unlocked_max;
    const n = Number(req.query.n);
    const items = pickListening(type, level, Number.isFinite(n) && n > 0 ? Math.min(n, 10) : 5, pteDoneItemIds(type));
    return {
      type,
      level,
      progress: state,
      total_bank: LISTENING.filter((x) => x.type === type && x.level === level).length,
      items: items.map(toView),
    };
  });

  /**
   * GET /pte/listening/say/:id — audio bai nghe (dung chung cache TTS).
   * smw: chi doc toi cho bi bip; tieng bip do client tu phat.
   */
  app.get<{ Params: { id: string } }>('/pte/listening/say/:id', async (req, reply) => {
    const it = getListening(req.params.id);
    if (!it) return reply.code(404).send({ error: 'Không có bài này.' });
    try {
      const buf = await synthesize(spokenText(it));
      return reply.header('Content-Type', 'audio/mpeg').header('Cache-Control', 'private, max-age=86400').send(buf);
    } catch (e) {
      return reply.code(502).send({ error: e instanceof TtsError ? e.message : (e as Error).message });
    }
  });

  /**
   * POST /pte/listening/answer { id, answer: string[] } — moi dang tru asq.
   *   fibl: chu go cho tung o · hiw: chi so cac tu da bam · con lai: nhan phuong an.
   */
  app.post<{ Body: { id?: string; answer?: unknown } }>('/pte/listening/answer', async (req, reply) => {
    const it = getListening(String(req.body?.id ?? ''));
    if (!it) return reply.code(404).send({ error: 'Không có bài này.' });
    if (it.type === 'asq') return reply.code(400).send({ error: 'Trả lời câu ngắn phải nộp bằng giọng nói.' });
    const raw = req.body?.answer;
    if (!Array.isArray(raw) || raw.length > 200 || raw.some((x) => typeof x !== 'string' || x.length > 80)) {
      return reply.code(400).send({ error: 'Bài làm không hợp lệ.' });
    }
    const r = gradeListening(it, raw as string[]);
    ghi(r, { answer: raw });
    return { ...r, progress: pteLevelState(it.type, LISTENING_MAX_LEVEL) };
  });

  /**
   * POST /pte/listening/answer/asq — multipart: id, audio.
   * KHONG truyen prompt chua dap an vao Whisper (cung ly do nhu moi route cham giong noi).
   */
  app.post('/pte/listening/answer/asq', async (req, reply) => {
    let audio: Buffer | null = null;
    let filename = 'asq.webm';
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
    const it = getListening(id);
    if (!it || it.type !== 'asq') return reply.code(404).send({ error: 'Không có câu hỏi này.' });
    if (!audio?.length) return reply.code(400).send({ error: 'Thiếu file audio.' });

    let said;
    try {
      said = await transcribe(audio, filename, mimetype);
    } catch (e) {
      return reply.code(502).send({ error: e instanceof SttError ? e.message : (e as Error).message, where: 'stt' });
    }
    const r = gradeAsq(it, said.text);
    ghi(r, { heard: r.heard }, said.text);
    return { ...r, progress: pteLevelState('asq', LISTENING_MAX_LEVEL) };
  });
}
