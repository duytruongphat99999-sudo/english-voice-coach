import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cfg } from './config.js';

export class TtsError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'TtsError';
  }
}

// ---------------------------------------------------------------------------
// Cache dia
//
// speaches KHONG cache gi. Do that 06/09: cung mot clip goi ba lan van mat
// 2,34 / 1,94 / 2,06 giay — moi lan bam nut nghe la tong hop lai tu dau.
// Nut nghe TU ngan hon nhung van 0,84-1,01 giay.
//
// Client co Cache-Control: private, max-age=86400 nen trinh duyet nho duoc,
// nhung mat sach khi doi may, xoa cache, hay mo tab an danh — va lan DAU cua
// moi clip thi luon phai doi.
//
// Cache o day nam ben trong synthesize() nen MOI duong goi TTS deu duoc huong:
// nut nghe tu, nghe cau vi du, doc de PTE, va ca roleplay.
//
// Ten file la hash cua (model|voice|speed|text): doi bat ky thu nao trong do
// la tu dong sinh lai, khong phai xoa tay. File cu nam lai vo hai.
// ---------------------------------------------------------------------------
const cacheDir = resolve(cfg.dataDir, 'tts-cache');
let cacheReady = false;

function ensureCacheDir(): boolean {
  if (cacheReady) return true;
  try {
    mkdirSync(cacheDir, { recursive: true });
    cacheReady = true;
  } catch (e) {
    // Dia chi doc / khong co quyen: bo cache, van tong hop binh thuong.
    console.warn(`[tts] khong tao duoc thu muc cache (${cacheDir}): ${(e as Error).message}`);
  }
  return cacheReady;
}

function cachePath(text: string, voice: string): string {
  const key = `${cfg.tts.model}|${voice}|${cfg.tts.speed}|${text}`;
  return resolve(cacheDir, `${createHash('sha1').update(key).digest('hex')}.mp3`);
}

/** Doc clip da co. Loi doc bat ky (file hong, mat quyen) deu coi nhu chua co. */
function readCache(p: string): Buffer | null {
  try {
    if (statSync(p).size > 0) return readFileSync(p);
  } catch {
    /* chua co */
  }
  return null;
}

/**
 * Ghi clip. Ghi ra file tam roi doi ten — hai request cung luc cung mot cau
 * thi khong ai doc phai file viet do dang.
 *
 * Ghi that bai KHONG duoc lam hong luot nghe: da co audio trong tay roi.
 */
function writeCache(p: string, buf: Buffer): void {
  try {
    const tmp = `${p}.${process.pid}.tmp`;
    writeFileSync(tmp, buf);
    renameSync(tmp, p);
  } catch (e) {
    console.warn(`[tts] khong ghi duoc cache: ${(e as Error).message}`);
  }
}

/**
 * Giong doc theo ngon ngu.
 *
 * speaches doi CA HAI: model id (`speaches-ai/Kokoro-82M-v1.0-ONNX`) va voice id
 * (`af_heart`). Spec goc chi co TTS_VOICE — thieu model se 404.
 *
 * ⚠️ Kokoro co 54 giong nhung tieng Phap CHI CO MOT: ff_siwis (nu). Tieng Anh
 * co 28. Do la mot han che that cua viec luyen NGHE tieng Phap: de thi TEF/TCF
 * dung nhieu nguoi noi, nhieu toc do, co ca giong Quebec. Tu B1 tro len nen
 * chuyen sang audio that (RFI, TV5Monde, Radio-Canada) thay vi giong tong hop.
 */
const VOICE_BY_LANG: Record<string, string> = {
  fr: 'ff_siwis',
};

/**
 * `voice` (them 12/09): chon giong rieng — bai "Tom tat thao luan nhom" can BA
 * nguoi noi khac nhau. Bo trong thi nhu cu. Ten file cache da gom giong nen
 * khong dung nhau.
 */
const pending = new Map<string, Promise<Buffer>>();

export async function synthesize(text: string, lang: 'en' | 'fr' = 'en', voiceOverride?: string): Promise<Buffer> {
  const voice = voiceOverride ?? VOICE_BY_LANG[lang] ?? cfg.tts.voice;
  const key = cachePath(text.trim(), voice);
  const existing = pending.get(key);
  if (existing) return existing;
  const job = synthesizeOnce(text, lang, voiceOverride);
  pending.set(key, job);
  try { return await job; } finally { pending.delete(key); }
}

async function synthesizeOnce(text: string, lang: 'en' | 'fr' = 'en', voiceOverride?: string): Promise<Buffer> {
  const voice = voiceOverride ?? VOICE_BY_LANG[lang] ?? cfg.tts.voice;
  const clean = text.trim();
  if (!clean) return Buffer.alloc(0);

  // Da tong hop cau nay roi thi tra thang tu dia, khong goi speaches nua.
  const hit = ensureCacheDir() ? cachePath(clean, voice) : null;
  if (hit) {
    const cached = readCache(hit);
    if (cached) return cached;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  let res: Response;
  try {
    res = await fetch(`${cfg.tts.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.tts.model,
        voice,
        input: clean,
        response_format: 'mp3',
        speed: cfg.tts.speed,
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw new TtsError(
      `Khong goi duoc TTS (${cfg.tts.baseUrl}): ${(e as Error).message}. Container evc-speaches con song khong?`,
    );
  }

  if (!res.ok) {
    clearTimeout(timer);
    const body = await res.text().catch(() => '');
    if (res.status === 404 || /model.*not.*(found|downloaded)/i.test(body)) {
      throw new TtsError(
        `speaches chua co model "${cfg.tts.model}". Chay: bash scripts/preload-models.sh`,
        res.status,
      );
    }
    throw new TtsError(`TTS loi ${res.status}: ${body.slice(0, 300)}`, res.status);
  }

  let buf: Buffer;
  try { buf = Buffer.from(await res.arrayBuffer()); }
  finally { clearTimeout(timer); }
  if (hit && buf.length) writeCache(hit, buf);
  return buf;
}

/**
 * Cat text thanh cum cau de TTS tra ve som tung mieng thay vi doi ca doan.
 * Day la thu duy nhat keo do tre cam nhan xuong: cau dau phat khi Gemini
 * van con dang viet not phan sua loi.
 */
export function splitForStreaming(text: string, minChars = 90): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text];
  const out: string[] = [];
  let buf = '';
  for (const s of sentences) {
    buf += s;
    // Mieng DAU cat ngay sau cau dau tien: TTS tren CPU chay ~1s cho moi 10
    // tu, nen mieng dau ngan la thu duy nhat keo do tre "bam xong -> nghe
    // thay tieng" xuong. Cac mieng sau to hon cho do vun giong.
    const need = out.length === 0 ? 1 : minChars;
    if (buf.trim().length >= need) {
      out.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) {
    // Manh cuoi qua ngan thi gop vao mieng truoc cho khoi cut giong.
    if (out.length && buf.trim().length < 25) out[out.length - 1] += ' ' + buf.trim();
    else out.push(buf.trim());
  }
  return out.filter(Boolean);
}
