import type { FastifyInstance } from 'fastify';
import { transcribe, SttError } from '../stt.js';
import {
  READ_ALOUD,
  MAX_LEVEL,
  getPassage,
  gradeReadAloud,
  pickPassages,
  wordCount,
} from '../pte-speaking.js';
import { countFillers } from './presentation.js';
import { pteDoneItemIds, pteLevelState, recentPteAttempts, recordPteAttempt } from '../store.js';

const TASK = 'ra';

export default async function pteSpeakingRoutes(app: FastifyInstance) {
  /**
   * GET /pte/ra/items?level=&n= — rut de Read Aloud.
   *
   * ⚠️ ROUTE NAY TRA CA VAN BAN GOC, va do la NGOAI LE CO CHU Y cua luat
   * "/pte/items khong bao gio tra cau goc".
   *
   * Luat do sinh ra cho Repeat Sentence va Write from Dictation: hai task ay la
   * "nghe roi tai tao lai", gui dap an xuong client la bai tap mat sach y nghia.
   * Read Aloud thi nguoc han — no la bai DOC. Giau van ban di thi khong con bai.
   *
   * Ai QA lan sau: dung "sua" cho nay thanh loi.
   */
  app.get<{ Querystring: { level?: string; n?: string } }>('/pte/ra/items', async (req) => {
    const state = pteLevelState(TASK, MAX_LEVEL);

    // Cho phep on lai cap thap hon, nhung KHONG cho nhay len cap chua mo.
    const xin = Number(req.query.level);
    const level =
      Number.isInteger(xin) && xin >= 1 && xin <= state.unlocked_max ? xin : state.unlocked_max;

    const n = Number(req.query.n);
    const items = pickPassages(
      level,
      Number.isFinite(n) && n > 0 ? Math.min(n, 10) : 5,
      pteDoneItemIds(TASK),
    );

    return {
      level,
      progress: state,
      max_level: MAX_LEVEL,
      total_bank: READ_ALOUD.filter((p) => p.level === level).length,
      items: items.map((p) => ({
        id: p.id,
        level: p.level,
        topic: p.topic,
        text: p.text,
        word_count: wordCount(p.text),
        source: p.source ?? null,
      })),
    };
  });

  /** GET /pte/ra/progress — cap do va lich su, cho man mo dau. */
  app.get('/pte/ra/progress', async () => {
    const state = pteLevelState(TASK, MAX_LEVEL);
    return {
      progress: state,
      max_level: MAX_LEVEL,
      bank: [1, 2, 3].map((l) => ({ level: l, n: READ_ALOUD.filter((p) => p.level === l).length })),
      recent: recentPteAttempts(TASK, 10).map((r) => ({
        id: r.id,
        item_id: r.item_id,
        level: r.level,
        score: r.score,
        correct: r.correct,
        total: r.total,
        created_at: r.created_at,
      })),
    };
  });

  /**
   * POST /pte/answer/ra — multipart: id, audio, duration_s (tuy chon).
   *
   * KHONG truyen `prompt` chua van ban goc vao Whisper: mom cau cho no la no
   * nghe ra dung cau du nguoi hoc doc sai, va diem se luon dep. Cung ly do nhu
   * routes/review.ts va routes/pte.ts.
   */
  app.post('/pte/answer/ra', async (req, reply) => {
    let audio: Buffer | null = null;
    let filename = 'answer.webm';
    let mimetype = 'audio/webm';
    let id = '';
    let clientDuration = 0;

    try {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          audio = await part.toBuffer();
          filename = part.filename || filename;
          mimetype = part.mimetype || mimetype;
        } else if (part.fieldname === 'id') {
          id = String(part.value);
        } else if (part.fieldname === 'duration_s') {
          const n = Number(part.value);
          if (Number.isFinite(n) && n > 0) clientDuration = n;
        }
      }
    } catch (e) {
      return reply.code(413).send({ error: `Đọc file thất bại: ${(e as Error).message}` });
    }

    const p = getPassage(id);
    if (!p) return reply.code(404).send({ error: 'Không có đoạn này.' });
    if (!audio?.length) return reply.code(400).send({ error: 'Thiếu file audio.' });

    let said;
    try {
      said = await transcribe(audio, filename, mimetype, { words: true });
    } catch (e) {
      return reply
        .code(502)
        .send({ error: e instanceof SttError ? e.message : (e as Error).message, where: 'stt' });
    }

    // Whisper do duoc do dai thi tin no; khong thi dung so client gui len.
    const duration = said.duration_s > 0 ? said.duration_s : clientDuration;
    const heard = said.words.length
      ? said.words
      : said.text.split(/\s+/).filter(Boolean).map((w) => ({ word: w }));

    const r = gradeReadAloud(
      p,
      said.text.trim() ? heard : [],
      said.text,
      duration,
      countFillers(said.text),
    );

    // Ghi that bai KHONG duoc lam hong luot hoc: nguoi hoc da doc xong roi.
    try {
      recordPteAttempt({
        task: TASK,
        itemId: p.id,
        level: p.level,
        score: r.pte_score,
        correct: r.correct,
        total: r.total,
        transcript: said.text,
        detail: {
          wpm: r.wpm,
          duration_s: r.duration_s,
          filler_count: r.filler_count,
          pauses: r.pauses,
          longest_pause_s: r.longest_pause_s,
          extra_count: r.extra_count,
          raw_score: r.raw_score,
          dropped_endings: r.dropped_endings,
        },
      });
    } catch (e) {
      app.log.warn(`[pte-ra] khong ghi duoc lich su: ${(e as Error).message}`);
    }

    return {
      id: p.id,
      level: p.level,
      mode: 'ra',
      target: p.text,
      transcript: said.text.trim(),
      ...r,
      // Tra cap do MOI sau khi da ghi lan nay, de UI bao "vua mo cap hai".
      progress: pteLevelState(TASK, MAX_LEVEL),
    };
  });
}
