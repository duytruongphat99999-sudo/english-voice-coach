import { useEffect, useMemo, useState } from 'preact/hooks';
import MicButton, { type MicPhase } from './MicButton';
import SpeakButton from './SpeakButton';
import { get, post, postForm, ApiError, type LessonPayload, type AnswerResult, type WordResult } from '../lib/api';
import { extFor } from '../lib/recorder';
import { qp } from '../lib/qs';
import { cx } from '../lib/cx';

const PASS = 60;

/**
 * Mot chang hoc: tang 1 (tu vung), 2 (phat am) hoac 3 (phan xa dich).
 * Tang 4 la hoi thoai — trang /lesson chuyen thang sang /session.
 */
export default function Lesson() {
  const topic = qp('topic');
  const stage = Number(qp('stage', '1')) || 1;

  const [data, setData] = useState<LessonPayload | null>(null);
  const [error, setError] = useState('');
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<MicPhase>('idle');
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [answerErr, setAnswerErr] = useState('');
  const [finished, setFinished] = useState<{ vocab_added: number; unlocked: number } | null>(null);
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    if (!topic) {
      setError('Thiếu chủ đề.');
      return;
    }
    if (stage === 4) {
      window.location.replace(`/session?flow=lesson&scenario=${encodeURIComponent('topic:' + topic)}`);
      return;
    }
    get<LessonPayload>(`/learn/topic/${topic}/${stage}`)
      .then((d) => {
        setData(d);
        // Vao lai chang dang do thi nhay toi muc chua lam, khong bat lam lai
        // tu dau — lam lai tu dau la ly do nguoi ta bo giua chung.
        setI(Math.min(d.stage.items_done, Math.max(0, d.items.length - 1)));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, [topic, stage]);

  const items = data?.items ?? [];
  const total = items.length;
  const item = items[i];

  const send = async (blob: Blob, mime: string) => {
    setAnswerErr('');
    setPhase('busy');
    const form = new FormData();
    form.append('audio', blob, `answer.${extFor(mime)}`);
    form.append('topic_id', topic);
    form.append('stage', String(stage));
    form.append('index', String(i));
    try {
      const r = await postForm<AnswerResult>('/learn/answer', form);
      setResult(r);
      setReveal(true);
    } catch (e) {
      setAnswerErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setPhase('idle');
    }
  };

  const next = async () => {
    setResult(null);
    setReveal(false);
    setAnswerErr('');
    if (i + 1 < total) {
      setI(i + 1);
      return;
    }
    try {
      const done = await post<{ vocab_added: number; unlocked: number }>('/learn/stage-complete', {
        topic_id: topic,
        stage,
      });
      setFinished(done);
    } catch (e) {
      setAnswerErr(e instanceof ApiError ? e.message : (e as Error).message);
    }
  };

  if (error) {
    return (
      <Center title="Không mở được chặng này" sub={error} action={{ label: 'Về lộ trình', href: '/roadmap' }} />
    );
  }
  if (!data) return <p class="px-5 py-16 text-center text-[14px] text-vi">Đang tải…</p>;

  if (finished) {
    return (
      <Center
        title={`Xong chặng ${stage} — ${data.stage.name_vi}`}
        sub={
          finished.vocab_added > 0
            ? `${finished.vocab_added} từ đã vào kho ôn tập, mai sẽ quay lại đòi ôn.`
            : 'Điểm đã được ghi lại.'
        }
        action={
          finished.unlocked > stage
            ? { label: `Sang chặng ${finished.unlocked}`, href: `/lesson?topic=${topic}&stage=${finished.unlocked}` }
            : { label: 'Về lộ trình', href: '/roadmap' }
        }
        second={{ label: 'Về lộ trình', href: '/roadmap' }}
      />
    );
  }

  if (!item) {
    return <Center title="Chặng này chưa có mục nào" sub="" action={{ label: 'Về lộ trình', href: '/roadmap' }} />;
  }

  const recording = phase === 'recording';
  const sayUrl = `/api/learn/say/${topic}/${stage}/${i}`;

  return (
    <div class="flex min-h-dvh flex-col">
      {!recording && (
        <header class="sticky top-0 z-10 border-b border-line bg-ink/95 px-4 py-3 backdrop-blur">
          <div class="flex items-center justify-between gap-3">
            <p class="min-w-0 truncate text-[13.5px] text-en-dim">
              {data.emoji} {data.name_vi}
              <span class="text-vi"> · {data.stage.name_vi}</span>
            </p>
            <a href="/roadmap" class="shrink-0 text-[13px] text-vi">
              Thoát
            </a>
          </div>
          <div class="mt-2 flex items-center gap-2">
            <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
              <span
                class="block h-full rounded-full bg-accent transition-[width] duration-300"
                style={{ width: `${((i + (result ? 1 : 0)) / total) * 100}%` }}
              />
            </span>
            <span class="shrink-0 text-[11.5px] tabular-nums text-vi">
              {i + 1}/{total}
            </span>
          </div>
        </header>
      )}

      <div class="flex flex-1 flex-col justify-center px-5 py-6">
        {!recording && (
          <>
            {stage === 1 && <VocabCard item={item as any} sayUrl={sayUrl} />}
            {stage === 2 && <SentenceCard item={item as any} sayUrl={sayUrl} />}
            {stage === 3 && <TranslateCard item={item as any} reveal={reveal} result={result} />}

            {result && <ResultBlock stage={stage} r={result} sayUrl={sayUrl} />}

            {answerErr && (
              <p class="mt-4 rounded-xl bg-bad/10 px-3 py-2.5 text-[13.5px] leading-snug text-bad">{answerErr}</p>
            )}
          </>
        )}
      </div>

      <div class="sticky bottom-0 border-t border-line bg-ink/95 px-4 pb-3 pt-2 backdrop-blur">
        {result ? (
          <div class="mb-1 flex gap-2.5">
            <button
              onClick={() => {
                setResult(null);
                setReveal(false);
              }}
              class="flex-1 rounded-xl border border-line bg-surface py-3.5 text-[15px] font-medium text-en-dim"
            >
              Nói lại
            </button>
            <button
              onClick={() => void next()}
              class="flex-[1.4] rounded-xl bg-accent py-3.5 text-[15.5px] font-semibold text-ink"
            >
              {i + 1 < total ? 'Tiếp' : 'Xong chặng'}
            </button>
          </div>
        ) : (
          <MicButton
            phase={phase}
            maxSeconds={40}
            hint={stage === 3 ? 'Nói bằng tiếng Anh' : 'Đọc to câu trên'}
            onStateChange={(p) => setPhase((cur) => (cur === 'busy' ? cur : p))}
            onError={(m) => {
              setAnswerErr(m);
              setPhase('idle');
            }}
            onDone={(blob, mime) => void send(blob, mime)}
          />
        )}
      </div>
    </div>
  );
}

// --- The tung tang --------------------------------------------------------

function VocabCard({
  item,
  sayUrl,
}: {
  item: { word: string; ipa: string; meaning_vi: string; example_en: string; example_vi: string };
  sayUrl: string;
}) {
  return (
    <div class="rounded-2xl border border-line bg-surface p-5">
      <p class="text-center text-[30px] font-bold leading-tight text-en">{item.word}</p>
      {item.ipa && <p class="mt-1 text-center text-[14px] text-vi">{item.ipa}</p>}
      <p class="mt-2 text-center text-[15px] text-vi">{item.meaning_vi}</p>

      <div class="mt-4 flex justify-center">
        <SpeakButton src={`${sayUrl}?part=word`} label="nghe từ" />
      </div>

      <div class="mt-5 border-t border-line pt-4">
        <p class="text-[11.5px] uppercase tracking-wide text-vi">Đọc to câu này</p>
        <p class="mt-2 text-[19px] font-medium leading-relaxed text-en">{item.example_en}</p>
        <p class="mt-1.5 text-[13px] leading-snug text-vi">{item.example_vi}</p>
        <div class="mt-3">
          <SpeakButton src={sayUrl} label="nghe câu mẫu" variant="block" />
        </div>
      </div>
    </div>
  );
}

function SentenceCard({
  item,
  sayUrl,
}: {
  item: { en: string; vi: string; focus_vi: string };
  sayUrl: string;
}) {
  return (
    <div class="rounded-2xl border border-line bg-surface p-5">
      <p class="text-[11.5px] uppercase tracking-wide text-vi">Nghe mẫu rồi đọc lại</p>
      <p class="mt-3 text-[21px] font-medium leading-relaxed text-en">{item.en}</p>
      <p class="mt-2 text-[13.5px] leading-snug text-vi">{item.vi}</p>

      <div class="mt-4">
        <SpeakButton src={sayUrl} label="nghe mẫu" variant="block" />
      </div>

      {item.focus_vi && (
        <p class="mt-4 rounded-xl bg-warn/10 px-3 py-2.5 text-[13px] leading-snug text-warn">
          ⚠ {item.focus_vi}
        </p>
      )}
    </div>
  );
}

function TranslateCard({
  item,
  reveal,
  result,
}: {
  item: { vi: string; hint_en: string };
  reveal: boolean;
  result: AnswerResult | null;
}) {
  return (
    <div class="rounded-2xl border border-line bg-surface p-5">
      <p class="text-[11.5px] uppercase tracking-wide text-vi">Nói câu này bằng tiếng Anh</p>
      {/* Tieng Viet o day la DE BAI nen phai to va ro, khac voi cac man khac. */}
      <p class="mt-3 text-[21px] font-medium leading-relaxed text-en">{item.vi}</p>

      {!reveal && item.hint_en && (
        <p class="mt-4 text-[13px] text-vi">
          gợi ý: <span class="text-en-dim">{item.hint_en}</span>
        </p>
      )}

      {reveal && result?.reference_en && (
        <div class="mt-4 border-t border-line pt-4">
          <p class="text-[11.5px] uppercase tracking-wide text-vi">Một cách nói tự nhiên</p>
          <p class="mt-1.5 text-[17px] font-semibold leading-relaxed text-accent">{result.reference_en}</p>
        </div>
      )}
    </div>
  );
}

// --- Ket qua --------------------------------------------------------------

function ResultBlock({ stage, r, sayUrl }: { stage: number; r: AnswerResult; sayUrl: string }) {
  const tone = r.score >= 85 ? 'good' : r.score >= PASS ? 'ok' : 'bad';
  return (
    <div class="mt-5 rounded-2xl border border-line bg-surface p-4">
      <div class="flex items-baseline justify-between">
        <span class="text-[12px] text-vi">Điểm</span>
        <span
          class={cx(
            'text-[30px] font-bold tabular-nums',
            tone === 'good' ? 'text-accent' : tone === 'ok' ? 'text-warn' : 'text-bad',
          )}
        >
          {r.score}
          <span class="text-[15px] font-normal text-vi">/100</span>
        </span>
      </div>

      {stage !== 3 && r.words && r.words.length > 0 && (
        <>
          <p class="mt-3 text-[11.5px] uppercase tracking-wide text-vi">Máy nghe được từng chữ</p>
          <p class="mt-2 text-[17px] leading-loose">
            {r.words.map((w, k) => (
              <WordChip key={k} w={w} />
            ))}
          </p>
          <Legend />
        </>
      )}

      {r.transcript && (
        <p class="mt-3 text-[12.5px] leading-snug text-vi">
          Nghe thành: <span class="text-en-dim">{r.transcript}</span>
        </p>
      )}

      {r.feedback_vi && (
        <p
          class={cx(
            'mt-4 rounded-xl px-3 py-2.5 text-[13.5px] leading-snug',
            r.score >= 85 ? 'bg-accent/10 text-accent' : 'bg-warn/10 text-warn',
          )}
        >
          {r.feedback_vi}
        </p>
      )}

      {r.better_en && (
        <div class="mt-3">
          <p class="text-[11.5px] uppercase tracking-wide text-vi">Nói vầy tự nhiên hơn</p>
          <p class="mt-1 text-[16px] font-semibold leading-relaxed text-en">{r.better_en}</p>
        </div>
      )}

      <div class="mt-4">
        <SpeakButton src={sayUrl} label="nghe lại câu mẫu" />
      </div>
    </div>
  );
}

function WordChip({ w }: { w: WordResult }) {
  const cls =
    w.status === 'ok'
      ? 'text-en'
      : w.status === 'ending'
        ? 'text-warn underline decoration-warn decoration-wavy underline-offset-4'
        : w.status === 'weak'
          ? 'text-warn'
          : w.status === 'wrong'
            ? 'text-bad'
            : 'text-vi line-through decoration-vi';
  const title =
    w.status === 'ok'
      ? 'nghe rõ'
      : w.status === 'ending'
        ? `nuốt đuôi — nghe thành "${w.said}"`
        : w.status === 'weak'
          ? 'nghe được nhưng chưa rõ'
          : w.status === 'wrong'
            ? `nghe thành "${w.said}"`
            : 'không nghe thấy';
  return (
    <span class={cx('mr-1.5 inline-block', cls)} title={title}>
      {w.target}
    </span>
  );
}

function Legend() {
  const items = [
    ['text-en', 'rõ'],
    ['text-warn underline decoration-wavy underline-offset-2', 'nuốt đuôi'],
    ['text-warn', 'chưa rõ'],
    ['text-bad', 'sai từ'],
    ['text-vi line-through', 'mất'],
  ] as const;
  return (
    <p class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-vi">
      {items.map(([c, label]) => (
        <span key={label}>
          <span class={cx('font-semibold', c)}>Aa</span> {label}
        </span>
      ))}
    </p>
  );
}

function Center({
  title,
  sub,
  action,
  second,
}: {
  title: string;
  sub: string;
  action?: { label: string; href: string };
  second?: { label: string; href: string };
}) {
  return (
    <div class="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
      <p class="text-[19px] font-semibold text-en">{title}</p>
      {sub && <p class="mt-2 text-[14.5px] leading-relaxed text-vi">{sub}</p>}
      {action && (
        <a href={action.href} class="mt-8 w-full rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink">
          {action.label}
        </a>
      )}
      {second && (
        <a href={second.href} class="mt-3 py-2 text-[14px] text-vi">
          {second.label}
        </a>
      )}
    </div>
  );
}
