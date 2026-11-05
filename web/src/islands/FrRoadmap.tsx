import { useEffect, useState } from 'preact/hooks';
import { get, ApiError, type FrRoadmap as FrRoadmapData, type FrTopic } from '../lib/api';
import { cx } from '../lib/cx';

/**
 * Bai hoc tieng Phap — 8 chu de song con A1 (dot B, 12/09/2026).
 *
 * Giong man Lo trinh tieng Anh nhung doc /fr/learn/topics va KHONG hien diem:
 * chang 1-2 va 4 khong cham (may nghe tieng Phap kem voi giong nguoi moi hoc).
 */
export default function FrRoadmap() {
  const [data, setData] = useState<FrRoadmapData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    get<FrRoadmapData>('/fr/learn/topics')
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, []);

  if (error) return <p class="px-5 py-16 text-center text-[14px] text-bad">{error}</p>;
  if (!data) return <p class="px-5 py-16 text-center text-[14px] text-vi">Đang tải…</p>;
  if (!data.topics.length) {
    return (
      <div class="px-6 py-16 text-center">
        <p class="text-[16px] font-semibold text-en">Chưa có bài tiếng Pháp nào</p>
        <p class="mt-2 text-[14px] leading-relaxed text-vi">Nội dung nằm ở api/content/fr/ — chưa được nạp.</p>
      </div>
    );
  }

  return (
    <div class="px-5 pb-8 pt-7">
      <header>
        <div class="flex items-end justify-between gap-4">
          <h1 class="text-[23px] font-bold text-en">Bài học A1</h1>
          <span class="text-[22px] font-bold tabular-nums text-accent">{data.overall_percent}%</span>
        </div>
        <div class="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
          <div class="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${data.overall_percent}%` }} />
        </div>
        <p class="mt-2 text-[12.5px] text-vi">
          {data.done_stages}/{data.total_stages} chặng · 8 tình huống sống còn khi mới sang Canada
        </p>
      </header>

      {data.next && (
        <a
          href={`/fr-lesson?topic=${data.next.topic_id}&stage=${data.next.stage}`}
          class="mt-6 flex items-center gap-3 rounded-2xl bg-accent px-4 py-4 text-ink active:scale-[0.99]"
        >
          <span class="text-[26px] leading-none">{data.next.emoji}</span>
          <span class="min-w-0 flex-1">
            <span class="block text-[11.5px] font-medium opacity-70">Tiếp theo</span>
            <span class="block truncate text-[16px] font-semibold">{data.next.name_vi}</span>
          </span>
          <span class="shrink-0 rounded-full bg-ink/15 px-2.5 py-1 text-[12px] font-semibold">chặng {data.next.stage}</span>
        </a>
      )}

      <ul class="mt-7 flex flex-col gap-2">
        {data.topics.map((t) => (
          <TopicRow key={t.id} t={t} isNext={data.next?.topic_id === t.id} />
        ))}
      </ul>

      <section class="mt-8 rounded-2xl border border-line bg-surface px-4 py-4 text-[13px] leading-relaxed text-vi">
        <p class="font-semibold text-en-dim">Mỗi chủ đề 4 chặng</p>
        <p class="mt-1.5">1 · 12 từ — nghe mẫu rồi nói theo</p>
        <p>2 · 8 câu phát âm — nghe rồi đọc lại</p>
        <p>3 · Thấy câu tiếng Việt → <b class="text-en-dim">gõ</b> câu tiếng Pháp, chấm từng chữ có dấu</p>
        <p>4 · Trò chuyện với AI trong tình huống thật</p>
        <p class="mt-2 text-[12px]">
          Phần nói không chấm điểm: máy nghe tiếng Pháp hay nghe nhầm giọng người mới học. Xong chặng 1 thì 12 từ vào
          kho Ôn từ.
        </p>
      </section>
    </div>
  );
}

function TopicRow({ t, isNext }: { t: FrTopic; isNext: boolean }) {
  const complete = t.done_stages === t.stages.length;
  return (
    <li>
      <a
        href={`/fr-lesson?topic=${t.id}&stage=${t.unlocked}`}
        class={cx(
          'flex items-center gap-3 rounded-2xl border px-4 py-3.5 active:scale-[0.995]',
          complete ? 'border-accent/25 bg-accent/[0.06]' : isNext ? 'border-accent/40 bg-surface' : 'border-line bg-surface',
        )}
      >
        <span class="text-[22px] leading-none">{t.emoji}</span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[15px] font-medium text-en">{t.name_vi}</span>
          <span class="mt-1 flex items-center gap-1.5">
            {t.stages.map((s) => {
              const partial = !s.done && s.items_done > 0;
              return (
                <span
                  key={s.stage}
                  title={`${s.name_vi}${s.done ? ' · xong' : partial ? ` · ${s.items_done}/${s.total}` : ''}`}
                  class={cx(
                    'h-2.5 w-2.5 rounded-full',
                    s.done ? 'bg-accent' : partial ? 'bg-accent/45' : s.stage <= t.unlocked ? 'border border-vi/50' : 'border border-line',
                  )}
                />
              );
            })}
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
