/**
 * Cham phat am bang cach doi chieu cau NGUOI HOC NOI voi cau MAU, tung tu.
 *
 * GIOI HAN, doc truoc khi tin con so:
 * Day KHONG phai cham am vi. Whisper khong biet ban phat am /θ/ thanh /t/;
 * no chi biet no co nghe ra dung tu do khong, va nghe voi bao nhieu phan tu
 * tin (`probability` tra ve kem moi tu). Cham am vi that can forced alignment
 * (wav2vec2 GOP / MFA) — them mo hinh, them vai GB, CPU nay khong gong noi.
 *
 * Nhung do cai nay van dung, vi no tra loi dung cau nguoi hoc can:
 * "noi vay nguoi ta co hieu khong".
 *
 * Rieng mot ca duoc tach ra: tu gan dung, chi lech duoi cuoi
 * (walked -> walk, books -> book). Do la loi kinh dien cua nguoi Viet — nuot
 * phu am cuoi — nen no duoc bao rieng thay vi gop chung vao "sai tu".
 */

export type WordStatus = 'ok' | 'weak' | 'ending' | 'wrong' | 'missing';

export type WordResult = {
  target: string;
  said: string | null;
  status: WordStatus;
  /** Do tu tin cua Whisper cho tu no nghe duoc, 0-1. null khi khong nghe thay. */
  probability: number | null;
};

export type PronounceScore = {
  score: number; // 0-100
  words: WordResult[];
  extra: string[]; // tu nguoi hoc noi thua
  summary: { ok: number; weak: number; ending: number; wrong: number; missing: number };
};

export type HeardWord = { word: string; probability?: number };

// Whisper hay tra so dang chu so trong khi cau mau viet bang chu (va nguoc lai).
const NUMBERS: Record<string, string> = {
  '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five',
  '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine', '10': 'ten',
  '11': 'eleven', '12': 'twelve', '13': 'thirteen', '14': 'fourteen',
  '15': 'fifteen', '16': 'sixteen', '17': 'seventeen', '18': 'eighteen',
  '19': 'nineteen', '20': 'twenty', '30': 'thirty', '40': 'forty',
  '50': 'fifty', '60': 'sixty', '70': 'seventy', '80': 'eighty',
  '90': 'ninety', '100': 'hundred', '1000': 'thousand',
};

