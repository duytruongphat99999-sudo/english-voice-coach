// Cac thao tac DB co logic nghiep vu. db.ts chi lo schema va ket noi.
import { db, todayLocal, daysAgoLocal, nowIso, getOrCreateToday, type DailyRow } from './db.js';
import { cfg } from './config.js';
import { sm2, fsrsNext, fsrsNextRated, type SrsState, type FsrsState } from './srs.js';
import type { Grade } from 'ts-fsrs';
import type { VocabItem } from './llm.js';

export type VocabRow = {
  id: number;
  word: string;
  /** 'en' | 'fr'. The cu deu la 'en' (mac dinh cot). */
  lang?: string;
  meaning_vi: string;
  example_en: string;
  domain: string;
  source_session_id: number | null;
  created_at: string;
  ease: number;
  interval: number;
  reps: number;
  due_date: string;
  last_grade: number | null;
  // Them o migration (xem db.ts). The cu tu truoc do co the chua co gia tri.
  topic_id: string | null;
  ipa: string;
  kind: string;
  // FSRS-6 (02/09/2026)
  stability: number;
  difficulty: number;
  fsrs_state: number;
  lapses: number;
  last_review: string | null;
};

// ---------------------------------------------------------------------------
// Vocab
// ---------------------------------------------------------------------------

/**
 * Nap tu moi vao deck. Card moi khoi tao ease=2.5 interval=0 reps=0 due=hom nay
 * (spec §7) — nhung due thuc te la NGAY MAI, vi tu vua hoc hom nay ma bat on
 * ngay trong ngay thi khong con la spaced repetition nua.
 *
 * Tra ve so tu THUC SU them moi. Tu da co trong deck bi bo qua, KHONG reset
 * lich on cua no.
 */
/**
 * Ngon ngu cua kho tu. Duy chot 07/09/2026: tieng Anh va tieng Phap la HAI
 * KHONG GIAN RIENG, khong dung nhau — chon ngay khi vao app.
 *
 * Moi ham doc kho tu deu PHAI loc theo lang. Quen mot cho la the tieng Phap
 * lot vao buoi on tieng Anh, va nguoc lai.
 */
export type Lang = 'en' | 'fr';
export const DEFAULT_LANG: Lang = 'en';
export function asLang(v: unknown): Lang {
  return v === 'fr' ? 'fr' : 'en';
}

export function addVocab(items: VocabItem[], sessionId: number | null, lang: Lang = DEFAULT_LANG): number {
  if (!items.length) return 0;
  const ins = db.prepare(`
    INSERT INTO vocab (word, meaning_vi, example_en, domain, source_session_id,
                       created_at, ease, interval, reps, due_date, lang)
    VALUES (?, ?, ?, ?, ?, ?, 2.5, 0, 0, ?, ?)
    ON CONFLICT DO NOTHING
  `);
  const due = tomorrowLocal();
  let added = 0;
  for (const v of items) {
    const word = (v.word ?? '').trim();
    if (!word || word.length > 80) continue;
    const r = ins.run(
      word,
      (v.meaning_vi ?? '').trim(),
      (v.example_en ?? '').trim(),
      (v.domain ?? '').trim(),
      sessionId,
      nowIso(),
      due,
      lang,
    );
    if (r.changes > 0) added += 1;
  }
  return added;
}

function tomorrowLocal(): string {
  return new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', {
    timeZone: process.env.TZ || 'Asia/Ho_Chi_Minh',
  });
}

export function dueVocab(limit = 20, lang: Lang = DEFAULT_LANG): VocabRow[] {
  return db
    .prepare('SELECT * FROM vocab WHERE lang = ? AND due_date <= ? ORDER BY due_date ASC, id ASC LIMIT ?')
    .all(lang, todayLocal(), limit) as unknown as VocabRow[];
}

export function dueCount(lang: Lang = DEFAULT_LANG): number {
  const r = db.prepare('SELECT COUNT(*) AS n FROM vocab WHERE lang = ? AND due_date <= ?').get(lang, todayLocal()) as
    | { n: number }
    | undefined;
  return r?.n ?? 0;
}

export function getVocab(id: number): VocabRow | undefined {
  return db.prepare('SELECT * FROM vocab WHERE id = ?').get(id) as unknown as VocabRow | undefined;
}

