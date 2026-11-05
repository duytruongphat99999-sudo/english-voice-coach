import { useEffect, useRef, useState } from 'preact/hooks';
import { MicRecorder } from '../lib/recorder';
import { cx } from '../lib/cx';

export type MicPhase = 'idle' | 'recording' | 'busy';

type Props = {
  phase: MicPhase;
  /** Nhan blob khi nguoi dung bam dung. */
  onDone: (blob: Blob, mime: string, duration: number) => void;
  onError: (message: string) => void;
  /** Chu duoi nut, tieng Viet, mo. */
  hint?: string;
  /** Bam nut giua luc busy thi bo qua. */
  disabled?: boolean;
  /** Tu dung sau bao nhieu giay (0 = khong gioi han). */
  maxSeconds?: number;
  /** Bao cho component cha biet da bat/tat mic, de an giao dien. */
  onStateChange?: (phase: MicPhase) => void;
  /**
   * Goi NGAY khi nguoi dung cham nut, TRUOC khi xin quyen mic.
   *
   * Man On tu do thoi gian phan xa bang moc `recording`, ma moc do chi bat sau
   * `await r.start()` — ben trong do la getUserMedia + tao MediaRecorder, va
   * MicRecorder duoc tao moi moi lan cham nen lan nao cung phai xin lai stream.
   * Toan bo khoang do dang bi tinh la "nguoi hoc nghi lau". Prop nay cho phep
   * chot dong ho dung luc ngon tay cham xuong.
   */
  onTap?: () => void;
};

/**
 * Nut mic — hanh dong chinh cua moi man (spec §6.6).
 * 3 trang thai: idle -> dang nghe (co waveform) -> dang xu ly.
 */
export default function MicButton({ phase, onDone, onError, hint, disabled, maxSeconds = 90, onStateChange, onTap }: Props) {
  const recRef = useRef<MicRecorder | null>(null);
  const rafRef = useRef<number>(0);
  const [level, setLevel] = useState(0);
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      recRef.current?.cancel();
      document.body.classList.remove('recording');
    };
  }, []);

  const tick = () => {
    const r = recRef.current;
    if (!r || r.state !== 'recording') return;
    setLevel(r.level());
    const e = r.elapsed();
    setSecs(e);
    if (maxSeconds > 0 && e >= maxSeconds) {
      void stop();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  };

  const start = async () => {
    // Chot dong ho o day: moi thu sau dong nay (xin quyen mic, tao recorder)
    // deu la thoi gian cua MAY, khong phai thoi gian nguoi hoc nghi.
    onTap?.();
    try {
      const r = new MicRecorder();
      recRef.current = r;
      await r.start();
      document.body.classList.add('recording');
      onStateChange?.('recording');
      // Rung nhe de biet da bat dau ma khong can nhin man hinh.
      navigator.vibrate?.(15);
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      recRef.current = null;
      onStateChange?.('idle');
      onError((e as Error).message);
    }
  };

  const stop = async () => {
    const r = recRef.current;
    if (!r || r.state !== 'recording') return;
    cancelAnimationFrame(rafRef.current);
    document.body.classList.remove('recording');
    onStateChange?.('idle');
    navigator.vibrate?.(10);
    try {
      const { blob, mime, duration } = await r.stop();
      recRef.current = null;
      setLevel(0);
      setSecs(0);
      if (duration < 0.6) {
        onError('Ngắn quá, chưa kịp nghe. Giữ lâu hơn một chút.');
        return;
      }
      onDone(blob, mime, duration);
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const busy = phase === 'busy';
  const recording = phase === 'recording';

  const label = busy ? 'Đang xử lý…' : recording ? 'Chạm để dừng' : 'Chạm để nói';

  return (
    <div class="flex flex-col items-center gap-3 py-2">
      {recording && <Waveform level={level} />}

      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => (recording ? void stop() : void start())}
        aria-label={label}
        class={cx(
          'relative flex h-24 w-24 items-center justify-center rounded-full transition-all duration-200',
          'focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/40',
          busy
            ? 'bg-surface-2 text-vi cursor-wait'
            : recording
              ? 'bg-bad text-ink shadow-[0_0_0_10px_rgba(242,118,91,0.12)]'
              : 'bg-accent text-ink shadow-[0_0_0_8px_rgba(74,222,155,0.10)] active:scale-95',
        )}
        style={recording ? { transform: `scale(${1 + level * 0.12})` } : undefined}
      >
        {busy ? <Spinner /> : recording ? <StopIcon /> : <MicIcon />}
      </button>

      <div class="min-h-[2.5rem] text-center">
        <p class="text-[15px] font-medium text-en-dim">{label}</p>
        {recording ? (
          <p class="text-[13px] tabular-nums text-vi">
            {secs.toFixed(0)}s{maxSeconds > 0 ? ` / ${maxSeconds}s` : ''}
          </p>
        ) : (
          hint && !busy && <p class="text-[13px] text-vi">{hint}</p>
        )}
      </div>
    </div>
  );
}

function Waveform({ level }: { level: number }) {
  const bars = 13;
  return (
    <div class="flex h-12 items-center justify-center gap-[3px]" aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => {
        // Giua cao hon hai bien -> nhin ra hinh song chu khong phai cot deu.
        const center = 1 - Math.abs(i - (bars - 1) / 2) / ((bars - 1) / 2);
        const h = 6 + level * 42 * (0.35 + center * 0.65);
        return (
          <span
            class="w-[3px] rounded-full bg-accent/70"
            style={{ height: `${h}px`, transition: 'height 90ms linear' }}
          />
        );
      })}
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor" stroke="none" />
      <path d="M5 11a7 7 0 0 0 14 0" stroke-linecap="round" />
      <path d="M12 18v3" stroke-linecap="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24">
      <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
      <circle cx="12" cy="12" r="9" opacity="0.2" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke-linecap="round">
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="0.9s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}
