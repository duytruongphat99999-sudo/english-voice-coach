import type { FastifyInstance } from 'fastify';
import {
  READING,
  READING_MAX_LEVEL,
  READING_TYPES,
  getReading,
  gradeReading,
  pickReading,
  toView,
  type ReadingType,
} from '../pte-reading.js';
import { pteDoneItemIds, pteLevelState, recentPteAttempts, recordPteAttempt } from '../store.js';

const TEN_VI: Record<ReadingType, string> = {
  rwfib: 'Điền từ (chọn)',
  rfib: 'Điền từ (kéo thả)',
  rop: 'Sắp xếp đoạn',
  mcsa_r: 'Chọn một đáp án',
  mcma_r: 'Chọn nhiều đáp án',
};

function loaiHopLe(v: unknown): ReadingType | null {
  return READING_TYPES.includes(v as ReadingType) ? (v as ReadingType) : null;
}

export default async function pteReadingRoutes(app: FastifyInstance) {
  /**
   * GET /pte/reading/progress — cap do tung dang + so de moi cap + vai lan gan nhat.
   * Moi dang mo cap RIENG (task trong pte_attempts = ma dang), cung luat voi Read Aloud.
   */
  app.get('/pte/reading/progress', async () => ({
    max_level: READING_MAX_LEVEL,
    types: READING_TYPES.map((t) => ({
      type: t,
      name_vi: TEN_VI[t],
      progress: pteLevelState(t, READING_MAX_LEVEL),
      bank: [1, 2, 3].map((l) => ({ level: l, n: READING.filter((x) => x.type === t && x.level === l).length })),
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

  /**
   * GET /pte/reading/items?type=&level=&n=
   *
   * ⚠️ KHONG tra dap an: xem toView(). Cho on lai cap thap hon, KHONG cho nhay
   * len cap chua mo.
   */
  app.get<{ Querystring: { type?: string; level?: string; n?: string } }>('/pte/reading/items', async (req, reply) => {
    const type = loaiHopLe(req.query.type);
    if (!type) return reply.code(400).send({ error: `Dạng bài phải là một trong: ${READING_TYPES.join(', ')}.` });
    const state = pteLevelState(type, READING_MAX_LEVEL);
    const xin = Number(req.query.level);
    const level = Number.isInteger(xin) && xin >= 1 && xin <= state.unlocked_max ? xin : state.unlocked_max;
    const n = Number(req.query.n);
    const items = pickReading(type, level, Number.isFinite(n) && n > 0 ? Math.min(n, 10) : 5, pteDoneItemIds(type));
    return {
      type,
      level,
      progress: state,
      total_bank: READING.filter((x) => x.type === type && x.level === level).length,
      items: items.map(toView),
    };
  });

  /**
   * POST /pte/reading/answer { id, answer: string[] }
   *   FIB: answer[j] = chu da chon cho o thu j (chuoi rong = bo trong).
   *   rop: answer = cac nhan doan theo thu tu nguoi hoc xep.
   *   trac nghiem: answer = nhan cac phuong an da chon.
   */
  app.post<{ Body: { id?: string; answer?: unknown } }>('/pte/reading/answer', async (req, reply) => {
    const it = getReading(String(req.body?.id ?? ''));
    if (!it) return reply.code(404).send({ error: 'Không có bài này.' });
    const raw = req.body?.answer;
    if (!Array.isArray(raw) || raw.length > 10 || raw.some((x) => typeof x !== 'string' || x.length > 80)) {
      return reply.code(400).send({ error: 'Bài làm không hợp lệ.' });
    }
    const r = gradeReading(it, raw as string[]);

    // Ghi that bai KHONG duoc lam hong luot hoc: nguoi hoc da lam xong roi.
    try {
      recordPteAttempt({
        task: it.type,
        itemId: it.id,
        level: it.level,
        score: r.pte_score,
        correct: r.correct,
        total: r.total,
        detail: { answer: raw },
      });
    } catch (e) {
      app.log.warn(`[pte-reading] khong ghi duoc lich su: ${(e as Error).message}`);
    }

    return { ...r, progress: pteLevelState(it.type, READING_MAX_LEVEL) };
  });
}