/**
 * Cham xong mot the: recompute lich on bang FSRS-6 va ghi lai.
 *
 * `score` la diem phat am 0-100 (nguyen ban), KHONG phai grade da lam tron.
 * Di thang tu score sang 4 muc cua FSRS de khong mat thong tin qua hai lan lam tron.
 *
 * `grade` 0-5 kieu SM-2 van duoc ghi vao cot last_grade va tra ve cho web hien
 * thi "Diem nho x/5" — doi khoa tra ve la vo co phai sua ca frontend.
 *
 * Cot ease/interval/reps cu KHONG bi dong toi: con nguyen de lui ve sm2() duoc.
 */
export function applyGrade(row: VocabRow, grade: number, score: number, rating?: Grade) {
  const prev: FsrsState = {
    stability: row.stability ?? 0,
    difficulty: row.difficulty ?? 0,
    reps: row.reps,
    lapses: row.lapses ?? 0,
    state: row.fsrs_state ?? 0,
    last_review: row.last_review ?? null,
    due_date: row.due_date,
  };
  // Co `rating` thi dung thang (man On tu tu 04/09 tron ca thoi gian phan xa
  // vao — xem srs.reviewRating). Khong co thi giu duong cu suy tu score.
  const next = rating !== undefined ? fsrsNextRated(prev, rating, new Date()) : fsrsNext(prev, score);

  db.prepare(
    'UPDATE vocab SET stability = ?, difficulty = ?, fsrs_state = ?, lapses = ?, last_review = ?, reps = ?, interval = ?, due_date = ?, last_grade = ? WHERE id = ?',
  ).run(
    next.stability,
    next.difficulty,
    next.state,
    next.lapses,
    next.last_review,
    next.reps,
    next.scheduled_days,
    next.due_date,
    grade,
    row.id,
  );

  // Giu nguyen hinh dang tra ve cua ban SM-2 de routes/review.ts va web khong doi.
  return {
    ease: row.ease,
    interval: next.scheduled_days,
    reps: next.reps,
    due_date: next.due_date,
  };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export type TranscriptTurn = {
  role: 'user' | 'model';
  text: string;
  at: string;
  corrections?: unknown[];
  /** difficulty_note Gemini tu ghi lai cho luot sau (spec §8). */
  note?: string;
};

/** Note calibrate do kho tu luot gan nhat, de nap lai vao system prompt. */
export function lastDifficultyNote(id: number): string | undefined {
  const t = readTranscript(id);
  for (let i = t.length - 1; i >= 0; i -= 1) {
    const n = t[i]?.note;
    if (n) return n;
  }
  return undefined;
}

export function createSession(scenario: string, level: string): number {
  const r = db
    .prepare('INSERT INTO sessions (scenario, level, started_at, transcript_json) VALUES (?, ?, ?, ?)')
    .run(scenario, level, nowIso(), '[]');
  return Number(r.lastInsertRowid);
}

export function getSession(id: number) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
    | { id: number; scenario: string; level: string; started_at: string; ended_at: string | null; transcript_json: string }
    | undefined;
}

export function readTranscript(id: number): TranscriptTurn[] {
  const s = getSession(id);
  if (!s) return [];
  try {
    const t = JSON.parse(s.transcript_json);
    return Array.isArray(t) ? t : [];
  } catch {
    return [];
  }
}

export function appendTranscript(id: number, turns: TranscriptTurn[]) {
  const cur = readTranscript(id);
  cur.push(...turns);
  db.prepare('UPDATE sessions SET transcript_json = ? WHERE id = ?').run(JSON.stringify(cur), id);
}

export function endSession(id: number) {
  db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL').run(nowIso(), id);
}

/** Dem luot NOI cua nguoi hoc trong session (dung de biet da du ~8 luot chua). */
export function userTurnCount(id: number): number {
  return readTranscript(id).filter((t) => t.role === 'user').length;
}

// ---------------------------------------------------------------------------
// Daily + streak
// ---------------------------------------------------------------------------

export function bumpDaily(field: 'vocab_reviewed' | 'scenario_done' | 'presentation_done', by = 1): DailyRow {
  getOrCreateToday();
  // by = 0 duoc phep: nguoi goi chi muon bao dam hom nay da co dong trong
  // bang `daily` ma khong cong them gi.
  if (by !== 0) db.prepare(`UPDATE daily SET ${field} = ${field} + ? WHERE date = ?`).run(by, todayLocal());
  return getOrCreateToday();
}

