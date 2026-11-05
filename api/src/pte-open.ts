// PTE — bay dang CO NGUOI CHAM NOI DUNG (them 12/09, Duy: "con lai lam het di"):
//   Viet: swt (Tom tat bai doc) · we (Viet luan) · sst (Tom tat bai nghe)
//   Noi : di (Mo ta hinh) · rl (Ke lai bai giang) · rts (Ung xu tinh huong) · sgd (Tom tat thao luan nhom)
//
// ⚠️ APP KHONG CHAM DUOC NHU PEARSON. Pearson cham Content bang may + NGUOI; con
// phat am va do troi chay la may cham rieng cua ho. O day:
//   - Form (dem tu / mot cau)  -> app tu cham CHINH XAC theo luat Score Guide 07/2025.
//   - Content, ngu phap, tu vung, chinh ta, cau truc -> Gemini GOP Y theo DUNG mo ta
//     thang cham chep tu Score Guide (api/content/pte-rubrics.json). Day la UOC LUONG,
//     KHONG PHAI DIEM PTE — man hinh phai noi ro.
//   - Phat am, do troi chay (Noi) -> KHONG cham. Chi hien chi bao tho (tu/phut, ngung).
// Luat Pearson ap lai o day: Content = 0 hoac Form = 0 thi cac tieu chi khac = 0.
// Van mau hoc thuoc => Content 0 (rules.template_zero trong pte-exam-facts.json).

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bankPath = resolve(here, '..', 'content', 'pte-open.json');
const rubricPath = resolve(here, '..', 'content', 'pte-rubrics.json');

export type OpenType = 'swt' | 'we' | 'sst' | 'di' | 'rl' | 'rts' | 'sgd';
export const OPEN_TYPES: OpenType[] = ['di', 'rl', 'rts', 'sgd', 'swt', 'sst', 'we'];
export const OPEN_WRITING = new Set<OpenType>(['swt', 'we', 'sst']);
export const OPEN_MAX_LEVEL = 3;

export type Chart = {
  kind: 'bar' | 'line' | 'pie' | 'table';
  title: string;
  unit: string;
  labels: string[];
  series: { name: string; values: number[] }[];
};
export type Turn = { speaker: 'A' | 'B' | 'C'; name: string; text: string };

type Base = { id: string; level: number; topic: string; source: string; license: string; key_points: string[] };
// Moi kieu MOT gia tri `type` — de TypeScript loai duoc nhanh.
export type OpenItem =
  | (Base & { type: 'swt'; text: string })
  | (Base & { type: 'we'; prompt: string })
  | (Base & { type: 'sst'; script: string })
  | (Base & { type: 'rl'; script: string })
  | (Base & { type: 'di'; chart: Chart })
  | (Base & { type: 'rts'; situation: string })
  | (Base & { type: 'sgd'; turns: Turn[] });

/** Thoi gian nhu de that (giay chuan bi / giay tra loi, hoac so phut viet). */
export const TIMING: Record<OpenType, { prep_s?: number; answer_s?: number; minutes?: number }> = {
  di: { prep_s: 25, answer_s: 40 },
  rl: { prep_s: 10, answer_s: 40 },
  rts: { prep_s: 20, answer_s: 40 },
  sgd: { prep_s: 10, answer_s: 120 },
  swt: { minutes: 10 },
  sst: { minutes: 10 },
  we: { minutes: 20 },
};

/** Giong doc cho tung nguoi trong bai thao luan nhom — ba giong khac han nhau. */
export const SGD_VOICE: Record<Turn['speaker'], string> = { A: 'am_michael', B: 'af_bella', C: 'bm_george' };

// ---------------------------------------------------------------------------
// Nap du lieu
// ---------------------------------------------------------------------------

export type Trait = { name: string; max: number; who: 'ai' | 'app' | 'none' };
type Rubrics = { source: string; checked_at: string; types: Record<OpenType, { traits: Trait[]; rubric: string }> };

