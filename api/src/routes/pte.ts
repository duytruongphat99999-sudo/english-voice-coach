import type { FastifyInstance } from 'fastify';
import { transcribe, SttError } from '../stt.js';
import { synthesize, TtsError } from '../tts.js';
import { getSentence, gradeSentence, pickSentences, typedToHeard, PTE_SENTENCES } from '../pte.js';
import { recordPteAttempt } from '../store.js';

/**
 * Ghi diem vao pte_attempts.
 *
 * ⚠️ LAT QUYET DINH 04/09 ("module PTE khong ghi gi vao DB. Co y") cho hai dang
 * nay — 11/09/2026. Ly do: lo trinh PTE tu dieu chinh theo diem (Duy duyet) ma
 * Repeat Sentence va Write from Dictation la HAI DANG TRONG SO CAO NHAT de 2025.
 * Khong ghi thi phan "tu dieu chinh" vo nghia dung o hai dang quan trong nhat.
 *
 * Ghi hong KHONG duoc lam hong luot lam bai: nguoi hoc da tra loi xong roi.
 */
function ghi(app: FastifyInstance, task: 'rs' | 'wfd', itemId: string, r: { pte_score: number; correct: number; total: number }, transcript: string) {
  try {
    recordPteAttempt({ task, itemId, score: r.pte_score, correct: r.correct, total: r.total, transcript });
  } catch (e) {
    app.log.warn(`[pte-${task}] khong ghi duoc lich su: ${(e as Error).message}`);
  }
}

export default async function pteRoutes(app: FastifyInstance) {
  /**
   * GET /pte/items?n=10 — rut de.
   *
   * CO Y KHONG tra ve cau goc. Ca hai task deu la "nghe roi tai tao lai"; gui
   * dap an xuong client la bai tap mat sach y nghia, chi can mo tab Network
   * hoac mot loi hien thi la lo. Cau goc chi ve o buoc cham.
   */
  app.get<{ Querystring: { n?: string } }>('/pte/items', async (req) => {
    const n = Number(req.query.n);
    const items = pickSentences(Number.isFinite(n) && n > 0 ? Math.min(n, 30) : 10);
    return {
      total_bank: PTE_SENTENCES.length,
      items: items.map((s) => ({ id: s.id, word_count: s.text.trim().split(/\s+/).length })),
    };
  });

  /** GET /pte/say/:id — doc de bang TTS. */
  app.get<{ Params: { id: string } }>('/pte/say/:id', async (req, reply) => {
    const s = getSentence(req.params.id);
    if (!s) return reply.code(404).send({ error: 'Không có câu này.' });
    try {
      const buf = await synthesize(s.text);
      return reply
        .header('Content-Type', 'audio/mpeg')
        // De cache: PTE cho nghe de DUNG MOT LAN, nhung day la luyen tap —
        // nghe lai la mot phan cua viec hoc. Client tu quyet dinh cho phep hay khong.
        .header('Cache-Control', 'private, max-age=86400')
        .send(buf);
    } catch (e) {
      return reply.code(502).send({ error: e instanceof TtsError ? e.message : (e as Error).message });
    }
  });

  /**
   * POST /pte/answer/wfd — Write from Dictation. { id, typed }
   *
   * Cham CHAT: nguoi hoc go chu nen sai chinh ta hoac sai dang tu la sai han,
   * PTE khong cho diem mot phan o day.
   */
  app.post<{ Body: { id?: string; typed?: string } }>('/pte/answer/wfd', async (req, reply) => {
    const id = typeof req.body?.id === 'string' ? req.body.id : '';
    const typed = typeof req.body?.typed === 'string' ? req.body.typed : '';
    const s = getSentence(id);
    if (!s) return reply.code(404).send({ error: 'Không có câu này.' });

    const r = gradeSentence(s.text, typedToHeard(typed), true);
    ghi(app, 'wfd', s.id, r, typed.trim());
    return { id: s.id, mode: 'wfd', target: s.text, transcript: typed.trim(), ...r };
  });

  /**
   * POST /pte/answer/rs — Repeat Sentence (multipart: id, audio).
   *
   * Cham MEM hon wfd: `weak` (Whisper nghe ra dung tu nhung khong chac) van
   * tinh la dung, vi day la loi noi chu khong phai chinh ta. Rung duoi thi
   * van khong duoc tinh — xem chu thich trong pte.gradeSentence.
   */
  app.post('/pte/answer/rs', async (req, reply) => {
    let audio: Buffer | null = null;
    let filename = 'answer.webm';
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

    const s = getSentence(id);
    if (!s) return reply.code(404).send({ error: 'Không có câu này.' });
    if (!audio?.length) return reply.code(400).send({ error: 'Thiếu file audio.' });

    let said;
    try {
      // KHONG truyen `prompt` chua cau goc: lam vay la moi Whisper nghe ra dung
      // cau du nguoi hoc noi sai, va diem se luon dep. Cung mot ly do nhu
      // routes/review.ts.
      said = await transcribe(audio, filename, mimetype, { words: true });
    } catch (e) {
      return reply.code(502).send({ error: e instanceof SttError ? e.message : (e as Error).message, where: 'stt' });
    }

    const heard = said.words.length ? said.words : said.text.split(/\s+/).map((w) => ({ word: w }));
    const r = gradeSentence(s.text, said.text.trim() ? heard : [], false);
    ghi(app, 'rs', s.id, r, said.text.trim());
    return { id: s.id, mode: 'rs', target: s.text, transcript: said.text.trim(), ...r };
  });
}