/**
 * Streak chi tang khi `completed` LAN DAU chuyen tu 0 sang 1 trong ngay.
 * Goi ham nay nhieu lan trong cung mot ngay khong cong don.
 *
 * Dieu kien hoan thanh (spec §7): du Buoc 1 (on it nhat 1 tu) + Buoc 2
 * (xong 1 roleplay). Neu hom nay khong co tu nao den han thi Buoc 1 duoc
 * mien — nguoi hoc khong the on cai khong ton tai.
 */
export function completeDailyIfReady(force = false): DailyRow {
  const row = getOrCreateToday();
  if (row.completed === 1) return row;

  const step1 = row.vocab_reviewed > 0 || dueCountExcludingToday() === 0;
  const step2 = row.scenario_done > 0;
  if (!force && !(step1 && step2)) return row;

  const y = db.prepare('SELECT streak FROM daily WHERE date = ?').get(daysAgoLocal(1)) as
    | { streak: number }
    | undefined;
  const streak = (y?.streak ?? 0) + 1;

  db.prepare('UPDATE daily SET completed = 1, streak = ? WHERE date = ?').run(streak, todayLocal());
  return getOrCreateToday();
}

/**
 * So tu den han, tinh o thoi diem "truoc khi hoc hom nay". Dung de biet
 * Buoc 1 co the bo qua duoc hay khong — neu deck rong thi khong bat on.
 */
function dueCountExcludingToday(): number {
  // PHAI CUNG phep dem voi trang chu (dueCount -> /today.due_count), neu khong la
  // trang chu bao "Buoc 1 xong" ma ngay khong bao gio chot — ngo cut (review 16/09).
  //
  // ⚠️ 16/09 bo ve `(last_grade IS NULL OR due_date < hom nay)` (co tu thoi SM-2):
  // last_grade la cot VINH VIEN — the nao tung on deu co — nen ve do loai nham MOI
  // the da tung on toi han DUNG hom nay (truong hop pho bien nhat), va chi tro
  // chuyen la chot duoc ngay du chua on tu nao. The on HOM NAY khong can loai
  // rieng: FSRS chay enable_short_term:false nen due_date moi luon >= ngay mai
  // (review 16/09 tai hien tren ban sao DB that: 22 the den han, ham cu dem ra 2).
  //
  // The bi "De sau" HOM NAY (due_date = mai) KHONG duoc dem — giu dung hanh vi dang
  // chay: bam "De sau" het thi Buoc 1 coi nhu xong. Chu thich cu o day tung muon
  // dem chung (de "De sau" khong chot duoc ngay) nhung SQL chua bao gio lam vay;
  // muon luat chat hon thi phai sua CA trang chu + cho on lai the da de sau (de xuat
  // 16/09, cho Duy quyet — Duy dang ban, khong nho luat cu).
  const r = db
    .prepare('SELECT COUNT(*) AS n FROM vocab WHERE lang = ? AND due_date <= ?')
    .get(DEFAULT_LANG, todayLocal()) as { n: number } | undefined;
  return r?.n ?? 0;
}

/**
 * "De sau" — day rieng due_date cua mot the ra `days` ngay, KHONG dong vao FSRS.
 *
 * TUYET DOI khong cham stability / difficulty / fsrs_state / lapses / reps /
 * last_review / last_grade / interval. Do la toan bo mo hinh tri nho cua the;
 * mot lan bam nut go bi khong duoc phep ghi vao do.
 *
 * Vi sao khong ghi Again: do bang chinh engine FSRS trong container — mot lan
 * Again keo day khoang on tu 3-12-52-180 ngay xuong 1-3-8-20 va day difficulty
 * 2,10 -> 6,38 VINH VIEN. Ly do bam bo qua thuong khong phai quen tu (on, hong
 * mic, met, STT loi 502), nen ghi lapse la ghi sai su that vao mo hinh.
 *
 * Vi sao khong ghi Hard: trong FSRS, Hard la mot lan NHO DUOC. Bam Hard sau lan
 * lien tiep tren the moi day lich ra 2-5-12-16-25-36 ngay, stability len 35,16,
 * lapses van 0. Mot tu chua lan nao noi dung ma bien mat 36 ngay la hong.
 */
export function buryVocab(id: number, days = 1): string {
  const next = new Date(Date.now() + days * 86_400_000).toLocaleDateString('en-CA', {
    timeZone: cfg.tz,
  });
  db.prepare('UPDATE vocab SET due_date = ?, buried_on = ? WHERE id = ?').run(next, todayLocal(), id);
  return next;
}

