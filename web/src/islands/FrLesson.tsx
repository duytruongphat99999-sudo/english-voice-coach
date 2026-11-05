import { useEffect, useRef, useState } from 'preact/hooks';
import MicButton, { type MicPhase } from './MicButton';
import SpeakButton from './SpeakButton';
import FrKeys from './FrKeys';
import {
  get,
  post,
  postForm,
  ApiError,
  type FrLessonPayload,
  type FrVocabItem,
  type FrSentenceItem,
  type FrTranslateItem,
  type FrSpeakResult,
  type FrTranslateResult,
} from '../lib/api';
import { extFor } from '../lib/recorder';
import { qp } from '../lib/qs';
import { cx } from '../lib/cx';

/**
 * Mot chang bai hoc tieng Phap (dot B, 12/09/2026). Chang 4 chuyen sang /fr-session.
 *
 * Khac man Lesson tieng Anh o cho Duy chot 12/09:
 *  - chang 1-2: noi theo mau, app hien "may nghe duoc gi", KHONG DIEM, va duoc
 *    di tiep ma khong noi (may nghe tieng Phap kem voi giong nguoi moi hoc);
 *  - chang 3: GO cau tieng Phap; app so tung chu co dau, AI giai thich.
 * File rieng, khong dong vao Lesson.tsx cua tieng Anh.
 */
