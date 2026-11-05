import type { RefObject } from 'preact';

/**
 * Hang phim dau tieng Phap, chen DUNG CHO con tro trong o go.
 *
 * Can vi ba man tieng Phap (On tu, chang 3, Chinh ta) cham chinh ta CO DAU ma
 * ban phim tieng Viet / tieng Anh tren dien thoai khong co san é è ç œ — bat
 * nguoi hoc giu phim de tim dau thi ho se bo dau, roi bi cham sai.
 *
 * onMouseDown preventDefault: bam phim khong lam o go mat focus (iOS dong ban
 * phim neu mat focus).
 */
const KEYS = ['é', 'è', 'ê', 'à', 'â', 'ç', 'ô', 'î', 'û', 'ù', 'ë', 'ï', 'œ', "'"];

export default function FrKeys({
  target,
  value,
  onChange,
}: {
  target: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  value: string;
  onChange: (v: string) => void;
}) {
  const put = (ch: string) => {
    const el = target.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + ch + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + ch.length, start + ch.length);
    });
  };
  return (
    <div class="mt-2 flex flex-wrap gap-1.5">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => put(k)}
          class="h-9 min-w-[2.25rem] rounded-lg border border-line bg-surface-2 px-2 text-[17px] text-en active:bg-accent/20"
        >
          {k}
        </button>
      ))}
    </div>
  );
}
