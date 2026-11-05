// Read Aloud — task PTE Academic, va la task NOI de cham nhat trong so cac task
// con thieu.
//
// VI SAO LAM DANG NAY TRUOC:
//
// ⚠️ SUA 11/09/2026: truoc day dong nay ghi "Read Aloud an diem CA Speaking LAN
// Reading" — SAI theo de moi. PTE Academic Test Taker Score Guide (07/2025) ghi
// Read Aloud: 6-7 cau, chi gop vao SPEAKING. Thong tin cu la cua de truoc 2025,
// cong dong luyen thi van chep lai.
//
// Ly do van dang lam dang nay: no co VAN BAN GOC co dinh ma nguoi hoc phai doc
// lai nguyen van — dung mo hinh cua pronounce.score() (canh chuoi tu bang
// Needleman-Wunsch), khong phai xap xi. Va Pearson cham Content Read Aloud dung
// kieu do: "each replacement, omission or insertion of a word counts as one error".
//
// ⚠️ APP KHONG CHAM DUOC PHAT AM. PTE cham Read Aloud theo ba tieu chi:
// Content, Oral Fluency, Pronunciation. App chi lam ra duoc CONTENT. Khong co
// forced alignment (wav2vec2 GOP / MFA can them vai GB model, speaches
// 0.8.3-cpu khong gong noi — xem pronounce.ts dong 1-16), nen:
//   - Pronunciation: KHONG hien diem, khong hien ten tieu chi do.
//   - Oral Fluency: chi hien CHI BAO THO (wpm, tu dem, so lan ngap ngung),
//     khong goi la diem.
//
// ⚠️ BO CHAM CUA APP HIEN HON MAY PTE, va cang bai dai cang lech: Whisper dung
// mo hinh ngon ngu de doan tu con may PTE thi khong. Doan cang dai, Whisper
// cang co nhieu ngu canh de tu lap cho trong. Con so % o day la MOC LUYEN TAP,
// khong phai du doan diem thi.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradeSentence, type PteResult } from './pte.js';
import type { HeardWord } from './pronounce.js';

const here = dirname(fileURLToPath(import.meta.url));
const passagesPath = resolve(here, '..', 'content', 'pte-read-aloud.json');

export type ReadAloudPassage = {
  id: string;
  level: number;
  topic: string;
  text: string;
  source?: string;
  license?: string;
};

/** Cap do cao nhat co de. Doc tu file chu khong ghim cung so 3. */
export const MAX_LEVEL = 3;

function load(): ReadAloudPassage[] {
  if (!existsSync(passagesPath)) {
    console.warn(`[pte-speaking] khong thay ${passagesPath} — man Read Aloud se rong`);
    return [];
  }
  let raw: { passages?: ReadAloudPassage[] };
  try {
    raw = JSON.parse(readFileSync(passagesPath, 'utf8'));
  } catch (e) {
    // JSON hong thi bo ca file, KHONG de app chet luc khoi dong.
    console.warn(`[pte-speaking] ${passagesPath} hong: ${(e as Error).message}`);
    return [];
  }

  const out: ReadAloudPassage[] = [];
  for (const p of raw.passages ?? []) {
    if (!p?.id || !p?.text) continue;
    const level = Number(p.level);
    if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) {
      // Bo de sai cap do, nhung noi ra. De hong ma van cham la te hon crash:
      // nguoi hoc tin vao mot con so sai.
      console.warn(`[pte-speaking] bo de ${p.id}: level=${p.level} khong hop le`);
      continue;
    }
    out.push({ ...p, level, topic: p.topic ?? '' });
  }
  return out;
}

export const READ_ALOUD: ReadAloudPassage[] = load();

