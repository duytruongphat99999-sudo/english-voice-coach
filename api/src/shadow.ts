// Shadowing — nghe cau mau va noi de theo gan nhu cung luc, tre khoang nua giay.
//
// VI SAO LAM, BAM PTE:
// PTE cham Oral Fluency theo nhip, ngat cum va do deu. Shadowing luyen dung
// thu do bang cach bat chuoc. Hai che do o day khop dung hai dang bai PTE:
//   'rs' — 60 cau Repeat Sentence. Doi 12/09: hien chu mac dinh, tat chu duoc
//   'ra' — 12 doan Read Aloud tach thanh cau, NHIN CHU khi shadow (dung ky nang RA)
//
// THU MOI MA CHUA MAN NAO CO: DO NHIP. So moc thoi gian tung tu cua nguoi hoc
// voi moc thoi gian tung tu cua cau mau.
//
// ⚠️ CHI BAO NHIP KHONG PHAI DIEM ORAL FLUENCY CUA PTE. PTE con cham trong am,
// ngu dieu, ngat cum theo nghia — app khong lam duoc (khong co forced alignment,
// khong phan tich cao do). Day chi do "nhanh/cham hon mau" va "ngat cho nao
// khac mau".
//
// ⚠️ KHONG do duoc do tre TUYET DOI giua mau va nguoi: mic mo mat mot khoang
// khong xac dinh truoc khi thu that, nen moc 0 cua ban ghi khong trung moc 0
// cua audio mau. Vi vay moi so do deu TUONG DOI — lay tu dau tien ghep duoc
// lam goc cho ca hai ben.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cfg, TOPICS } from './config.js';
import { PTE_SENTENCES } from './pte.js';
import { READ_ALOUD } from './pte-speaking.js';
import { mergeElision, normalize, tokenize, type HeardWord } from './pronounce.js';
import { synthesize } from './tts.js';
import { transcribe } from './stt.js';

/**
 * Nguon cau. Duy chot 10/09: shadowing la mot PHUONG PHAP hoc, khong phai mot
 * dang bai PTE — nen dung duoc cho moi noi dung, khong chi cau de thi.
 *   rs     — 60 cau Repeat Sentence. Doi 12/09: HIEN chu mac dinh, co nut tat
 *            chu de luyen dung dieu kien thi (Duy: "khong co chu sao nhai noi")
 *   ra     — 12 doan Read Aloud tach cau, nhin chu
 *   vocab  — cau vi du cua 240 tu vung, nhin chu
 *   lesson — cau trong bai hoc 20 chu de (chang Phat am), nhin chu
 */
export type ShadowMode = 'rs' | 'ra' | 'vocab' | 'lesson';

export type ShadowItem = {
  id: string;
  mode: ShadowMode;
  text: string;
  /** Chi 'ra' co cap do; con lai null. */
  level: number | null;
  /** Nhom de hien tren man: ten chu de (vocab/lesson), null voi cau PTE. */
  group: string | null;
  /** Nghia tieng Viet neu co san trong noi dung. */
  vi: string | null;
  /** Diem phat am can chu y — chi cau bai hoc co san truong nay. */
  focus_vi: string | null;
};

// ---------------------------------------------------------------------------
// Nguon cau
// ---------------------------------------------------------------------------

/**
 * Tach doan Read Aloud thanh cau. An toan vi bo de da viet theo luat: khong co
 * "Dr.", khong so thap phan, khong viet tat (xem truong note cua file de).
 */
function tachCau(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 4);
}

function buildItems(): ShadowItem[] {
  const out: ShadowItem[] = [];
  const bare = { group: null, vi: null, focus_vi: null };
  for (const s of PTE_SENTENCES) out.push({ id: `rs:${s.id}`, mode: 'rs', text: s.text, level: null, ...bare });
  for (const p of READ_ALOUD) {
    tachCau(p.text).forEach((c, i) =>
      out.push({ id: `ra:${p.id}:${i}`, mode: 'ra', text: c, level: p.level, ...bare }),
    );
  }
  // Noi dung chu de (tieng Anh). Tieng Phap se them khi co noi dung dot B.
  for (const t of TOPICS) {
    t.vocab.forEach((v, i) => {
      if (!v.example_en?.trim()) return;
      out.push({
        id: `vocab:${t.id}:${i}`,
        mode: 'vocab',
        text: v.example_en.trim(),
        level: null,
        group: t.name_vi,
        vi: v.example_vi?.trim() || null,
        focus_vi: null,
      });
    });
    t.sentences.forEach((c, i) => {
      if (!c.en?.trim()) return;
      out.push({
        id: `lesson:${t.id}:${i}`,
        mode: 'lesson',
        text: c.en.trim(),
        level: null,
        group: t.name_vi,
        vi: c.vi?.trim() || null,
        focus_vi: c.focus_vi?.trim() || null,
      });
    });
  }
  return out;
}

