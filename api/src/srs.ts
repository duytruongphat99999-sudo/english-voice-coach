// SM-2 (SuperMemo 2). Nguyen ban, khong che bien.
//
//   grade 0-5. >= 3 la nho duoc.
//   sai (grade < 3): reps ve 0, interval ve 1 => mai gap lai.
//   dung: interval 1 -> 6 -> round(interval * ease)
//   ease' = ease + (0.1 - (5-g)*(0.08 + (5-g)*0.02)), san duoi 1.3
//
// Card moi: ease=2.5, interval=0, reps=0, due=now (spec §7).

import { fsrs, generatorParameters, createEmptyCard, Rating, State, type Card, type Grade } from 'ts-fsrs';

export type SrsState = { ease: number; interval: number; reps: number };
export type SrsNext = { ease: number; interval: number; reps: number; due_date: string };

export function sm2(prev: SrsState, grade: number): SrsNext {
  const g = Math.max(0, Math.min(5, Math.round(grade)));

  let ease = prev.ease + (0.1 - (5 - g) * (0.08 + (5 - g) * 0.02));
  if (ease < 1.3) ease = 1.3;

  let reps: number;
  let interval: number;

  if (g < 3) {
    // Quen. Khong phat ease qua nang, nhung keo lich ve sat.
    reps = 0;
    interval = 1;
  } else {
    reps = prev.reps + 1;
    if (reps === 1) interval = 1;
    else if (reps === 2) interval = 6;
    else interval = Math.round(prev.interval * ease);
    if (interval < 1) interval = 1;
  }

  return {
    ease: Math.round(ease * 1000) / 1000,
    interval,
    reps,
    due_date: addDaysIso(interval),
  };
}

// due_date luu dang YYYY-MM-DD de so sanh chuoi truc tiep trong SQL.
function addDaysIso(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toLocaleDateString('en-CA', { timeZone: process.env.TZ || 'Asia/Ho_Chi_Minh' });
}

export function initialDue(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: process.env.TZ || 'Asia/Ho_Chi_Minh' });
}


// ---------------------------------------------------------------------------
// FSRS-6 (ts-fsrs). Thay SM-2 lam thuat toan chinh tu 02/09/2026.
//
// Vi sao doi: SM-2 chi mang MOT bien `ease` di theo the. FSRS tach lam hai —
// stability (nho duoc bao lau) va difficulty (the nay kho toi dau voi nguoi hoc
// nay) — nen khoang on bam duong cong quen sat hon.
//
// `sm2()` ben tren GIU NGUYEN, khong xoa. Doi y thi tro applyGrade() ve no la
// lui duoc ngay, vi cac cot ease/interval/reps cung con nguyen trong DB.
// ---------------------------------------------------------------------------

// enable_short_term: false la BAT BUOC voi app nay.
// Mac dinh FSRS xep lich giai doan learning theo PHUT. DB o day luu due_date dang
// YYYY-MM-DD de so chuoi thang trong SQL, nen lich phut bi lam tron thanh "hom nay"
// => the quay lai lien tuc trong ngay. Tat di thi moi khoang deu tinh bang ngay.
const fsrsParams = generatorParameters({
  enable_short_term: false,
  enable_fuzz: true,
  request_retention: 0.9,
  maximum_interval: 365,
});
const engine = fsrs(fsrsParams);

export type FsrsState = {
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
  due_date: string;
};

export type FsrsNext = {
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: number;
  scheduled_days: number;
  last_review: string;
  due_date: string;
};

