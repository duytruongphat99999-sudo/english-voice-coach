import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

function req(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Thieu bien moi truong bat buoc: ${name} (xem .env.example)`);
  return v;
}
function opt(name: string, fallback: string): string {
  const v = process.env[name]?.trim();
  return v ? v : fallback;
}

export type Scenario = {
  id: string;
  name_vi: string;
  role: string;
  context: string;
  domain: string;
  target_phrases: string[];
  /** Only set for French topic scenarios ('topic:fr_*'); undefined = English. */
  lang?: 'fr';
};

// scenarios.json nam canh package.json (mot cap tren dist/), COPY rieng trong Dockerfile.
const scenariosPath = resolve(here, '..', 'scenarios.json');
export const SCENARIOS: Scenario[] = JSON.parse(readFileSync(scenariosPath, 'utf8'));

// ---------------------------------------------------------------------------
// Noi dung khoa hoc: 20 chu de, moi chu de 4 tang.
//
// Doc tu dia luc khoi dong, KHONG goi Gemini luc chay. Ly do: noi dung sinh
// moi lan mot khac thi nguoi hoc khong bao gio on lai dung cai da hoc, va
// tien do theo tung muc tro nen vo nghia. Sinh mot lan bang
// `node scripts/gen-content.mjs` roi commit.
// ---------------------------------------------------------------------------
export type VocabEntry = {
  word: string;
  ipa: string;
  meaning_vi: string;
  example_en: string;
  example_vi: string;
  /**
   * Cach doc de dua cho TTS, khi doc thang `word` ra sai.
   *
   * Chi 4 the dung toi, deu la chu viet tat: Kokoro doc lien mot tieng
   * ("MOQ" -> "Mach", "FOB" -> "Five", "CIF" -> "As if"), nen nut nghe mau
   * DAY NGUOI HOC DOC SAI ngay tu dau. Ghi "M O Q" thi no danh van tung chu,
   * dung nhu ipa cua chinh the do vien: /ˌem.oʊˈkjuː/.
   *
   * KHONG dung de cham diem — cham van so voi `word`. Chi doi duong am thanh.
   */
  say_as?: string;
  /** French only: 'm' | 'f' | 'mpl' | 'fpl' for nouns, '' otherwise. */
  gender?: string;
  /** French only: one short tip in Vietnamese (gender, Quebec usage...). */
  note_vi?: string;
};
export type SentenceEntry = { en: string; vi: string; focus_vi: string };
export type TranslateEntry = { vi: string; en_ref: string; hint_en: string };

export type Topic = {
  id: string;
  name_vi: string;
  emoji: string;
  track: 'everyday' | 'vet' | 'b2b' | 'derm' | 'fr_a1';
  order: number;
  vocab: VocabEntry[];
  sentences: SentenceEntry[];
  translate: TranslateEntry[];
  scenario: { role: string; context: string; opener_en: string; opener_vi: string };
  /** 'fr' for topics loaded from content/fr/. English topics leave it unset. */
  lang?: 'fr';
};

const contentDir = resolve(here, '..', 'content');

function loadTopics(): Topic[] {
  const indexPath = resolve(contentDir, 'index.json');
  if (!existsSync(indexPath)) {
    // Chua sinh noi dung thi app van phai len duoc — chi la lo trinh rong.
    console.warn(`[content] khong thay ${indexPath}. Chay: node scripts/gen-content.mjs`);
    return [];
  }
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as { id: string }[];
  const out: Topic[] = [];
  for (const row of index) {
    const f = resolve(contentDir, `${row.id}.json`);
    if (!existsSync(f)) {
      console.warn(`[content] thieu ${row.id}.json — bo qua chu de nay`);
      continue;
    }
    out.push(JSON.parse(readFileSync(f, 'utf8')) as Topic);
  }
  return out.sort((a, b) => a.order - b.order);
}

export const TOPICS: Topic[] = loadTopics();

export function getTopic(id: string): Topic | undefined {
  return TOPICS.find((t) => t.id === id);
}

// ---------------------------------------------------------------------------
// TIENG PHAP (dot B, 12/09/2026) — nam RIENG o content/fr/, danh sach RIENG.
//
// Khong nhet vao index.json chung, vi ba ly do do duoc (xem CONTEXT_SYNC 12/09):
//  - shadow.ts lap qua TOPICS => cau tieng Phap lot vao Shadowing tieng Anh,
//    bi doc bang giong Anh va nghe bang may nghe tieng Anh;
//  - /learn/topics va /today tinh % lo trinh tren TOPICS => tron hai thu tieng;
//  - scripts/gen-content.mjs VIET LAI index.json tu danh sach cung 20 chu de.
// getTopic() van CHI tim tieng Anh, nen moi route bai hoc tieng Anh khong bao gio
// phuc vu nham chu de tieng Phap. Tieng Phap di qua routes/fr.ts.
//
// File tieng Phap viet truong theo tieng Phap (example_fr, fr, fr_ref, hint_fr,
// opener_fr). Luc nap doi sang ten truong cua Topic de dung chung kieu —
// trong RAM, `example_en` cua chu de tieng Phap la CAU TIENG PHAP.
// ---------------------------------------------------------------------------
type FrTopicFile = {
  id: string;
  name_vi: string;
  emoji: string;
  order: number;
  vocab: { word: string; gender: string; ipa: string; meaning_vi: string; example_fr: string; example_vi: string; note_vi: string }[];
  sentences: { fr: string; vi: string; focus_vi: string }[];
  translate: { vi: string; fr_ref: string; hint_fr: string }[];
  scenario: { role: string; context: string; opener_fr: string; opener_vi: string };
};

export type FrDeckWord = {
  word: string;
  gender: string;
  ipa: string;
  meaning_vi: string;
  example_fr: string;
  example_vi: string;
  note_vi: string;
  group: string;
};
export type FrDeck = { groups: { id: string; name_vi: string; emoji: string }[]; words: FrDeckWord[] };

const frDir = resolve(contentDir, 'fr');

function loadTopicsFr(): Topic[] {
  const indexPath = resolve(frDir, 'index.json');
  if (!existsSync(indexPath)) return [];
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as { id: string }[];
  const out: Topic[] = [];
  for (const row of index) {
    const f = resolve(frDir, `${row.id}.json`);
    if (!existsSync(f)) {
      console.warn(`[content] thieu fr/${row.id}.json — bo qua chu de nay`);
      continue;
    }
    const t = JSON.parse(readFileSync(f, 'utf8')) as FrTopicFile;
    out.push({
      id: t.id,
      name_vi: t.name_vi,
      emoji: t.emoji,
      track: 'fr_a1',
      order: t.order,
      lang: 'fr',
      vocab: t.vocab.map((v) => ({
        word: v.word,
        ipa: v.ipa,
        meaning_vi: v.meaning_vi,
        example_en: v.example_fr,
        example_vi: v.example_vi,
        gender: v.gender,
        note_vi: v.note_vi,
      })),
      sentences: t.sentences.map((s) => ({ en: s.fr, vi: s.vi, focus_vi: s.focus_vi })),
      translate: t.translate.map((s) => ({ vi: s.vi, en_ref: s.fr_ref, hint_en: s.hint_fr })),
      scenario: { role: t.scenario.role, context: t.scenario.context, opener_en: t.scenario.opener_fr, opener_vi: t.scenario.opener_vi },
    });
  }
  return out.sort((a, b) => a.order - b.order);
}

export const TOPICS_FR: Topic[] = loadTopicsFr();

export function getTopicFr(id: string): Topic | undefined {
  return TOPICS_FR.find((t) => t.id === id);
}

function loadFrDeck(): FrDeck {
  const f = resolve(frDir, 'deck.json');
  if (!existsSync(f)) return { groups: [], words: [] };
  return JSON.parse(readFileSync(f, 'utf8')) as FrDeck;
}

/** ~500 tu A1 vao thang kho on (khong co bai hoc). Nap vao DB bang scripts/seed-fr-deck.sh. */
export const FR_DECK: FrDeck = loadFrDeck();

/** Ten tieng Viet cua mot nhom tu tieng Phap: chu de co bai, hoac nhom chi-co-trong-kho. */
export function frGroupVi(id: string): { name_vi: string; emoji: string } | undefined {
  const t = getTopicFr(id);
  if (t) return { name_vi: t.name_vi, emoji: t.emoji };
  const g = FR_DECK.groups.find((x) => x.id === id);
  return g ? { name_vi: g.name_vi, emoji: g.emoji } : undefined;
}

/**
 * Giong + ghi chu cua mot tu tieng Phap, tra theo chinh chu `word` — bang vocab
 * trong DB khong co hai cot nay (giong sayAsFor ben tren: khong dong vao schema).
 */
export function frInfoFor(word: string): { gender: string; note_vi: string; example_vi: string } | undefined {
  const k = word.trim().toLowerCase();
  for (const t of TOPICS_FR) {
    const v = t.vocab.find((x) => x.word.trim().toLowerCase() === k);
    if (v) return { gender: v.gender ?? '', note_vi: v.note_vi ?? '', example_vi: v.example_vi };
  }
  const d = FR_DECK.words.find((x) => x.word.trim().toLowerCase() === k);
  return d ? { gender: d.gender, note_vi: d.note_vi, example_vi: d.example_vi } : undefined;
}

/**
 * Tra `say_as` cua mot tu, tim theo chinh chu `word` trong bo noi dung.
 *
 * Man On tu doc the tu DB (bang vocab) chu khong tu TOPICS, ma bang do khong co
 * cot say_as. Tra nguoc o day de KHONG phai dong vao schema DB: bo noi dung da
 * nam san trong RAM tu luc boot nen phep tim nay khong ton I/O.
 *
 * The "mined" (Gemini dao ra tu /chat) khong co trong content -> tra undefined
 * -> nguoi goi dung `word` nhu cu.
 */
export function sayAsFor(word: string): string | undefined {
  const k = word.trim().toLowerCase();
  for (const t of TOPICS) {
    for (const v of t.vocab) {
      if (v.say_as && v.word.trim().toLowerCase() === k) return v.say_as;
    }
  }
  return undefined;
}

/**
 * Nhan tieng Viet cho cot `domain` — nhan linh vuc do Gemini gan khi dao tu ra
 * tu hoi thoai (/chat), khac han voi 20 chu de giao trinh trong api/content.
 *
 * ⚠️ BANG NAY CHAC CHAN SE THIEU. llm.ts khai bao `domain: S.str` — chuoi TU DO,
 * khong enum — nen Gemini muon tra gi cung duoc. DB da co "purchasing" trong khi
 * api/scenarios.json khong he co domain do. Vi vay moi cho tra bang nay PHAI co
 * duong rot ve (slug goc), dung bao gio de trong.
 */
export const DOMAIN_VI: Record<string, string> = {
  negotiation: 'Đàm phán',
  purchasing: 'Mua hàng',
  interview: 'Phỏng vấn',
  presentation: 'Thuyết trình',
  meeting: 'Họp hành',
  support: 'Chăm sóc khách',
  sales: 'Bán hàng',
  logistics: 'Vận chuyển',
};

export const TRACK_VI: Record<Topic['track'], string> = {
  everyday: 'Đời thường',
  vet: 'Thú y',
  b2b: 'Kinh doanh B2B',
  derm: 'Da liễu',
  fr_a1: 'Tiếng Pháp A1',
};

/**
 * Scenario cho /chat.
 *
 * Hai nguon: `scenarios.json` (5 tinh huong business ban dau) va scenario cua
 * tung chu de trong content, tra cuu bang id `topic:<id>`. Giu ca hai — cai cu
 * van dung duoc o muc "Luyen them", khong vut di.
 */
export function getScenario(id: string): Scenario | undefined {
  const found = SCENARIOS.find((s) => s.id === id);
  if (found) return found;

  const topicId = id.startsWith('topic:') ? id.slice(6) : id;
  // Chang 4 tieng Phap cung di qua /chat — chat.ts doc `lang` de chon giong,
  // may nghe va prompt.
  const t = getTopic(topicId) ?? getTopicFr(topicId);
  if (!t) return undefined;
  return {
    id: `topic:${t.id}`,
    name_vi: t.name_vi,
    role: t.scenario.role,
    context: t.scenario.context,
    domain: t.id,
    // Tu vung cua chinh chu de do lam moi cho Gemini keo hoi thoai ve dung mach.
    target_phrases: t.vocab.slice(0, 8).map((v) => v.word),
    ...(t.lang === 'fr' ? { lang: 'fr' as const } : {}),
  };
}

export const cfg = {
  port: Number(opt('PORT', '3040')),
  dbPath: opt('DB_PATH', resolve(here, '..', 'data', 'evc.db')),
  dataDir: dirname(opt('DB_PATH', resolve(here, '..', 'data', 'evc.db'))),

  gemini: {
    apiKey: req('GEMINI_API_KEY'),
    model: opt('GEMINI_MODEL', 'gemini-3.5-flash'),
    thinking: opt('GEMINI_THINKING', 'low') as 'low' | 'high',
    // Google tra 503 "high demand" kha thuong xuyen tren cac model moi.
    // Danh sach du phong, thu lan luot khi model chinh qua tai.
    fallbacks: opt('GEMINI_MODEL_FALLBACK', 'gemini-3.5-flash-lite,gemini-2.5-flash')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  stt: {
    baseUrl: opt('STT_BASE_URL', 'http://evc-speaches:8000/v1').replace(/\/+$/, ''),
    model: opt('STT_MODEL', 'Systran/faster-whisper-small'),
  },

  tts: {
    baseUrl: opt('TTS_BASE_URL', 'http://evc-speaches:8000/v1').replace(/\/+$/, ''),
    model: opt('TTS_MODEL', 'speaches-ai/Kokoro-82M-v1.0-ONNX'),
    voice: opt('TTS_VOICE', 'af_heart'),
    speed: Number(opt('TTS_SPEED', '0.95')),
  },

  app: {
    // Mat khau vao app. Dat bang: bash scripts/set-password.sh
    password: req('APP_PASSWORD'),
    // Khoa ky cookie phien. Doi khoa nay = da dang xuat moi thiet bi.
    secret: req('APP_SECRET'),
  },

  level: opt('LEVEL', 'B1'),
  todayToken: process.env.TODAY_TOKEN?.trim() ?? '',
  tz: opt('TZ', 'Asia/Ho_Chi_Minh'),
} as const;
