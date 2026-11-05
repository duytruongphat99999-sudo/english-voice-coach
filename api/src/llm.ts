// Google Gemini. Goi thang REST bang fetch — khong them SDK, giu image nho.
//
// Doi tu Claude sang Gemini theo yeu cau cua Duy. Hop dong JSON giu nguyen
// nhu spec §8; khac o cho Gemini co `responseSchema` nen JSON duoc bao dam
// dung shape ngay tu phia server, khong con phai strip code fence.
// Ham parseLoose() van giu lai lam luoi do phong khi doi model.
import { cfg } from './config.js';

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models';

export class LlmError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'LlmError';
  }
}

type SchemaNode = Record<string, unknown>;
type Part = { text?: string };
export type Turn = { role: 'user' | 'model'; text: string };

// --- schema (Gemini dung bien the OpenAPI, ten type VIET HOA) --------------
const S = {
  str: { type: 'STRING' } as SchemaNode,
  int: { type: 'INTEGER' } as SchemaNode,
  bool: { type: 'BOOLEAN' } as SchemaNode,
  obj: (props: Record<string, SchemaNode>): SchemaNode => ({
    type: 'OBJECT',
    properties: props,
    required: Object.keys(props),
  }),
  arr: (items: SchemaNode): SchemaNode => ({ type: 'ARRAY', items }),
};

const FIX_ITEM = S.obj({ you_said: S.str, better: S.str, why_vi: S.str });

export const CHAT_SCHEMA: SchemaNode = S.obj({
  // reply_en DAU TIEN co chu y: Gemini sinh field theo thu tu khai bao, nen
  // khi stream ta doc duoc cau tra loi truoc luc no viet xong corrections/vocab
  // => TTS chay som duoc vai giay.
  reply_en: S.str,
  corrections: S.arr(FIX_ITEM),
  vocab: S.arr(S.obj({ word: S.str, meaning_vi: S.str, example_en: S.str, domain: S.str })),
  difficulty_note: S.str,
});

export const REVIEW_SCHEMA: SchemaNode = S.obj({
  ok: S.bool,
  grade: S.int,
  feedback_vi: S.str,
  better_en: S.str,
});

export const PRESENTATION_SCHEMA: SchemaNode = S.obj({
  structure_score: S.int,
  structure_vi: S.str,
  pace_vi: S.str,
  fixes: S.arr(FIX_ITEM),
  next_focus_vi: S.str,
});

export type Correction = { you_said: string; better: string; why_vi: string };
export type VocabItem = { word: string; meaning_vi: string; example_en: string; domain: string };

export type ChatResult = {
  reply_en: string;
  corrections: Correction[];
  vocab: VocabItem[];
  difficulty_note: string;
};
export type ReviewResult = { ok: boolean; grade: number; feedback_vi: string; better_en: string };
export type PresentationResult = {
  structure_score: number;
  structure_vi: string;
  pace_vi: string;
  fixes: Correction[];
  next_focus_vi: string;
};

