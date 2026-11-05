// PTE Reading — ba dang MAY CHAM DUOC HOAN TOAN, khong can nguoi (them 11/09):
//   rwfib — Reading & Writing: Fill in the Blanks (chon trong danh sach) · 5-6 cau/de
//   rfib  — Reading: Fill in the Blanks (keo chu tu kho vao o)          · 4-5 cau/de
//   rop   — Re-order Paragraphs (sap xep doan)                          · 2-3 cau/de
// Ca ba chi gop vao READING (Score Guide 07/2025, xem api/content/pte-exam-facts.json).
//
// CHAM DUNG LUAT PEARSON — ca ba deu "partial credit":
//   FIB: moi o dung 1 diem, sai 0.
//   ROP: moi CAP KE NHAU dung thu tu 1 diem — n doan thi toi da n-1 diem.
//
// Ba dang tren lay DAP AN LA CHINH CHU cua van ban nguon; phan duy nhat phai
// viet them la tu nhieu (distractor).
//
// THEM 12/09 — hai dang trac nghiem, Duy duyet ("con lai lam het di"):
//   mcsa_r — Multiple Choice, Single Answer (Reading)   · 2-3 cau/de · dung/sai
//   mcma_r — Multiple Choice, Multiple Answers (Reading) · 2-3 cau/de · TRU DIEM:
//            +1 moi dap an dung chon, -1 moi dap an sai chon, thap nhat 0.
// Bai doc van trich tu nguon mo; CAU HOI va PHUONG AN thi phai viet moi — nen
// moi cau duoc kiem bang cach cho agent lam MU (khong thay khoa) truoc khi nap.
//
// ⚠️ DAP AN KHONG BAO GIO XUONG CLIENT TRUOC KHI NOP. toView() chi tra kho chu
// da xao, lua chon da xao, doan van da xao kem NHAN MO (khong suy ra thu tu).

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bankPath = resolve(here, '..', 'content', 'pte-reading.json');

export type ReadingType = 'rwfib' | 'rfib' | 'rop' | 'mcsa_r' | 'mcma_r';
export const READING_TYPES: ReadingType[] = ['rwfib', 'rfib', 'rop', 'mcsa_r', 'mcma_r'];
export const READING_MAX_LEVEL = 3;

type Base = { id: string; level: number; topic: string; source: string; license: string };
export type RopItem = Base & { type: 'rop'; paragraphs: string[] };
export type RfibItem = Base & { type: 'rfib'; text: string; answers: string[]; distractors: string[] };
export type RwfibItem = Base & { type: 'rwfib'; text: string; blanks: { answer: string; options: string[] }[] };
/** Trac nghiem. `answers` = chi so (0-based) cua phuong an dung trong `options`. */
type McBase = Base & {
  text: string;
  question: string;
  options: string[];
  answers: number[];
  /** Giai thich tieng Viet cho nguoi hoc — CHI tra sau khi nop. */
  why_vi?: string;
};
// Hai kieu rieng, moi kieu MOT gia tri `type`: TypeScript chi loai duoc mot nhanh
// cua union khi truong phan biet la mot gia tri, khong phai hop 'mcsa_r' | 'mcma_r'.
export type McItem = (McBase & { type: 'mcsa_r' }) | (McBase & { type: 'mcma_r' });
export type ReadingItem = RopItem | RfibItem | RwfibItem | McItem;

/** O trong trong van ban: {{1}}, {{2}}, ... theo dung thu tu. */
const O_TRONG = /\{\{(\d+)\}\}/g;

const key = (s: string) => s.trim().toLowerCase();

function soO(text: string): number[] {
  return [...text.matchAll(O_TRONG)].map((m) => Number(m[1]));
}

/** Kiem mot de. Tra ly do hong, hoac null neu dung. */
function loiDe(it: ReadingItem): string | null {
  if (!it.id || !it.source || !it.license) return 'thieu id/source/license';
  if (!Number.isInteger(it.level) || it.level < 1 || it.level > READING_MAX_LEVEL) return `level=${it.level}`;
  if (it.type === 'rop') {
    if (!Array.isArray(it.paragraphs) || it.paragraphs.length < 3 || it.paragraphs.length > 6) return 'rop can 3-6 doan';
    if (new Set(it.paragraphs.map(key)).size !== it.paragraphs.length) return 'rop co doan trung';
    return null;
  }
  if (it.type === 'mcsa_r' || it.type === 'mcma_r') {
    if (!it.text?.trim() || !it.question?.trim()) return 'thieu bai doc / cau hoi';
    const opts = (it.options ?? []).map(key);
    if (opts.length < 4 || opts.length > 7) return 'can 4-7 phuong an';
    if (new Set(opts).size !== opts.length) return 'phuong an trung';
    const a = it.answers ?? [];
    if (new Set(a).size !== a.length || a.some((i) => !Number.isInteger(i) || i < 0 || i >= opts.length)) return 'answers sai chi so';
    if (it.type === 'mcsa_r' && a.length !== 1) return 'mcsa can dung 1 dap an';
    if (it.type === 'mcma_r' && (a.length < 2 || a.length >= opts.length)) return 'mcma can 2..(n-1) dap an';
    return null;
  }
  const o = soO(it.text ?? '');
  const n = it.type === 'rfib' ? it.answers?.length : it.blanks?.length;
  if (!n || o.length !== n || o.some((x, i) => x !== i + 1)) return `o trong ${JSON.stringify(o)} khong khop ${n} dap an`;
  if (it.type === 'rfib') {
    const kho = [...it.answers, ...(it.distractors ?? [])].map(key);
    if (new Set(kho).size !== kho.length) return 'kho chu co tu trung';
    if (!it.distractors?.length) return 'rfib can tu nhieu';
    return null;
  }
  for (const [i, b] of it.blanks.entries()) {
    const opts = (b.options ?? []).map(key);
    if (opts.length < 3 || opts.length > 5) return `o ${i + 1}: can 3-5 lua chon`;
    if (new Set(opts).size !== opts.length) return `o ${i + 1}: lua chon trung`;
    if (opts.filter((x) => x === key(b.answer)).length !== 1) return `o ${i + 1}: dap an khong nam trong lua chon`;
  }
  return null;
}