/**
 * Diem phat am 0-100 -> 4 muc cua FSRS.
 *
 * Nguong 60 giu nguyen y nghia cua `grade >= 3` thoi SM-2, de ranh gioi
 * "dat / khong dat" ma nguoi dung nhin thay khong doi.
 *
 * NGUONG `Easy` PHAI HIEM. Trong FSRS, Easy khong co nghia la "dung" — no co
 * nghia la "de den muc dung hoi lai toi lau that lau", va no nhan stability
 * len rat manh. Ban dau nguong nay dat o 90, nhung do that tren chinh app nay
 * cho thay doc dung mot tu quen deu ra 100/100 (ke ca khi noi ca cau), tuc la
 * gan nhu MOI lan on thanh cong deu ban Easy. Ket qua do bang mo phong:
 *
 *   >=90 -> Easy :  8d ->  66d -> 365d -> 367d   (3 lan dung la bien mat 1 nam)
 *   >=97 -> Easy :  3d ->  14d ->  57d -> 196d   (duong cong that su gian dan)
 *
 * On dung 3 lan roi mat tu do mot nam thi khong con la spaced repetition nua.
 */
export function scoreToRating(score: number): Grade {
  if (score >= 97) return Rating.Easy;
  if (score >= 80) return Rating.Good;
  if (score >= 60) return Rating.Hard;
  return Rating.Again;
}

/**
 * Duoi day la duong dung THAT SU cua man On tu, thay cho scoreToRating.
 *
 * VI SAO PHAI CO HAM RIENG — doc truoc khi don gon lai:
 *
 * scoreToRating nhan diem tu `matchPhrase`, va thang diem do KHONG deu tay.
 *
 * ⚠️ SUA LAI 06/09/2026 — doan nay truoc day ghi "matchPhrase chi sinh
 * 100 / 85 / 50 / 0, KHONG CO GIA TRI NAO trong khoang 86-96". DO LA SAI, va
 * cai sai do da lam khoi 04/09 tin rang keo nguong Easy la vo ich.
 *
 * Diem la round(hit / so_tu * 100), voi `hit` cong don theo tung tu tu
 * {1 · 0,9 · 0,6 · 0,5 · 0}, nen cum cang dai thang cang min. Voi cum 1-5 tu
 * (do dai that cua 240 the trong api/content) co 83 gia tri khac nhau, rieng
 * khoang 86-99 da co 14 gia tri. Cai gap 86-96 khong he ton tai.
 *
 * Do that ngay 06/09 bang vong TTS -> STT tren DU 240 the: doc chuan cho 8 gia
 * tri (0 · 43 · 50 · 64 · 67 · 75 · 85 · 100); them cac bien the loi thi co
 * tiep 90 · 95 · 97 · 98.
 *
 * BAI HOC THAT SU khong phai "thang diem roi rac" ma la: DUNG DO PHAN PHOI
 * BANG CACH DUT SO VAO HAM. Ca hai lan mac loi truoc (02/09 chieu va 04/09)
 * deu la dut so; lan nay do bang am thanh that thi ra khac han. Ai muon chinh
 * nguong o day thi chay lai vong TTS -> STT tren api/content TRUOC DA.
 *
 * Cai sai goc o cho khac: DIEM PHAT AM KHONG PHAI DO CHAC TRI NHO. Nguoi bat
 * ra tu trong mot giay va nguoi nghi tam giay deu duoc 100 neu doc ro, trong
 * khi FSRS can biet nho DE hay nho KHO. Nen tu 04/09 rating an theo hai thu:
 * doc co dung khong, va bat ra co nhanh khong.
 *
 *   Easy  = doc chuan (>=97) VA bat ra duoi FAST_MS
 *   Good  = doc dat (>=80)
 *   Hard  = doc dat nhung nghi lau hon SLOW_MS, hoac diem 60-79
 *   Again = duoi 60
 *
 * Khong biet thoi gian (thinkMs = null, client cu) thi KHONG BAO GIO Easy —
 * mac dinh phai la ben an toan, vi Easy sai thi mat tu ca nam.
 *
 * ⚠️ HAI MOC NAY CHUA CO DU LIEU THAT DE CHUAN HOA. Toi 04/09/2026 app co 0
 * luot on that, nen 3,5s va 8,0s la uoc luong: nguoi hoc phai doc xong mot cum
 * tieng Viet ("chinh sach gia theo so luong") roi moi cham mic, rieng viec doc
 * da het khoang mot giay. Sau vai tram luot, do lai phan phoi thuc te roi
 * chinh — dung tin hai so nay nhu su that.
 */