function loadRubrics(): Rubrics | null {
  if (!existsSync(rubricPath)) return null;
  try {
    return JSON.parse(readFileSync(rubricPath, 'utf8')) as Rubrics;
  } catch (e) {
    console.warn(`[pte-open] ${rubricPath} hong: ${(e as Error).message}`);
    return null;
  }
}
export const RUBRICS = loadRubrics();

function loiDe(it: OpenItem): string | null {
  if (!it.id || !Number.isInteger(it.level) || it.level < 1 || it.level > OPEN_MAX_LEVEL) return 'id/level';
  if (!Array.isArray(it.key_points) || it.key_points.length < 2) return 'can >= 2 key_points';
  switch (it.type) {
    case 'swt':
      return it.text?.trim() ? null : 'thieu text';
    case 'we':
      return it.prompt?.trim() ? null : 'thieu prompt';
    case 'sst':
    case 'rl':
      return it.script?.trim() ? null : 'thieu script';
    case 'rts':
      return it.situation?.trim() ? null : 'thieu situation';
    case 'sgd':
      return Array.isArray(it.turns) && it.turns.length >= 4 && it.turns.every((t) => SGD_VOICE[t.speaker] && t.text?.trim())
        ? null
        : 'turns hong';
    case 'di': {
      const c = it.chart;
      if (!c || !['bar', 'line', 'pie', 'table'].includes(c.kind)) return 'chart.kind';
      if (!c.labels?.length || !c.series?.length) return 'chart rong';
      if (c.series.some((s) => s.values?.length !== c.labels.length || s.values.some((v) => typeof v !== 'number'))) return 'chart: so gia tri lech nhan';
      return null;
    }
  }
  return 'type';
}

function load(): OpenItem[] {
  if (!existsSync(bankPath)) {
    console.warn(`[pte-open] khong thay ${bankPath} — man Noi/Viet se rong`);
    return [];
  }
  let raw: { items?: OpenItem[] };
  try {
    raw = JSON.parse(readFileSync(bankPath, 'utf8'));
  } catch (e) {
    console.warn(`[pte-open] ${bankPath} hong: ${(e as Error).message}`);
    return [];
  }
  const out: OpenItem[] = [];
  const ids = new Set<string>();
  for (const it of raw.items ?? []) {
    if (!OPEN_TYPES.includes(it?.type)) continue;
    const loi = ids.has(it.id) ? 'id trung' : loiDe(it);
    if (loi) {
      console.warn(`[pte-open] bo de ${it?.id}: ${loi}`);
      continue;
    }
    ids.add(it.id);
    out.push({ ...it, topic: it.topic ?? '', license: it.license ?? '' });
  }
  return out;
}

export const OPEN: OpenItem[] = load();

export function getOpen(id: string): OpenItem | undefined {
  return OPEN.find((x) => x.id === id);
}

function xao<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function pickOpen(type: OpenType, level: number, n: number, exclude?: Set<string>): OpenItem[] {
  const pool = OPEN.filter((x) => x.type === type && x.level === level);
  if (!pool.length) return [];
  const moi = exclude ? pool.filter((x) => !exclude.has(x.id)) : pool;
  const cu = exclude ? pool.filter((x) => exclude.has(x.id)) : [];
  return [...xao(moi), ...xao(cu)].slice(0, Math.max(1, Math.min(n, pool.length)));
}

