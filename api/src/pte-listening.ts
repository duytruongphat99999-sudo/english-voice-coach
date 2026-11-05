// PTE Listening — bay dang MAY CHAM DUOC HOAN TOAN (them 12/09, Duy: "con lai lam het di"):
//   fibl   — Fill in the Blanks (nghe, go tu con thieu)        · 2-3 cau/de · tung o
//   hiw    — Highlight Incorrect Words (bam tu doc khac chu)   · 2-3 cau/de · TRU DIEM
//   smw    — Select Missing Word (chon phan bi bip mat)        · 1-2 cau/de · dung/sai
//   mcsa_l — Multiple Choice, Single Answer (nghe)            · 2-3 cau/de · dung/sai
//   mcma_l — Multiple Choice, Multiple Answers (nghe)         · 2-3 cau/de · TRU DIEM
//   hcs    — Highlight Correct Summary                        · 2-3 cau/de · dung/sai
//   asq    — Answer Short Question (nghe hoi, NOI tra loi)    · 5-6 cau/de · dung/sai
// So cau / cach cham / ky nang: api/content/pte-exam-facts.json (Score Guide 07/2025).
//
// Bai nghe = van ban chuyen the tu nguon mo (Wikipedia, CC BY-SA 4.0), doc bang
// TTS. Cau hoi / phuong an / tu bi thay do Claude soan va DA DUOC AGENT KIEM MU
// truoc khi nap (xem CONTEXT_SYNC 12/09). Cau hoi asq do Claude soan.
//
// ⚠️ KHONG LO BAI NGHE TRUOC KHI NOP: voi smw, mcsa_l, mcma_l, hcs, asq client
// KHONG nhan van ban — chi nghe. fibl chi nhan van ban da duc o; hiw nhan ban
// "tren man" (co tu bi thay). Van ban nghe that chi ve SAU khi nop.

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenize } from './pronounce.js';

const here = dirname(fileURLToPath(import.meta.url));
const bankPath = resolve(here, '..', 'content', 'pte-listening.json');

export type ListeningType = 'fibl' | 'hiw' | 'smw' | 'mcsa_l' | 'mcma_l' | 'hcs' | 'asq';
export const LISTENING_TYPES: ListeningType[] = ['fibl', 'hiw', 'smw', 'mcsa_l', 'mcma_l', 'hcs', 'asq'];
export const LISTENING_MAX_LEVEL = 3;

type Base = { id: string; level: number; topic: string; source: string; license: string; script: string; why_vi?: string };
type ChoiceFields = { question?: string; options: string[]; answers: number[] };
// Moi kieu MOT gia tri `type` — de TypeScript loai duoc nhanh (xem pte-reading.ts).
export type ListeningItem =
  | (Base & { type: 'fibl'; answers_text: string[] })
  | (Base & { type: 'hiw' })
  | (Base & { type: 'asq'; answers_text: string[] })
  | (Base & ChoiceFields & { type: 'smw' })
  | (Base & ChoiceFields & { type: 'mcsa_l' })
  | (Base & ChoiceFields & { type: 'mcma_l' })
  | (Base & ChoiceFields & { type: 'hcs' });

/** fibl: {{tu}}. hiw: {{tren-man|doc-that}}. Ca hai deu la MOT tu, khong co dau cach. */
const O_FIBL = /\{\{([^|{}]+)\}\}/g;
const O_HIW = /\{\{([^|{}]+)\|([^{}]+)\}\}/g;

const key = (s: string) => s.trim().toLowerCase();
/** Bo dau cau hai dau de so tu go vao voi dap an: "honey." -> "honey". */
const tron = (s: string) => key(s).replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '');

/** Van ban TTS doc — dung cho /say va cho pregen. */
export function spokenText(it: ListeningItem): string {
  if (it.type === 'fibl') return it.script.replace(O_FIBL, '$1');
  if (it.type === 'hiw') return it.script.replace(O_HIW, '$2');
  return it.script;
}

/** Ban hiw tren man: tach theo khoang trang, danh dau o bi thay. */
function hiwTokens(script: string): { shown: string; spoken: string; swapped: boolean }[] {
  return script
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const m = /\{\{([^|{}]+)\|([^{}]+)\}\}/.exec(tok);
      if (!m) return { shown: tok, spoken: tok, swapped: false };
      return { shown: tok.replace(m[0], m[1]!), spoken: tok.replace(m[0], m[2]!), swapped: true };
    });
}