export const SHADOW_ITEMS: ShadowItem[] = buildItems();

export function getShadowItem(id: string): ShadowItem | undefined {
  return SHADOW_ITEMS.find((x) => x.id === id);
}

/** Rut n cau cua mot che do. Fisher-Yates, KHONG dung sort(random). */
export function pickShadow(mode: ShadowMode, n: number, level?: number): ShadowItem[] {
  const pool = SHADOW_ITEMS.filter((x) => x.mode === mode && (level == null || x.level === level));
  const a = pool.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, Math.max(1, Math.min(n, a.length)));
}

// ---------------------------------------------------------------------------
// Moc thoi gian cua cau mau
//
// Kokoro KHONG tra moc thoi gian tung tu. Cach lay: cho chinh Whisper nghe
// audio mau. Do that 10/09: mat 2-7 giay moi cau — nen PHAI luu lai, giong
// cach tts.ts luu giong doc. Ten file la hash cua (giong|toc do|cau).
// ---------------------------------------------------------------------------

type TimedWord = { word: string; start: number; end: number };
type RefTiming = { words: TimedWord[]; duration: number };

const cacheDir = resolve(cfg.dataDir, 'shadow-cache');
let cacheReady = false;

function cachePath(text: string): string {
  const key = `${cfg.tts.model}|${cfg.tts.voice}|${cfg.tts.speed}|${cfg.stt.model}|${text}`;
  return resolve(cacheDir, `${createHash('sha1').update(key).digest('hex')}.json`);
}