export function getPassage(id: string): ReadAloudPassage | undefined {
  return READ_ALOUD.find((p) => p.id === id);
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Rut n doan o cap do da cho.
 *
 * `exclude` la nhung de da lam gan day: uu tien de MOI truoc, chi quay lai de
 * cu khi khong con de moi nao. Read Aloud khong "lo dap an" nhu MCQ, nhung doc
 * lai dung mot doan da thuoc long thi khong con do duoc gi.
 *
 * Xao bang Fisher-Yates tren mang chi so — KHONG dung
 * `sort(() => Math.random() - .5)`, kieu do lech phan phoi.
 */
export function pickPassages(level: number, n: number, exclude?: Set<string>): ReadAloudPassage[] {
  const pool = READ_ALOUD.filter((p) => p.level === level);
  if (!pool.length) return [];

  const moi = exclude ? pool.filter((p) => !exclude.has(p.id)) : pool;
  const cu = exclude ? pool.filter((p) => exclude.has(p.id)) : [];

  const xao = (arr: ReadAloudPassage[]) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  };

  return [...xao(moi), ...xao(cu)].slice(0, Math.max(1, Math.min(n, pool.length)));
}

export type ReadAloudResult = PteResult & {
  /** Tu moi phut. So sanh voi vung 140-180 cua PTE. */
  wpm: number;
  duration_s: number;
  filler_count: number;
  filler_breakdown: Record<string, number>;
  /** So lan ngung qua 0,7 giay giua hai tu, va khoang ngung dai nhat. */
  pauses: number;
  longest_pause_s: number;
  /** So tu chem them ngoai van ban. Bay rieng vi pte_score BO QUA no. */
  extra_count: number;
};

/** Nguong coi la mot lan ngap ngung. Tren muc nay thi nguoi nghe cam nhan duoc. */
const PAUSE_S = 0.7;

/**
 * Dem lan ngap ngung tu moc thoi gian tung tu cua Whisper.
 *
 * Day la thu DUY NHAT trong ca bo do noi len duoc "co doc troi khong". Khong
 * phai Oral Fluency cua PTE — PTE con cham trong am va ngat cum, thu app khong
 * lam duoc — nhung no bat duoc kieu doc tung tu mot.
 */
function demNgapNgung(words: HeardWord[]): { pauses: number; longest: number } {
  let pauses = 0;
  let longest = 0;
  for (let i = 1; i < words.length; i += 1) {
    const truoc = words[i - 1] as { end?: number };
    const nay = words[i] as { start?: number };
    if (typeof truoc.end !== 'number' || typeof nay.start !== 'number') continue;
    const gap = nay.start - truoc.end;
    if (gap > PAUSE_S) {
      pauses += 1;
      if (gap > longest) longest = gap;
    }
  }
  return { pauses, longest: Math.round(longest * 10) / 10 };
}

/**
 * Cham mot bai Read Aloud.
 *
 * Noi dung cham bang gradeSentence(strict=false) — y het Repeat Sentence, vi
 * ban chat giong nhau: co van ban goc, nguoi hoc tai tao lai bang giong noi.
 *
 * `raw_score` va `extra_count` duoc bay RIENG chu khong gop vao pte_score, vi
 * hai lo da do duoc trong bo cham: (a) pte_score bo qua hoan toan tu chem
 * thua, nen doc dung het roi chem "um" muoi lam lan van ra 100; (b) doc dung
 * het nhung Whisper khong chac (do tu tin 0,4) cung ra 100 o correct/total
 * trong khi raw_score chi con 70. Hai con so, hai y nghia — bay ca hai.
 */
export function gradeReadAloud(
  passage: ReadAloudPassage,
  heard: HeardWord[],
  transcript: string,
  durationS: number,
  /**
   * Ket qua dem tu dem, do ROUTE truyen vao.
   *
   * countFillers() nam trong routes/presentation.ts. Import nguoc tu src/ len
   * routes/ thi chay duoc nhung lat tang phu thuoc, nen nhan qua tham so —
   * van dung CHUNG mot bang tu dem voi man Record & Roast, khong chep lai.
   */
  fillers: { total: number; breakdown: Record<string, number> },
): ReadAloudResult {
  const base = gradeSentence(passage.text, heard, false);
  const { pauses, longest } = demNgapNgung(heard);

  const words = transcript.trim().split(/\s+/).filter(Boolean).length;
  const wpm = durationS > 0 ? Math.round(words / (durationS / 60)) : 0;

  return {
    ...base,
    wpm,
    duration_s: Math.round(durationS * 10) / 10,
    filler_count: fillers.total,
    filler_breakdown: fillers.breakdown,
    pauses,
    longest_pause_s: longest,
    extra_count: base.extra.length,
  };
}