function loiDe(it: ListeningItem): string | null {
  if (!it.id || !it.script?.trim()) return 'thieu id/script';
  if (!Number.isInteger(it.level) || it.level < 1 || it.level > LISTENING_MAX_LEVEL) return `level=${it.level}`;
  if (it.type !== 'asq' && (!it.source || !it.license)) return 'thieu source/license';
  if (it.type === 'fibl') {
    const o = [...it.script.matchAll(O_FIBL)].map((m) => key(m[1]!));
    if (o.length < 2) return 'fibl can >= 2 o';
    if (o.some((w) => /\s/.test(w))) return 'fibl: o chi duoc MOT tu';
    // answers_text co the ghi nhieu cach viet dung: "geological|geologic" — cach DAU phai trung chu trong script.
    if (o.length !== it.answers_text?.length || o.some((w, i) => w !== key(it.answers_text[i]!.split('|')[0]!))) {
      return 'fibl: o khong khop answers_text';
    }
    return null;
  }
  if (it.type === 'hiw') {
    const t = hiwTokens(it.script);
    const n = t.filter((x) => x.swapped).length;
    if (n < 1) return 'hiw can >= 1 tu bi thay';
    if (t.some((x) => x.swapped && tron(x.shown) === tron(x.spoken))) return 'hiw: tu thay giong tu goc';
    if ([...it.script.matchAll(O_HIW)].length !== n) return 'hiw: danh dau lech (co dau cach trong {{..|..}}?)';
    return null;
  }
  if (it.type === 'asq') return it.answers_text?.length ? null : 'asq thieu answers_text';
  const opts = (it.options ?? []).map(key);
  if (opts.length < 3 || opts.length > 6) return 'can 3-6 phuong an';
  if (new Set(opts).size !== opts.length) return 'phuong an trung';
  const a = it.answers ?? [];
  if (new Set(a).size !== a.length || a.some((i) => !Number.isInteger(i) || i < 0 || i >= opts.length)) return 'answers sai chi so';
  if (it.type === 'mcma_l') {
    if (a.length < 2 || a.length >= opts.length) return 'mcma_l can 2..(n-1) dap an';
  } else if (a.length !== 1) return `${it.type} can dung 1 dap an`;
  if ((it.type === 'mcsa_l' || it.type === 'mcma_l' || it.type === 'hcs') && !it.question?.trim()) return 'thieu cau hoi';
  return null;
}

function load(): ListeningItem[] {
  if (!existsSync(bankPath)) {
    console.warn(`[pte-listening] khong thay ${bankPath} — man Nghe se rong`);
    return [];
  }
  let raw: { items?: ListeningItem[] };
  try {
    raw = JSON.parse(readFileSync(bankPath, 'utf8'));
  } catch (e) {
    console.warn(`[pte-listening] ${bankPath} hong: ${(e as Error).message}`);
    return [];
  }
  const out: ListeningItem[] = [];
  const ids = new Set<string>();
  for (const it of raw.items ?? []) {
    if (!LISTENING_TYPES.includes(it?.type)) continue;
    const loi = ids.has(it.id) ? 'id trung' : loiDe(it);
    if (loi) {
      console.warn(`[pte-listening] bo de ${it?.id}: ${loi}`);
      continue;
    }
    ids.add(it.id);
    out.push({ ...it, topic: it.topic ?? '', license: it.license ?? '' });
  }
  return out;
}

export const LISTENING: ListeningItem[] = load();

export function getListening(id: string): ListeningItem | undefined {
  return LISTENING.find((x) => x.id === id);
}

function xao<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function pickListening(type: ListeningType, level: number, n: number, exclude?: Set<string>): ListeningItem[] {
  const pool = LISTENING.filter((x) => x.type === type && x.level === level);
  if (!pool.length) return [];
  const moi = exclude ? pool.filter((x) => !exclude.has(x.id)) : pool;
  const cu = exclude ? pool.filter((x) => exclude.has(x.id)) : [];
  return [...xao(moi), ...xao(cu)].slice(0, Math.max(1, Math.min(n, pool.length)));
}

// ---------------------------------------------------------------------------
// Ban cho client — KHONG co dap an, KHONG co van ban nghe (tru fibl/hiw)
// ---------------------------------------------------------------------------

function nhan(id: string, i: number): string {
  return createHash('sha1').update(`ls|${id}|${i}`).digest('hex').slice(0, 8);
}

export type ListeningView = {
  id: string;
  type: ListeningType;
  level: number;
  topic: string;
  source: string;
  license: string;
  /** fibl: van ban cat tai o trong — n o thi n+1 doan. */
  segments?: string[];
  /** hiw: tung tu TREN MAN (co tu bi thay), bam theo chi so. */
  words?: string[];
  question?: string;
  /** smw / trac nghiem / hcs: phuong an da xao kem nhan mo. */
  choices?: { key: string; text: string }[];
  multi?: boolean;
};

export function toView(it: ListeningItem): ListeningView {
  const v: ListeningView = { id: it.id, type: it.type, level: it.level, topic: it.topic, source: it.source, license: it.license };
  if (it.type === 'fibl') {
    v.segments = it.script.split(O_FIBL).filter((_, i) => i % 2 === 0);
    return v;
  }
  if (it.type === 'hiw') {
    v.words = hiwTokens(it.script).map((t) => t.shown);
    return v;
  }
  if (it.type === 'asq') return v;
  v.question = it.question;
  v.choices = xao(it.options.map((text, i) => ({ key: nhan(it.id, i), text })));
  v.multi = it.type === 'mcma_l';
  return v;
}