export default function FrLesson() {
  const topic = qp('topic');
  const stage = Number(qp('stage', '1')) || 1;

  const [data, setData] = useState<FrLessonPayload | null>(null);
  const [error, setError] = useState('');
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<MicPhase>('idle');
  const [speak, setSpeak] = useState<FrSpeakResult | null>(null);
  const [tr, setTr] = useState<FrTranslateResult | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [answerErr, setAnswerErr] = useState('');
  const [finished, setFinished] = useState<{ vocab_added: number; unlocked: number } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!topic) {
      setError('Thiếu chủ đề.');
      return;
    }
    if (stage === 4) {
      window.location.replace(`/fr-session?scenario=${encodeURIComponent('topic:' + topic)}`);
      return;
    }
    get<FrLessonPayload>(`/fr/learn/topic/${topic}/${stage}`)
      .then((d) => {
        setData(d);
        const n = d.items?.length ?? 0;
        setI(Math.min(d.stage.items_done, Math.max(0, n - 1)));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, [topic, stage]);

  const items = data?.items ?? [];
  const total = items.length;
  const item = items[i];

  const sendVoice = async (blob: Blob, mime: string) => {
    setAnswerErr('');
    setPhase('busy');
    const form = new FormData();
    form.append('audio', blob, `answer.${extFor(mime)}`);
    form.append('topic_id', topic);
    form.append('stage', String(stage));
    form.append('index', String(i));
    try {
      setSpeak(await postForm<FrSpeakResult>('/fr/learn/answer', form));
    } catch (e) {
      setAnswerErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setPhase('idle');
    }
  };

  const sendText = async () => {
    const text = typed.trim();
    if (!text || busy) return;
    setAnswerErr('');
    setBusy(true);
    try {
      setTr(await post<FrTranslateResult>('/fr/learn/answer-text', { topic_id: topic, index: i, text }));
    } catch (e) {
      setAnswerErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const next = async () => {
    setSpeak(null);
    setTr(null);
    setTyped('');
    setAnswerErr('');
    if (i + 1 < total) {
      setI(i + 1);
      return;
    }
    try {
      setFinished(await post<{ vocab_added: number; unlocked: number }>('/fr/learn/stage-complete', { topic_id: topic, stage }));
    } catch (e) {
      setAnswerErr(e instanceof ApiError ? e.message : (e as Error).message);
    }
  };

  if (error) return <Center title="Không mở được chặng này" sub={error} action={{ label: 'Về bài học', href: '/fr-roadmap' }} />;
  if (!data) return <p class="px-5 py-16 text-center text-[14px] text-vi">Đang tải…</p>;

  if (finished) {
    return (
      <Center
        title={`Xong chặng ${stage} — ${data.stage.name_vi}`}
        sub={finished.vocab_added > 0 ? `${finished.vocab_added} từ đã vào kho Ôn từ, mai sẽ hỏi lại.` : 'Đã ghi lại.'}
        action={
          finished.unlocked > stage
            ? { label: `Sang chặng ${finished.unlocked}`, href: `/fr-lesson?topic=${topic}&stage=${finished.unlocked}` }
            : { label: 'Về bài học', href: '/fr-roadmap' }
        }
        second={{ label: 'Về bài học', href: '/fr-roadmap' }}
      />
    );
  }
  if (!item) return <Center title="Chặng này chưa có mục nào" sub="" action={{ label: 'Về bài học', href: '/fr-roadmap' }} />;

  const recording = phase === 'recording';
  const sayUrl = `/api/fr/learn/say/${topic}/${stage}/${i}`;
  const answered = stage === 3 ? Boolean(tr) : Boolean(speak);

  return (
    <div class="flex min-h-dvh flex-col">
      {!recording && (
        <header class="sticky top-0 z-10 border-b border-line bg-ink/95 px-4 py-3 backdrop-blur">
          <div class="flex items-center justify-between gap-3">
            <p class="min-w-0 truncate text-[13.5px] text-en-dim">
              {data.emoji} {data.name_vi}
              <span class="text-vi"> · {data.stage.name_vi}</span>
            </p>
            <a href="/fr-roadmap" class="shrink-0 text-[13px] text-vi">
              Thoát
            </a>
          </div>
          <div class="mt-2 flex items-center gap-2">
            <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
              <span
                class="block h-full rounded-full bg-accent transition-[width] duration-300"
                style={{ width: `${((i + (answered ? 1 : 0)) / total) * 100}%` }}
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
            {stage === 1 && <VocabCard item={item as FrVocabItem} sayUrl={sayUrl} />}
            {stage === 2 && <SentenceCard item={item as FrSentenceItem} sayUrl={sayUrl} />}
            {stage === 3 && (
              <TranslateCard
                item={item as FrTranslateItem}
                result={tr}
                typed={typed}
                setTyped={setTyped}
                inputRef={inputRef}
                busy={busy}
                onSubmit={() => void sendText()}
              />
            )}

            {speak && <SpeakBlock r={speak} sayUrl={sayUrl} />}
            {tr && <TranslateBlock r={tr} sayUrl={sayUrl} />}

            {answerErr && <p class="mt-4 rounded-xl bg-bad/10 px-3 py-2.5 text-[13.5px] leading-snug text-bad">{answerErr}</p>}
          </>
        )}
      </div>

      <div class="sticky bottom-0 border-t border-line bg-ink/95 px-4 pb-3 pt-2 backdrop-blur">
        {answered ? (
          <div class="mb-1 flex gap-2.5">
            <button
              onClick={() => {
                setSpeak(null);
                setTr(null);
                requestAnimationFrame(() => inputRef.current?.focus());
              }}
              class="flex-1 rounded-xl border border-line bg-surface py-3.5 text-[15px] font-medium text-en-dim"
            >
              {stage === 3 ? 'Gõ lại' : 'Nói lại'}
            </button>
            <button onClick={() => void next()} class="flex-[1.4] rounded-xl bg-accent py-3.5 text-[15.5px] font-semibold text-ink">
              {i + 1 < total ? 'Tiếp' : 'Xong chặng'}
            </button>
          </div>
        ) : stage === 3 ? (
          <button
            onClick={() => void sendText()}
            disabled={!typed.trim() || busy}
            class="mb-1 w-full rounded-xl bg-accent py-3.5 text-[16px] font-semibold text-ink disabled:opacity-40"
          >
            {busy ? 'Đang chấm…' : 'Nộp câu'}
          </button>
        ) : (
          <>
            <MicButton
              phase={phase}
              maxSeconds={30}
              hint="Nghe mẫu rồi nói theo — không chấm điểm"
              onStateChange={(p) => setPhase((cur) => (cur === 'busy' ? cur : p))}
              onError={(m) => {
                setAnswerErr(m);
                setPhase('idle');
              }}
              onDone={(blob, mime) => void sendVoice(blob, mime)}
            />
            {phase === 'idle' && (
              <button onClick={() => void next()} class="mb-1 w-full py-1.5 text-center text-[12.5px] text-vi">
                {i + 1 < total ? 'đang ở chỗ không tiện nói? sang mục sau →' : 'xong chặng, không nói →'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// --- The tung chang -------------------------------------------------------

function VocabCard({ item, sayUrl }: { item: FrVocabItem; sayUrl: string }) {
  return (
    <div class="rounded-2xl border border-line bg-surface p-5">
      <p class="text-center text-[28px] font-bold leading-tight text-en">{item.word}</p>
      {item.ipa && <p class="mt-1 text-center text-[14px] text-vi">{item.ipa}</p>}
      <p class="mt-2 text-center text-[15px] text-vi">
        {item.meaning_vi}
        {item.gender_vi && <span class="text-en-dim"> · {item.gender_vi}</span>}
      </p>
      {item.note_vi && <p class="mt-2 text-center text-[12.5px] leading-snug text-warn">{item.note_vi}</p>}
      <div class="mt-4 flex justify-center">
        <SpeakButton src={`${sayUrl}?part=word`} label="nghe từ" />
      </div>
      <div class="mt-5 border-t border-line pt-4">
        <p class="text-[11.5px] uppercase tracking-wide text-vi">Nghe rồi nói theo câu này</p>
        <p class="mt-2 text-[19px] font-medium leading-relaxed text-en" lang="fr">
          {item.example_fr}
        </p>
        <p class="mt-1.5 text-[13px] leading-snug text-vi">{item.example_vi}</p>
        <div class="mt-3">
          <SpeakButton src={sayUrl} label="nghe câu mẫu" variant="block" />
        </div>
      </div>
    </div>
  );
}

function SentenceCard({ item, sayUrl }: { item: FrSentenceItem; sayUrl: string }) {
  return (
    <div class="rounded-2xl border border-line bg-surface p-5">
      <p class="text-[11.5px] uppercase tracking-wide text-vi">Nghe mẫu rồi đọc lại</p>
      <p class="mt-3 text-[21px] font-medium leading-relaxed text-en" lang="fr">
        {item.fr}
      </p>
      <p class="mt-2 text-[13.5px] leading-snug text-vi">{item.vi}</p>
      <div class="mt-4">
        <SpeakButton src={sayUrl} label="nghe mẫu" variant="block" />
      </div>
      {item.focus_vi && <p class="mt-4 rounded-xl bg-warn/10 px-3 py-2.5 text-[13px] leading-snug text-warn">⚠ {item.focus_vi}</p>}
    </div>
  );
}

function TranslateCard({
  item,
  result,
  typed,
  setTyped,
  inputRef,
  busy,
  onSubmit,
}: {
  item: FrTranslateItem;
  result: FrTranslateResult | null;
  typed: string;
  setTyped: (v: string) => void;
  inputRef: { current: HTMLTextAreaElement | null };
  busy: boolean;
  onSubmit: () => void;
}) {
  return (
    <div class="rounded-2xl border border-line bg-surface p-5">
      <p class="text-[11.5px] uppercase tracking-wide text-vi">Gõ câu này bằng tiếng Pháp</p>
      <p class="mt-3 text-[21px] font-medium leading-relaxed text-en">{item.vi}</p>
      {!result && item.hint_fr && (
        <p class="mt-3 text-[13px] text-vi">
          gợi ý: <span class="text-en-dim">{item.hint_fr}</span>
        </p>
      )}
      {!result && (
        <>
          <textarea
            ref={inputRef}
            value={typed}
            rows={3}
            lang="fr"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="sentences"
            spellcheck={false}
            disabled={busy}
            placeholder="Gõ tiếng Pháp, nhớ đủ dấu…"
            onInput={(e) => setTyped((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
            class="mt-4 w-full resize-none rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-[17px] text-en outline-none placeholder:text-vi focus:border-accent"
          />
          <FrKeys target={inputRef} value={typed} onChange={setTyped} />
        </>
      )}
    </div>
  );
}

// --- Ket qua --------------------------------------------------------------

function SpeakBlock({ r, sayUrl }: { r: FrSpeakResult; sayUrl: string }) {
  const missed = r.words.filter((w) => !w.heard).length;
  return (
    <div class="mt-5 rounded-2xl border border-line bg-surface p-4">
      <p class="text-[11.5px] uppercase tracking-wide text-vi">Máy nghe được</p>
      <p class="mt-1.5 text-[16px] leading-relaxed text-en-dim" lang="fr">
        {r.transcript.trim() || '… (không nghe ra chữ nào)'}
      </p>
      <p class="mt-3 text-[11.5px] uppercase tracking-wide text-vi">So với câu mẫu</p>
      <p class="mt-1.5 text-[17px] leading-loose" lang="fr">
        {r.words.map((w, k) => (
          <span
            key={k}
            // "l'" dinh lien chu sau (may tach "l'adresse" thanh hai chu de so).
            class={cx(w.w.endsWith("'") ? 'inline-block' : 'mr-1.5 inline-block', w.heard ? 'text-en' : 'text-vi line-through decoration-vi')}
            title={w.heard ? 'máy có nghe ra' : 'máy không nghe ra'}
          >
            {w.w}
          </span>
        ))}
      </p>
      <p class="mt-3 rounded-xl bg-surface-2 px-3 py-2.5 text-[12.5px] leading-snug text-vi">
        {missed === 0
          ? 'Máy nghe ra đủ các chữ của câu mẫu.'
          : `${missed} chữ gạch ngang là máy không nghe ra — có thể do bạn, cũng có thể do máy nghe tiếng Pháp kém. Không chấm điểm: nghe lại mẫu và tự so.`}
      </p>
      <div class="mt-3">
        <SpeakButton src={sayUrl} label="nghe lại câu mẫu" />
      </div>
    </div>
  );
}

function TranslateBlock({ r, sayUrl }: { r: FrTranslateResult; sayUrl: string }) {
  const tone = r.grade >= 4 ? 'good' : r.grade >= 3 ? 'ok' : 'bad';
  return (
    <div class="mt-5 rounded-2xl border border-line bg-surface p-4">
      <div class="flex items-baseline justify-between">
        <span class="text-[12px] text-vi">Bạn gõ</span>
        <span class={cx('text-[26px] font-bold tabular-nums', tone === 'good' ? 'text-accent' : tone === 'ok' ? 'text-warn' : 'text-bad')}>
          {r.grade}
          <span class="text-[14px] font-normal text-vi">/5</span>
        </span>
      </div>
      <p class="mt-1 text-[16px] leading-relaxed text-en-dim" lang="fr">
        {r.typed}
      </p>

      {r.accent_slips.length > 0 && (
        <div class="mt-3 rounded-xl bg-bad/10 px-3 py-2.5">
          <p class="text-[12.5px] font-semibold text-bad">Sai dấu (app so từng chữ)</p>
          <p class="mt-1 text-[15px]" lang="fr">
            {r.accent_slips.map((s, k) => (
              <span key={k} class="mr-3 inline-block">
                <span class="text-vi line-through">{s.typed}</span> → <b class="text-en">{s.correct}</b>
              </span>
            ))}
          </p>
        </div>
      )}

      {r.feedback_vi && (
        <p class={cx('mt-3 rounded-xl px-3 py-2.5 text-[13.5px] leading-snug', r.grade >= 4 ? 'bg-accent/10 text-accent' : 'bg-warn/10 text-warn')}>
          {r.feedback_vi}
        </p>
      )}

      {r.better_fr && r.better_fr.trim() !== r.typed.trim() && (
        <div class="mt-3">
          <p class="text-[11.5px] uppercase tracking-wide text-vi">Câu của bạn, sửa lại</p>
          <p class="mt-1 text-[16px] font-semibold leading-relaxed text-en" lang="fr">
            {r.better_fr}
          </p>
        </div>
      )}

      <div class="mt-3 border-t border-line pt-3">
        <p class="text-[11.5px] uppercase tracking-wide text-vi">Câu mẫu</p>
        <p class="mt-1 text-[16px] font-semibold leading-relaxed text-accent" lang="fr">
          {r.reference_fr}
        </p>
        <div class="mt-2">
          <SpeakButton src={sayUrl} label="nghe câu mẫu" />
        </div>
      </div>
      <p class="mt-3 text-[11.5px] leading-snug text-vi">Điểm do AI chấm nghĩa và ngữ pháp; phần dấu do app so chính xác từng chữ.</p>
    </div>
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
