import { useEffect, useState } from 'preact/hooks';
import { get, post, ApiError, type Today, type ScenarioBrief } from '../lib/api';
import { qp } from '../lib/qs';
import { cx } from '../lib/cx';
import LangPicker from './LangPicker';
import { daChon, getLang, coLang, tenLang } from '../lib/lang';

/**
 * Man chinh: "Nhiem vu hom nay" — checklist 3 buoc + streak + mot nut.
 * KHONG phai chat tu do (spec §5).
 */
export default function DailyHome() {
  const step = qp('step');
  // Chua tung chon ngon ngu => hien man chon truoc, khong vao thang.
  const [canChon, setCanChon] = useState(!daChon());
  const lang = getLang();
  const [today, setToday] = useState<Today | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioBrief[]>([]);
  const [error, setError] = useState('');
  const [showExtra, setShowExtra] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = () => {
    get<Today>('/today')
      .then(setToday)
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
    get<ScenarioBrief[]>('/scenarios')
      .then(setScenarios)
      .catch(() => {});
  };

  useEffect(load, []);

  // Vua xong Buoc 2 -> tu chot ngay va hien tong ket (Buoc 3).
  useEffect(() => {
    if (step !== '3' || !today) return;
    if (today.completed || confirming) return;
    setConfirming(true);
    post('/daily/complete')
      .then(() => load())
      .catch(() => {});
  }, [step, today]);

  // Man chon ngon ngu chan truoc moi thu khac.
  if (canChon) return <LangPicker />;

  if (error) {
    return (
      <div class="px-5 py-16 text-center">
        <p class="text-[16px] font-semibold text-bad">Không nối được API</p>
        <p class="mt-2 text-[14px] text-vi">{error}</p>
      </div>
    );
  }
  if (!today) {
    return <div class="px-5 py-16 text-center text-[14px] text-vi">Đang tải…</div>;
  }

  const s = today.steps_done;
  const doneCount = [s.vocab || today.due_count === 0, s.scenario].filter(Boolean).length;

  // Buoc 3 = tong ket, chi hien khi vua xong Buoc 2.
  if (step === '3') return <Summary today={today} />;

  // Buoc 2 gio la mot chang trong LO TRINH, khong con la mot scenario
  // business ngau nhien.
  const lessonHref = today.next_lesson
    ? `/lesson?topic=${today.next_lesson.topic_id}&stage=${today.next_lesson.stage}`
    : '/roadmap';
  const startHref = !s.vocab && today.due_count > 0 ? '/review?flow=daily' : lessonHref;

  return (
    <div class="px-5 pb-8 pt-7">
      <header class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-[24px] font-bold leading-tight text-en">Nhiệm vụ hôm nay</h1>
          {/* Nut doi kho. Hai ngon ngu tach rieng hoan toan nen phai luon nhin
              thay dang o kho nao — nham kho la on nham bo tu. */}
          <button
            onClick={() => setCanChon(true)}
            class="mt-1 flex items-center gap-1.5 text-[13.5px] text-vi"
          >
            <span>{coLang(lang)}</span>
            <span>{tenLang(lang)}</span>
            <span class="text-vi/60">· đổi</span>
          </button>
        </div>
        <Streak n={today.streak} live={today.completed} />
      </header>

      {/* Nhin thay duong dai chu khong chi viec hom nay. */}
      <a href="/roadmap" class="mt-5 block rounded-2xl border border-line bg-surface px-4 py-3">
        <span class="flex items-center justify-between">
          <span class="text-[13px] text-vi">Lộ trình</span>
          <span class="text-[13px] font-semibold tabular-nums text-accent">{today.roadmap_percent}%</span>
        </span>
        <span class="mt-2 block h-1.5 overflow-hidden rounded-full bg-surface-2">
          <span
            class="block h-full rounded-full bg-accent transition-[width] duration-500"
            style={{ width: `${today.roadmap_percent}%` }}
          />
        </span>
      </a>

      <ol class="mt-5 flex flex-col gap-2.5">
        <Step
          n={1}
          done={s.vocab || today.due_count === 0}
          title="Ôn từ"
          en={today.due_count === 0 ? 'no words due' : `${today.due_count} word${today.due_count > 1 ? 's' : ''} due`}
          sub={
            today.due_count > 0
              ? 'Thấy nghĩa tiếng Việt, bật ra từ tiếng Anh'
              : 'Kho chưa có từ tới hạn — bỏ qua bước này'
          }
        />
        <Step
          n={2}
          done={s.scenario}
          title="Học chặng mới"
          en={today.next_lesson ? `${today.next_lesson.emoji} chặng ${today.next_lesson.stage}` : 'roadmap'}
          sub={
            today.next_lesson
              ? `${today.next_lesson.name_vi} · ${today.next_lesson.stage_vi}`
              : 'Mở Lộ trình để chọn chủ đề'
          }
        />
        <Step n={3} done={today.completed} title="Tổng kết" en="30 seconds" sub="Từ mới, lỗi lặp, streak" />
      </ol>

      {today.completed ? (
        <div class="mt-7 rounded-2xl border border-accent/25 bg-accent/[0.07] p-5 text-center">
          <p class="text-[16px] font-semibold text-accent">Hôm nay xong rồi</p>
          <p class="mt-1.5 text-[13.5px] text-vi">
            Streak {today.streak} ngày. Quay lại mai để giữ chuỗi.
          </p>
        </div>
      ) : (
        <a
          href={startHref}
          class="mt-7 flex w-full items-center justify-center rounded-2xl bg-accent py-4.5 text-[17px] font-semibold text-ink active:scale-[0.99]"
          style={{ paddingTop: '1.1rem', paddingBottom: '1.1rem' }}
        >
          {doneCount === 0 ? 'Bắt đầu' : 'Tiếp tục'}
        </a>
      )}

      {/* Luyen them — tuy chon, nam ngoai nhiem vu. */}
      <section class="mt-9">
        <button
          onClick={() => setShowExtra(!showExtra)}
          class="flex w-full items-center justify-between py-2 text-left"
        >
          <span class="text-[15px] font-medium text-en-dim">Luyện thêm</span>
          <span class="text-[13px] text-vi">{showExtra ? '−' : '+'}</span>
        </button>
        {showExtra && (
          <div class="mt-2 flex flex-col gap-2">
            <a
              href="/roadmap"
              class="flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3.5"
            >
              <span>
                <span class="block text-[15px] font-medium text-en">Roadmap</span>
                <span class="block text-[12.5px] text-vi">20 chủ đề · chọn chủ đề bất kỳ</span>
              </span>
              <span class="text-vi">›</span>
            </a>
            {scenarios.map((sc) => (
              <a
                key={sc.id}
                href={`/session?flow=extra&scenario=${encodeURIComponent(sc.id)}`}
                class="flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3.5"
              >
                <span>
                  <span class="block text-[15px] font-medium text-en">{sc.id.replace(/_/g, ' ')}</span>
                  <span class="block text-[12.5px] text-vi">{sc.name_vi}</span>
                </span>
                <span class="text-vi">›</span>
              </a>
            ))}
            <a
              href="/presentation"
              class="mt-1 flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3.5"
            >
              <span>
                <span class="block text-[15px] font-medium text-en">Record &amp; Roast</span>
                <span class="block text-[12.5px] text-vi">Thu 2–3 phút thuyết trình · 1–2 lần/tuần</span>
              </span>
              <span class="text-vi">›</span>
            </a>
          </div>
        )}
      </section>
    </div>
  );
}