// ---------------------------------------------------------------------------
// Cham
// ---------------------------------------------------------------------------

export type ListeningResult = {
  id: string;
  type: ListeningType;
  level: number;
  pte_score: number;
  correct: number;
  total: number;
  /** Van ban nghe that — CHI ve sau khi nop. */
  transcript: string;
  blanks?: { typed: string | null; answer: string; ok: boolean }[];
  words?: { shown: string; spoken: string; swapped: boolean; tapped: boolean }[];
  question?: string;
  choices?: { text: string; correct: boolean; chosen: boolean }[];
  /** asq: may nghe anh noi gi, va cac dap an chap nhan. */
  heard?: string;
  accepted?: string[];
  why_vi?: string;
  source: string;
  license: string;
};

const pct = (d: number, t: number) => (t > 0 ? Math.round((d / t) * 100) : 0);

export function gradeListening(it: ListeningItem, answer: string[]): ListeningResult {
  const base = {
    id: it.id,
    type: it.type,
    level: it.level,
    transcript: spokenText(it),
    why_vi: it.why_vi,
    source: it.source,
    license: it.license,
  };

  if (it.type === 'fibl') {
    const dapAn = it.answers_text;
    const blanks = dapAn.map((a, j) => {
      const t = typeof answer[j] === 'string' && answer[j]!.trim() ? answer[j]!.trim() : null;
      // Chinh ta phai dung — PTE khong cho diem tu viet sai. Nhieu cach viet dung
      // (Anh/My, geological/geologic) ghi cach nhau bang '|', cach nao cung duoc.
      const cach = a.split('|');
      return { typed: t, answer: cach.join(' / '), ok: t !== null && cach.some((x) => tron(x) === tron(t)) };
    });
    const d = blanks.filter((b) => b.ok).length;
    return { ...base, pte_score: pct(d, dapAn.length), correct: d, total: dapAn.length, blanks };
  }

  if (it.type === 'hiw') {
    const t = hiwTokens(it.script);
    const bam = new Set(answer.map((x) => Number(x)).filter((i) => Number.isInteger(i) && i >= 0 && i < t.length));
    // Luat Pearson: +1 moi tu sai bam dung, -1 moi tu dung bi bam nham, san 0.
    let d = 0;
    for (const i of bam) d += t[i]!.swapped ? 1 : -1;
    const total = t.filter((x) => x.swapped).length;
    const diem = Math.max(0, d);
    return {
      ...base,
      pte_score: pct(diem, total),
      correct: diem,
      total,
      words: t.map((x, i) => ({ ...x, tapped: bam.has(i) })),
    };
  }

  if (it.type === 'asq') {
    // Khong di duong nay — asq cham bang gradeAsq() tu ban ghi giong noi.
    return { ...base, pte_score: 0, correct: 0, total: 1 };
  }

  const viTri = new Map(it.options.map((_, i) => [nhan(it.id, i), i]));
  const chon = new Set<number>();
  for (const k of answer) {
    const i = viTri.get(k);
    if (i !== undefined) chon.add(i);
  }
  const dung = new Set(it.answers);
  let diem: number;
  let total: number;
  if (it.type === 'mcma_l') {
    total = it.answers.length;
    let d = 0;
    for (const i of chon) d += dung.has(i) ? 1 : -1;
    diem = Math.max(0, d);
  } else {
    total = 1;
    diem = chon.size === 1 && dung.has([...chon][0]!) ? 1 : 0;
  }
  return {
    ...base,
    pte_score: pct(diem, total),
    correct: diem,
    total,
    question: it.question,
    choices: it.options.map((text, i) => ({ text, correct: dung.has(i), chosen: chon.has(i) })),
  };
}

/**
 * asq: dung neu MOT dap an chap nhan xuat hien LIEN trong loi noi (sau khi chuan
 * hoa: thuong hoa, bo dau, so -> chu). Noi them "It's an architect" van dung —
 * PTE cham noi dung, khong bat noi dung mot tu.
 */
export function gradeAsq(it: Extract<ListeningItem, { type: 'asq' }>, heardText: string): ListeningResult {
  const nghe = tokenize(heardText);
  const coTrong = (a: string) => {
    const t = tokenize(a);
    if (!t.length) return false;
    for (let i = 0; i + t.length <= nghe.length; i += 1) {
      if (t.every((w, j) => nghe[i + j] === w)) return true;
    }
    return false;
  };
  const ok = it.answers_text.some(coTrong);
  return {
    id: it.id,
    type: 'asq',
    level: it.level,
    pte_score: ok ? 100 : 0,
    correct: ok ? 1 : 0,
    total: 1,
    transcript: it.script,
    heard: heardText.trim(),
    accepted: it.answers_text.slice(),
    why_vi: it.why_vi,
    source: it.source,
    license: it.license,
  };
}
