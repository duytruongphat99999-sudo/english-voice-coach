import type { FastifyInstance } from 'fastify';
import { completeDailyIfReady, getOrCreateToday, currentStreak, dueCount } from '../store.js';

export default async function dailyRoutes(app: FastifyInstance) {
  /**
   * POST /daily/complete — chot nhiem vu hom nay, cap nhat streak.
   *
   * Binh thuong khong can goi tay: /review/answer va /session/end da tu chot
   * khi du dieu kien. Endpoint nay de man "Tong ket" bam nut xac nhan, va de
   * chua tay khi can (`{ "force": true }`).
   */
  app.post<{ Body?: { force?: boolean } }>('/daily/complete', async (req) => {
    const before = getOrCreateToday();
    const after = completeDailyIfReady(req.body?.force === true);
    return {
      date: after.date,
      completed: after.completed === 1,
      just_completed: before.completed === 0 && after.completed === 1,
      streak: after.streak,
      steps_done: {
        vocab: after.vocab_reviewed > 0,
        scenario: after.scenario_done > 0,
        presentation: after.presentation_done > 0,
      },
      vocab_reviewed: after.vocab_reviewed,
      // Chua du dieu kien thi noi ro con thieu gi, dung de UI im lang.
      missing: after.completed === 1
        ? []
        : [
            ...(after.vocab_reviewed === 0 && dueCount() > 0 ? ['Buoc 1: on it nhat 1 tu'] : []),
            ...(after.scenario_done === 0 ? ['Buoc 2: xong 1 roleplay'] : []),
          ],
    };
  });

  /** GET /daily — trang thai hom nay. */
  app.get('/daily', async () => {
    const d = getOrCreateToday();
    return {
      date: d.date,
      vocab_reviewed: d.vocab_reviewed,
      scenario_done: d.scenario_done,
      presentation_done: d.presentation_done,
      completed: d.completed === 1,
      streak: currentStreak(),
    };
  });
}
