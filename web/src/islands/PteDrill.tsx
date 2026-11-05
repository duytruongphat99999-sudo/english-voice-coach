import { useEffect, useRef, useState } from 'preact/hooks';
import MicButton, { type MicPhase } from './MicButton';
import SpeakButton from './SpeakButton';
import { get, post, postForm, ApiError, type PteItem, type PteItems, type PteResult } from '../lib/api';
import { extFor } from '../lib/recorder';
import { qp } from '../lib/qs';
import { cx } from '../lib/cx';

type Mode = 'rs' | 'wfd';

const MODE_VI: Record<Mode, { name: string; sub: string; hint: string }> = {
  rs: {
    name: 'Nhại câu',
    sub: 'Repeat Sentence',
    hint: 'Nghe một lần rồi nói lại y nguyên. Nhớ được bao nhiêu nói bấy nhiêu — nói một nửa vẫn có điểm, im lặng thì không.',
  },
  wfd: {
    name: 'Nghe — gõ',
    sub: 'Write from Dictation',
    hint: 'Nghe rồi gõ lại đúng từng chữ. Sai chính tả là mất từ đó. Đây là task ăn điểm cao nhất cả bài thi.',
  },
};

const N = 10;

export default function PteDrill() {
  const [mode, setMode] = useState<Mode>(qp('mode') === 'wfd' ? 'wfd' : 'rs');
  const [items, setItems] = useState<PteItem[] | null>(null);
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<MicPhase>('idle');
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<PteResult | null>(null);
  const [done, setDone] = useState<PteResult[]>([]);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const load = (m: Mode) => {
    setItems(null);
    setI(0);
    setResult(null);
    setDone([]);
    setTyped('');
    setError('');
    get<PteItems>(`/pte/items?n=${N}`)
      .then((r) => setItems(r.items))
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : String(e)));
  };

  useEffect(() => load(mode), [mode]);

  // Sang cau moi thi con tro nhay vao o go luon — bot mot cham tren dien thoai.
  useEffect(() => {
    if (mode === 'wfd' && !result && items) inputRef.current?.focus();
  }, [i, result, items, mode]);

  const finish = (r: PteResult) => {
    setResult(r);
    setDone((d) => [...d, r]);
  };

  const sendVoice = async (blob: Blob, mime: string) => {
    const item = items?.[i];
    if (!item) return;
    setError('');
    setPhase('busy');
    const form = new FormData();
    form.append('audio', blob, `rs.${extFor(mime)}`);
    form.append('id', item.id);
    try {
      finish(await postForm<PteResult>('/pte/answer/rs', form));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setPhase('idle');
    }
  };

  const sendTyped = async () => {
    const item = items?.[i];
    if (!item || phase === 'busy') return;
    setError('');
    setPhase('busy');
    try {
      finish(await post<PteResult>('/pte/answer/wfd', { id: item.id, typed }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setPhase('idle');
    }
  };

  const advance = () => {
    setResult(null);
    setTyped('');
    setError('');
    setI(i + 1);
  };

  if (loadError) {
    return <Center title="Không tải được bộ đề" sub={loadError} href="/coach" action="Về trang chủ" />;
  }
  if (!items) return <Center title="Đang rút đề…" sub="" />;
  if (items.length === 0) {
    return <Center title="Bộ đề trống" sub="Thiếu api/content/pte-sentences.json." href="/coach" action="Về trang chủ" />;
  }

  // --- Xong cả lượt ---------------------------------------------------------
  if (i >= items.length) {
    const totalWords = done.reduce((a, r) => a + r.total, 0);
    const gotWords = done.reduce((a, r) => a + r.correct, 0);
    const endings = done.reduce((a, r) => a + r.dropped_endings, 0);
    const pct = totalWords ? Math.round((gotWords / totalWords) * 100) : 0;

    return (
      <div class="px-5 pb-10 pt-8">
        <h1 class="text-[22px] font-bold text-en">Xong {items.length} câu</h1>
        <p class="mt-1 text-[13.5px] text-vi">{MODE_VI[mode].name} · {MODE_VI[mode].sub}</p>

        <div class="mt-6 rounded-2xl border border-line bg-surface px-5 py-6 text-center">
          <p class={cx('text-[42px] font-bold leading-none', pct >= 80 ? 'text-accent' : pct >= 60 ? 'text-warn' : 'text-bad')}>
            {pct}%
          </p>
          <p class="mt-2 text-[13.5px] text-vi">
            {gotWords}/{totalWords} từ đúng
          </p>
        </div>

        {endings > 0 && (
          <div class="mt-4 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3">
            <p class="text-[13.5px] leading-relaxed text-warn">
              <b>{endings} lần rụng đuôi từ</b> trong lượt này. Đây là lỗi ăn điểm nặng nhất của người
              Việt ở PTE — nó lấy cả điểm Pronunciation lẫn điểm Content.
            </p>
          </div>
        )}

        <p class="mt-5 text-[12.5px] leading-relaxed text-vi">
          Mốc tham khảo cho PTE 65: giữ đều trên <b>80%</b> ở Nhại câu và trên <b>90%</b> ở Nghe — gõ.
          Con số này là mốc luyện tập, không phải điểm PTE thật.
        </p>

        <button
          onClick={() => load(mode)}
          class="mt-7 w-full rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink"
        >
          Lượt nữa
        </button>
        <a href="/coach" class="mt-3 block py-2 text-center text-[14px] text-vi">
          Về trang chủ
        </a>
      </div>
    );
  }

  const item = items[i]!;
  const recording = phase === 'recording';

  return (
    <div class="flex min-h-dvh flex-col">
      {!recording && (
        <header class="border-b border-line px-4 py-3">
          <div class="flex items-center justify-between">
            <p class="text-[13px] text-vi">
              Câu {i + 1}/{items.length}
            </p>
            <span class="flex items-center gap-3.5">
              {/* Loi vao man Doc to. Dat o day thay vi them cot thu 6 vao nav:
                  nav dang 5 cot, tren man 360px them cot nua la nhan bi bop. */}
              <a href="/pte-speaking" class="text-[13px] text-accent">
                Đọc to →
              </a>
              <a href="/pte" class="text-[13px] text-vi">
                Thoát
              </a>
            </span>
          </div>

          <div class="mt-3 flex gap-2">
            {(['rs', 'wfd'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                class={cx(
                  'flex-1 rounded-full px-3 py-2 text-[13.5px] transition-colors',
                  m === mode ? 'bg-accent font-semibold text-ink' : 'bg-surface-2 text-vi',
                )}
              >
                {MODE_VI[m].name}
              </button>
            ))}
          </div>
        </header>
      )}

      <div class="flex-1 px-5 pt-7">
        {!recording && (
          <>
            <div class="rounded-2xl border border-line bg-surface px-5 py-7 text-center">
              <p class="text-[11.5px] uppercase tracking-wide text-vi">
                {result ? 'Câu gốc' : `Nghe câu ${item.word_count} từ`}
              </p>

              {result ? (
                <p class="mt-3 text-[19px] font-semibold leading-snug text-en">{result.target}</p>
              ) : (
                <div class="mt-5 flex justify-center">
                  <SpeakButton
                    src={`/api/pte/say/${item.id}`}
                    label="nghe đề"
                    variant="block"
                    autoPlay
                  />
                </div>
              )}

              {!result && (
                <p class="mt-5 text-[12.5px] leading-relaxed text-vi">{MODE_VI[mode].hint}</p>
              )}
              {/* Them 12/09: bai nay la THI THU — khong chu, dung de that. Kho qua
                  thi hoc co chu truoc o Shadowing roi quay lai. */}
              {!result && mode === 'rs' && (
                <a href="/shadowing?mode=rs" class="mt-2 inline-block text-[12.5px] text-accent">
                  Khó quá? Luyện có chữ chạy trước ở Shadowing › Nhại câu →
                </a>
              )}
            </div>

            {result && <ResultCard r={result} />}

            {!result && mode === 'wfd' && (
              <textarea
                ref={inputRef}
                value={typed}
                onInput={(e) => setTyped((e.target as HTMLTextAreaElement).value)}
                onKeyDown={(e) => {
                  // Enter gui luon; Shift+Enter xuong dong. Cau PTE khong bao gio
                  // nhieu dong nen Enter = gui la dung phan xa.
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void sendTyped();
                  }
                }}
                rows={3}
                autocapitalize="none"
                autocorrect="off"
                spellcheck={false}
                placeholder="Gõ lại câu vừa nghe…"
                class="mt-4 w-full rounded-xl border border-line bg-surface-2 px-4 py-3.5 text-[16px] leading-relaxed text-en outline-none focus:border-accent"
              />
            )}

            {error && (
              <p class="mt-4 rounded-xl bg-bad/10 px-3 py-2.5 text-[13.5px] text-bad">{error}</p>
            )}
          </>
        )}
      </div>

      <div class="sticky bottom-0 border-t border-line bg-ink/95 px-4 pb-3 pt-2 backdrop-blur">
        {result ? (
          <button
            onClick={advance}
            class="mb-2 w-full rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink"
          >
            {i + 1 < items.length ? 'Câu tiếp theo' : 'Xem tổng kết'}
          </button>
        ) : mode === 'wfd' ? (
          // Hang ngang: khi o go trong thi "Nop" bi khoa, nen "Bo" la duong di
          // tiep DUY NHAT — no phai luon bam duoc (tru luc dang cham).
          <div class="mb-2 flex gap-2">
            <button
              onClick={() => void sendTyped()}
              disabled={phase === 'busy' || !typed.trim()}
              class="flex-1 rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink disabled:opacity-40"
            >
              {phase === 'busy' ? 'Đang chấm…' : 'Nộp'}
            </button>
            <button
              onClick={advance}
              disabled={phase === 'busy'}
              class="rounded-xl border border-line px-4 py-4 text-[15px] text-vi disabled:opacity-40"
            >
              Bỏ ›
            </button>
          </div>
        ) : (
          <div class="relative">
            {phase === 'idle' && (
              <button
                onClick={advance}
                class="absolute right-0 top-7 z-10 px-3 py-2.5 text-[13px] text-vi"
              >
                Bỏ câu này ›
              </button>
            )}
          <MicButton
            phase={phase}
            maxSeconds={20}
            hint="Nói lại câu vừa nghe"
            onStateChange={(p) => setPhase((cur) => (cur === 'busy' ? cur : p))}
            onError={(m) => {
              setError(m);
              setPhase('idle');
            }}
            onDone={(blob, mime) => void sendVoice(blob, mime)}
          />
          </div>
        )}
      </div>
    </div>
  );
}

