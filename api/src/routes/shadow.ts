import type { FastifyInstance } from 'fastify';
import { transcribe, SttError } from '../stt.js';
import { synthesize, TtsError } from '../tts.js';
import { gradeSentence } from '../pte.js';
import {
  getShadowItem,
  karaoke,
  pickShadow,
  refTiming,
  soNhip,
  SHADOW_ITEMS,
  SHADOW_PASSAGES,
  type ShadowMode,
} from '../shadow.js';
import { recordPteAttempt, recentPteAttempts } from '../store.js';

const TASK = 'shadow';

export default async function shadowRoutes(app: FastifyInstance) {
  /**
   * GET /shadow/items?mode=rs|ra|vocab|lesson&n=&level=
   *
   * ⚠️ DOI LUAT 12/09 — Duy: "nhai cau khong co chu sao nhai noi?". Truoc day
   * che do 'rs' giau chu (cung luat /pte/items) de giu 60 cau nay "chua thay"
   * cho bai Repeat Sentence. Duy chon HOC truoc: shadowing la noi hoc, nen gio
   * MOI che do deu tra van ban; man Shadowing co nut tat chu de luyen dung dieu
   * kien thi. Bai thi thu that (/pte/items, PteDrill) VAN giau chu — khong doi.
   * Cai gia: cau da nhin chu o day se de hon khi gap lai o bai Nhai cau / Nghe-go.
   */
  app.get<{ Querystring: { mode?: string; n?: string; level?: string } }>('/shadow/items', async (req) => {
    const MODES: ShadowMode[] = ['rs', 'ra', 'vocab', 'lesson'];
    const mode: ShadowMode = MODES.includes(req.query.mode as ShadowMode) ? (req.query.mode as ShadowMode) : 'rs';
    const n = Number(req.query.n);
    const lv = Number(req.query.level);
    const items = pickShadow(
      mode,
      Number.isFinite(n) && n > 0 ? Math.min(n, 20) : 8,
      mode === 'ra' && Number.isInteger(lv) && lv >= 1 && lv <= 3 ? lv : undefined,
    );
    return {
      mode,
      total_bank: SHADOW_ITEMS.filter((x) => x.mode === mode).length,
      items: items.map((x) => ({
        id: x.id,
        mode: x.mode,
        level: x.level,
        word_count: x.text.trim().split(/\s+/).length,
        // Doi 12/09: moi che do deu tra chu (xem chu thich route). 'rs' khong
        // co nghia / diem can chu y san nen hai truong do van null.
        text: x.text,
        group: x.group,
        vi: x.vi,
        focus_vi: x.focus_vi,
      })),
    };
  });

  /** GET /shadow/say/:id — audio mau (dung chung cache voi moi duong TTS khac). */
  app.get<{ Params: { id: string } }>('/shadow/say/:id', async (req, reply) => {
    const it = getShadowItem(req.params.id);
    if (!it) return reply.code(404).send({ error: 'Không có câu này.' });
    try {
      const buf = await synthesize(it.text);
      return reply.header('Content-Type', 'audio/mpeg').header('Cache-Control', 'private, max-age=86400').send(buf);
    } catch (e) {
      return reply.code(502).send({ error: e instanceof TtsError ? e.message : (e as Error).message });
    }
  });

  /**
   * GET /shadow/prep/:id — tinh san moc thoi gian cua cau mau.
   *
   * Client goi ngay khi hien cau, trong luc nguoi hoc dang nghe mau lan dau.
   * Lan dau mot cau mat 2-7 giay (Whisper nghe lai audio mau); goi truoc thi
   * luc nop bai khong phai cho them khoang do.
   *
   * `karaoke` (them 11/09): moc tung chu tren man, de chu chay theo giong mau.
   * Doi 12/09: tra cho ca 'rs' — /shadow/items da tra chu cua 'rs' roi.
   */
  app.get<{ Params: { id: string } }>('/shadow/prep/:id', async (req, reply) => {
    const it = getShadowItem(req.params.id);
    if (!it) return reply.code(404).send({ error: 'Không có câu này.' });
    try {
      const ref = await refTiming(it.text);
      return {
        id: it.id,
        words: ref.words.length,
        duration_s: ref.duration,
        karaoke: karaoke(it.text, ref),
      };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  /**
   * GET /shadow/passages — cac doan cho che do "Nghe roi noi lai ca doan".
   *
   * Tra ca van ban: chi gom cau Doc to (ra) va cau bai hoc (lesson), deu la
   * loai NHIN CHU. KHONG bao gio gom cau 'rs' (xem buildPassages).
   */
  app.get('/shadow/passages', async () => ({
    passages: SHADOW_PASSAGES.map((p) => ({
      ...p,
      items: p.items.map((x) => ({ ...x, word_count: x.text.trim().split(/\s+/).length })),
    })),
  }));

  /**
   * POST /shadow/answer — multipart: id, audio.
   *
   * KHONG truyen `prompt` chua cau goc vao Whisper — cung ly do nhu moi route
   * cham khac: mom cau cho no la no nghe ra dung cau du nguoi hoc noi sai.
   */
  app.post('/shadow/answer', async (req, reply) => {
    let audio: Buffer | null = null;
    let filename = 'shadow.webm';
    let mimetype = 'audio/webm';
    let id = '';
    // Them 12/09: nguoi hoc co nhin chu khi shadow khong ('1'/'0'). null = client cu.
    let nhinChu: boolean | null = null;
    try {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          audio = await part.toBuffer();
          filename = part.filename || filename;
          mimetype = part.mimetype || mimetype;
        } else if (part.fieldname === 'id') {
          id = String(part.value);
        } else if (part.fieldname === 'nhin_chu') {
          nhinChu = String(part.value) === '1';
        }
      }
    } catch (e) {
      return reply.code(413).send({ error: `Đọc file thất bại: ${(e as Error).message}` });
    }

    const it = getShadowItem(id);
    if (!it) return reply.code(404).send({ error: 'Không có câu này.' });
    if (!audio?.length) return reply.code(400).send({ error: 'Thiếu file audio.' });

    let said;
    let ref;
    try {
      // Chay song song: moc mau thuong da co san trong cache (nho /shadow/prep).
      [said, ref] = await Promise.all([
        transcribe(audio, filename, mimetype, { words: true }),
        refTiming(it.text),
      ]);
    } catch (e) {
      return reply
        .code(502)
        .send({ error: e instanceof SttError ? e.message : (e as Error).message, where: 'stt' });
    }

    const heard = said.words.length
      ? said.words
      : said.text.split(/\s+/).filter(Boolean).map((w) => ({ word: w, start: 0, end: 0 }));
    // Noi dung: cung bo cham voi Repeat Sentence / Read Aloud.
    const content = gradeSentence(it.text, said.text.trim() ? heard : [], false);
    const nhip = soNhip(it.text, ref, said.words);

    try {
      recordPteAttempt({
        task: TASK,
        itemId: it.id,
        level: it.level ?? 1,
        score: content.pte_score,
        correct: content.correct,
        total: content.total,
        transcript: said.text,
        detail: {
          mode: it.mode,
          nhin_chu: nhinChu,
          tempo_ratio: nhip.tempo_ratio,
          mean_offset_ms: nhip.mean_offset_ms,
          extra_pauses: nhip.extra_pauses,
          matched: nhip.matched,
        },
      });
    } catch (e) {
      app.log.warn(`[shadow] khong ghi duoc lich su: ${(e as Error).message}`);
    }

    return {
      id: it.id,
      mode: it.mode,
      target: it.text,
      transcript: said.text.trim(),
      ...content,
      timing: nhip,
      // Van ban da lo o `target` roi nen moi che do deu tra, ke ca 'rs'.
      karaoke: karaoke(it.text, ref),
    };
  });

  /** GET /shadow/recent — vai lan gan nhat, cho man mo dau. */
  app.get('/shadow/recent', async () =>
    recentPteAttempts(TASK, 10).map((r) => ({
      id: r.id,
      item_id: r.item_id,
      score: r.score,
      correct: r.correct,
      total: r.total,
      detail: JSON.parse(r.detail_json || '{}'),
      created_at: r.created_at,
    })),
  );
}
