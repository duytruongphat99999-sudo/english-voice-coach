import { useEffect, useState } from 'preact/hooks';
import { get, ApiError, type Roadmap as RoadmapData, type RoadmapTopic } from '../lib/api';
import { cx } from '../lib/cx';

/**
 * Lo trinh — man tra loi cau "toi dang o dau, con bao nhieu nua".
 *
 * Truoc day app chi hien viec cua hom nay, khong co cho nao nhin thay duong
 * dai, nen khong biet lay gi ma phan dau.
 */
export default function Roadmap() {
  const [data, setData] = useState<RoadmapData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    get<RoadmapData>('/learn/topics')
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, []);

  if (error) return <p class="px-5 py-16 text-center text-[14px] text-bad">{error}</p>;
  if (!data) return <p class="px-5 py-16 text-center text-[14px] text-vi">Đang tải…</p>;

  if (!data.topics.length) {
    return (
      <div class="px-6 py-16 text-center">
        <p class="text-[16px] font-semibold text-en">Chưa có nội dung</p>
        <p class="mt-2 text-[14px] leading-relaxed text-vi">
          Chạy <code class="text-en-dim">node scripts/gen-content.mjs</code> trên máy chủ rồi mở lại.
        </p>
      </div>
    );
  }

  const byTrack = data.tracks
    .map((tr) => ({ ...tr, items: data.topics.filter((t) => t.track === tr.key) }))
    .filter((g) => g.items.length);

  return (
    <div class="px-5 pb-8 pt-7">
      <header>
        <div class="flex items-end justify-between gap-4">
          <h1 class="text-[23px] font-bold text-en">Lộ trình</h1>
          <span class="text-[22px] font-bold tabular-nums text-accent">{data.overall_percent}%</span>
        </div>
        <div class="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
          <div
            class="h-full rounded-full bg-accent transition-[width] duration-500"
            style={{ width: `${data.overall_percent}%` }}
          />
        </div>
        <p class="mt-2 text-[12.5px] text-vi">
          {data.done_stages}/{data.total_stages} chặng · mỗi chủ đề 4 chặng
        </p>
      </header>

      {data.next && (
        <a
          href={`/lesson?topic=${data.next.topic_id}&stage=${data.next.stage}`}
          class="mt-6 flex items-center gap-3 rounded-2xl bg-accent px-4 py-4 text-ink active:scale-[0.99]"
        >
          <span class="text-[26px] leading-none">{data.next.emoji}</span>
          <span class="min-w-0 flex-1">
            <span class="block text-[11.5px] font-medium opacity-70">Tiếp theo</span>
            <span class="block truncate text-[16px] font-semibold">{data.next.name_vi}</span>
          </span>
          <span class="shrink-0 rounded-full bg-ink/15 px-2.5 py-1 text-[12px] font-semibold">
            chặng {data.next.stage}
          </span>
        </a>
      )}

      {byTrack.map((g) => (
        <section key={g.key} class="mt-8">
          <h2 class="mb-3 text-[12px] uppercase tracking-wide text-vi">{g.name_vi}</h2>
          <ul class="flex flex-col gap-2">
            {g.items.map((t) => (
              <TopicRow key={t.id} t={t} isNext={data.next?.topic_id === t.id} />
            ))}
          </ul>
        </section>
      ))}

      <p class="mt-9 text-center text-[12px] leading-relaxed text-vi">
        Chủ đề mở hết ngay từ đầu — chọn cái đang cần dùng.
        <br />
        Trong mỗi chủ đề thì 4 chặng đi lần lượt.
      </p>
    </div>
  );
}

function TopicRow({ t, isNext }: { t: RoadmapTopic; isNext: boolean }) {
  const complete = t.done_stages === t.stages.length;
  return (
    <li>
      <a
        href={`/lesson?topic=${t.id}&stage=${t.unlocked}`}
        class={cx(
          'flex items-center gap-3 rounded-2xl border px-4 py-3.5 active:scale-[0.995]',
          complete
            ? 'border-accent/25 bg-accent/[0.06]'
            : isNext
              ? 'border-accent/40 bg-surface'
              : 'border-line bg-surface',
        )}
      >
        <span class="text-[22px] leading-none">{t.emoji}</span>

        <span class="min-w-0 flex-1">
          <span class="block truncate text-[15px] font-medium text-en">{t.name_vi}</span>
          <span class="mt-1 flex items-center gap-1.5">
            {t.stages.map((s) => (
              <Dot key={s.stage} s={s} unlocked={s.stage <= t.unlocked} />
            ))}
            <span class="ml-1 text-[11.5px] text-vi">
              {t.done_stages}/{t.stages.length}
            </span>
          </span>
        </span>

        <span class="shrink-0 text-vi">{complete ? '✓' : '›'}</span>
      </a>
    </li>
  );
}

function Dot({
  s,
  unlocked,
}: {
  s: RoadmapTopic['stages'][number];
  unlocked: boolean;
}) {
  // Dang lam do dang thi to nua vong, de phan biet voi "chua dung toi".
  const partial = !s.done && s.items_done > 0;
  return (
    <span
      title={`${s.name_vi}${s.done ? ' · xong' : partial ? ` · ${s.items_done}/${s.total}` : ''}`}
      class={cx(
        'h-2.5 w-2.5 rounded-full',
        s.done
          ? 'bg-accent'
          : partial
            ? 'bg-accent/45'
            : unlocked
              ? 'border border-vi/50'
              : 'border border-line',
      )}
    />
  );
}