/**
 * Streak hien tai. Doc tu bang chu khong tin gia tri cu: neu hom qua va hom
 * nay deu chua completed thi chuoi da dut, phai tra 0.
 */
export function currentStreak(): number {
  const today = db.prepare('SELECT completed, streak FROM daily WHERE date = ?').get(todayLocal()) as
    | { completed: number; streak: number }
    | undefined;
  if (today?.completed === 1) return today.streak;

  const y = db.prepare('SELECT completed, streak FROM daily WHERE date = ?').get(daysAgoLocal(1)) as
    | { completed: number; streak: number }
    | undefined;
  // Hom nay chua xong nhung hom qua xong => chuoi con song, chua dut.
  if (y?.completed === 1) return y.streak;
  return 0;
}

/** Scenario goi y: cai lau chua tap nhat. */
export function suggestScenario(all: { id: string }[]): string {
  const rows = db
    .prepare('SELECT scenario, MAX(started_at) AS last FROM sessions GROUP BY scenario')
    .all() as unknown as { scenario: string; last: string }[];
  const seen = new Map(rows.map((r) => [r.scenario, r.last]));
  const never = all.find((s) => !seen.has(s.id));
  if (never) return never.id;
  const sorted = [...all].sort((a, b) => (seen.get(a.id) ?? '').localeCompare(seen.get(b.id) ?? ''));
  return sorted[0]?.id ?? all[0]?.id ?? '';
}

export { todayLocal, nowIso, getOrCreateToday };
export type { DailyRow };

// ---------------------------------------------------------------------------
// Lo trinh: 20 chu de x 4 tang
// ---------------------------------------------------------------------------

export type StageRow = {
  topic_id: string;
  stage: number;
  done: number;
  score: number | null;
  items_done: number;
  updated_at: string;
};

/**
 * So mucs DA LAM va diem, tinh THANG TU drill_attempts chu khong tu bo dem.
 *
 * Ly do: nguoi hoc lam lai mot muc la chuyen binh thuong, va neu cong don
 * bo dem thi lam lai 3 lan mot tu se hien "3/12 muc" trong khi moi xong 1.
 * Diem lay ban TOT NHAT cua moi muc — lam lai de sua thi phai duoc tinh.
 */
