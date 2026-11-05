// So chu tieng Phap CO DAU — cho On tu (go lai tu), chang 3 (go cau dich) va
// Nghe-viet chinh ta.
//
// Duy chot 12/09/2026: tieng Phap khong de may nghe cham (may nghe kem voi
// giong nguoi moi hoc => lich on sai). Go thi app cham duoc CHINH XAC — va sai
// dau la sai chinh ta, dung cai ky nang Viet can.
//
// Dau KHONG bi coi nhe: "eleve" != "élève". Nhung sai-chi-dau duoc tach rieng
// khoi sai-han, vi "nho ra tu roi, chi quen dau" khac hoan toan "khong nho".
// Khong dung Intl.Collator o day: can biet CHINH XAC chu nao lech dau de chi ra,
// ma collator chi tra so sanh. NFD + bo dau ket hop la du va chay trong ICU san
// co cua Node — khong cai goi nao.

/** Bo dau: é è ê ë -> e, ç -> c, œ -> oe, æ -> ae. Giu nguyen chu cai khac. */
export function foldAccents(s: string): string {
  return s
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'AE')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Dua ve dang so sanh: thuong, nhay ASCII, gon khoang trang, bo dau cau quanh. */
export function tidy(s: string, keepCase = false): string {
  const t = s
    .normalize('NFC')
    .replace(/[’‘`´]/g, "'")
    .replace(/[\u00a0\u202f]/g, ' ');
  return (keepCase ? t : t.toLowerCase())
    .replace(/\s*'\s*/g, "'")
    .replace(/[.!?;:,«»"“”()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Chi mao tu XAC DINH — quy uoc noi dung: danh tu mang le/la/l'/les. DAI TRUOC NGAN:
// de 'le' dung truoc thi "les meubles" khop 'le' roi bi loai (review 12/09: go
// "meubles" bi cham 0 thay vi 'thieu mao tu'). Khong co un/une/des: "un peu" la
// trang tu, khong phai mao tu + danh tu.
const ARTICLE = /^(les|la|le|l')\s*/;
// Phia CHU NGUOI HOC GO thi nhan ca mao tu khong xac dinh: go "une adresse" cho
// the "l'adresse" la sai mao tu (60), khong phai quen tu (review 12/09).
const TYPED_ARTICLE = /^(les|la|le|l'|une|un|des|du)\s*/;

function splitArticle(s: string, re: RegExp = ARTICLE): { art: string; rest: string } {
  const m = s.match(re);
  if (!m) return { art: '', rest: s };
  // "l'" dinh lien voi danh tu; cac mao tu khac can khoang trang sau.
  if (m[1] !== "l'" && !/\s/.test(s.slice(m[1]!.length, m[1]!.length + 1))) return { art: '', rest: s };
  return { art: m[1]!, rest: s.slice(m[0].length) };
}

function lev(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

export type WordVerdict = 'ok' | 'accent' | 'article' | 'no_article' | 'typo' | 'wrong' | 'empty';

/**
 * Cham mot tu go lai (man On tu tieng Phap).
 *
 * `score` 0-100 cho srs.reviewRating (<60 = quen · 60-79 = kho · >=80 = nho):
 *   ok 100 · sai dau 70 · sai/thieu mao tu 60 · sai mot chu 40 · sai 0.
 * Sai mao tu = sai GIONG: nho ra danh tu nhung chua nho giong — voi tieng Phap
 * do la mot nua cua viec biet tu, nen chi "kho" chu khong phai "nho".
 */
export function checkWord(typed: string, expected: string): { verdict: WordVerdict; score: number } {
  const t = tidy(typed);
  const e = tidy(expected);
  if (!t) return { verdict: 'empty', score: 0 };
  if (t === e) return { verdict: 'ok', score: 100 };
  if (foldAccents(t) === foldAccents(e)) return { verdict: 'accent', score: 70 };

  const te = splitArticle(e);
  if (te.art) {
    const tt = splitArticle(t, TYPED_ARTICLE);
    if (tt.rest === te.rest || foldAccents(tt.rest) === foldAccents(te.rest)) {
      const accentToo = tt.rest !== te.rest;
      if (!tt.art) return { verdict: 'no_article', score: accentToo ? 50 : 60 };
      return { verdict: 'article', score: accentToo ? 50 : 60 };
    }
  }
  const d = lev(foldAccents(t), foldAccents(e));
  if (d === 1 && foldAccents(e).length >= 4) return { verdict: 'typo', score: 40 };
  return { verdict: 'wrong', score: 0 };
}

/**
 * Tach cau thanh tu de so: giu nguyen chu va dau, nhay dinh voi chu truoc no.
 * keepCase = giu hoa/thuong de HIEN THI (so sanh van khong phan biet hoa/thuong).
 */
export function wordsOf(s: string, keepCase = false): string[] {
  return tidy(s, keepCase)
    .split(' ')
    .flatMap((w) => {
      // "l'adresse" -> "l'", "adresse": nguoi hoc go "la adresse" van khop duoc
      // phan "adresse" va chi sai dung cho mao tu.
      const m = w.match(/^([a-zà-ÿ]{1,3}')(.+)$/i);
      return m ? [m[1]!, m[2]!] : [w];
    })
    .filter(Boolean);
}

export type DiffToken = { w: string; status: 'ok' | 'accent' | 'missing' | 'extra'; typed?: string };

/**
 * So cau go voi cau goc, tung tu, theo LCS tren dang da bo dau.
 * Tra ve day tu cua CAU GOC (ok / accent / missing) xen voi tu THUA nguoi hoc
 * go them (extra). Diem: dung 1, sai dau 0,5, thua tru 0,5 — chia cho so tu goc.
 */
export function diffSentence(typed: string, reference: string): { tokens: DiffToken[]; score: number; ok: number; accent: number; missing: number; extra: number } {
  // Giu hoa/thuong de hien thi cau goc dung nhu no; so sanh tren dang viet thuong.
  const a = wordsOf(typed, true);
  const b = wordsOf(reference, true);
  const la = a.map((x) => x.toLowerCase());
  const lb = b.map((x) => x.toLowerCase());
  const fa = la.map(foldAccents);
  const fb = lb.map(foldAccents);
  const n = a.length;
  const m = b.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      L[i]![j] = fa[i] === fb[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
    }
  }
  const tokens: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && fa[i] === fb[j]) {
      const same = la[i] === lb[j];
      tokens.push({ w: b[j]!, status: same ? 'ok' : 'accent', ...(same ? {} : { typed: a[i]! }) });
      i += 1;
      j += 1;
    } else if (j < m && (i >= n || L[i]![j + 1]! >= L[i + 1]![j]!)) {
      tokens.push({ w: b[j]!, status: 'missing' });
      j += 1;
    } else {
      tokens.push({ w: a[i]!, status: 'extra' });
      i += 1;
    }
  }
  const ok = tokens.filter((t) => t.status === 'ok').length;
  const accent = tokens.filter((t) => t.status === 'accent').length;
  const missing = tokens.filter((t) => t.status === 'missing').length;
  const extra = tokens.filter((t) => t.status === 'extra').length;
  const score = m ? Math.max(0, Math.round(((ok + 0.5 * accent - 0.5 * extra) / m) * 100)) : 0;
  return { tokens, score, ok, accent, missing, extra };
}

// --- So -> chu (chi dung cho LOI MAY NGHE) ------------------------------------
//
// Whisper viet so bang chu so ("9h", "3h30", "200 dollars", "1 000 $") trong khi
// cau mau cua app viet bang chu ("neuf heures", "deux cents dollars"). Do 12/09
// tren 224 cau bai hoc: 12 cau bi bao oan "khong nghe ra" chi vi chuyen nay.
// KHONG ap cho chu nguoi hoc go (Chinh ta, chang 3) — viet so bang chu la mot
// phan cua chinh ta.
const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const TENS: Record<number, string> = { 2: 'vingt', 3: 'trente', 4: 'quarante', 5: 'cinquante', 6: 'soixante' };

function below100(n: number): string {
  if (n <= 16) return UNITS[n]!;
  if (n < 20) return `dix-${UNITS[n - 10]}`;
  const t = Math.floor(n / 10);
  const u = n % 10;
  if (t === 7) return n === 71 ? 'soixante et onze' : `soixante-${below100(n - 60)}`;
  if (t === 8) return u === 0 ? 'quatre-vingts' : `quatre-vingt-${UNITS[u]}`;
  if (t === 9) return `quatre-vingt-${below100(n - 80)}`;
  if (u === 0) return TENS[t]!;
  if (u === 1) return `${TENS[t]} et un`;
  return `${TENS[t]}-${UNITS[u]}`;
}

export function numberFr(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) return String(n);
  if (n < 100) return below100(n);
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    const cent = h === 1 ? 'cent' : `${UNITS[h]} cent${r === 0 ? 's' : ''}`;
    return r ? `${cent} ${below100(r)}` : cent;
  }
  const k = Math.floor(n / 1000);
  const r = n % 1000;
  // Truoc "mille", "cents"/"vingts" mat chu s: deux cent mille, quatre-vingt mille.
  const mille = k === 1 ? 'mille' : `${numberFr(k).replace(/(cent|vingt)s$/, '$1')} mille`;
  return r ? `${mille} ${numberFr(r)}` : mille;
}

/** "heure" giong cai: une heure, vingt et une heures (khong phai "un heure"). */
function gioFr(h: number): string {
  return `${numberFr(h).replace(/\bun$/, 'une')} ${h === 1 ? 'heure' : 'heures'}`;
}

/** "9h" -> "neuf heures", "14h30" -> "quatorze heures trente", "1 000 $" -> "mille dollars". */
export function spellNumbersFr(s: string): string {
  return s
    .replace(/(\d)\s(?=\d{3}\b)/g, '$1')
    .replace(/\b(\d{1,2})\s?h\s?(\d{2})\b/gi, (_, h: string, m: string) => `${gioFr(Number(h))}${Number(m) ? ` ${numberFr(Number(m))}` : ''}`)
    .replace(/\b(\d{1,2})\s?h\b/gi, (_, h: string) => gioFr(Number(h)))
    .replace(/(\d+)\s?\$/g, (_, n: string) => `${numberFr(Number(n))} dollars`)
    .replace(/(\d+)\s?%/g, (_, n: string) => `${numberFr(Number(n))} pour cent`)
    .replace(/\b\d+\b/g, (n) => numberFr(Number(n)));
}

/**
 * Nhung tu nguoi hoc go SAI DAU so voi cau mau (cung chu cai, khac dau).
 * Dung cho chang 3: dua cho Gemini lam du kien cung, vi Gemini tung cham mot
 * la thu mat sach dau thanh C1 (do 07/09).
 */
export function accentSlips(typed: string, reference: string): { typed: string; correct: string }[] {
  return diffSentence(typed, reference)
    .tokens.filter((t) => t.status === 'accent')
    .map((t) => ({ typed: t.typed ?? '', correct: t.w }));
}
