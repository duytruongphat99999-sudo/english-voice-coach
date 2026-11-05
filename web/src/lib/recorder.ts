/**
 * Thu am tu mic + do bien do de ve waveform.
 *
 * Khong convert format o client: speaches decode bang PyAV nen nhan thang
 * webm/opus (Chrome/Android) va mp4/aac (Safari/iOS).
 *
 * getUserMedia chi chay trong secure context => localhost khi dev, HTTPS qua
 * Cloudflare tunnel khi dung that.
 */

export type RecorderState = 'idle' | 'recording' | 'stopped';

function pickMime(): string {
  const prefer = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const m of prefer) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

export function extFor(mime: string): string {
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  return 'bin';
}

export class MicRecorder {
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private data: Uint8Array | null = null;
  private startedAt = 0;

  mime = '';
  state: RecorderState = 'idle';

  static get supported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined'
    );
  }

  async start(): Promise<void> {
    if (this.state === 'recording') return;
    if (!MicRecorder.supported) {
      throw new Error('Trinh duyet nay khong ho tro thu am. Can Chrome/Safari ban moi va trang HTTPS.');
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (e) {
      const err = e as DOMException;
      if (err.name === 'NotAllowedError') throw new Error('Chua cho phep dung mic. Bat quyen mic cho trang nay roi thu lai.');
      if (err.name === 'NotFoundError') throw new Error('Khong tim thay mic nao.');
      throw new Error(`Khong mo duoc mic: ${err.message}`);
    }

    this.mime = pickMime();
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream, this.mime ? { mimeType: this.mime } : undefined);
    this.rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.rec.start(250);
    this.startedAt = Date.now();
    this.state = 'recording';

    // Analyser chi de ve song. Loi o day khong duoc lam hong viec thu am.
    try {
      this.ctx = new AudioContext();
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.75;
      src.connect(this.analyser);
      this.data = new Uint8Array(this.analyser.frequencyBinCount);
    } catch {
      this.analyser = null;
    }
  }

  /** 0..1, dung cho waveform. */
  level(): number {
    if (!this.analyser || !this.data) return 0;
    this.analyser.getByteTimeDomainData(this.data as unknown as Uint8Array<ArrayBuffer>);
    let peak = 0;
    for (let i = 0; i < this.data.length; i += 1) {
      const v = Math.abs(this.data[i]! - 128) / 128;
      if (v > peak) peak = v;
    }
    return Math.min(1, peak * 1.8);
  }

  elapsed(): number {
    return this.state === 'recording' ? (Date.now() - this.startedAt) / 1000 : 0;
  }

  async stop(): Promise<{ blob: Blob; mime: string; duration: number }> {
    if (!this.rec || this.state !== 'recording') throw new Error('Chua thu am.');
    const duration = (Date.now() - this.startedAt) / 1000;

    const blob = await new Promise<Blob>((resolve) => {
      this.rec!.onstop = () => resolve(new Blob(this.chunks, { type: this.mime || 'audio/webm' }));
      this.rec!.stop();
    });

    this.cleanup();
    this.state = 'stopped';
    return { blob, mime: this.mime || 'audio/webm', duration };
  }

  cancel() {
    try {
      if (this.rec && this.state === 'recording') this.rec.stop();
    } catch {
      /* da dung roi */
    }
    this.cleanup();
    this.state = 'idle';
  }

  private cleanup() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.rec = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
    this.data = null;
  }
}

/**
 * Hang doi phat audio. Cac mieng TTS ve khong deu nhau; phat lien tiep dung
 * thu tu, khong chong tieng.
 */
export class AudioQueue {
  private queue: { index: number; url: string }[] = [];
  private playing = false;
  private nextIndex = 0;
  onStart?: () => void;
  onIdle?: () => void;

  push(index: number, b64: string, mime: string) {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) buf[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([buf], { type: mime }));
    this.queue.push({ index, url });
    this.queue.sort((a, b) => a.index - b.index);
    void this.pump();
  }

  private async pump() {
    if (this.playing) return;
    this.playing = true;
    this.onStart?.();
    while (this.queue.length) {
      const head = this.queue[0]!;
      // Mieng ke tiep chua ve — dung cho, dung nhay coc.
      if (head.index !== this.nextIndex) break;
      this.queue.shift();
      this.nextIndex += 1;
      await this.playOne(head.url);
      URL.revokeObjectURL(head.url);
    }
    this.playing = false;
    if (!this.queue.length) this.onIdle?.();
  }

  private playOne(url: string): Promise<void> {
    return new Promise((resolve) => {
      const a = new Audio(url);
      a.onended = () => resolve();
      // Trinh duyet chan autoplay hoac file hong => bo qua, dung treo UI.
      a.onerror = () => resolve();
      void a.play().catch(() => resolve());
    });
  }

  reset() {
    this.queue.forEach((q) => URL.revokeObjectURL(q.url));
    this.queue = [];
    this.nextIndex = 0;
    this.playing = false;
  }
}

/** Phat mot file audio tu URL (nut "nghe lai"). */
export function playUrl(url: string): Promise<void> {
  return new Promise((resolve) => {
    const a = new Audio(url);
    a.onended = () => resolve();
    a.onerror = () => resolve();
    void a.play().catch(() => resolve());
  });
}