// --- than request ----------------------------------------------------------
function thinkingConfig(model: string): Record<string, unknown> {
  // Gemini 3.x nhan `thinkingLevel`; dong 2.5 nhan `thinkingBudget`.
  // Gui nham key thi API tra 400.
  if (/^gemini-3/.test(model)) return { thinkingLevel: cfg.gemini.thinking };
  if (/^gemini-2\.5/.test(model)) {
    return { thinkingBudget: cfg.gemini.thinking === 'high' ? 4096 : 0 };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Failover.
//
// Google tra 503 "This model is currently experiencing high demand" kha
// thuong xuyen — do do o phia ho, khong phai loi cua minh, va khong tu het
// neu chi bao loi cho nguoi dung. Thu lai vai lan roi tut xuong model du
// phong. 429 (het quota) xu ly y het.
// ---------------------------------------------------------------------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ma noi bo: stream dut giua chung, chua phat gi ra loa nen thu lai duoc. */
const BAD_JSON = 599;
const RETRYABLE = new Set([429, 503, BAD_JSON]);

function modelChain(): string[] {
  return [cfg.gemini.model, ...cfg.gemini.fallbacks].filter((m, i, a) => m && a.indexOf(m) === i);
}

async function withFailover<T>(run: (model: string) => Promise<T>): Promise<T> {
  const chain = modelChain();
  let last: unknown = new LlmError('Khong co model Gemini nao duoc cau hinh.');

  for (let m = 0; m < chain.length; m += 1) {
    const model = chain[m]!;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await run(model);
      } catch (e) {
        last = e;
        const status = (e as LlmError).status;
        if (status === undefined || !RETRYABLE.has(status)) throw e;
        // In ra de con biet vi sao mot luot noi bong cham gap doi.
        // Xem bang: docker compose logs evc-api | grep gemini-failover
        const next = attempt === 0 ? model : (chain[m + 1] ?? '(het model)');
        console.warn(`gemini-failover: ${model} loi ${status}, chuyen sang ${next}`);
        if (attempt === 0) await sleep(700);
      }
    }
  }
  throw last;
}

const SAFETY = [
  // Roleplay "khach hang dang buc" tung bi chan nham la harassment.
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
].map((category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' }));

function buildBody(
  model: string,
  system: string,
  contents: { role: string; parts: Part[] }[],
  schema: SchemaNode,
  temperature: number,
  withThinking = true,
) {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature,
      ...(withThinking ? { thinkingConfig: thinkingConfig(model) } : {}),
    },
    safetySettings: SAFETY,
  };
}

/** Con giu lai phong khi doi sang model khong ho tro responseSchema. */
export function parseLoose<T>(raw: string): T {
  let t = raw.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first > 0 || (last >= 0 && last < t.length - 1)) t = t.slice(first, last + 1);
  return JSON.parse(t) as T;
}

function textOf(parts: Part[] | undefined): string {
  return (parts ?? []).map((p) => p.text ?? '').join('');
}

async function call<T>(
  system: string,
  contents: { role: string; parts: Part[] }[],
  schema: SchemaNode,
  temperature: number,
): Promise<T> {
  return withFailover((model) => callOne<T>(model, system, contents, schema, temperature));
}

async function callOne<T>(
  model: string,
  system: string,
  contents: { role: string; parts: Part[] }[],
  schema: SchemaNode,
  temperature: number,
): Promise<T> {
  const attempt = async (withThinking: boolean): Promise<T> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90_000);
    let res: Response;
    try {
      res = await fetch(`${API_ROOT}/${model}:generateContent?key=${cfg.gemini.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(model, system, contents, schema, temperature, withThinking)),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new LlmError(`Khong goi duoc Gemini: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    const bodyText = await res.text();
    if (!res.ok) {
      // 400 vi thinkingConfig sai key cho model nay -> thu lai khong co no.
      if (res.status === 400 && withThinking && /thinking/i.test(bodyText)) return attempt(false);
      throw httpErr(res.status, bodyText);
    }

    const json = JSON.parse(bodyText) as {
      candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
    };
    if (json.promptFeedback?.blockReason) {
      throw new LlmError(`Gemini chan noi dung: ${json.promptFeedback.blockReason}`);
    }
    const text = textOf(json.candidates?.[0]?.content?.parts);
    if (!text) {
      throw new LlmError(`Gemini tra ve rong (finishReason=${json.candidates?.[0]?.finishReason ?? '?'})`);
    }
    return parseLoose<T>(text);
  };

  try {
    return await attempt(true);
  } catch (e) {
    // Retry 1 lan neu la loi parse JSON (spec §8).
    if (e instanceof SyntaxError) return attempt(true);
    throw e;
  }
}

