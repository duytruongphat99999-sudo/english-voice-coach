// Sinh noi dung hoc cho 20 chu de, ghi ra api/content/<id>.json
//
//   node scripts/gen-content.mjs            # sinh cai nao con thieu
//   node scripts/gen-content.mjs --force    # sinh lai het
//   node scripts/gen-content.mjs an_uong    # sinh lai dung mot chu de
//
// CHAY MOT LAN roi commit ket qua. Luc app chay thi doc thang tu file:
// khong goi Gemini, khong ton tien, va noi dung khong tu doi duoi chan nguoi
// hoc giua chung mot chu de.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'api', 'content');

const ENV = readFileSync(join(ROOT, '.env'), 'utf8');
const envGet = (k) => {
  const l = ENV.split(/\r?\n/).find((x) => x.startsWith(k + '='));
  return l ? l.slice(k.length + 1).trim() : '';
};
const KEY = envGet('GEMINI_API_KEY');
const LEVEL = envGet('LEVEL') || 'B1';
if (!KEY) throw new Error('Thieu GEMINI_API_KEY trong .env');

// --- schema ---------------------------------------------------------------
const S = {
  str: { type: 'STRING' },
  obj: (p) => ({ type: 'OBJECT', properties: p, required: Object.keys(p) }),
  arr: (i) => ({ type: 'ARRAY', items: i }),
};
const SCHEMA = S.obj({
  vocab: S.arr(
    S.obj({ word: S.str, ipa: S.str, meaning_vi: S.str, example_en: S.str, example_vi: S.str }),
  ),
  sentences: S.arr(S.obj({ en: S.str, vi: S.str, focus_vi: S.str })),
  translate: S.arr(S.obj({ vi: S.str, en_ref: S.str, hint_en: S.str })),
  scenario: S.obj({ role: S.str, context: S.str, opener_en: S.str, opener_vi: S.str }),
});

// --- prompt ---------------------------------------------------------------
const SYSTEM = `You author English learning content for TWO Vietnamese adults at CEFR ${LEVEL}.
They learn by SPEAKING, on a phone, about 12 minutes a day.

Learner A: a veterinarian who also runs cross-border B2B trade.
Learner B: a dermatologist who sees international patients and presents cases at conferences.

# Hard rules

Everything must be something they would ACTUALLY say in real life this month.
No textbook filler. No corporate abstractions like "cross-functional synergy".
Concrete beats impressive: a learner can picture "the rash spread to her elbow";
nobody can picture "annual volume".

## IPA — read this twice
Write ALL IPA in **General American** only, in slashes, with stress marks.
The app reads text aloud with an American voice, so British IPA would teach the
learner one thing and play them another.
  - Pronounce every written r: /ˈhɑːrm.ləs/  NOT /ˈhɑːm.ləs/
  - Use /oʊ/ never /əʊ/:      /ˈkaʊn.tɚ/ or /ˈkaʊn.tər/, never /ˈkaʊn.tə/
  - Use /æ/ in ask, class, after — not /ɑː/
Be consistent inside a single entry: never mix accents within one word.

## vocab — exactly 12
Words and short phrases a ${LEVEL} learner does NOT reliably know yet but will
use constantly in this topic. Prefer collocations and phrasal verbs over single
dictionary words. example_en is a real spoken sentence, 6-14 words, contractions
encouraged ("I'm", "don't", "it's") because that is how people actually talk.
example_vi is its natural Vietnamese meaning, not a word-for-word gloss.

## sentences — exactly 8
For a read-aloud pronunciation drill. 7-14 words each, one sentence, no lists.
Deliberately load each with sounds Vietnamese speakers drop or swap:
final consonants (-s, -ed, -t, -k), /θ/ and /ð/, /r/ vs /l/, consonant
clusters (/spl/, /str/, /sk/), and final /z/.
focus_vi names the ONE thing to watch, in Vietnamese, max 12 words.

## translate — exactly 8
A Vietnamese-to-English reflex drill. "vi" is natural SPOKEN Vietnamese, the way
someone actually talks, not translationese. "en_ref" is what a native would
really say, not a literal rendering. hint_en is 1-3 key English words only.

## scenario
A roleplay for this topic. role = who the AI plays. context = the situation in
2-3 sentences, written in second person to the learner. opener_en = the AI's
first line, max 25 words, ending in a question. opener_vi = its Vietnamese gloss.

Vietnamese anywhere in the output must be everyday Vietnamese, not stiff.`;