/** Van ban TTS doc cho bai co nghe. sgd doc TUNG luot, giong rieng. */
export function spokenText(it: OpenItem, turn?: number): { text: string; voice?: string } | null {
  if (it.type === 'sst' || it.type === 'rl') return { text: it.script };
  if (it.type === 'rts') return { text: it.situation };
  if (it.type === 'sgd') {
    const t = it.turns[turn ?? 0];
    return t ? { text: t.text, voice: SGD_VOICE[t.speaker] } : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ban cho client — KHONG co key_points; bai chi-nghe KHONG co chu
// ---------------------------------------------------------------------------

export type OpenView = {
  id: string;
  type: OpenType;
  level: number;
  topic: string;
  source: string;
  license: string;
  timing: (typeof TIMING)[OpenType];
  /** swt: bai doc. */
  text?: string;
  /** we: de bai. */
  prompt?: string;
  /** rts: tinh huong (de that vua doc vua nghe). */
  situation?: string;
  /** di: du lieu bieu do — client tu ve. */
  chart?: Chart;
  /** Co audio khong; sgd: so luot va ten nguoi noi (khong co loi). */
  audio: boolean;
  turns?: { speaker: Turn['speaker']; name: string }[];
};

export function toView(it: OpenItem): OpenView {
  const v: OpenView = {
    id: it.id,
    type: it.type,
    level: it.level,
    topic: it.topic,
    source: it.source,
    license: it.license,
    timing: TIMING[it.type],
    audio: ['sst', 'rl', 'rts', 'sgd'].includes(it.type),
  };
  if (it.type === 'swt') v.text = it.text;
  if (it.type === 'we') v.prompt = it.prompt;
  if (it.type === 'rts') v.situation = it.situation;
  if (it.type === 'di') v.chart = it.chart;
  if (it.type === 'sgd') v.turns = it.turns.map((t) => ({ speaker: t.speaker, name: t.name }));
  return v;
}

// ---------------------------------------------------------------------------
// Form — app tu cham CHINH XAC (Score Guide 07/2025)
// ---------------------------------------------------------------------------

export function demTu(text: string): number {
  return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

export type FormResult = { band: number; max: number; words: number; ly_do_vi: string };

export function chamForm(type: OpenType, text: string): FormResult | null {
  if (!OPEN_WRITING.has(type)) return null;
  const words = demTu(text);
  const chuCai = text.replace(/[^A-Za-z]/g, '');
  const toanHoa = chuCai.length > 3 && chuCai === chuCai.toUpperCase();
  const dong = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const chiGachDau = dong.length > 1 && dong.every((l) => /^[-•*]\s/.test(l));
  const khongDau = !/[.,;:!?]/.test(text);

  if (type === 'swt') {
    // Mot cau duy nhat: khong co dau ket cau (. ! ?) nao o GIUA roi cau moi.
    const cauGiua = /[.!?]["')\]]?\s+\S/.test(text.trim());
    if (toanHoa) return { band: 0, max: 1, words, ly_do_vi: 'Viết toàn chữ IN HOA — Pearson cho Form 0.' };
    if (cauGiua) return { band: 0, max: 1, words, ly_do_vi: 'Có hơn một câu. Tóm tắt bài đọc phải là MỘT câu duy nhất.' };
    if (words < 5 || words > 75) return { band: 0, max: 1, words, ly_do_vi: `${words} từ — phải từ 5 đến 75 từ.` };
    return { band: 1, max: 1, words, ly_do_vi: `Một câu, ${words} từ — đạt.` };
  }
  if (toanHoa) return { band: 0, max: 2, words, ly_do_vi: 'Viết toàn chữ IN HOA — Pearson cho Form 0.' };
  if (khongDau) return { band: 0, max: 2, words, ly_do_vi: 'Không có dấu câu — Pearson cho Form 0.' };
  if (chiGachDau) return { band: 0, max: 2, words, ly_do_vi: 'Chỉ gồm gạch đầu dòng — Pearson cho Form 0.' };
  if (type === 'we') {
    if (words >= 200 && words <= 300) return { band: 2, max: 2, words, ly_do_vi: `${words} từ — trong khoảng 200–300.` };
    if ((words >= 120 && words <= 199) || (words >= 301 && words <= 380)) {
      return { band: 1, max: 2, words, ly_do_vi: `${words} từ — ngoài 200–300 nhưng trong 120–380, mất 1 điểm Form.` };
    }
    return { band: 0, max: 2, words, ly_do_vi: `${words} từ — dưới 120 hoặc trên 380, Form 0 và cả bài không được chấm tiếp.` };
  }
  // sst
  if (words >= 50 && words <= 70) return { band: 2, max: 2, words, ly_do_vi: `${words} từ — trong khoảng 50–70.` };
  if ((words >= 40 && words <= 49) || (words >= 71 && words <= 100)) {
    return { band: 1, max: 2, words, ly_do_vi: `${words} từ — ngoài 50–70 nhưng trong 40–100, mất 1 điểm Form.` };
  }
  return { band: 0, max: 2, words, ly_do_vi: `${words} từ — dưới 40 hoặc trên 100, Form 0 và cả bài không được chấm tiếp.` };
}

// ---------------------------------------------------------------------------
// Loi nhan cho Gemini
// ---------------------------------------------------------------------------

const TEN_DANG: Record<OpenType, string> = {
  swt: 'Summarize Written Text',
  we: 'Write Essay',
  sst: 'Summarize Spoken Text',
  di: 'Describe Image',
  rl: 'Retell Lecture',
  rts: 'Respond to a Situation',
  sgd: 'Summarize Group Discussion',
};

function vatLieu(it: OpenItem): string {
  switch (it.type) {
    case 'swt':
      return `PASSAGE THE LEARNER READ:\n${it.text}`;
    case 'we':
      return `ESSAY PROMPT:\n${it.prompt}`;
    case 'sst':
    case 'rl':
      return `LECTURE THE LEARNER HEARD (transcript):\n${it.script}`;
    case 'rts':
      return `SITUATION (read and heard):\n${it.situation}`;
    case 'sgd':
      return `GROUP DISCUSSION THE LEARNER HEARD:\n${it.turns.map((t) => `${t.name} (${t.speaker}): ${t.text}`).join('\n')}`;
    case 'di': {
      const c = it.chart;
      const rows = c.series.map((s) => `${s.name}: ${c.labels.map((l, i) => `${l} = ${s.values[i]}`).join(', ')}`).join('\n');
      return `IMAGE (a ${c.kind} chart) titled "${c.title}"${c.unit ? `, unit: ${c.unit}` : ''}:\n${rows}`;
    }
  }
}

export function buildPrompt(
  it: OpenItem,
  response: string,
  extra: string,
): { system: string; user: string; traits: Trait[] } {
  const r = RUBRICS?.types[it.type];
  const traits = (r?.traits ?? []).filter((t) => t.who === 'ai');
  const system = [
    'You are an experienced, strict PTE Academic rater. Rate the learner response using ONLY the official Pearson descriptors given below — use the full scale and do not be generous; a typical B1 response sits in the middle of the scale.',
    'Then coach the learner, a Vietnamese speaker, in plain everyday Vietnamese (why_vi, template_vi, fixes[].why_vi, summary_vi). Keep English examples in English.',
    'RULES: (1) Rate exactly these traits, each an integer from 0 to its maximum: ' +
      traits.map((t) => `"${t.name}" (0-${t.max})`).join(', ') +
      '. Do not rate Form, Pronunciation or Oral Fluency. (2) Pearson rule: responses containing pre-prepared or memorised material (generic template sentences that would fit any prompt) are irrelevant — if so, set template_like=true, explain in template_vi, and give Content 0. (3) key_points: return every key point given, with covered true only if the response clearly conveys it. (4) fixes: up to 5 corrections of the learner\'s OWN sentences (you_said = their words, better = corrected English). (5) better_en: one model response of the right length for this task type. (6) summary_vi: 2-4 sentences of the most useful advice.',
    OPEN_WRITING.has(it.type)
      ? 'The response was typed.'
      : 'The response was SPOKEN and transcribed by speech recognition: ignore punctuation and small recognition errors; judge content and language only.',
    `OFFICIAL DESCRIPTORS for ${TEN_DANG[it.type]} (PTE Academic Test Taker Score Guide, July 2025):\n${r?.rubric ?? '(missing)'}`,
  ].join('\n\n');
  const user = [
    `TASK: ${TEN_DANG[it.type]}`,
    vatLieu(it),
    `KEY POINTS (for your checking only):\n${it.key_points.map((k) => `- ${k}`).join('\n')}`,
    extra,
    `LEARNER RESPONSE:\n${response.trim() || '(empty)'}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  return { system, user, traits };
}

/** Van ban cho nguoi hoc xem SAU khi nop (bai nghe, bai thao luan). */
export function materialAfter(it: OpenItem): string | null {
  if (it.type === 'sst' || it.type === 'rl') return it.script;
  if (it.type === 'sgd') return it.turns.map((t) => `${t.name}: ${t.text}`).join('\n');
  return null;
}