function httpErr(status: number, body: string): LlmError {
  if (status === 429) return new LlmError('Gemini het quota (429) tren moi model du phong.', 429);
  if (status === 503) return new LlmError('Moi model Gemini deu dang qua tai (503). Thu lai sau it phut.', 503);
  if (status === 400 && /API key/i.test(body)) return new LlmError('GEMINI_API_KEY sai hoac het han.', 400);
  if (status >= 500) return new LlmError(`Gemini loi may chu ${status}.`, status);
  return new LlmError(`Gemini loi ${status}: ${body.slice(0, 300)}`, status);
}

/**
 * Vot lai nhung gi con doc duoc tu mot chuoi JSON HONG hoac bi cat ngang.
 *
 * Xay ra that: Google thinh thoang dong stream giua chung, con lai mot mang
 * `corrections` chua dong ngoac. Luc do nguoi hoc DA nghe xong cau tra loi
 * roi — nem loi ra man hinh la vut ca luot noi vi mot cai dau phay.
 */
function salvage(acc: string): ChatResult {
  return {
    reply_en: peekString(acc, 'reply_en') ?? '',
    corrections: salvageArray<Correction>(acc, 'corrections', ['you_said', 'better', 'why_vi']),
    vocab: salvageArray<VocabItem>(acc, 'vocab', ['word', 'meaning_vi', 'example_en', 'domain']),
    difficulty_note: peekString(acc, 'difficulty_note') ?? '',
  };
}