export function stageStats(topicId: string, stage: number): { items: number; score: number | null } {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS items, AVG(best) AS avg FROM (
         SELECT item_index, MAX(score) AS best
         FROM drill_attempts WHERE topic_id = ? AND stage = ?
         GROUP BY item_index
       )`,
    )
    .get(topicId, stage) as { items: number; avg: number | null } | undefined;
  return { items: r?.items ?? 0, score: r?.avg === null || r?.avg === undefined ? null : Math.round(r.avg) };
}

export function recordAttempt(a: {
  topicId: string;
  stage: number;
  itemIndex: number;
  target: string;
  said: string;
  score: number;
  detail: unknown;
}) {
  db.prepare(
    `INSERT INTO drill_attempts (topic_id, stage, item_index, target, said, score, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(a.topicId, a.stage, a.itemIndex, a.target, a.said, a.score, JSON.stringify(a.detail ?? {}), nowIso());

  const st = stageStats(a.topicId, a.stage);
  db.prepare(
    `INSERT INTO topic_progress (topic_id, stage, done, score, items_done, updated_at)
     VALUES (?, ?, 0, ?, ?, ?)
     ON CONFLICT(topic_id, stage) DO UPDATE SET score = excluded.score,
                                                items_done = excluded.items_done,
                                                updated_at = excluded.updated_at`,
  ).run(a.topicId, a.stage, st.score, st.items, nowIso());
  return st;
}

export function markStageDone(topicId: string, stage: number): StageRow {
  const st = stageStats(topicId, stage);
  db.prepare(
    `INSERT INTO topic_progress (topic_id, stage, done, score, items_done, updated_at)
     VALUES (?, ?, 1, ?, ?, ?)
     ON CONFLICT(topic_id, stage) DO UPDATE SET done = 1,
                                                score = excluded.score,
                                                items_done = excluded.items_done,
                                                updated_at = excluded.updated_at`,
  ).run(topicId, stage, st.score, st.items, nowIso());
  return db.prepare('SELECT * FROM topic_progress WHERE topic_id = ? AND stage = ?').get(topicId, stage) as unknown as StageRow;
}

export function progressFor(topicId: string): StageRow[] {
  return db
    .prepare('SELECT * FROM topic_progress WHERE topic_id = ? ORDER BY stage')
    .all(topicId) as unknown as StageRow[];
}

export function allProgress(): StageRow[] {
  return db.prepare('SELECT * FROM topic_progress ORDER BY topic_id, stage').all() as unknown as StageRow[];
}

/**
 * Tang cao nhat dang duoc mo cho mot chu de (1..4).
 * Chu de thi mo het tu dau — chi TANG la khoa tuan tu, vi thang do kho nam
 * ben trong mot chu de: nhan mat tu -> doc duoc -> tu bat ra -> dung that.
 */
export function unlockedStage(rows: StageRow[]): number {
  let stage = 1;
  for (let s = 1; s <= 3; s += 1) {
    if (rows.find((r) => r.stage === s)?.done === 1) stage = s + 1;
    else break;
  }
  return stage;
}

/**
 * Nap 12 tu cua chu de vao kho on tap khi hoc xong Tang 1.
 *
 * Dung `ON CONFLICT DO NOTHING` nen hoc lai Tang 1 khong lam reset lich on
 * cua tu da thuoc. due = ngay mai, giong tu do Gemini dao ra.
 */
export function addCourseVocab(
  topicId: string,
  items: { word: string; ipa: string; meaning_vi: string; example_en: string }[],
  lang: Lang = DEFAULT_LANG,
): number {
  const ins = db.prepare(
    `INSERT INTO vocab (word, meaning_vi, example_en, domain, topic_id, ipa, kind,
                        source_session_id, created_at, ease, interval, reps, due_date, lang)
     VALUES (?, ?, ?, ?, ?, ?, 'course', NULL, ?, 2.5, 0, 0, ?, ?)
     ON CONFLICT DO NOTHING`,
  );
  const due = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', {
    timeZone: process.env.TZ || 'Asia/Ho_Chi_Minh',
  });
  let added = 0;
  for (const v of items) {
    const w = (v.word ?? '').trim();
    if (!w) continue;
    const r = ins.run(w, v.meaning_vi ?? '', v.example_en ?? '', topicId, topicId, v.ipa ?? '', nowIso(), due, lang);
    if (r.changes > 0) added += 1;
  }
  return added;
}

/** Danh sach chu de co tu trong kho — cho bo loc o man On tu. */
export function vocabTopics(lang: Lang = DEFAULT_LANG): { topic_id: string; n: number; due: number }[] {
  return db
    .prepare(
      `SELECT COALESCE(topic_id, domain) AS topic_id,
              COUNT(*) AS n,
              SUM(CASE WHEN due_date <= ? THEN 1 ELSE 0 END) AS due
       FROM vocab WHERE lang = ? GROUP BY COALESCE(topic_id, domain) ORDER BY due DESC, n DESC`,
    )
    .all(todayLocal(), lang) as unknown as { topic_id: string; n: number; due: number }[];
}

/** Tu den han, loc theo chu de neu can. */
export function dueVocabIn(
  topicId: string | undefined,
  limit: number,
  lang: Lang = DEFAULT_LANG,
): VocabRow[] {
  if (!topicId) return dueVocab(limit, lang);
  return db
    .prepare(
      `SELECT * FROM vocab
       WHERE lang = ? AND due_date <= ? AND COALESCE(topic_id, domain) = ?
       ORDER BY due_date ASC, id ASC LIMIT ?`,
    )
    .all(lang, todayLocal(), topicId, limit) as unknown as VocabRow[];
}

// ---------------------------------------------------------------------------
// Kho 500 tu tieng Phap (dot B, 12/09/2026)
//
// Nap mot lan bang scripts/seed-fr-deck.sh vao HANG DOI (kind='deck',
// due_date = HANG_DOI_FR). Hai tran cung luc: moi ngay toi da FR_NEW_PER_DAY tu
// "cua hom nay" (mo hom nay HOAC hoc lan dau hom nay — markFrFirstSeen), VA so tu
// da mo ma chua hoc khong bao gio vuot FR_NEW_PER_DAY (chi BU cho du).
// Bo hoc vai ngay thi tu moi khong don lai; hoc 14/15 thi hom sau van co 15 tu
// moi (1 cu + 14 mo them), khong phai chi 1.
// Tu cua bai hoc (kind='course', 12 tu/chu de) KHONG qua hang doi: hoc xong
// chang 1 la mai phai on, nhu tieng Anh.
// ---------------------------------------------------------------------------
export const HANG_DOI_FR = '9999-12-31';
export const FR_NEW_PER_DAY = 15;