export function normalize(raw: string): string {
  let w = raw
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'") // dau nhay cong -> nhay thang
    .replace(/[^a-z0-9'%]/g, '')
    .replace(/^'+|'+$/g, '');
  if (w === '%') return 'percent';
  w = w.replace(/%$/, '');
  return NUMBERS[w] ?? w;
}

export function tokenize(text: string): string[] {
  return text.split(/\s+/).map(normalize).filter(Boolean);
}

/**
 * Gop token bat dau bang DAU NHAY vao token dung truoc.
 *
 * ⚠️ LOI NANG NHAT CUA TIENG PHAP, do that 07/09/2026.
 *
 * Whisper cat token ngay tai dau nhay, con de bai thi giu lien:
 *   de bai      "J'ai déjà réservé une chambre à l'hôpital."
 *   Whisper tra [" J", "'ai", " déjà", ..., " l", "'hôpital."]
 *   tokenize de ["j'ai", "dj", "rserv", ..., "l'hpital"]
 * normalize() con cat tiep dau nhay dau/cuoi nen "'ai" -> "ai", "'hôpital." ->
 * "hpital". De mot token, may hai token => lech o MOI cho co elision
 * (j' l' d' qu' n' c' s' m' t'), tuc gan nhu moi cau tieng Phap.
 *
 * Do that sau khi gop, KHONG dong gi toi dau:
 *   "J'ai déjà réservé une chambre à l'hôpital."  72 -> 100
 *   "Où est la gare, s'il vous plaît ?"           83 -> 100
 * Tren 26 cau Whisper nghe dung tung chu: diem trung binh 87 -> 95,7,
 * so cau tuyet doi 10 -> 26.
 *
 * ⚠️ Xoa dau KHONG phai nguyen nhan cua loi nay — do that: giu dau 95,7 vs bo
 * dau 95,7, chenh 0. Dau van la van de that, nhung cua ky nang VIET (sai dau la
 * sai chinh ta), khong phai cua ky nang NOI.
 *
 * VO HAI VOI TIENG ANH: tieng Anh khong tach token o dau nhay ("don't" luon la
 * mot token), nen ham nay khong co gi de gop. Da kiem lai tren ca 240 the.
 */
export function mergeElision(heard: HeardWord[]): HeardWord[] {
  const out: HeardWord[] = [];
  for (const h of heard) {
    const w = (h.word ?? '').trim();
    // Bat dau bang dau nhay VA co chu dang sau => manh sau cua mot tu bi cat.
    if (out.length && /^['‘’ʼ]\S/.test(w)) {
      const prev = out[out.length - 1]!;
      out[out.length - 1] = {
        ...prev,
        word: `${prev.word}${w}`,
        // Do tu tin cua ca tu: lay muc thap hon, dung ben an toan.
        probability:
          typeof prev.probability === 'number' && typeof h.probability === 'number'
            ? Math.min(prev.probability, h.probability)
            : (prev.probability ?? h.probability),
      };
      continue;
    }
    out.push(h);
  }
  return out;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Hai tu chi khac nhau o duoi cuoi? walked/walk, books/book, uses/use. */
function differsOnlyAtEnd(target: string, said: string): boolean {
  if (target === said) return false;
  const shorter = target.length <= said.length ? target : said;
  const longer = target.length <= said.length ? said : target;
  if (shorter.length < 3) return false;
  if (!longer.startsWith(shorter)) return false;
  const tail = longer.slice(shorter.length);
  return tail.length <= 2 && /^(s|es|ed|d|t|th|ing|'s)$/.test(tail);
}

function similarity(a: string, b: string): number {
  const d = levenshtein(a, b);
  const m = Math.max(a.length, b.length);
  return m === 0 ? 1 : 1 - d / m;
}

/**
 * Dang bat quy tac cua nhung dong tu DANG duoc dung lam tu dau cua the trong
 * api/content. Danh sach do bang cach quet chinh kho noi dung (18 dong tu),
 * khong phai chep tu bang dong tu bat quy tac chung — them nua chi lam file
 * dai ra ma khong the nao gap.
 *
 * Chi phuc vu matchPhrase (man On tu). score() KHONG dung bang nay: ben do
 * dang cham phat am, "came" thay vi "come" la doc sai that.
 */
const IRREGULAR: Record<string, readonly string[]> = {
  be: ['am', 'is', 'are', 'was', 'were', 'been', 'being'],
  break: ['broke', 'broken', 'breaking'],
  catch: ['caught', 'catching'],
  come: ['came', 'coming'],
  do: ['does', 'did', 'done', 'doing'],
  get: ['got', 'gotten', 'getting'],
  go: ['goes', 'went', 'gone', 'going'],
  have: ['has', 'had', 'having'],
  hit: ['hitting'],
  keep: ['kept', 'keeping'],
  lose: ['lost', 'losing'],
  make: ['made', 'making'],
  run: ['ran', 'running'],
  split: ['splitting'],
  stick: ['stuck', 'sticking'],
  take: ['took', 'taken', 'taking'],
  throw: ['threw', 'thrown', 'throwing'],
  wear: ['wore', 'worn', 'wearing'],
};

const IRREGULAR_TO_BASE: Record<string, string> = {};
for (const [base, forms] of Object.entries(IRREGULAR)) {
  for (const f of forms) IRREGULAR_TO_BASE[f] = base;
}

/** Gap doi phu am roi them duoi: run/running, stop/stopped, plan/planning. */
function doubledConsonantForm(shorter: string, longer: string): boolean {
  if (shorter.length < 3) return false;
  const last = shorter[shorter.length - 1]!;
  if (!longer.startsWith(shorter + last)) return false;
  const tail = longer.slice(shorter.length + 1);
  return /^(ed|ing)$/.test(tail);
}

/**
 * Hai tu la CUNG MOT TU o hai dang khac nhau?
 * come/came, run/running, term/terms, apply/applied.
 *
 * Khac han `differsOnlyAtEnd`: ham kia tra loi cau hoi "co phai nuot duoi
 * khong" cho viec cham phat am, va PHAI giu chat de con bat duoc loi nuot
 * phu am cuoi cua nguoi Viet. Ham nay tra loi cau hoi khac — "nguoi hoc co
 * nho ra tu nay khong" — nen no rong hon, va chi man On tu dung.
 */
function sameWordDifferentForm(a: string, b: string): boolean {
  if (a === b) return false;
  if (differsOnlyAtEnd(a, b)) return true;

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (doubledConsonantForm(shorter, longer)) return true;

  // -ing / -es dai hon 2 ky tu nen differsOnlyAtEnd truot.
  if (longer.startsWith(shorter) && /^(ing|es|ies)$/.test(longer.slice(shorter.length))) return true;
  // apply/applied, carry/carries: bo "y" roi them duoi.
  if (shorter.endsWith('y') && longer.startsWith(shorter.slice(0, -1)) && /^(ied|ies)$/.test(longer.slice(shorter.length - 1)))
    return true;

  return IRREGULAR_TO_BASE[a] === b || IRREGULAR_TO_BASE[b] === a;
}

/**
 * Can hai chuoi tu bang Needleman-Wunsch.
 *
 * Khong dung cach ngay tho "so tu thu i voi tu thu i": chi can nguoi hoc them
 * mot tieng "uhm" o dau la moi tu sau do lech mot nac va bi cham 0 het, trong
 * khi ho doc dung ca cau.
 */
export function score(targetText: string, heard: HeardWord[]): PronounceScore {
  const target = tokenize(targetText);
  const said = mergeElision(heard)
    .map((h) => ({ w: normalize(h.word), p: typeof h.probability === 'number' ? h.probability : null }))
    .filter((h) => h.w.length > 0);

  const GAP = -1;
  const n = target.length;
  const m = said.length;

  const pairScore = (t: string, s: string): number => {
    if (t === s) return 2;
    if (differsOnlyAtEnd(t, s)) return 1;
    const sim = similarity(t, s);
    if (sim >= 0.72) return 0.5;
    return -1.5;
  };

  // Bang quy hoach dong.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i += 1) dp[i]![0] = i * GAP;
  for (let j = 1; j <= m; j += 1) dp[0]![j] = j * GAP;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      dp[i]![j] = Math.max(
        dp[i - 1]![j - 1]! + pairScore(target[i - 1]!, said[j - 1]!.w),
        dp[i - 1]![j]! + GAP,
        dp[i]![j - 1]! + GAP,
      );
    }
  }

  // Lan nguoc lay duong di.
  const words: WordResult[] = [];
  const extra: string[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (
      i > 0 &&
      j > 0 &&
      dp[i]![j] === dp[i - 1]![j - 1]! + pairScore(target[i - 1]!, said[j - 1]!.w)
    ) {
      const t = target[i - 1]!;
      const s = said[j - 1]!;
      let status: WordStatus;
      if (t === s.w) status = s.p !== null && s.p < 0.6 ? 'weak' : 'ok';
      else if (differsOnlyAtEnd(t, s.w)) status = 'ending';
      else if (similarity(t, s.w) >= 0.72) status = 'weak';
      else status = 'wrong';
      words.push({ target: t, said: s.w, status, probability: s.p });
      i -= 1;
      j -= 1;
    } else if (i > 0 && dp[i]![j] === dp[i - 1]![j]! + GAP) {
      words.push({ target: target[i - 1]!, said: null, status: 'missing', probability: null });
      i -= 1;
    } else {
      extra.push(said[j - 1]!.w);
      j -= 1;
    }
  }
  words.reverse();
  extra.reverse();

  const CREDIT: Record<WordStatus, number> = {
    ok: 1,
    weak: 0.7,
    ending: 0.5, // nghe ra tu, nhung nuot duoi — van tinh nua diem
    wrong: 0.1,
    missing: 0,
  };

  const summary = { ok: 0, weak: 0, ending: 0, wrong: 0, missing: 0 };
  let earned = 0;
  for (const w of words) {
    summary[w.status] += 1;
    earned += CREDIT[w.status];
  }

  let pct = n === 0 ? 0 : (earned / n) * 100;
  // Noi thua vai tu thi tru nhe, khong tru sap. Nguoi hoc hay them "uhm",
  // "I think" — do la thoi quen noi, khong phai loc phat am.
  pct -= Math.min(12, extra.length * 4);

  return {
    score: Math.max(0, Math.min(100, Math.round(pct))),
    words,
    extra,
    summary,
  };
}

/**
 * Tim mot TU/CUM TU muc tieu ben trong cau nguoi hoc vua noi.
 *
 * Dung cho man On tu: de bai la nghia tieng Viet, nguoi hoc phai bat ra tu
 * tieng Anh. Ho co the noi trong ("leverage") hoac noi ca cau
 * ("um, the word is leverage") — ca hai deu la nho duoc tu, nen phai tinh
 * nhu nhau. Doi chieu ca cau nhu score() se phat oan truong hop thu hai.
 */
export function matchPhrase(target: string, heard: HeardWord[]): {
  score: number;
  found: boolean;
  matched: string | null;
  probability: number | null;
} {
  const want = tokenize(target);
  const said = mergeElision(heard)
    .map((h) => ({ w: normalize(h.word), p: typeof h.probability === 'number' ? h.probability : null }))
    .filter((h) => h.w);

  if (!want.length || !said.length) return { score: 0, found: false, matched: null, probability: null };

  // Bo de va Whisper thuong dat KHOANG TRANG khac cho cho CUNG MOT chuoi am.
  // normalize() vut dau gach noi, nen "dairy-free" thanh MOT token "dairyfree"
  // trong khi Whisper tra ve HAI token "dairy" + "free"; chieu nguoc lai,
  // "work out" (hai token) bi Whisper viet lien thanh "workout". Cua so truot
  // ben duoi doi so token phai khop nhau nen ca hai deu cham 0 — nguoi hoc doc
  // dung tuyet doi van truot, va khong co cach nao dat diem.
  //
  // Day la CHO CAT TU, khong phai loi phat am. Thu dan lien truoc: bo het
  // khoang trang hai ben roi so chuoi. Do lai tren ca 240 the trong
  // api/content ngay 06/09: 183 -> 201 the dat 100, so the 0 diem 18 -> 6,
  // va KHONG the nao bi tut diem.
  const wantGlued = want.join('');
  const maxSpan = Math.min(said.length, want.length + 3);
  for (let i = 0; i < said.length; i += 1) {
    let glued = '';
    for (let n = 1; n <= maxSpan && i + n <= said.length; n += 1) {
      glued += said[i + n - 1]!.w;
      if (glued.length > wantGlued.length) break;
      if (glued !== wantGlued) continue;
      const probs = said.slice(i, i + n).map((w) => w.p).filter((p): p is number => p !== null);
      const prob = probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : null;
      // KHONG tru 15% khi Whisper thieu tu tin nua — xem khoi chu thich dai o
      // duoi (cho tinh `pct` cua duong cua so). Chuoi da khop TUYET DOI thi
      // khong co ly do gi de tru.
      const pct = 100;
      return {
        score: pct,
        found: true,
        matched: said.slice(i, i + n).map((w) => w.w).join(' '),
        probability: prob,
      };
    }
  }

  let best = { sim: 0, at: -1, prob: null as number | null, droppedEnding: false };

  // Truot mot cua so dai bang cum muc tieu doc theo cau da noi.
  for (let i = 0; i + want.length <= said.length; i += 1) {
    const win = said.slice(i, i + want.length);
    let hit = 0;
    let droppedEnding = false;
    for (let k = 0; k < want.length; k += 1) {
      const t = want[k]!;
      const s = win[k]!.w;
      if (t !== s && differsOnlyAtEnd(t, s)) droppedEnding = true;
      if (t === s) hit += 1;
      // NUOT PHU AM CUOI di rieng mot nac, TRUOC nhanh rong ben duoi.
      // sameWordDifferentForm() goi differsOnlyAtEnd() ngay dong dau, nen truoc
      // day hai lop loi khac han nhau — "term/terms" (nuot duoi) va "came/come"
      // (chia dang) — di chung mot nhanh 0.9 va bi cap di phang. Voi cum tu 3-4
      // tu, mot loi nuot duoi van cho 97-98 diem => Easy => lich on 8-64-363
      // ngay. Do la dung lop loi ma ca file nay duoc viet ra de bat.
      // Tach ra: nuot duoi 0.6, chia dang giu 0.9.
      else if (differsOnlyAtEnd(t, s)) hit += 0.6;
      // Chia dang (came/come, running/run) van la nho ra tu, gan nhu tron diem.
      // Truoc day cho 0.6 nen "I came down with a cold" chi duoc 83 trong khi
      // doc nguyen dang tu dien "come down with" duoc 100 — tuc la app dang
      // thuong cho viec doc thuoc long va phat viec dung that.
      else if (sameWordDifferentForm(t, s)) hit += 0.9;
      // KHONG nang muc nay: leverage/beverage cham nguong 0.72, phai giu no la
      // truot chu khong phai gan dung.
      else if (similarity(t, s) >= 0.72) hit += 0.5;
    }
    const sim = hit / want.length;
    if (sim > best.sim) {
      const probs = win.map((w) => w.p).filter((p): p is number => p !== null);
      best = {
        sim,
        at: i,
        prob: probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : null,
        droppedEnding,
      };
    }
  }

  const found = best.sim >= 0.6;
  let pct = best.sim * 100;

  // ⚠️ DA BO khoan tru 15% khi Whisper "thieu tu tin" (truoc day o day co dong
  //    `if (best.prob !== null && best.prob < 0.6) pct *= 0.85;`).
  //
  // Do tren 916 ban TTS -> STT ngay 07/09:
  //   so ban dinh phat: 30
  //     doc DUNG tu : 26  (doc chuan 18 - noi cham 5 - noi nhanh 2 - co "uhm" 1)
  //     doc SAI     :  4  — va ca 4 ca nay Whisper da tu khoi phuc duoi roi,
  //                         matchPhrase khong he nhin thay loi; chan duoc la
  //                         do MAY, khong do thiet ke.
  //   => ti le hai/loi = 6,5 : 1
  //
  // Phan chung dut diem: `probability` cua Whisper do DO MO AM HOC (chat giong,
  // muc am, nhieu nen), KHONG do do chuan phat am. Cung cum "lead time" doc
  // dung: giong af_heart cho prob 0,566 => bi chan 85; giong bm_george cho prob
  // 0,805 => 100. Chat doc y het nhau, chi khac chat giong.
  //
  // Hau qua truoc khi bo: 17/250 the (6,8%) bi chan tran 85 DU Whisper nghe ra
  // dung tung chu — tuc khong bao gio len duoc Easy.
  //
  // KHONG dung toi nac 'weak' trong score() (dong 222): man Lo trinh dung nac
  // do va man do dang khoe (doc chuan thap nhat 86 diem).

  // Thuong cho viec DUNG tu trong mot cau that thay vi doc troi tu do ra.
  // Bat ra duoc "We can lower the MOQ for this order" kho hon va dang gia hon
  // la doc "MOQ", nen no khong duoc phep thap diem hon.
  //
  // TRU khi cau do co nuot phu am cuoi. Do la lop loi nang nhat cua nguoi Viet
  // va la thu ca file nay duoc viet ra de bat; cong diem len cho no vuot nguong
  // Easy thi thanh ra thuong dung cai minh dang muon sua. "payment term" noi
  // trong mot cau nhanh phai dung lai o Good, khong duoc len Easy.
  if (found && !best.droppedEnding && said.length >= want.length + 3) pct += 5;

  // CHAN CUNG: nuot phu am cuoi KHONG BAO GIO duoc len Easy (nguong 97).
  //
  // Guard cua khoi thuong o tren khong du: no doi said.length >= want.length + 3,
  // tuc chi chay khi nguoi hoc noi thua it nhat 3 tu. Khi ho chi doc dung cum
  // thi ca menh de bi bo qua, va 97-98 diem sinh ra HOAN TOAN tu sim. Dong duoi
  // day moi la mieng chiu luc, va no dung voi MOI do dai cum — ke ca cum 10 tu
  // them vao sau nay.
  //
  // Do lai 06/09 tren 1.320 ban ghi (240 the x 8 bien the): so the rung duoi
  // lot len Easy 84 -> 0, so ban ghi thuoc nhom phai-giu (doc chuan / chia dang
  // / -ing / doc trong cau) bi doi hang: 0.
  if (best.droppedEnding) pct = Math.min(pct, 95);

  return {
    score: Math.max(0, Math.min(100, Math.round(pct))),
    found,
    matched: best.at >= 0 ? said.slice(best.at, best.at + want.length).map((w) => w.w).join(' ') : null,
    probability: best.prob,
  };
}

/** Diem 0-100 -> thang SM-2 0-5. */
export function scoreToGrade(score: number): number {
  if (score >= 90) return 5;
  if (score >= 80) return 4;
  if (score >= 60) return 3;
  if (score >= 40) return 2;
  if (score >= 20) return 1;
  return 0;
}
