import type { FastifyInstance } from 'fastify';
import {
  PTE_FACTS,
  addMock,
  getPlan,
  listMocks,
  phaseOf,
  practiceStats,
  setPlan,
  skillStats,
  todayPlan,
} from '../pte-plan.js';

const NGAY = /^\d{4}-\d{2}-\d{2}$/;

function diemHopLe(v: unknown): number | null {
  const n = Number(v);
  // Thang diem PTE la 10-90.
  return Number.isInteger(n) && n >= 10 && n <= 90 ? n : null;
}

export default async function ptePlanRoutes(app: FastifyInstance) {
  /**
   * GET /pte/plan — toan bo man tong quan tab PTE trong mot lan goi:
   * ke hoach, giai doan, hom nay hoc gi, diem luyen tap, lich su thi thu.
   */
  app.get('/pte/plan', async () => {
    const plan = getPlan();
    const mocks = listMocks();
    return {
      plan,
      today: todayPlan(plan, mocks),
      practice: practiceStats(),
      // Them 11/09: cung so lieu nhung xep theo 4 ky nang Pearson cham.
      skills: skillStats(plan, mocks),
      mocks,
      facts: PTE_FACTS
        ? {
            checked_at: PTE_FACTS.checked_at,
            format_changed_on: PTE_FACTS.format_changed_on,
            task_count: PTE_FACTS.tasks.length,
            in_app: PTE_FACTS.tasks.filter((t) => t.app).length,
            template_rule: PTE_FACTS.rules.template_zero ?? null,
            concordance: PTE_FACTS.concordance_overall,
            sources: PTE_FACTS.sources,
          }
        : null,
    };
  });

  /** GET /pte/tasks — 22 dang bai kem chien luoc, cho man "cac dang bai". */
  app.get('/pte/tasks', async () => (PTE_FACTS ? PTE_FACTS.tasks : []));

  /** PUT /pte/plan { exam_date: 'YYYY-MM-DD', target } */
  app.put<{ Body: { exam_date?: string; target?: number } }>('/pte/plan', async (req, reply) => {
    const d = String(req.body?.exam_date ?? '');
    if (!NGAY.test(d) || Number.isNaN(Date.parse(d))) {
      return reply.code(400).send({ error: 'Ngày thi phải có dạng YYYY-MM-DD.' });
    }
    const t = diemHopLe(req.body?.target ?? 65);
    if (t === null) return reply.code(400).send({ error: 'Điểm mục tiêu phải từ 10 đến 90.' });
    const plan = setPlan({ exam_date: d, target: t });
    return { plan, phase: phaseOf(plan, listMocks()) };
  });

  /**
   * POST /pte/mock — Duy nhap diem thi thu CHINH THUC.
   *
   * App KHONG tu sinh diem nay va KHONG du doan duoc no. Day la can cu that duy
   * nhat de lo trinh biet ky nang nao dang yeu.
   */
  app.post<{
    Body: {
      taken_on?: string;
      set_no?: number | null;
      overall?: number;
      listening?: number;
      reading?: number;
      speaking?: number;
      writing?: number;
      note?: string;
    };
  }>('/pte/mock', async (req, reply) => {
    const b = req.body ?? {};
    const ngay = String(b.taken_on ?? '');
    if (!NGAY.test(ngay)) return reply.code(400).send({ error: 'Ngày thi thử phải có dạng YYYY-MM-DD.' });
    const diem = {
      overall: diemHopLe(b.overall),
      listening: diemHopLe(b.listening),
      reading: diemHopLe(b.reading),
      speaking: diemHopLe(b.speaking),
      writing: diemHopLe(b.writing),
    };
    const thieu = Object.entries(diem).filter(([, v]) => v === null).map(([k]) => k);
    if (thieu.length) {
      return reply.code(400).send({ error: `Điểm phải là số nguyên 10–90: ${thieu.join(', ')}.` });
    }
    const setNo = b.set_no == null ? null : Number(b.set_no);
    if (setNo !== null && ![1, 2, 3].includes(setNo)) {
      return reply.code(400).send({ error: 'Bộ đề phải là 1, 2 hoặc 3.' });
    }
    const m = addMock({
      taken_on: ngay,
      set_no: setNo,
      overall: diem.overall!,
      listening: diem.listening!,
      reading: diem.reading!,
      speaking: diem.speaking!,
      writing: diem.writing!,
      note: String(b.note ?? '').slice(0, 500),
    });
    return { mock: m, today: todayPlan(getPlan(), listMocks()) };
  });
}
