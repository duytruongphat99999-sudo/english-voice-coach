import type { FastifyInstance } from 'fastify';
import { cfg, SCENARIOS, getScenario, TOPICS, TRACK_VI } from '../config.js';
import { dueCount, getOrCreateToday, currentStreak, suggestScenario, allProgress, unlockedStage } from '../store.js';

export default async function todayRoutes(app: FastifyInstance) {
  /**
   * GET /today  -> { due_count, suggested_scenario, streak, steps_done }
   *
   * Dung cho ca man Home lan n8n.
   *
   * Bao ve bang TODAY_TOKEN: app khong co dang nhap, ma endpoint nay lo ra
   * ai dang hoc gi. Chap nhan token o header `X-Today-Token`, `Authorization:
   * Bearer ...`, hoac query `?token=`. n8n gui kieu nao cung duoc.
   *
   * Neu TODAY_TOKEN de trong trong .env thi endpoint mo — chi hop ly khi chay
   * localhost luc dev. Sau Cloudflare Access thi van con mot lop nua, nhung
   * dat token van la dung.
   *
   * Ngoai le: request den qua nginx cua evc-web (co header X-Evc-Internal)
   * la chinh man Home dang hoi, khong can token.
   */
  app.get<{ Querystring: { token?: string } }>('/today', async (req, reply) => {
    // Request di qua nginx cua evc-web => la chinh app dang hoi, cho qua.
    // Xem chu thich trong web/nginx.conf ve vi sao header nay khong gia duoc.
    const internal = req.headers['x-evc-internal'] === 'yes';

    if (cfg.todayToken && !internal) {
      const header = req.headers['x-today-token'];
      const auth = req.headers.authorization;
      const bearer = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : undefined;
      const given = (typeof header === 'string' ? header : undefined) ?? bearer ?? req.query.token;
      if (given !== cfg.todayToken) {
        return reply.code(401).send({ error: 'Sai hoac thieu TODAY_TOKEN.' });
      }
    }

    const daily = getOrCreateToday();
    const scenarioId = suggestScenario(SCENARIOS);
    const sc = getScenario(scenarioId);

    // Buoc 2 cua nhiem vu gio la "tang tiep theo trong lo trinh", khong con la
    // mot scenario business ngau nhien. Uu tien chu de dang lam do dang.
    const prog = allProgress();
    const withCount = TOPICS.map((t) => {
      const rows = prog.filter((r) => r.topic_id === t.id);
      return { t, rows, done: rows.filter((r) => r.done === 1).length };
    });
    const pick =
      withCount.find((x) => x.done > 0 && x.done < 4) ?? withCount.find((x) => x.done === 0) ?? withCount[0];
    const STAGE_VI = ['', 'Từ vựng', 'Phát âm', 'Phản xạ dịch', 'Trò chuyện'];
    const nextLesson = pick
      ? {
          topic_id: pick.t.id,
          name_vi: pick.t.name_vi,
          emoji: pick.t.emoji,
          track_vi: TRACK_VI[pick.t.track],
          stage: unlockedStage(pick.rows),
          stage_vi: STAGE_VI[unlockedStage(pick.rows)] ?? '',
        }
      : null;

    const totalStages = TOPICS.length * 4;
    // Chi dem chang cua chu de TIENG ANH: topic_progress con chua chang cua chu de
    // tieng Phap (fr_*, them 12/09) — dem ca thi % lo trinh tieng Anh bi phong len.
    const enIds = new Set(TOPICS.map((t) => t.id));
    const doneStages = prog.filter((r) => r.done === 1 && enIds.has(r.topic_id)).length;

    return {
      next_lesson: nextLesson,
      roadmap_percent: totalStages ? Math.round((doneStages / totalStages) * 100) : 0,
      date: daily.date,
      due_count: dueCount(),
      suggested_scenario: scenarioId,
      suggested_scenario_vi: sc?.name_vi ?? '',
      streak: currentStreak(),
      steps_done: {
        vocab: daily.vocab_reviewed > 0,
        scenario: daily.scenario_done > 0,
        presentation: daily.presentation_done > 0,
      },
      vocab_reviewed: daily.vocab_reviewed,
      completed: daily.completed === 1,
    };
  });
}