const STATUS_CLASS: Record<string, string> = {
  ok: 'bg-accent/15 text-accent',
  weak: 'bg-accent/10 text-accent/80',
  ending: 'bg-warn/20 text-warn',
  wrong: 'bg-bad/15 text-bad line-through decoration-bad/50',
  missing: 'bg-bad/10 text-bad/70 line-through decoration-bad/40',
};

function ResultCard({ r }: { r: PteResult }) {
  const good = r.pte_score >= 80;
  return (
    <div class="mt-4 rounded-2xl border border-line bg-surface p-4">
      <div class="flex items-center justify-between">
        <span class={cx('text-[15px] font-medium', good ? 'text-accent' : r.pte_score >= 60 ? 'text-warn' : 'text-bad')}>
          {r.correct}/{r.total} từ đúng
        </span>
        <span class="text-[13px] tabular-nums text-vi">{r.pte_score}%</span>
      </div>

      {/* Tung tu mot: xanh dung - vang rung duoi - do sai/thieu. */}
      <div class="mt-3 flex flex-wrap gap-1.5">
        {r.words.map((w, k) => (
          <span key={k} class={cx('rounded px-1.5 py-0.5 text-[14px]', STATUS_CLASS[w.status])}>
            {w.target}
            {w.status === 'ending' && w.said && <sub class="ml-0.5 text-[10px] opacity-80">{w.said}</sub>}
          </span>
        ))}
      </div>

      {r.dropped_endings > 0 && (
        <p class="mt-3 rounded-lg bg-warn/10 px-3 py-2 text-[12.5px] leading-snug text-warn">
          Rụng {r.dropped_endings} đuôi từ (ô vàng). PTE tính đó là <b>sai từ</b>, không phải lỗi nhỏ.
        </p>
      )}

      {r.extra.length > 0 && (
        <p class="mt-2.5 text-[12.5px] text-vi">
          Thừa: <span class="text-en-dim">{r.extra.join(' ')}</span>
        </p>
      )}

      {r.transcript && (
        <p class="mt-2.5 text-[12.5px] leading-snug text-vi">
          {r.mode === 'rs' ? 'Máy nghe thành: ' : 'Bạn gõ: '}
          <span class="text-en-dim">{r.transcript}</span>
        </p>
      )}
    </div>
  );
}

function Center({
  title,
  sub,
  href,
  action,
}: {
  title: string;
  sub: string;
  href?: string;
  action?: string;
}) {
  return (
    <div class="flex min-h-[70dvh] flex-col items-center justify-center px-8 text-center">
      <p class="text-[18px] font-semibold text-en">{title}</p>
      {sub && <p class="mt-2 text-[14px] leading-relaxed text-vi">{sub}</p>}
      {href && action && (
        <a href={href} class="mt-7 rounded-xl bg-accent px-6 py-3 text-[15px] font-semibold text-ink">
          {action}
        </a>
      )}
    </div>
  );
}