// --- 20 chu de ------------------------------------------------------------
const TOPICS = [
  // Nen tang — doi thuong
  { id: 'an_uong', name_vi: 'Ăn uống', emoji: '🍜', track: 'everyday', order: 1,
    prompt: 'everyday eating and drinking: ordering at a restaurant, street food, describing taste, dietary restrictions and allergies, paying and splitting the bill, inviting someone out to eat.' },
  { id: 'sinh_hoat', name_vi: 'Sinh hoạt hằng ngày', emoji: '🌅', track: 'everyday', order: 2,
    prompt: 'daily routine: waking up, morning hygiene, getting ready, commuting, meals through the day, chores, winding down, going to bed, and talking about what time you usually do things.' },
  { id: 'so_thich', name_vi: 'Sở thích, giải trí', emoji: '🎬', track: 'everyday', order: 3,
    prompt: 'hobbies and free time: films and series, music, sports, gaming, reading, coffee with friends, saying what you are into and what bores you, making plans.' },
  { id: 'gia_dinh', name_vi: 'Gia đình, bạn bè', emoji: '👨‍👩‍👧', track: 'everyday', order: 4,
    prompt: 'family and friends: describing family members, relationships, kids, catching up with an old friend, small talk about how people are doing, congratulating and consoling.' },
  { id: 'mua_sam', name_vi: 'Mua sắm', emoji: '🛒', track: 'everyday', order: 5,
    prompt: 'shopping: groceries, clothes, sizes and fitting, prices and bargaining, online orders and delivery, returns and refunds, asking a shop assistant for help.' },
  { id: 'di_lai', name_vi: 'Đi lại', emoji: '🛵', track: 'everyday', order: 6,
    prompt: 'getting around: motorbike and car, Grab and taxi, traffic and directions, buses and trains, airports and check-in, being late, parking, fuel and repairs.' },
  { id: 'suc_khoe', name_vi: 'Sức khoẻ', emoji: '🤒', track: 'everyday', order: 7,
    prompt: 'everyday health as a PATIENT not a doctor: describing symptoms, going to a clinic, pharmacy and medicine, sleep, exercise, stress, cancelling plans because you are unwell.' },
  { id: 'thoi_tiet', name_vi: 'Thời tiết', emoji: '☀️', track: 'everyday', order: 8,
    prompt: 'weather and seasons: heat and humidity in Vietnam, rain and storms, what to wear, how weather changes plans, small talk about weather with a foreigner.' },
  { id: 'nha_cua', name_vi: 'Nhà cửa', emoji: '🏠', track: 'everyday', order: 9,
    prompt: 'home and living: rooms and furniture, renting, neighbours, things breaking and getting them fixed, cleaning, electricity and water bills, moving house.' },
  { id: 'cong_viec', name_vi: 'Công việc thường ngày', emoji: '💼', track: 'everyday', order: 10,
    prompt: 'ordinary workday talk, NOT corporate jargon: what you do for a living, your schedule, busy and quiet days, colleagues, taking a day off, small talk at work, being tired.' },
  { id: 'cuoi_tuan', name_vi: 'Cuối tuần, du lịch', emoji: '✈️', track: 'everyday', order: 11,
    prompt: 'weekends and travel: making plans, hotels and booking, sightseeing, beaches and mountains, packing, taking photos, telling someone about a trip you took.' },
  { id: 'dien_thoai', name_vi: 'Điện thoại, internet', emoji: '📱', track: 'everyday', order: 12,
    prompt: 'phones and internet: apps, wifi and mobile data, video calls, messaging, battery and charging, something not working, online payments, social media.' },

  // Nghe — anh (thu y + B2B)
  { id: 'thu_y_kham', name_vi: 'Thú y — khám & tư vấn chủ nuôi', emoji: '🐕', track: 'vet', order: 13,
    prompt: 'a veterinarian consulting a pet owner in English: taking the history, asking when symptoms started, appetite, stool, behaviour change, examining the animal, explaining the likely problem in plain words, and giving home care instructions.' },
  { id: 'thu_y_dieu_tri', name_vi: 'Thú y — bệnh lý & điều trị', emoji: '💉', track: 'vet', order: 14,
    prompt: 'veterinary treatment talk: vaccines and deworming schedules, common conditions in dogs and cats, prescribing and dosing, surgery and anaesthesia, follow-up visits, explaining risks and costs to an owner.' },
  { id: 'b2b_doi_tac', name_vi: 'B2B — đối tác xuyên quốc gia', emoji: '🌏', track: 'b2b', order: 15,
    prompt: 'cross-border B2B partner talk: introducing your company on a call, quoting and negotiating price, MOQ, lead time, exclusivity, following up after a trade fair, and keeping a relationship warm by email.' },
  { id: 'b2b_xnk', name_vi: 'B2B — xuất nhập khẩu, thanh toán', emoji: '📦', track: 'b2b', order: 16,
    prompt: 'import-export operations: Incoterms, shipping and containers, customs clearance, documents (invoice, packing list, CO, health certificate), payment terms, L/C and T/T, delays and claims.' },

  // Nghe — chi (da lieu + duoc)
  { id: 'da_lieu_kham', name_vi: 'Da liễu — khám bệnh nhân quốc tế', emoji: '🩺', track: 'derm', order: 17,
    prompt: 'a dermatologist consulting an international patient in English: taking history, asking about the rash or lesion (onset, itch, spread, triggers), examining, explaining the likely diagnosis in plain words, and reassuring an anxious patient.' },
  { id: 'da_lieu_phac_do', name_vi: 'Da liễu — phác đồ & thuốc', emoji: '🧴', track: 'derm', order: 18,
    prompt: 'explaining a dermatology treatment plan in English: topical vs oral, how much and how often, expected timeline, side effects, sun protection and skincare routine, when to come back, what to do if it gets worse.' },
  { id: 'da_lieu_thuyet_trinh', name_vi: 'Da liễu — thuyết trình ca lâm sàng', emoji: '🎤', track: 'derm', order: 19,
    prompt: 'presenting a clinical case at an international conference: opening a talk, describing the patient and presentation, showing images, walking through differential diagnosis and management, concluding, and handling questions from the audience.' },
  { id: 'duoc_doi_tac', name_vi: 'Làm việc với hãng dược', emoji: '💊', track: 'derm', order: 20,
    prompt: 'working with pharmaceutical suppliers and reps in English: hearing a product pitch, asking about clinical evidence and formulation, samples and trials, pricing and supply, distribution agreements, and politely declining.' },
];

const MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callGemini(model, userPrompt) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: `Topic: ${userPrompt}` }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: SCHEMA,
          temperature: 0.85,
          thinkingConfig: { thinkingLevel: 'low' },
        },
        safetySettings: [
          'HARM_CATEGORY_HARASSMENT',
          'HARM_CATEGORY_HATE_SPEECH',
          'HARM_CATEGORY_SEXUALLY_EXPLICIT',
          'HARM_CATEGORY_DANGEROUS_CONTENT',
        ].map((category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' })),
      }),
    },
  );
  const body = await res.text();
  if (!res.ok) {
    const err = new Error(`${res.status}: ${body.slice(0, 140)}`);
    err.status = res.status;
    throw err;
  }
  return JSON.parse(JSON.parse(body).candidates[0].content.parts.map((p) => p.text ?? '').join(''));
}

/** Kiem so luong + bat IPA con sot giong Anh. */
function audit(id, data) {
  const bad = [];
  if (data.vocab?.length !== 12) bad.push(`vocab=${data.vocab?.length}`);
  if (data.sentences?.length !== 8) bad.push(`sentences=${data.sentences?.length}`);
  if (data.translate?.length !== 8) bad.push(`translate=${data.translate?.length}`);

  // Dau hieu IPA kieu Anh: /əʊ/, hoac nguyen am dai ma sau no khong co r
  // trong cac tu VIET co r (harm, counter, doctor...).
  const brit = (data.vocab ?? []).filter(
    (v) => /əʊ/.test(v.ipa) || (/r/i.test(v.word) && /ɑː(?![ːr])/.test(v.ipa) && !/r/.test(v.ipa)),
  );
  if (brit.length) bad.push(`IPA kieu Anh: ${brit.map((v) => v.word).join(', ')}`);
  return bad;
}

async function genTopic(t) {
  let lastErr;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const data = await callGemini(model, t.prompt);
        return { data, model };
      } catch (e) {
        lastErr = e;
        if (e.status !== 503 && e.status !== 429) throw e;
        await sleep(attempt === 0 ? 1500 : 4000);
      }
    }
  }
  throw lastErr;
}

// --- chay -----------------------------------------------------------------
mkdirSync(OUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));

const index = [];
let made = 0;
let skipped = 0;

for (const t of TOPICS) {
  const file = join(OUT_DIR, `${t.id}.json`);
  index.push({ id: t.id, name_vi: t.name_vi, emoji: t.emoji, track: t.track, order: t.order });

  if (only.length && !only.includes(t.id)) continue;
  if (!force && !only.length && existsSync(file)) {
    skipped += 1;
    continue;
  }

  process.stdout.write(`[${String(t.order).padStart(2)}/20] ${t.id.padEnd(22)} `);
  const t0 = Date.now();
  const { data, model } = await genTopic(t);
  const problems = audit(t.id, data);

  writeFileSync(
    file,
    JSON.stringify({ id: t.id, name_vi: t.name_vi, emoji: t.emoji, track: t.track, order: t.order, ...data }, null, 2),
    'utf8',
  );
  made += 1;
  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(problems.length ? `CAN XEM LAI (${secs}s, ${model}) -> ${problems.join(' | ')}` : `ok (${secs}s, ${model})`);
}

writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
console.log(`\nsinh moi ${made}, bo qua ${skipped} (da co). index.json: ${index.length} chu de.`);
