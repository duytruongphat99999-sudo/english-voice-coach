// Lo trinh PTE tu dieu chinh — Duy chot 11/09/2026.
//
// Duy thi PTE Academic thang 03/2027, muc tieu 65. Chua co diem hien tai.
//
// NGUON SU THAT: api/content/pte-exam-facts.json (22 dang bai, so cau, ky nang
// gop, luat cham) — lay tu pearsonpte.com, KHONG tu blog luyen thi. File do do
// skill pte-cap-nhat so sanh dinh ky; sua de thi la sua file, khong sua code.
//
// ⚠️ APP KHONG DU DOAN DUOC DIEM PTE. Bo cham cua app hien hon may Pearson (da
// do nhieu lan). Can cu that duy nhat cua lo trinh la diem THI THU CHINH THUC
// (Scored Practice Test) do Duy tu nhap vao bang pte_mock. Diem trong app chi
// dung de biet dang nao dang yeu hon dang nao — khong bao gio quy ra diem PTE.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, nowIso, todayLocal } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const factsPath = resolve(here, '..', 'content', 'pte-exam-facts.json');

type Skill = 'L' | 'R' | 'S' | 'W';

export type PteTask = {
  id: string;
  name: string;
  name_vi: string;
  section: 'speaking_writing' | 'reading' | 'listening';
  items: [number, number];
  scoring: 'partial' | 'correct_incorrect' | 'negative';
  skills: Skill[];
  /** Duong dan trong app. null = app chua co dang nay. */
  app: string | null;
  human_content: boolean;
  new_2025?: boolean;
  strategies_vi: string[];
};

export type PteFacts = {
  version: number;
  checked_at: string;
  format_changed_on: string;
  sources: Record<string, string>;
  rules: Record<string, { vi: string; quote?: string; source: string }>;
  concordance_overall: { pte: number; ielts: number }[];
  tasks: PteTask[];
};

function loadFacts(): PteFacts | null {
  if (!existsSync(factsPath)) {
    console.warn(`[pte-plan] khong thay ${factsPath} — tab PTE se khong co lo trinh`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(factsPath, 'utf8')) as PteFacts;
  } catch (e) {
    // File hong KHONG duoc lam chet app luc khoi dong.
    console.warn(`[pte-plan] ${factsPath} hong: ${(e as Error).message}`);
    return null;
  }
}

export const PTE_FACTS: PteFacts | null = loadFacts();

// ---------------------------------------------------------------------------
// Ke hoach: ngay thi + muc tieu
// ---------------------------------------------------------------------------

export type PtePlan = { exam_date: string; target: number };

/**
 * Mac dinh khi Duy chua dat: 15/03/2027 — Duy chi noi "thang 03/2027", chon
 * GIUA thang de khong dat moc qua som hay qua muon. Duy sua duoc tren man hinh.
 */
export const DEFAULT_PLAN: PtePlan = { exam_date: '2027-03-15', target: 65 };

export function getPlan(): PtePlan {
  const r = db.prepare('SELECT exam_date, target FROM pte_plan WHERE id = 1').get() as PtePlan | undefined;
  return r ?? DEFAULT_PLAN;
}

export function setPlan(p: PtePlan): PtePlan {
  db.prepare(
    `INSERT INTO pte_plan (id, exam_date, target, updated_at) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET exam_date = excluded.exam_date, target = excluded.target,
                                   updated_at = excluded.updated_at`,
  ).run(p.exam_date, p.target, nowIso());
  return getPlan();
}

// ---------------------------------------------------------------------------
// Thi thu chinh thuc
// ---------------------------------------------------------------------------

export type PteMock = {
  id: number;
  taken_on: string;
  set_no: number | null;
  overall: number;
  listening: number;
  reading: number;
  speaking: number;
  writing: number;
  note: string;
};