export function seedFrDeck(words: { word: string; ipa: string; meaning_vi: string; example_fr: string; group: string }[]): number {
  const ins = db.prepare(
    `INSERT INTO vocab (word, meaning_vi, example_en, domain, topic_id, ipa, kind,
                        source_session_id, created_at, ease, interval, reps, due_date, lang)
     VALUES (?, ?, ?, ?, ?, ?, 'deck', NULL, ?, 2.5, 0, 0, ?, 'fr')
     ON CONFLICT DO NOTHING`,
  );
  let added = 0;
  for (const w of words) {
    const word = (w.word ?? '').trim();
    if (!word) continue;
    const r = ins.run(word, w.meaning_vi ?? '', w.example_fr ?? '', w.group, w.group, w.ipa ?? '', nowIso(), HANG_DOI_FR);
    if (r.changes > 0) added += 1;
  }
  return added;
}

/** Mo them tu moi cho hom nay (goi truoc moi lan doc kho tieng Phap). Tra so tu vua mo. */
export function releaseFrNew(perDay = FR_NEW_PER_DAY): number {
  const today = todayLocal();
  const one = (sql: string, ...p: string[]) => (db.prepare(sql).get(...p) as { n: number } | undefined)?.n ?? 0;
  const moHomNay = one(`SELECT COUNT(*) AS n FROM vocab WHERE lang = 'fr' AND kind = 'deck' AND introduced_on = ?`, today);
  const moChuaHoc = one(`SELECT COUNT(*) AS n FROM vocab WHERE lang = 'fr' AND kind = 'deck' AND introduced_on IS NOT NULL AND reps = 0`);
  const allow = Math.max(0, Math.min(perDay - moHomNay, perDay - moChuaHoc));
  if (!allow) return 0;
  const r = db
    .prepare(
      `UPDATE vocab SET due_date = ?, introduced_on = ?
       WHERE id IN (SELECT id FROM vocab WHERE lang = 'fr' AND kind = 'deck' AND introduced_on IS NULL ORDER BY id LIMIT ?)`,
    )
    .run(today, today, allow);
  return Number(r.changes);
}

/**
 * Lan DAU tra loi mot the kho: doi introduced_on sang HOM NAY.
 *
 * Tran "15 tu/ngay" dem theo introduced_on = hom nay. Neu cot chi ghi ngay MO,
 * thi hom nao hoc 15 tu ton tu hom truoc, releaseFrNew lai mo them 15 tu nua ngay
 * trong buoi do -> 30 tu moi mot buoi (bat duoc 16/09 khi chay thu qua ngay khac).
 * Ghi lai ngay HOC LAN DAU thi moi ngay gap toi da 15 tu moi, ke ca tu ton.
 */
export function markFrFirstSeen(id: number): void {
  db.prepare(
    `UPDATE vocab SET introduced_on = ? WHERE id = ? AND lang = 'fr' AND kind = 'deck' AND reps = 0`,
  ).run(todayLocal(), id);
}

/** The tieng Phap den han: on lai truoc, tu moi sau. */
export function dueVocabFr(limit = 20): VocabRow[] {
  releaseFrNew();
  return db
    .prepare(
      `SELECT * FROM vocab WHERE lang = 'fr' AND due_date <= ?
       ORDER BY CASE WHEN reps = 0 THEN 1 ELSE 0 END, due_date ASC, id ASC LIMIT ?`,
    )
    .all(todayLocal(), limit) as unknown as VocabRow[];
}

export function frDeckSummary() {
  releaseFrNew();
  const today = todayLocal();
  const one = (sql: string, ...p: string[]) => (db.prepare(sql).get(...p) as { n: number } | undefined)?.n ?? 0;
  return {
    total: one(`SELECT COUNT(*) AS n FROM vocab WHERE lang = 'fr'`),
    // FSRS tang reps ca khi tra loi "quen" => reps >= 3 mot minh dem ca the dang quen.
    learned: one(`SELECT COUNT(*) AS n FROM vocab WHERE lang = 'fr' AND reps >= 3 AND last_grade >= 3`),
    due: one(`SELECT COUNT(*) AS n FROM vocab WHERE lang = 'fr' AND due_date <= ?`, today),
    due_new: one(`SELECT COUNT(*) AS n FROM vocab WHERE lang = 'fr' AND due_date <= ? AND reps = 0`, today),
    waiting: one(`SELECT COUNT(*) AS n FROM vocab WHERE lang = 'fr' AND kind = 'deck' AND introduced_on IS NULL`),
    per_day: FR_NEW_PER_DAY,
  };
}