function load(): ReadingItem[] {
  if (!existsSync(bankPath)) {
    console.warn(`[pte-reading] khong thay ${bankPath} — man Doc se rong`);
    return [];
  }
  let raw: { items?: ReadingItem[] };
  try {
    raw = JSON.parse(readFileSync(bankPath, 'utf8'));
  } catch (e) {
    // JSON hong thi bo ca file, KHONG de app chet luc khoi dong.
    console.warn(`[pte-reading] ${bankPath} hong: ${(e as Error).message}`);
    return [];
  }
  const out: ReadingItem[] = [];
  const ids = new Set<string>();
  for (const it of raw.items ?? []) {
    if (!READING_TYPES.includes(it?.type)) continue;
    const loi = ids.has(it.id) ? 'id trung' : loiDe(it);
    if (loi) {
      // De hong ma van cham la te hon bo di: nguoi hoc tin vao mot con so sai.
      console.warn(`[pte-reading] bo de ${it?.id}: ${loi}`);
      continue;
    }
    ids.add(it.id);
    out.push({ ...it, topic: it.topic ?? '' });
  }
  return out;
}

export const READING: ReadingItem[] = load();

export function getReading(id: string): ReadingItem | undefined {
  return READING.find((x) => x.id === id);
}

function xao<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Giong pickPassages cua Read Aloud: de MOI truoc, het de moi moi quay lai de cu. */
export function pickReading(type: ReadingType, level: number, n: number, exclude?: Set<string>): ReadingItem[] {
  const pool = READING.filter((x) => x.type === type && x.level === level);
  if (!pool.length) return [];
  const moi = exclude ? pool.filter((x) => !exclude.has(x.id)) : pool;
  const cu = exclude ? pool.filter((x) => exclude.has(x.id)) : [];
  return [...xao(moi), ...xao(cu)].slice(0, Math.max(1, Math.min(n, pool.length)));
}

// ---------------------------------------------------------------------------
// Ban cho client — KHONG co dap an
// ---------------------------------------------------------------------------

/** Nhan mo cho tung doan cua rop: bam tu id de + vi tri, nhin nhan khong doan duoc thu tu. */
function nhan(id: string, i: number): string {
  return createHash('sha1').update(`rop|${id}|${i}`).digest('hex').slice(0, 8);
}

/** Nhan mo cho tung phuong an trac nghiem — cung cach, khac tien to. */
function nhanMc(id: string, i: number): string {
  return createHash('sha1').update(`mc|${id}|${i}`).digest('hex').slice(0, 8);
}

export type ReadingView = {
  id: string;
  type: ReadingType;
  level: number;
  topic: string;
  source: string;
  license: string;
  /** rop: cac doan DA XAO, moi doan kem nhan mo. */
  paragraphs?: { key: string; text: string }[];
  /** FIB: van ban cat tai cac o trong — n o thi n+1 doan. */
  segments?: string[];
  /** rfib: kho chu da xao (dap an + tu nhieu). */
  bank?: string[];
  /** rwfib: lua chon da xao cho TUNG o. */
  options?: string[][];
  /** Trac nghiem: bai doc + cau hoi + phuong an da xao kem nhan mo. */
  text?: string;
  question?: string;
  choices?: { key: string; text: string }[];
  /** true = chon nhieu (mcma_r, co tru diem). */
  multi?: boolean;
};

