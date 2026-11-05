import { useEffect, useRef, useState } from 'preact/hooks';
import { cx } from '../lib/cx';

type Props = {
  /** URL tra ve audio/mpeg. */
  src: string;
  label?: string;
  /** 'chip' cho nut nho canh chu, 'block' cho nut to doc lap. */
  variant?: 'chip' | 'block';
  autoPlay?: boolean;
};

type State = 'idle' | 'loading' | 'playing' | 'error';

/**
 * Nut nghe mau.
 *
 * Ban truoc chi goi play() roi thoi: bam xong man hinh khong doi gi, ma TTS
 * tren CPU mat 1-2 giay moi ra tieng, nen khong biet la may dang nghi hay
 * minh bam truot. Gio bat buoc co bon trang thai nhin thay duoc, va rung nhe
 * ngay luc cham de biet may da nhan.
 */
export default function SpeakButton({ src, label = 'nghe mẫu', variant = 'chip', autoPlay }: Props) {
  const [state, setState] = useState<State>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string>('');
  const controller = useRef<AbortController | null>(null);
  const version = useRef(0);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      version.current++;
      controller.current?.abort();
      clearTimeout(resetTimer.current);
      audioRef.current?.pause();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  // Doi muc khac thi ve idle, khong giu trang thai cua muc truoc.
  useEffect(() => {
    version.current++;
    controller.current?.abort();
    clearTimeout(resetTimer.current);
    setState('idle');
    audioRef.current?.pause();
    audioRef.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = '';
  }, [src]);

  const play = async () => {
    if (state === 'loading') return;
    if (state === 'playing') {
      audioRef.current?.pause();
      setState('idle');
      return;
    }

    navigator.vibrate?.(12);
    setState('loading');
    const requestVersion = version.current;
    try {
      // Keep the decoded clip for instant replays within this sentence.
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        await audioRef.current.play();
        setState('playing');
        return;
      }
      controller.current = new AbortController();
      const res = await fetch(src, { signal: controller.current.signal });
      if (res.status === 401) {
        window.location.replace('/login.html');
        return;
      }
      if (!res.ok) throw new Error(`máy chủ trả ${res.status}`);

      const blob = await res.blob();
      if (version.current !== requestVersion) return;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(blob);

      const a = new Audio(urlRef.current);
      audioRef.current = a;
      a.onended = () => setState('idle');
      a.onerror = () => setState('error');
      setState('playing');
      await a.play();
    } catch {
      if (version.current !== requestVersion) return;
      setState('error');
      // Loi khong dinh mai tren man hinh — 2.5s roi cho bam lai.
      resetTimer.current = setTimeout(() => setState('idle'), 2500);
    }
  };

  useEffect(() => {
    if (autoPlay) void play();
    // Chi tu phat khi doi muc.
  }, [src]);

  const text =
    state === 'loading' ? 'đang tải…' : state === 'playing' ? 'đang phát' : state === 'error' ? 'không phát được' : label;

  const icon =
    state === 'loading' ? <Spinner /> : state === 'playing' ? <Waves /> : state === 'error' ? <span>⚠</span> : <span>🔊</span>;

  if (variant === 'block') {
    return (
      <button
        type="button"
        onClick={() => void play()}
        aria-live="polite"
        class={cx(
          'flex w-full items-center justify-center gap-2.5 rounded-xl border py-3.5 text-[15px] font-medium transition-colors',
          state === 'playing'
            ? 'border-accent/40 bg-accent/10 text-accent'
            : state === 'error'
              ? 'border-bad/40 bg-bad/10 text-bad'
              : 'border-line bg-surface text-en-dim active:bg-surface-2',
        )}
      >
        {icon}
        <span>{text}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void play()}
      aria-live="polite"
      class={cx(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] transition-colors',
        state === 'playing'
          ? 'bg-accent/15 text-accent'
          : state === 'error'
            ? 'bg-bad/15 text-bad'
            : 'bg-surface-2 text-vi active:bg-surface',
      )}
    >
      {icon}
      <span>{text}</span>
    </button>
  );
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke-linecap="round">
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="0.8s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}

/** Ba vach nhun nhay — nhin la biet dang co tieng, khong can doc chu. */
function Waves() {
  return (
    <span class="inline-flex h-3.5 items-end gap-[2px]" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          class="w-[3px] rounded-full bg-current"
          style={{ animation: `evcwave 0.7s ease-in-out ${i * 0.15}s infinite alternate`, height: '6px' }}
        />
      ))}
      <style>{`@keyframes evcwave { from { height: 4px } to { height: 14px } }`}</style>
    </span>
  );
}
