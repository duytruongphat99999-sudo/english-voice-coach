import { useEffect, useState } from 'preact/hooks';
import { get, ApiError, type Progress } from '../lib/api';
import { cx } from '../lib/cx';

/** Liec mot phat la xong. Khong lam dashboard (spec §6). */
export default function ProgressView() {
  const [p, setP] = useState<Progress | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    get<Progress>('/progress')
      .then(setP)
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, []);

  if (error) return <p class="px-5 py-16 text-center text-[14px] text-bad">{error}</p>;
  if (!p) return <p class="px-5 py-16 text-center text-[14px] text-vi">Đang tải…</p>;

  return (
    <div class="px-5 pb-8 pt-7">
      <h1 class="text-[23px] font-bold text-en">Tiến độ</h1>

      <div class="mt-5 grid grid-cols-2 gap-2.5">
        <Tile v={String(p.streak)} l="ngày streak" accent />
        <Tile v={String(p.words_learned)} l="từ đã thuộc" sub={`/ ${p.words_total} trong kho`} />
        <Tile v={String(p.words_due)} l="từ tới hạn" />
        <Tile v={String(p.sessions_finished)} l="buổi hội thoại" sub={`/ ${p.sessions} đã mở`} />
      </div>

      <section class="mt-8">
        <h2 class="mb-3 text-[12px] uppercase tracking-wide text-vi">30 ngày qua</h2>
        <div class="flex flex-wrap gap-1.5">
          {p.last_30_days.map((d) => (
            <span
              key={d.date}
              title={`${d.date}${d.completed ? ' · xong' : ''}`}
              class={cx(
                'h-6 w-6 rounded-md',
                d.completed ? 'bg-accent' : d.vocab_reviewed > 0 ? 'bg-accent/30' : 'bg-surface-2',
              )}
            />
          ))}
        </div>
        <p class="mt-2.5 text-[12px] text-vi">Ô đậm = hoàn thành nhiệm vụ · ô nhạt = có học nhưng chưa xong</p>
      </section>

      {p.wpm_trend.length > 0 && (
        <section class="mt-8">
          <h2 class="mb-3 text-[12px] uppercase tracking-wide text-vi">Tốc độ nói (wpm)</h2>
          <WpmChart data={p.wpm_trend} />
        </section>
      )}

      {p.by_domain.length > 0 && (
        <section class="mt-8">
          <h2 class="mb-3 text-[12px] uppercase tracking-wide text-vi">Từ theo mảng</h2>
          <ul class="flex flex-col gap-2">
            {p.by_domain.map((d) => {
              const max = p.by_domain[0]?.n || 1;
              return (
                <li key={d.domain} class="flex items-center gap-3">
                  <span class="w-28 shrink-0 truncate text-[13.5px] text-en-dim">{d.domain}</span>
                  <span class="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <span class="block h-full rounded-full bg-accent/70" style={{ width: `${(d.n / max) * 100}%` }} />
                  </span>
                  <span class="w-6 shrink-0 text-right text-[12.5px] tabular-nums text-vi">{d.n}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function WpmChart({ data }: { data: { id: number; wpm: number }[] }) {
  const W = 320;
  const H = 96;
  const pad = 6;
  const vals = data.map((d) => d.wpm);
  const lo = Math.min(100, ...vals) - 10;
  const hi = Math.max(180, ...vals) + 10;
  const x = (i: number) => (data.length === 1 ? W / 2 : pad + (i * (W - pad * 2)) / (data.length - 1));
  const y = (v: number) => H - pad - ((v - lo) / (hi - lo)) * (H - pad * 2);

  const band = { top: y(160), bottom: y(130) };
  const path = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d.wpm).toFixed(1)}`).join(' ');

  return (
    <div class="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} class="h-24 w-full" preserveAspectRatio="none">
        {/* Vung 130-160 wpm = moc cho thuyet trinh. */}
        <rect
          x="0"
          y={band.top}
          width={W}
          height={Math.max(1, band.bottom - band.top)}
          fill="var(--color-accent)"
          opacity="0.10"
        />
        <path d={path} fill="none" stroke="var(--color-accent)" stroke-width="2" stroke-linejoin="round" />
        {data.map((d, i) => (
          <circle key={d.id} cx={x(i)} cy={y(d.wpm)} r="2.5" fill="var(--color-accent)" />
        ))}
      </svg>
      <p class="mt-1.5 text-[12px] text-vi">Dải sáng là mốc 130–160 wpm</p>
    </div>
  );
}

function Tile({ v, l, sub, accent }: { v: string; l: string; sub?: string; accent?: boolean }) {
  return (
    <div class="rounded-2xl border border-line bg-surface px-4 py-4">
      <p class={cx('text-[27px] font-bold leading-none', accent ? 'text-accent' : 'text-en')}>{v}</p>
      <p class="mt-1.5 text-[12.5px] text-en-dim">{l}</p>
      {sub && <p class="text-[11.5px] text-vi">{sub}</p>}
    </div>
  );
}