// ---------------------------------------------------------------------------
// PTE — lich su lam bai va cap do
//
// Tach hoan toan khoi topic_progress / drill_attempts / daily. Ba bang do la
// cua LO TRINH HOC (20 chu de, 4 chang), con day la cua LUYEN THI. Tron vao
// nhau thi phan tram lo trinh o trang chu sai, va streak doi dinh nghia.
// ---------------------------------------------------------------------------

export type PteAttemptRow = {
  id: number;
  task: string;
  item_id: string;
  level: number;
  score: number;
  correct: number;
  total: number;
  transcript: string;
  detail_json: string;
  created_at: string;
};

export function recordPteAttempt(a: {
  task: string;
  itemId: string;
  level?: number;
  score: number;
  correct?: number;
  total?: number;
  transcript?: string;
  detail?: unknown;
}): void {
  db.prepare(
    `INSERT INTO pte_attempts (task, item_id, level, score, correct, total, transcript, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    a.task,
    a.itemId,
    a.level ?? 1,
    Math.round(a.score),
    a.correct ?? 0,
    a.total ?? 0,
    (a.transcript ?? '').slice(0, 2000),
    JSON.stringify(a.detail ?? {}),
    nowIso(),
  );
}

/** N lan gan nhat cua mot dang bai. */
export function recentPteAttempts(task: string, limit = 20): PteAttemptRow[] {
  return db
    .prepare('SELECT * FROM pte_attempts WHERE task = ? ORDER BY id DESC LIMIT ?')
    .all(task, limit) as unknown as PteAttemptRow[];
}

/** Da lam nhung de nao cua dang bai nay (de khoi rut trung). */
export function pteDoneItemIds(task: string, sinceDays = 30): Set<string> {
  const rows = db
    .prepare('SELECT DISTINCT item_id FROM pte_attempts WHERE task = ? AND created_at >= ?')
    .all(task, new Date(Date.now() - sinceDays * 86_400_000).toISOString()) as unknown as {
    item_id: string;
  }[];
  return new Set(rows.map((r) => r.item_id));
}

export type PteLevelState = {
  level: number;
  /** So bai da lam o cap do hien tai. */
  done: number;
  /** Diem trung binh cua toi da PASS_WINDOW bai gan nhat o cap do hien tai. */
  avg: number;
  /** Con thieu bao nhieu bai nua moi du dieu kien xet len cap. */
  need: number;
  unlocked_max: number;
};

// Mo cap khi lam DU `PASS_WINDOW` bai o cap hien tai va trung binh >= `PASS_AVG`.
//
// Bam vao DIEM THAT chu khong bam vao so buoi hoc: nguoi hoc lam nhieu ma diem
// khong len thi o lai cap do do, dung y "nang dan tu tu".
//
// PASS_AVG = 80 chu khong phai 90: bo cham cua app HIEN HON may cham PTE that
// (Whisper dung ngu canh de doan tu), nen dat nguong qua cao o day chi lam
// nguoi hoc ket lai o cap 1 trong khi thuc luc da qua. Hai so nay chua co du
// lieu that de chuan hoa — sua khi co vai chuc luot.
const PASS_WINDOW = 5;
const PASS_AVG = 80;

export function pteLevelState(task: string, maxLevel: number): PteLevelState {
  let level = 1;
  let done = 0;
  let avg = 0;

  // Di len tung cap mot: chi duoc xet cap sau khi cap truoc da dat.
  for (;;) {
    const rows = db
      .prepare(
        'SELECT score FROM pte_attempts WHERE task = ? AND level = ? ORDER BY id DESC LIMIT ?',
      )
      .all(task, level, PASS_WINDOW) as unknown as { score: number }[];
    done = rows.length;
    avg = rows.length ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length) : 0;
    const dat = rows.length >= PASS_WINDOW && avg >= PASS_AVG;
    if (!dat || level >= maxLevel) break;
    level += 1;
  }

  return {
    level,
    done,
    avg,
    need: Math.max(0, PASS_WINDOW - done),
    unlocked_max: level,
  };
}
