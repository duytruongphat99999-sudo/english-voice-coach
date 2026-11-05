// Repeat Sentence + Write from Dictation — hai task PTE Academic.
//
// VI SAO CHI LAM HAI TASK NAY, khong lam Describe Image / Re-tell Lecture:
//
// PTE cham hai task nay bang SO TU DUNG THEO DUNG THU TU, khong dung toi am vi.
// Do dung bang cach `pronounce.score()` da hoat dong (canh chuoi tu bang
// Needleman-Wunsch). Nghia la o day bo cham cua app khong phai xap xi — no
// dung mo hinh. Cac task noi dai thi diem an theo fluency + noi dung, ma cham
// phat am muc am vi thi may nay khong gong noi (xem pronounce.ts dong 1-16),
// nen lam ra cung khong tin duoc con so.
//
// Hai task nay cung la hai task nang ky nhat cua bai thi: Repeat Sentence an
// diem ca Listening lan Speaking; Write from Dictation la task co gia tri moi
// cau cao nhat toan bai va KHONG dinh phat am ti nao.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { score, tokenize, type PronounceScore, type HeardWord } from './pronounce.js';

const here = dirname(fileURLToPath(import.meta.url));
const sentencesPath = resolve(here, '..', 'content', 'pte-sentences.json');

export type PteSentence = { id: string; text: string };

function load(): PteSentence[] {
  if (!existsSync(sentencesPath)) {
    console.warn(`[pte] khong thay ${sentencesPath} — hai man PTE se rong`);
    return [];
  }
  const raw = JSON.parse(readFileSync(sentencesPath, 'utf8')) as { sentences?: PteSentence[] };
  return (raw.sentences ?? []).filter((s) => s.id && s.text);
}

export const PTE_SENTENCES: PteSentence[] = load();

export function getSentence(id: string): PteSentence | undefined {
  return PTE_SENTENCES.find((s) => s.id === id);
}

/**
 * Rut n cau, khong trung nhau.
 *
 * Xao bang chi so cua Fisher-Yates. KHONG dung `sort(() => Math.random() - .5)`:
 * kieu do lech phan phoi, cuoi bang bi rut it hon han dau bang.
 */
export function pickSentences(n: number): PteSentence[] {
  const idx = PTE_SENTENCES.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  return idx.slice(0, Math.max(1, Math.min(n, idx.length))).map((i) => PTE_SENTENCES[i]!);
}

export type PteResult = {
  /** Diem kieu PTE: so tu KHOP CHINH XAC / tong so tu, 0-100. */
  pte_score: number;
  /** Tu dung / tong tu — con so nguoi hoc thuc su can nhin. */
  correct: number;
  total: number;
  /** So tu bi rung duoi (-s, -ed, -t...). Lop loi nang nhat cua nguoi Viet. */
  dropped_endings: number;
  /** Diem mem cua pronounce.score(), giu de doi chieu — KHONG phai diem PTE. */
  raw_score: number;
  words: PronounceScore['words'];
  extra: string[];
};

/**
 * Cham mot cau.
 *
 * `strict = true` cho Write from Dictation: nguoi hoc GO chu, nen sai chinh ta
 * hay sai dang tu deu la sai han — PTE khong cho diem mot phan o day. Chi
 * `ok` (khop chinh xac) moi duoc tinh.
 *
 * `strict = false` cho Repeat Sentence: nguoi hoc NOI, nen `weak` (Whisper
 * nghe ra dung tu nhung khong chac) van tinh la dung. Rieng `ending` KHONG
 * duoc tinh vao `correct` du o che do nao — rung duoi la mat tu that trong
 * PTE, va giau no di thi hong ca muc dich cua bai luyen.
 */
export function gradeSentence(target: string, heard: HeardWord[], strict: boolean): PteResult {
  const s = score(target, heard);
  const total = tokenize(target).length;
  const correct = strict ? s.summary.ok : s.summary.ok + s.summary.weak;

  return {
    pte_score: total === 0 ? 0 : Math.round((correct / total) * 100),
    correct,
    total,
    dropped_endings: s.summary.ending,
    raw_score: s.score,
    words: s.words,
    extra: s.extra,
  };
}

/** Chuoi da go -> dang `heard` cua pronounce.score(). Khong co do tu tin. */
export function typedToHeard(text: string): HeardWord[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ({ word }));
}