function Summary({ today }: { today: Today }) {
  return (
    <div class="flex min-h-[80dvh] flex-col justify-center px-6 text-center">
      <p class="text-[13px] uppercase tracking-wide text-vi">Bước 3 · Tổng kết</p>
      <h1 class="mt-3 text-[26px] font-bold text-en">Xong nhiệm vụ hôm nay</h1>

      <div class="mt-8 grid grid-cols-2 gap-3">
        <Tile big={`${today.vocab_reviewed}`} label="từ đã ôn" />
        <Tile big={`${today.streak}`} label="ngày liên tiếp" accent />
      </div>

      <p class="mt-8 text-[14px] leading-relaxed text-vi">
        Từ mới hôm nay đã vào kho và sẽ tới hạn ôn vào ngày mai.
      </p>

      <a
        href="/progress"
        class="mt-8 rounded-xl border border-line bg-surface py-3.5 text-[15px] font-medium text-en"
      >
        Xem tiến độ
      </a>
      <a href="/coach" class="mt-3 py-2 text-[14px] text-vi">
        Về trang chủ
      </a>
    </div>
  );
}

function Tile({ big, label, accent }: { big: string; label: string; accent?: boolean }) {
  return (
    <div class="rounded-2xl border border-line bg-surface px-4 py-5">
      <p class={cx('text-[32px] font-bold leading-none', accent ? 'text-accent' : 'text-en')}>{big}</p>
      <p class="mt-2 text-[12.5px] text-vi">{label}</p>
    </div>
  );
}

function Step({
  n,
  done,
  title,
  en,
  sub,
}: {
  n: number;
  done: boolean;
  title: string;
  en: string;
  sub: string;
}) {
  return (
    <li
      class={cx(
        'flex items-start gap-3.5 rounded-2xl border px-4 py-3.5',
        done ? 'border-accent/25 bg-accent/[0.05]' : 'border-line bg-surface',
      )}
    >
      <span
        class={cx(
          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold',
          done ? 'bg-accent text-ink' : 'bg-surface-2 text-vi',
        )}
      >
        {done ? '✓' : n}
      </span>
      <span class="min-w-0">
        {/* Tieng Anh dam, tieng Viet mo — spec §6.4 */}
        <span class="block text-[15.5px] font-semibold text-en">{en}</span>
        <span class="block text-[12.5px] text-vi">
          {title} · {sub}
        </span>
      </span>
    </li>
  );
}

function Streak({ n, live }: { n: number; live: boolean }) {
  return (
    <div class="shrink-0 text-right">
      <p class={cx('text-[26px] font-bold leading-none', live ? 'text-accent' : 'text-en-dim')}>
        {n}
      </p>
      <p class="mt-1 text-[11.5px] text-vi">ngày streak</p>
    </div>
  );
}