export async function refTiming(text: string): Promise<RefTiming> {
  if (!cacheReady) {
    try {
      mkdirSync(cacheDir, { recursive: true });
      cacheReady = true;
    } catch {
      /* khong tao duoc thi van tinh, chi la khong luu */
    }
  }
  const p = cachePath(text);
  try {
    const j = JSON.parse(readFileSync(p, 'utf8')) as RefTiming;
    if (j.words?.length) return j;
  } catch {
    /* chua co */
  }

  const mp3 = await synthesize(text);
  const said = await transcribe(mp3, 'ref.mp3', 'audio/mpeg', { words: true });
  const out: RefTiming = {
    words: said.words.map((w) => ({ word: w.word, start: w.start, end: w.end })),
    duration: said.duration_s,
  };
  if (cacheReady && out.words.length) {
    try {
      const tmp = `${p}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(out));
      renameSync(tmp, p);
    } catch {
      /* ghi hong khong duoc lam hong luot hoc */
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// So nhip
// ---------------------------------------------------------------------------

/** Chuan hoa danh sach tu co moc: gop elision, normalize, bo token rong. */
function chuanHoa(words: TimedWord[]): (TimedWord & { k: string })[] {
  return mergeElision(words as unknown as HeardWord[])
    .map((w) => {
      const t = w as unknown as TimedWord;
      return { ...t, k: normalize(t.word) };
    })
    .filter((w) => w.k.length > 0);
}

/**
 * Day con chung dai nhat giua hai day token. Tra ve cac cap (i, j) khop
 * CHINH XAC. Dung LCS chu khong dung Needleman-Wunsch cua pronounce.ts: o day
 * chi can biet tu nao chac chan la cung mot tu de lay moc thoi gian, khong
 * can cham diem gan dung.
 */
function lcs(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i += 1;
    else j += 1;
  }
  return pairs;
}

export type WordTiming = {
  /** Tu trong CAU GOC. */
  word: string;
  /**
   * Lech so voi mau, mili giay, SAU KHI da bu toc do chung. Duong = noi muon
   * hon nhip mau, am = noi som hon. null = khong ghep duoc (noi thieu, sai tu,
   * hoac may nghe mau khong ra tu nay).
   */
  offset_ms: number | null;
  /** Ngung truoc tu nay dai hon mau bao nhieu mili giay. null = khong so duoc. */
  extra_pause_ms: number | null;
};

export type ShadowTiming = {
  /**
   * Toc do tuong doi: thoi gian nguoi / thoi gian mau, tren doan tu dau toi tu
   * cuoi ghep duoc. 1,00 = khop; 1,20 = cham hon 20%; 0,85 = nhanh hon 15%.
   */
  tempo_ratio: number | null;
  /** Trung binh |lech|, mili giay, tren cac tu ghep duoc. */
  mean_offset_ms: number | null;
  /** So tu ghep duoc moc thoi gian / tong tu cau goc. */
  matched: number;
  total: number;
  /** So cho ngung thua (ngung dai hon mau tren 400 ms). */
  extra_pauses: number;
  words: WordTiming[];
};

const NGUNG_THUA_MS = 400;

export function soNhip(text: string, ref: RefTiming, heard: TimedWord[]): ShadowTiming {
  const T = tokenize(text);
  const R = chuanHoa(ref.words);
  const H = chuanHoa(heard);

  const tr = new Map(lcs(T, R.map((x) => x.k)));
  const th = new Map(lcs(T, H.map((x) => x.k)));

  // Tu cau goc ghep duoc CA hai ben.
  const both: number[] = [];
  for (let t = 0; t < T.length; t += 1) if (tr.has(t) && th.has(t)) both.push(t);

  const words: WordTiming[] = T.map((w) => ({ word: w, offset_ms: null, extra_pause_ms: null }));

  if (both.length < 2) {
    return { tempo_ratio: null, mean_offset_ms: null, matched: both.length, total: T.length, extra_pauses: 0, words };
  }

  const t0 = both[0]!;
  const tN = both[both.length - 1]!;
  const r0 = R[tr.get(t0)!]!;
  const h0 = H[th.get(t0)!]!;
  const rSpan = R[tr.get(tN)!]!.end - r0.start;
  const hSpan = H[th.get(tN)!]!.end - h0.start;
  const ratio = rSpan > 0 ? hSpan / rSpan : null;

  let sumAbs = 0;
  let extraPauses = 0;
  let prev: number | null = null;

  for (const t of both) {
    const r = R[tr.get(t)!]!;
    const h = H[th.get(t)!]!;
    // Bu toc do chung truoc khi so: nguoi noi cham deu 20% thi tung tu KHONG
    // bi tinh la lech — cai do da nam trong tempo_ratio roi.
    const hRel = ratio ? (h.start - h0.start) / ratio : h.start - h0.start;
    const rRel = r.start - r0.start;
    const off = Math.round((hRel - rRel) * 1000);
    words[t]!.offset_ms = off;
    sumAbs += Math.abs(off);

    if (prev !== null) {
      const rp = R[tr.get(prev)!]!;
      const hp = H[th.get(prev)!]!;
      // Chi so ngung giua hai tu LIEN KE trong cau goc — bo mot tu o giua thi
      // khoang lang do khong con so sanh duoc.
      if (t === prev + 1) {
        const gapR = r.start - rp.end;
        const gapH = h.start - hp.end;
        const extra = Math.round((gapH - gapR) * 1000);
        words[t]!.extra_pause_ms = extra;
        if (extra > NGUNG_THUA_MS) extraPauses += 1;
      }
    }
    prev = t;
  }

  return {
    tempo_ratio: ratio ? Math.round(ratio * 100) / 100 : null,
    mean_offset_ms: Math.round(sumAbs / both.length),
    matched: both.length,
    total: T.length,
    extra_pauses: extraPauses,
    words,
  };
}

// ---------------------------------------------------------------------------
// Chu chay theo giong mau (karaoke) — them 11/09
// ---------------------------------------------------------------------------

/** Mot chu TREN MAN (giu dau cau) kem moc giay trong audio mau. */
export type KaraWord = { w: string; s: number; e: number };

/**
 * Moc thoi gian cho tung chu hien tren man, de chu sang dan theo giong mau.
 *
 * Lay tu chinh RefTiming da luu (khong ton them lan Whisper nao). Ghep chu voi
 * moc bang cung LCS nhu soNhip. Chu Whisper nghe khong ra thi chia khoang giua
 * hai chu ke theo do dai chu — lech co 0,1 giay, mat nguoi khong nhan ra.
 *
 * Token chi co dau cau (vd "—") gop vao chu dung truoc, de khong co o nao
 * sang ma khong co chu.
 *
 * null = khong co gi de dua vao (audio mau rong / Whisper khong tra gi).
 */
export function karaoke(text: string, ref: RefTiming): KaraWord[] | null {
  const shown: string[] = [];
  for (const w of text.trim().split(/\s+/).filter(Boolean)) {
    if (!normalize(w) && shown.length) shown[shown.length - 1] += ` ${w}`;
    else shown.push(w);
  }
  if (!shown.length) return null;

  const keys = shown.map((w) => normalize(w));
  const R = chuanHoa(ref.words);
  const dur = ref.duration > 0 ? ref.duration : (R[R.length - 1]?.end ?? 0);
  if (dur <= 0) return null;

  const s: (number | null)[] = shown.map(() => null);
  const e: (number | null)[] = shown.map(() => null);
  // Chi cau bat dau bang dau cau moi con token rong o vi tri 0 — bo qua no khi ghep.
  const idx = keys.map((k, i) => (k ? i : -1)).filter((i) => i >= 0);
  for (const [a, b] of lcs(idx.map((i) => keys[i]!), R.map((x) => x.k))) {
    s[idx[a]!] = R[b]!.start;
    e[idx[a]!] = R[b]!.end;
  }

  // Lap khoang cho tung doan chu chua co moc.
  let j = 0;
  while (j < idx.length) {
    if (s[idx[j]!] !== null) {
      j += 1;
      continue;
    }
    let k = j;
    while (k < idx.length && s[idx[k]!] === null) k += 1;
    const run = idx.slice(j, k);
    let hi = k < idx.length ? s[idx[k]!]! : dur;
    // Doan dau cau: bat dau tu tieng dau tien Whisper nghe thay, nhung chua it
    // nhat 0,25 giay moi chu — Whisper hay nuot chu dau vao chu thu hai.
    const lo = j > 0 ? e[idx[j - 1]!]! : Math.max(0, Math.min(R[0]?.start ?? 0, hi - 0.25 * run.length));
    if (hi < lo) hi = lo;
    const tong = run.reduce((acc, i) => acc + Math.max(1, keys[i]!.length), 0);
    let t = lo;
    for (const i of run) {
      const d = ((hi - lo) * Math.max(1, keys[i]!.length)) / tong;
      s[i] = t;
      e[i] = t + d;
      t += d;
    }
    j = k;
  }

  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return shown.map((w, i) => ({ w, s: r3(s[i] ?? 0), e: r3(e[i] ?? s[i] ?? 0) }));
}

// ---------------------------------------------------------------------------
// Doan van — che do "Nghe roi noi lai ca doan" (them 11/09)
//
// Duy chot 11/09: AI doc TUNG CAU, nguoi hoc noi lai, tu sang cau sau cho het
// doan. Dung lai dung cac cau shadowing co san (cung id) nen /shadow/say,
// /shadow/prep, /shadow/answer dung nguyen — khong them noi dung moi.
//   ra     — 12 doan Read Aloud, 3-4 cau moi doan
//   lesson — 20 chu de bai hoc, 8 cau moi chu de
// ---------------------------------------------------------------------------

export type ShadowPassage = {
  /** 'ra:<id doan>' | 'lesson:<id chu de>' */
  id: string;
  src: 'ra' | 'lesson';
  title: string;
  /** Chu phu ngan: cap do (ra) hoac nhom chu de (lesson). */
  sub: string;
  emoji: string | null;
  level: number | null;
  items: { id: string; text: string; vi: string | null; focus_vi: string | null }[];
};

function buildPassages(): ShadowPassage[] {
  const out = new Map<string, ShadowPassage>();
  for (const x of SHADOW_ITEMS) {
    if (x.mode !== 'ra' && x.mode !== 'lesson') continue;
    // id cau: 'ra:<doan>:<i>' | 'lesson:<chu de>:<i>' — xem buildItems.
    const key = x.id.split(':')[1] ?? '';
    const id = `${x.mode}:${key}`;
    let p = out.get(id);
    if (!p) {
      if (x.mode === 'ra') {
        const ra = READ_ALOUD.find((r) => r.id === key);
        p = { id, src: 'ra', title: ra?.topic ?? key, sub: `Đọc to · cấp ${x.level ?? '?'}`, emoji: null, level: x.level, items: [] };
      } else {
        const t = TOPICS.find((r) => r.id === key);
        p = { id, src: 'lesson', title: t?.name_vi ?? key, sub: 'Câu trong bài học', emoji: t?.emoji ?? null, level: null, items: [] };
      }
      out.set(id, p);
    }
    p.items.push({ id: x.id, text: x.text, vi: x.vi, focus_vi: x.focus_vi });
  }
  // Mot cau thi khong phai "doan".
  return [...out.values()].filter((p) => p.items.length >= 2);
}

export const SHADOW_PASSAGES: ShadowPassage[] = buildPassages();