/** Lay cac phan tu object DA HOAN CHINH trong mot mang, bo phan tu cuoi dang do. */
function salvageArray<T>(acc: string, key: string, required: string[]): T[] {
  const at = acc.indexOf(`"${key}"`);
  if (at < 0) return [];
  const open = acc.indexOf('[', at);
  if (open < 0) return [];

  const out: T[] = [];
  let i = open + 1;
  while (i < acc.length) {
    if (acc[i] !== '{') {
      if (acc[i] === ']') break;
      i += 1;
      continue;
    }
    // Dem ngoac, bo qua ngoac nam trong chuoi.
    let depth = 0;
    let j = i;
    let inStr = false;
    for (; j < acc.length; j += 1) {
      const ch = acc[j]!;
      if (inStr) {
        if (ch === '\\') j += 1;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) break; // object cuoi cung con do dang -> dung
    try {
      const obj = JSON.parse(acc.slice(i, j + 1)) as Record<string, unknown>;
      if (required.every((k) => typeof obj[k] === 'string')) out.push(obj as T);
    } catch {
      /* bo qua phan tu hong */
    }
    i = j + 1;
  }
  return out;
}

/**
 * Doc gia tri string cua `key` tu mot chuoi JSON CHUA hoan chinh.
 * Tra null neu chuoi do chua dong ngoac kep.
 */
export function peekString(partial: string, key: string): string | null {
  const at = partial.indexOf(`"${key}"`);
  if (at < 0) return null;
  let i = partial.indexOf(':', at + key.length + 2);
  if (i < 0) return null;
  i += 1;
  while (i < partial.length && /\s/.test(partial[i]!)) i += 1;
  if (partial[i] !== '"') return null;
  const start = i;
  i += 1;
  while (i < partial.length) {
    const ch = partial[i]!;
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '"') {
      try {
        return JSON.parse(partial.slice(start, i + 1)) as string;
      } catch {
        return null;
      }
    }
    i += 1;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Roleplay CO STREAM.
// onReply(text) duoc goi ngay khi field reply_en hoan chinh trong luong SSE,
// truoc luc corrections/vocab viet xong. Nho vay TTS bat dau som ~2-3s.
// ---------------------------------------------------------------------------
export async function roleplay(
  system: string,
  history: Turn[],
  userText: string,
  onReply?: (replyEn: string) => void,
): Promise<ChatResult> {
  // 503/429 xay ra o buoc mo ket noi, TRUOC khi co byte nao chay ve, nen
  // thu lai o day khong bao gio phat trung mot cau ra loa.
  return withFailover((model) => roleplayOne(model, system, history, userText, onReply));
}

async function roleplayOne(
  model: string,
  system: string,
  history: Turn[],
  userText: string,
  onReply?: (replyEn: string) => void,
): Promise<ChatResult> {
  const contents = [
    ...history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    { role: 'user', parts: [{ text: userText }] },
  ];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  let res: Response;
  try {
    res = await fetch(`${API_ROOT}/${model}:streamGenerateContent?alt=sse&key=${cfg.gemini.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBody(model, system, contents, CHAT_SCHEMA, 0.85)),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw new LlmError(`Khong goi duoc Gemini: ${(e as Error).message}`);
  }

  if (!res.ok || !res.body) {
    clearTimeout(timer);
    throw httpErr(res.status, await res.text().catch(() => ''));
  }

  let acc = '';
  let replyFired = false;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let sseBuf = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuf += dec.decode(value, { stream: true });
      const lines = sseBuf.split('\n');
      sseBuf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const chunk = JSON.parse(payload) as { candidates?: { content?: { parts?: Part[] } }[] };
          acc += textOf(chunk.candidates?.[0]?.content?.parts);
        } catch {
          // Mieng SSE vo — bo qua, mieng sau se bu.
          continue;
        }
        if (!replyFired && onReply) {
          const early = peekString(acc, 'reply_en');
          if (early) {
            replyFired = true;
            onReply(early);
          }
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }

  if (!acc.trim()) throw new LlmError('Gemini tra ve rong.', BAD_JSON);

  let parsed: Partial<ChatResult>;
  try {
    parsed = parseLoose<Partial<ChatResult>>(acc);
  } catch {
    parsed = salvage(acc);
    // Chua kip phat gi ra loa -> con cuu duoc bang mot luot goi lai sach se.
    if (!parsed.reply_en) throw new LlmError('Gemini tra ve JSON hong.', BAD_JSON);
  }

  const reply = parsed.reply_en ?? '';
  if (!replyFired && onReply && reply) onReply(reply);
  return {
    reply_en: reply,
    corrections: Array.isArray(parsed.corrections) ? parsed.corrections : [],
    vocab: Array.isArray(parsed.vocab) ? parsed.vocab : [],
    difficulty_note: parsed.difficulty_note ?? '',
  };
}

export async function gradeReview(
  system: string,
  word: string,
  meaningVi: string,
  saidSentence: string,
): Promise<ReviewResult> {
  const user = [
    `Target word: "${word}"`,
    `Vietnamese meaning: ${meaningVi || 'n/a'}`,
    `Learner said: "${saidSentence}"`,
  ].join('\n');
  const r = await call<ReviewResult>(system, [{ role: 'user', parts: [{ text: user }] }], REVIEW_SCHEMA, 0.2);
  const grade = Math.max(0, Math.min(5, Math.round(Number(r.grade) || 0)));
  return { ok: grade >= 3, grade, feedback_vi: r.feedback_vi ?? '', better_en: r.better_en ?? '' };
}

export async function analyzePresentation(
  system: string,
  transcript: string,
  wpm: number,
  fillerCount: number,
  durationS: number,
): Promise<PresentationResult> {
  const user = [
    `Measured: ${wpm} wpm over ${Math.round(durationS)} seconds, ${fillerCount} filler words.`,
    '',
    'Transcript:',
    transcript,
  ].join('\n');
  return call<PresentationResult>(
    system,
    [{ role: 'user', parts: [{ text: user }] }],
    PRESENTATION_SCHEMA,
    0.3,
  );
}

export const PRONOUNCE_SCHEMA: SchemaNode = S.obj({ tip_vi: S.str, focus_word: S.str });

export type PronounceFeedback = { tip_vi: string; focus_word: string };

export async function explainPronunciation(
  system: string,
  target: string,
  flagged: { target: string; said: string | null; status: string }[],
): Promise<PronounceFeedback> {
  const lines = flagged.map((f) => `  ${f.target} -> ${f.said ?? '(khong nghe thay)'} [${f.status}]`);
  const user = [`Target sentence: "${target}"`, '', 'Flagged words:', ...lines].join('\n');
  return call<PronounceFeedback>(
    system,
    [{ role: 'user', parts: [{ text: user }] }],
    PRONOUNCE_SCHEMA,
    0.3,
  );
}

export async function gradeTranslate(
  system: string,
  vi: string,
  reference: string,
  said: string,
): Promise<ReviewResult> {
  const user = [
    `Vietnamese prompt: ${vi}`,
    `One natural English reference: ${reference}`,
    `Learner said: "${said}"`,
  ].join('\n');
  const r = await call<ReviewResult>(system, [{ role: 'user', parts: [{ text: user }] }], REVIEW_SCHEMA, 0.2);
  const grade = Math.max(0, Math.min(5, Math.round(Number(r.grade) || 0)));
  return { ok: grade >= 3, grade, feedback_vi: r.feedback_vi ?? '', better_en: r.better_en ?? '' };
}

/**
 * Chang 3 tieng Phap: nguoi hoc GO cau (khong noi — Duy chot 12/09). App tu so
 * dau truoc (fr-text.accentSlips) va dua cho Gemini lam du kien cung: Gemini
 * tung cham mot la thu mat sach dau thanh C1 (do 07/09). Neu app thay sai dau
 * ma Gemini van cho 5 thi ha xuong 4 — sai dau la sai chinh ta.
 */
export async function gradeTranslateFr(
  system: string,
  vi: string,
  reference: string,
  typed: string,
  accentSlips: { typed: string; correct: string }[],
): Promise<ReviewResult> {
  const user = [
    `Vietnamese prompt: ${vi}`,
    `One simple French reference: ${reference}`,
    `Learner typed: "${typed}"`,
    `Accent mistakes found by the app: ${accentSlips.length ? accentSlips.map((a) => `${a.typed} -> ${a.correct}`).join(', ') : 'none against the reference (other words may still be misspelled)'}`,
  ].join('\n');
  const r = await call<ReviewResult>(system, [{ role: 'user', parts: [{ text: user }] }], REVIEW_SCHEMA, 0.2);
  let grade = Math.max(0, Math.min(5, Math.round(Number(r.grade) || 0)));
  if (accentSlips.length && grade > 4) grade = 4;
  return { ok: grade >= 3, grade, feedback_vi: r.feedback_vi ?? '', better_en: r.better_en ?? '' };
}

// ---------------------------------------------------------------------------
// PTE Noi / Viet co nguoi cham (them 12/09) — Gemini GOP Y theo dung mo ta
// thang cham trong Score Guide. KHONG phai diem Pearson: xem api/src/pte-open.ts.
// ---------------------------------------------------------------------------

export const PTE_OPEN_SCHEMA: SchemaNode = S.obj({
  traits: S.arr(S.obj({ name: S.str, band: S.int, why_vi: S.str })),
  key_points: S.arr(S.obj({ point: S.str, covered: S.bool })),
  template_like: S.bool,
  template_vi: S.str,
  fixes: S.arr(FIX_ITEM),
  better_en: S.str,
  summary_vi: S.str,
});

export type PteOpenFeedback = {
  traits: { name: string; band: number; why_vi: string }[];
  key_points: { point: string; covered: boolean }[];
  template_like: boolean;
  template_vi: string;
  fixes: Correction[];
  better_en: string;
  summary_vi: string;
};

export async function gradePteOpen(system: string, user: string): Promise<PteOpenFeedback> {
  const r = await call<PteOpenFeedback>(system, [{ role: 'user', parts: [{ text: user }] }], PTE_OPEN_SCHEMA, 0.2);
  return {
    traits: Array.isArray(r.traits) ? r.traits : [],
    key_points: Array.isArray(r.key_points) ? r.key_points : [],
    template_like: !!r.template_like,
    template_vi: r.template_vi ?? '',
    fixes: Array.isArray(r.fixes) ? r.fixes : [],
    better_en: r.better_en ?? '',
    summary_vi: r.summary_vi ?? '',
  };
}