// ⚠️ NOI 07/09: 3_500 -> 6_000 va 8_000 -> 12_000.
//
// Do tren 250 the (may doc chuan cho may nghe): o moc 3,4 giay co 219 the dat
// Easy, o 4,0 giay con 0. Tuc 3,5s khong phai mot moc — no la mot VACH DA dat
// ngay giua vung nguoi dung that se roi vao.
//
// Ba thu cong don vao khoang thoi gian do, ma khong thu nao la "nghi lau":
//   1. doc xong de bai — mot cum tieng Viet trung vi 4 tu, p90 7 tu, dai nhat 13;
//   2. nho ra tu tieng Anh;
//   3. trinh duyet bat mic (getUserMedia + tao MediaRecorder) — xem MicButton.
// Rieng (1) da het khoang mot giay.
//
// VAN CHUA CO DU LIEU THAT de chuan hoa: app moi co 6 luot on that. Hai so nay
// van la uoc luong, chi khac la uoc luong o phia RONG TAY thay vi chat tay.
const FAST_MS = 6_000;
const SLOW_MS = 12_000;

export function reviewRating(score: number, thinkMs: number | null): Grade {
  if (score < 60) return Rating.Again;

  // Thoi gian am, hoac lau qua muc vo ly (may khoa man hinh giua chung, tab bi
  // treo nen), thi coi nhu khong do duoc.
  const t = thinkMs !== null && Number.isFinite(thinkMs) && thinkMs >= 0 && thinkMs <= 120_000 ? thinkMs : null;

  if (score >= 97 && t !== null && t <= FAST_MS) return Rating.Easy;
  if (score >= 80) return t !== null && t > SLOW_MS ? Rating.Hard : Rating.Good;
  return Rating.Hard;
}

export function fsrsNext(prev: FsrsState, score: number, now: Date = new Date()): FsrsNext {
  return fsrsNextRated(prev, scoreToRating(score), now);
}

/** Nhu fsrsNext nhung nhan thang muc FSRS, de goi duoc reviewRating o ngoai. */
export function fsrsNextRated(prev: FsrsState, rating: Grade, now: Date = new Date()): FsrsNext {
  // stability = 0 nghia la the chua tung duoc FSRS cham (ke ca the cu thoi SM-2)
  // => bat dau tu the rong, trang thai New. Khong co gi de chuyen doi.
  const card: Card =
    prev.stability > 0
      ? {
          due: parseLocalDate(prev.due_date, now),
          stability: prev.stability,
          difficulty: prev.difficulty,
          elapsed_days: 0,
          scheduled_days: 0,
          learning_steps: 0,
          reps: prev.reps,
          lapses: prev.lapses,
          state: prev.state as State,
          last_review: prev.last_review ? new Date(prev.last_review) : undefined,
        }
      : createEmptyCard(now);

  const out = engine.next(card, now, rating).card;

  return {
    stability: Math.round(out.stability * 10_000) / 10_000,
    difficulty: Math.round(out.difficulty * 10_000) / 10_000,
    reps: out.reps,
    lapses: out.lapses,
    state: out.state,
    scheduled_days: out.scheduled_days,
    last_review: now.toISOString(),
    due_date: toLocalDate(out.due),
  };
}

/** FSRS tra ve Date thuc; DB nay so chuoi YYYY-MM-DD theo gio VN. */
function toLocalDate(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: process.env.TZ || 'Asia/Ho_Chi_Minh' });
}

/** due_date trong DB chi co ngay. Doc lai thanh Date, hong thi lay `now`. */
function parseLocalDate(s: string, fallback: Date): Date {
  const t = Date.parse(s + 'T00:00:00');
  return Number.isNaN(t) ? fallback : new Date(t);
}
