import type { FastifyInstance } from 'fastify';
import { db, daysAgoLocal } from '../db.js';
import { currentStreak, dueCount } from '../store.js';

export default async function progressRoutes(app: FastifyInstance) {
  /** GET /progress — lieec mot phat la xong, khong phai dashboard. */
  app.get('/progress', async () => {
    const one = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).get(...(p as never[])) as T | undefined;

    // Trang Tien do la cua TIENG ANH: kho tieng Phap (12/09, ~600 tu) va buoi tro
    // chuyen tieng Phap (scenario 'topic:fr_*') khong duoc tinh vao day.
    const total = one<{ n: number }>("SELECT COUNT(*) AS n FROM vocab WHERE lang = 'en'")?.n ?? 0;
    // "Thuoc" = da on dung >= 3 lan (spec §6). FSRS tang reps ca khi tra loi QUEN,
    // nen reps >= 3 mot minh dem ca the dang quen — them dieu kien lan tra loi cuoi
    // khong phai quen (last_grade >= 3). Sua 13/09, cung cach voi kho tieng Phap.
    const learned =
      one<{ n: number }>("SELECT COUNT(*) AS n FROM vocab WHERE lang = 'en' AND reps >= 3 AND last_grade >= 3")?.n ?? 0;
    const sessions = one<{ n: number }>("SELECT COUNT(*) AS n FROM sessions WHERE COALESCE(scenario, '') NOT LIKE 'topic:fr\\_%' ESCAPE '\\'")?.n ?? 0;
    const talkTurns =
      one<{ n: number }>(
        "SELECT COUNT(*) AS n FROM sessions WHERE ended_at IS NOT NULL AND COALESCE(scenario, '') NOT LIKE 'topic:fr\\_%' ESCAPE '\\'",
      )?.n ?? 0;

    const wpmTrend = db
      .prepare('SELECT id, created_at, wpm, filler_count FROM presentations ORDER BY id ASC LIMIT 60')
      .all() as unknown as { id: number; created_at: string; wpm: number; filler_count: number }[];

    // 30 ngay gan nhat, ke ca ngay khong hoc (de nhin thay lo hong).
    const rows = db
      .prepare('SELECT date, completed, vocab_reviewed, scenario_done FROM daily WHERE date >= ? ORDER BY date ASC')
      .all(daysAgoLocal(29)) as unknown as {
      date: string;
      completed: number;
      vocab_reviewed: number;
      scenario_done: number;
    }[];
    const byDate = new Map(rows.map((r) => [r.date, r]));
    const last30 = Array.from({ length: 30 }, (_, i) => {
      const date = daysAgoLocal(29 - i);
      const r = byDate.get(date);
      return { date, completed: r?.completed === 1, vocab_reviewed: r?.vocab_reviewed ?? 0 };
    });

    const domains = db
      .prepare("SELECT domain, COUNT(*) AS n FROM vocab WHERE lang = 'en' GROUP BY domain ORDER BY n DESC")
      .all() as unknown as { domain: string; n: number }[];

    return {
      streak: currentStreak(),
      words_total: total,
      words_learned: learned,
      words_due: dueCount(),
      sessions,
      sessions_finished: talkTurns,
      wpm_trend: wpmTrend,
      last_30_days: last30,
      by_domain: domains.filter((d) => d.domain),
    };
  });

  /** GET /vocab — ca kho, de xem lai. */
  app.get<{ Querystring: { q?: string } }>('/vocab', async (req) => {
    const q = (req.query.q ?? '').trim();
    const rows = q
      ? (db
          .prepare("SELECT * FROM vocab WHERE lang = 'en' AND (word LIKE ? OR meaning_vi LIKE ?) ORDER BY due_date ASC LIMIT 300")
          .all(`%${q}%`, `%${q}%`) as unknown as unknown[])
      : (db.prepare("SELECT * FROM vocab WHERE lang = 'en' ORDER BY due_date ASC LIMIT 300").all() as unknown as unknown[]);
    return rows;
  });
}
