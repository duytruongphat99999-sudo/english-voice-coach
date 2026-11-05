import { cfg } from './config.js';

export class SttError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'SttError';
  }
}

export type HeardWord = { word: string; start: number; end: number; probability: number };
export type Transcription = { text: string; duration_s: number; words: HeardWord[] };

/**
 * Gui audio thang cho speaches. KHONG convert format o day:
 * - speaches decode bang PyAV (qua faster_whisper.decode_audio) nen nhan
 *   webm/opus tu Chrome va mp4/aac tu Safari iOS.
 * - Container api la node:24-slim, khong co ffmpeg, va rang buoc du an cam
 *   `apt install` trong buoc build => khong the convert kieu khac duoc.
 */
export async function transcribe(
  audio: Buffer,
  filename: string,
  mimetype: string,
  opts: { prompt?: string; words?: boolean; lang?: 'en' | 'fr' } = {},
): Promise<Transcription> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: mimetype || 'audio/webm' }), filename || 'audio.webm');
  form.append('model', cfg.stt.model);
  // Ngon ngu PHAI khai bao. De Whisper tu doan thi cau tieng Phap ngan de bi
  // nhan nham thanh tieng Anh roi phien am bay ("Où est" -> "west"). Mac dinh
  // 'en' de moi duong goi cu giu nguyen hanh vi.
  form.append('language', opts.lang ?? 'en');
  form.append('response_format', 'verbose_json');
  // Timestamp theo tung tu, kem `probability` cua Whisper cho moi tu — day la
  // tin hieu duy nhat de cham phat am (xem pronounce.ts). Chi bat khi can:
  // no lam Whisper cham hon vi phai chay them buoc can chinh.
  if (opts.words) form.append('timestamp_granularities[]', 'word');
  // `prompt` day Whisper ve phia tu vung nghiep vu — giup no khong bien
  // "leverage" thanh "level rage".
  if (opts.prompt) form.append('prompt', opts.prompt.slice(0, 800));

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  let res: Response;
  try {
    res = await fetch(`${cfg.stt.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      body: form,
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new SttError(
      `Khong goi duoc STT (${cfg.stt.baseUrl}): ${(e as Error).message}. Container evc-speaches con song khong?`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 404 || /model.*not.*(found|downloaded)/i.test(body)) {
      throw new SttError(
        `speaches chua co model "${cfg.stt.model}". Chay: bash scripts/preload-models.sh`,
        res.status,
      );
    }
    throw new SttError(`STT loi ${res.status}: ${body.slice(0, 300)}`, res.status);
  }

  const json = (await res.json()) as {
    text?: string;
    duration?: number;
    words?: HeardWord[];
    segments?: { words?: HeardWord[] }[];
  };
  const text = (json.text ?? '').trim();

  // speaches de mang `words` o cap goc, nhung mot so ban lai nhet trong tung
  // segment. Nhan ca hai cho de khoi phu thuoc vao chi tiet do.
  const words = json.words ?? (json.segments ?? []).flatMap((s) => s.words ?? []);

  // verbose_json tra `duration` (giay). Fallback 0 de cho nguoi goi tu xu ly.
  return {
    text,
    duration_s: typeof json.duration === 'number' ? json.duration : 0,
    words: Array.isArray(words) ? words : [],
  };
}