export function addMock(m: Omit<PteMock, 'id'>): PteMock {
  const r = db
    .prepare(
      `INSERT INTO pte_mock (taken_on, set_no, overall, listening, reading, speaking, writing, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(m.taken_on, m.set_no, m.overall, m.listening, m.reading, m.speaking, m.writing, m.note, nowIso());
  return db.prepare('SELECT * FROM pte_mock WHERE id = ?').get(Number(r.lastInsertRowid)) as unknown as PteMock;
}

export function listMocks(): PteMock[] {
  return db.prepare('SELECT * FROM pte_mock ORDER BY taken_on DESC, id DESC').all() as unknown as PteMock[];
}

// ---------------------------------------------------------------------------
// Giai doan
// ---------------------------------------------------------------------------

export type Phase = 'chan_doan' | 'nen_tang' | 'tang_toc' | 'chot' | 'da_thi';

export const PHASE_VI: Record<Phase, { ten: string; mo_ta: string }> = {
  chan_doan: {
    ten: 'Chẩn đoán',
    mo_ta: 'Chưa có điểm thật. Làm bài thi thử chính thức bộ 1 để biết mình đang ở đâu — con số B1 trong app chỉ là đoán.',
  },
  nen_tang: {
    ten: 'Nền tảng',
    mo_ta: 'Luyện đều các dạng nhiều câu nhất. Học cách tổ chức ý — KHÔNG học template (Pearson cho 0 điểm).',
  },
  tang_toc: {
    ten: 'Tăng tốc',
    mo_ta: 'Dồn vào kỹ năng thấp nhất theo lần thi thử gần nhất.',
  },
  chot: {
    ten: 'Chốt',
    mo_ta: 'Làm đề đủ giờ, quản lý thời gian, sửa lỗi lặp. Không học thứ mới.',
  },
  da_thi: { ten: 'Đã qua ngày thi', mo_ta: 'Cập nhật ngày thi mới nếu thi lại.' },
};

/**
 * Giai doan tinh theo SO TUAN CON LAI toi ngay thi, khong theo tuan da hoc —
 * de Duy doi ngay thi thi moi moc tu doi theo, va bat dau muon cung khong lech.
 *
 * Chua co lan thi thu nao => luon la Chan doan, bat ke con bao nhieu tuan:
 * khong co diem that thi moi he so "ky nang yeu nhat" deu la doan.
 */
export function phaseOf(plan: PtePlan, mocks: PteMock[], today = todayLocal()) {
  const ms = Date.parse(`${plan.exam_date}T00:00:00`) - Date.parse(`${today}T00:00:00`);
  const daysLeft = Math.round(ms / 86_400_000);
  const weeksLeft = Math.ceil(daysLeft / 7);

  let phase: Phase;
  if (daysLeft < 0) phase = 'da_thi';
  else if (mocks.length === 0) phase = 'chan_doan';
  else if (weeksLeft <= 3) phase = 'chot';
  else if (weeksLeft <= 13) phase = 'tang_toc';
  else phase = 'nen_tang';

  // Moc thi thu ke tiep: bo 2 khi con ~13 tuan, bo 3 khi con ~3 tuan.
  const daLam = new Set(mocks.map((m) => m.set_no).filter((x): x is number => x != null));
  let nextMock: { set_no: number; khi_vi: string } | null = null;
  if (!daLam.has(1) && mocks.length === 0) nextMock = { set_no: 1, khi_vi: 'ngay bây giờ' };
  else if (!daLam.has(2) && weeksLeft > 3) nextMock = { set_no: 2, khi_vi: 'khi còn khoảng 13 tuần' };
  else if (!daLam.has(3)) nextMock = { set_no: 3, khi_vi: 'khi còn khoảng 3 tuần' };

  return { phase, days_left: daysLeft, weeks_left: weeksLeft, next_mock: nextMock, ...PHASE_VI[phase] };
}

// ---------------------------------------------------------------------------
// Hom nay hoc gi
// ---------------------------------------------------------------------------

/**
 * Trong so goc = so cau trung binh trong de x so ky nang dang do gop vao.
 *
 * ⚠️ UOC LUONG THO. Pearson KHONG cong bo trong so % tung dang. Day chi la cach
 * don gian, giai thich duoc, de xep uu tien. Ket qua voi de 2025:
 * Repeat Sentence 22 · Write from Dictation 7 · Read Aloud 6,5 · ...
 */
export function baseWeight(t: PteTask): number {
  return ((t.items[0] + t.items[1]) / 2) * t.skills.length;
}

/** Ma dang bai trong app -> task trong bang pte_attempts. */
const ATTEMPT_TASK: Record<string, string> = {
  ra: 'ra',
  rs: 'rs',
  wfd: 'wfd',
  // Them 11/09 — ba dang Doc (routes/pte-reading.ts ghi task = dung ma dang).
  rwfib: 'rwfib',
  rfib: 'rfib',
  rop: 'rop',
  // Them 12/09 — hai dang trac nghiem Doc.
  mcsa_r: 'mcsa_r',
  mcma_r: 'mcma_r',
  // Them 12/09 — bay dang Nghe (routes/pte-listening.ts ghi task = dung ma dang).
  fibl: 'fibl',
  hiw: 'hiw',
  smw: 'smw',
  mcsa_l: 'mcsa_l',
  mcma_l: 'mcma_l',
  hcs: 'hcs',
  asq: 'asq',
  // Them 12/09 — bay dang co nguoi cham noi dung (routes/pte-open.ts). Diem la
  // UOC LUONG cua AI theo thang Pearson, khong phai diem PTE.
  di: 'di',
  rl: 'rl',
  rts: 'rts',
  sgd: 'sgd',
  swt: 'swt',
  sst: 'sst',
  we: 'we',
};

/**
 * He so yeu tu diem app 14 ngay gan nhat: diem thap => nhan len, cao => giam.
 * Chua lam lan nao => 1 (khong co thong tin thi khong doan).
 */
function heSoYeu(taskId: string): { f: number; avg: number | null; n: number } {
  const key = ATTEMPT_TASK[taskId];
  if (!key) return { f: 1, avg: null, n: 0 };
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const r = db
    .prepare('SELECT AVG(score) AS avg, COUNT(*) AS n FROM pte_attempts WHERE task = ? AND created_at >= ?')
    .get(key, since) as { avg: number | null; n: number };
  if (!r.n || r.avg === null) return { f: 1, avg: null, n: 0 };
  // 60 diem => x1; 20 diem => x2 (tran); 90 diem => x0,5 (san).
  const f = Math.min(2, Math.max(0.5, (100 - r.avg) / 40));
  return { f, avg: Math.round(r.avg), n: r.n };
}

export type PlanBlock = {
  id: string;
  name_vi: string;
  minutes: number;
  in_app: boolean;
  href: string | null;
  why_vi: string;
};

/** Tong thoi gian mot ngay. 200 gio / 26 tuan ~ 1,1 gio/ngay (Cambridge: B1->B2 ~180-260 gio). */
const PHUT_NGAY = 65;
const PHUT_ON_TU = 10;

export function todayPlan(plan: PtePlan, mocks: PteMock[], today = todayLocal()) {
  const ph = phaseOf(plan, mocks, today);
  if (!PTE_FACTS) return { phase: ph, minutes_total: 0, blocks: [] as PlanBlock[] };

  // Ky nang thap nhat o lan thi thu gan nhat.
  const moi = mocks[0];
  let yeuNhat: Skill | null = null;
  if (moi) {
    const k: [Skill, number][] = [
      ['L', moi.listening],
      ['R', moi.reading],
      ['S', moi.speaking],
      ['W', moi.writing],
    ];
    yeuNhat = k.sort((a, b) => a[1] - b[1])[0]![0];
  }
  // Giai doan tang toc thi don manh hon vao ky nang yeu.
  const heSoKyNang = ph.phase === 'tang_toc' ? 2 : 1.5;

  const scored = PTE_FACTS.tasks.map((t) => {
    const y = heSoYeu(t.id);
    const k = yeuNhat && t.skills.includes(yeuNhat) ? heSoKyNang : 1;
    return { t, w: baseWeight(t) * y.f * k, yeu: y, kyNang: k > 1 };
  });

  const blocks: PlanBlock[] = [];

  if (ph.phase === 'chan_doan') {
    blocks.push({
      id: 'mock',
      name_vi: 'Thi thử chính thức — bộ 1',
      minutes: 120,
      in_app: false,
      href: PTE_FACTS.sources.practice_test ?? null,
      why_vi: 'Chưa có điểm thật. Mọi con số trong app đều không dự đoán được điểm PTE — bài này thì có.',
    });
  }

  blocks.push({
    id: 'vocab',
    name_vi: 'Ôn từ',
    minutes: PHUT_ON_TU,
    in_app: true,
    href: '/review',
    why_vi: 'Từ vựng là nền của cả bốn kỹ năng.',
  });

  // Hai dang trong app co trong so cao nhat.
  const trongApp = scored.filter((x) => x.t.app).sort((a, b) => b.w - a.w).slice(0, 2);
  // Them 11/09: ky nang nao app CO bai ma hai dang tren chua phu thi them dang
  // nang nhat cua ky nang do, de ngay nao cung du Nghe · Noi · Doc · Viet. Can
  // vi moi dang Doc chi gop MOT ky nang va it cau, nen trong so khong bao gio
  // tu dua no vao top 2 — Duy se khong bao gio duoc giao bai Doc.
  const themDuKyNang = new Set<(typeof scored)[number]>();
  const daPhu = new Set(trongApp.flatMap((x) => x.t.skills));
  for (const s of ['L', 'S', 'R', 'W'] as Skill[]) {
    if (daPhu.has(s)) continue;
    const ung = scored
      .filter((x) => x.t.app && x.t.skills.includes(s) && !trongApp.includes(x))
      .sort((a, b) => b.w - a.w)[0];
    if (!ung) continue;
    trongApp.push(ung);
    themDuKyNang.add(ung);
    ung.t.skills.forEach((k) => daPhu.add(k));
  }
  // Mot dang ngoai app, XOAY THEO NGAY de khong ngay nao cung giong nhau, lay
  // trong 6 dang ngoai app co trong so cao nhat.
  const ngoaiApp = scored.filter((x) => !x.t.app).sort((a, b) => b.w - a.w).slice(0, 6);
  const dayNo = Math.floor(Date.parse(`${today}T00:00:00`) / 86_400_000);
  const chonNgoai = ngoaiApp.length ? ngoaiApp[dayNo % ngoaiApp.length]! : null;

  const nhom = chonNgoai ? [...trongApp, chonNgoai] : trongApp;
  const tongW = nhom.reduce((a, x) => a + x.w, 0) || 1;
  const phutCon = PHUT_NGAY - PHUT_ON_TU;

  for (const x of nhom) {
    // Lam tron 5 phut, toi thieu 10 phut — duoi muc do khong kip vao guong.
    const phut = Math.max(10, Math.round(((x.w / tongW) * phutCon) / 5) * 5);
    const ly: string[] = [];
    ly.push(`${x.t.items[0]}–${x.t.items[1]} câu trong đề, góp ${x.t.skills.length} kỹ năng`);
    if (x.yeu.avg !== null) ly.push(`điểm luyện 14 ngày qua ${x.yeu.avg}%`);
    if (x.kyNang) ly.push('góp vào kỹ năng thấp nhất lần thi thử trước');
    if (themDuKyNang.has(x)) ly.push('thêm vào để hôm nay đủ cả bốn kỹ năng');
    if (x.t.new_2025) ly.push('dạng MỚI của đề 2025');
    blocks.push({
      id: x.t.id,
      name_vi: x.t.name_vi,
      minutes: phut,
      in_app: !!x.t.app,
      href: x.t.app,
      why_vi: ly.join(' · '),
    });
  }

  return {
    phase: ph,
    weakest_skill: yeuNhat,
    minutes_total: blocks.filter((b) => b.id !== 'mock').reduce((a, b) => a + b.minutes, 0),
    blocks,
  };
}

// ---------------------------------------------------------------------------
// Bon ky nang — them 11/09
//
// Duy bao "chua ro ve nghe noi doc viet". practiceStats() ben duoi xep theo
// DANG BAI; day xep lai theo KY NANG Pearson cham: moi ky nang co bao nhieu
// dang trong de, app luyen duoc may dang, luyen bao nhieu, thi thu bao nhieu.
//
// ⚠️ Mot dang gop nhieu ky nang (Nhai cau = Nghe + Noi), nen mot luot Nhai cau
// tinh vao CA HAI o. Diem trung binh o day la trung binh cac luot luyen, KHONG
// phai diem ky nang PTE.
// ---------------------------------------------------------------------------

const SKILL_ORDER: Skill[] = ['L', 'S', 'R', 'W'];
const SKILL_VI: Record<Skill, string> = { L: 'Nghe', S: 'Nói', R: 'Đọc', W: 'Viết' };
const SKILL_MOCK: Record<Skill, keyof Pick<PteMock, 'listening' | 'speaking' | 'reading' | 'writing'>> = {
  L: 'listening',
  S: 'speaking',
  R: 'reading',
  W: 'writing',
};

export function skillStats(plan: PtePlan, mocks: PteMock[]) {
  if (!PTE_FACTS) return [];
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const moi = mocks[0] ?? null;
  const shadow = db
    .prepare("SELECT COUNT(*) AS n FROM pte_attempts WHERE task = 'shadow' AND created_at >= ?")
    .get(since) as { n: number };

  return SKILL_ORDER.map((s) => {
    const tasks = PTE_FACTS!.tasks.filter((t) => t.skills.includes(s));
    const inApp = tasks.filter((t) => t.app);
    const keys = [...new Set(inApp.map((t) => ATTEMPT_TASK[t.id]).filter((k): k is string => !!k))];
    let avg: number | null = null;
    let n = 0;
    if (keys.length) {
      const r = db
        .prepare(
          `SELECT AVG(score) AS avg, COUNT(*) AS n FROM pte_attempts
           WHERE task IN (${keys.map(() => '?').join(',')}) AND created_at >= ?`,
        )
        .get(...keys, since) as { avg: number | null; n: number };
      n = r.n;
      avg = r.n && r.avg !== null ? Math.round(r.avg) : null;
    }
    return {
      skill: s,
      name_vi: SKILL_VI[s],
      task_count: tasks.length,
      in_app: inApp.map((t) => ({ id: t.id, name_vi: t.name_vi, href: t.app })),
      attempts_14d: n,
      avg_14d: avg,
      // Shadowing luyen do troi chay — chi tinh vao o Noi, dem rieng, khong tron diem.
      shadow_14d: s === 'S' ? shadow.n : null,
      mock: moi ? { score: moi[SKILL_MOCK[s]], taken_on: moi.taken_on } : null,
      target: plan.target,
    };
  });
}

/** Diem luyen tap tung dang trong app, cho man tong quan. */
export function practiceStats() {
  if (!PTE_FACTS) return [];
  return PTE_FACTS.tasks
    .filter((t) => t.app)
    .map((t) => {
      const y = heSoYeu(t.id);
      return { id: t.id, name_vi: t.name_vi, href: t.app, avg_14d: y.avg, attempts_14d: y.n };
    });
}