export function toView(it: ReadingItem): ReadingView {
  const v: ReadingView = { id: it.id, type: it.type, level: it.level, topic: it.topic, source: it.source, license: it.license };
  if (it.type === 'rop') {
    const goc = it.paragraphs.map((text, i) => ({ key: nhan(it.id, i), text }));
    // Khong bao gio dua ra dung thu tu goc — de that cua Pearson cung vay.
    let x = xao(goc);
    for (let lan = 0; lan < 10 && x.every((p, i) => p.key === goc[i]!.key); lan += 1) x = xao(goc);
    v.paragraphs = x;
    return v;
  }
  if (it.type === 'mcsa_r' || it.type === 'mcma_r') {
    v.text = it.text;
    v.question = it.question;
    v.choices = xao(it.options.map((text, i) => ({ key: nhanMc(it.id, i), text })));
    v.multi = it.type === 'mcma_r';
    return v;
  }
  v.segments = it.text.split(O_TRONG).filter((_, i) => i % 2 === 0);
  if (it.type === 'rfib') v.bank = xao([...it.answers, ...it.distractors]);
  else v.options = it.blanks.map((b) => xao(b.options));
  return v;
}

// ---------------------------------------------------------------------------
// Cham
// ---------------------------------------------------------------------------

export type ReadingBlankResult = { chosen: string | null; answer: string; ok: boolean };

export type ReadingResult = {
  id: string;
  type: ReadingType;
  level: number;
  /** 0-100 = diem / toi da. */
  pte_score: number;
  correct: number;
  total: number;
  /** FIB: tung o. */
  blanks?: ReadingBlankResult[];
  /** FIB: van ban day du da dien dap an dung. */
  full_text?: string;
  /** rop: thu tu dung (van ban). */
  correct_order?: string[];
  /** rop: thu tu nguoi hoc xep, kem cap nao voi doan sau dung. */
  your_order?: { text: string; pair_ok: boolean | null }[];
  /** Trac nghiem: MOI phuong an theo thu tu goc, dung hay khong, nguoi hoc co chon khong. */
  choices?: { text: string; correct: boolean; chosen: boolean }[];
  /** Trac nghiem: vi sao dung, bay o dau. */
  why_vi?: string;
  source: string;
  license: string;
};

export function gradeReading(it: ReadingItem, answer: string[]): ReadingResult {
  const base = { id: it.id, type: it.type, level: it.level, source: it.source, license: it.license };

  if (it.type === 'rop') {
    const viTri = new Map(it.paragraphs.map((_, i) => [nhan(it.id, i), i]));
    // Chi lay nhan hop le, moi nhan mot lan, giu thu tu nguoi hoc xep.
    const seq: number[] = [];
    for (const k of answer) {
      const i = viTri.get(k);
      if (i !== undefined && !seq.includes(i)) seq.push(i);
    }
    // Luat Pearson: moi cap (i, i+1) cua thu tu dung xuat hien LIEN NHAU trong bai lam.
    let diem = 0;
    const your = seq.map((i, t) => {
      const sau = seq[t + 1];
      const ok = sau === undefined ? null : sau === i + 1;
      if (ok) diem += 1;
      return { text: it.paragraphs[i]!, pair_ok: ok };
    });
    const total = it.paragraphs.length - 1;
    return {
      ...base,
      pte_score: Math.round((diem / total) * 100),
      correct: diem,
      total,
      correct_order: it.paragraphs.slice(),
      your_order: your,
    };
  }

  if (it.type === 'mcsa_r' || it.type === 'mcma_r') {
    const viTri = new Map(it.options.map((_, i) => [nhanMc(it.id, i), i]));
    const chon = new Set<number>();
    for (const k of answer) {
      const i = viTri.get(k);
      if (i !== undefined) chon.add(i);
    }
    const dung = new Set(it.answers);
    let diem: number;
    let total: number;
    if (it.type === 'mcsa_r') {
      // Chon mot. Gui len nhieu hon mot (client loi) thi tinh sai — khong doan y.
      total = 1;
      diem = chon.size === 1 && dung.has([...chon][0]!) ? 1 : 0;
    } else {
      // Luat Pearson: +1 moi dap an dung da chon, -1 moi dap an sai da chon, san 0.
      total = it.answers.length;
      let d = 0;
      for (const i of chon) d += dung.has(i) ? 1 : -1;
      diem = Math.max(0, d);
    }
    return {
      ...base,
      pte_score: Math.round((diem / total) * 100),
      correct: diem,
      total,
      choices: it.options.map((text, i) => ({ text, correct: dung.has(i), chosen: chon.has(i) })),
      why_vi: it.why_vi,
    };
  }

  const dapAn = it.type === 'rfib' ? it.answers : it.blanks.map((b) => b.answer);
  const blanks: ReadingBlankResult[] = dapAn.map((a, j) => {
    const c = typeof answer[j] === 'string' && answer[j]!.trim() ? answer[j]!.trim() : null;
    return { chosen: c, answer: a, ok: c !== null && key(c) === key(a) };
  });
  const diem = blanks.filter((b) => b.ok).length;
  let j = 0;
  const full = it.text.replace(O_TRONG, () => dapAn[j++] ?? '');
  return {
    ...base,
    pte_score: Math.round((diem / dapAn.length) * 100),
    correct: diem,
    total: dapAn.length,
    blanks,
    full_text: full,
  };
}
