import { useEffect, useRef, useState } from 'preact/hooks';
import SpeakButton from './SpeakButton';
import FrKeys from './FrKeys';
import { get, post, ApiError, type FrDicteeList, type FrDicteeResult } from '../lib/api';
import { cx } from '../lib/cx';

/**
 * Nghe - viet chinh ta tieng Phap (dot B, 12/09/2026).
 *
 * May doc mot cau (giong ff_siwis), nguoi hoc go lai; app so TUNG CHU CO DAU
 * (fr-text.diffSentence): dung / sai dau / thieu / thua. Cau lay tu 8 chu de A1
 * (cau vi du, cau phat am, cau dich). Server khong gui chu truoc khi nop.
 *
 * Chua luu lich su len may chu — moi luot chi tinh diem tai cho.
 */
const LENS = [
  { k: 'all', label: 'Trộn' },
  { k: 'ngan', label: 'Ngắn' },
  { k: 'vua', label: 'Vừa' },
  { k: 'dai', label: 'Dài' },
] as const;

export default function FrDictee() {
  const [len, setLen] = useState<string>('ngan');
  const [topic, setTopic] = useState('');
  const [list, setList] = useState<FrDicteeList | null>(null);
  const [topics, setTopics] = useState<FrDicteeList['topics']>([]);
  const [i, setI] = useState(0);
  const [typed, setTyped] = useState('');
  const [res, setRes] = useState<FrDicteeResult | null>(null);
  const [scores, setScores] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const begin = async () => {
    setError('');
    try {
      const l = await get<FrDicteeList>(`/fr/dictee/items?n=10&len=${len}${topic ? `&topic=${topic}` : ''}`);
      setTopics(l.topics);
      if (!l.items.length) {
        setError('Không có câu nào khớp lựa chọn này.');
        return;
      }
      setList(l);
      setI(0);
      setScores([]);
      setTyped('');
      setRes(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  // Lan dau mo trang: lay danh sach chu de de hien bo loc.
  useEffect(() => {
    get<FrDicteeList>('/fr/dictee/items?n=1')
      .then((l) => setTopics(l.topics))
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, []);

  const item = list?.items[i];

  const submit = async () => {
    if (!item || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await post<FrDicteeResult>('/fr/dictee/answer', { id: item.id, text: typed });
      setRes(r);
      setScores((s) => [...s, r.score]);
      // O go van nam trong cay (an) — nha con tro de ban phim khong che ket qua.
      inputRef.current?.blur();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    // Goi tu nut "Cau tiep" => dang trong cu cham: focus ngay de iPhone bat ban phim.
    if (list && i + 1 < list.items.length) inputRef.current?.focus();
    setI(i + 1);
    setTyped('');
    setRes(null);
  };

  // --- Man chon -------------------------------------------------------------
  if (!list) {
    return (
      <div class="px-5 pb-8 pt-7">
        <div class="flex items-center justify-between">
          <h1 class="text-[23px] font-bold text-en">Nghe – viết chính tả</h1>
          <a href="/fr" class="text-[13px] text-vi">
            Thoát
          </a>
        </div>
        <p class="mt-2 text-[13.5px] leading-relaxed text-vi">
          Máy đọc một câu tiếng Pháp, bạn gõ lại. App chấm từng chữ, <b class="text-en-dim">có dấu</b> — sai dấu là sai
          chính tả. Số thì viết bằng chữ (quinze, huit heures).
        </p>

        <p class="mt-6 text-[12px] uppercase tracking-wide text-vi">Độ dài câu</p>
        <div class="mt-2 grid grid-cols-4 gap-2">
          {LENS.map((l) => (
            <button
              key={l.k}
              onClick={() => setLen(l.k)}
              class={cx('rounded-xl border py-2.5 text-[14px]', len === l.k ? 'border-accent bg-accent/10 text-accent' : 'border-line bg-surface text-en-dim')}
            >
              {l.label}
            </button>
          ))}
        </div>

        <p class="mt-6 text-[12px] uppercase tracking-wide text-vi">Chủ đề</p>
        <div class="mt-2 flex flex-wrap gap-2">
          <button
            onClick={() => setTopic('')}
            class={cx('rounded-full border px-3 py-1.5 text-[13px]', !topic ? 'border-accent bg-accent/10 text-accent' : 'border-line text-en-dim')}
          >
            Tất cả
          </button>
          {topics.map((t) => (
              <button
                key={t.id}
                onClick={() => setTopic(t.id)}
                class={cx('rounded-full border px-3 py-1.5 text-[13px]', topic === t.id ? 'border-accent bg-accent/10 text-accent' : 'border-line text-en-dim')}
              >
                {t.emoji} {t.name_vi}
              </button>
          ))}
        </div>

        {error && <p class="mt-5 rounded-xl bg-bad/10 px-3 py-2.5 text-[13.5px] text-bad">{error}</p>}

        <button onClick={() => void begin()} class="mt-8 w-full rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink">
          Bắt đầu 10 câu
        </button>
      </div>
    );
  }

  // --- Het luot -----------------------------------------------------------
  if (!item) {
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    return (
      <div class="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
        <p class="text-[19px] font-semibold text-en">Xong {scores.length} câu</p>
        <p class="mt-2 text-[40px] font-bold tabular-nums text-accent">{avg}%</p>
        <p class="text-[13px] text-vi">trung bình · {scores.filter((s) => s === 100).length} câu đúng hoàn toàn</p>
        <button onClick={() => void begin()} class="mt-8 w-full rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink">
          Làm 10 câu nữa
        </button>
        <button onClick={() => setList(null)} class="mt-3 py-2 text-[14px] text-vi">
          Đổi độ dài / chủ đề
        </button>
      </div>
    );
  }

  // --- Mot cau ------------------------------------------------------------
  return (
    <div class="flex min-h-dvh flex-col">
      <header class="sticky top-0 z-10 border-b border-line bg-ink/95 px-4 py-3 backdrop-blur">
        <div class="flex items-center justify-between gap-3">
          <p class="min-w-0 truncate text-[13.5px] text-en-dim">
            {item.emoji} {item.topic_vi} <span class="text-vi">· {item.words} chữ</span>
          </p>
          <button onClick={() => setList(null)} class="shrink-0 text-[13px] text-vi">
            Thoát
          </button>
        </div>
        <div class="mt-2 flex items-center gap-2">
          <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
            <span class="block h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${((i + (res ? 1 : 0)) / list.items.length) * 100}%` }} />
          </span>
          <span class="shrink-0 text-[11.5px] tabular-nums text-vi">
            {i + 1}/{list.items.length}
          </span>
        </div>
      </header>

      <div class="flex flex-1 flex-col justify-center px-5 py-6">
        <div class="rounded-2xl border border-line bg-surface p-5">
          <div class="flex justify-center">
            <SpeakButton key={item.id} src={`/api/fr/dictee/say/${item.id}`} label="nghe câu" variant="block" autoPlay />
          </div>

          {/* O go LUON nam trong cay (an bang sr-only khi dang xem ket qua) de nut
              "Cau tiep" focus duoc NGAY trong cu cham — iPhone chi bat ban phim khi
              focus chay dong bo trong su kien cham. */}
          <div class={res ? 'sr-only' : ''} aria-hidden={Boolean(res)}>
              <textarea
                ref={inputRef}
                value={typed}
                rows={3}
                lang="fr"
                tabIndex={res ? -1 : 0}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="sentences"
                spellcheck={false}
                // readOnly chu KHONG disabled: giu con tro (ban phim iPhone) luc dang cham.
                readOnly={busy}
                placeholder="Gõ lại đúng câu vừa nghe…"
                onInput={(e) => setTyped((e.target as HTMLTextAreaElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (typed.trim()) void submit();
                  }
                }}
                class="mt-4 w-full resize-none rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-[17px] text-en outline-none placeholder:text-vi focus:border-accent"
              />
          </div>
          {!res && <FrKeys target={inputRef} value={typed} onChange={setTyped} />}
          {res && (
            <div class="mt-4">
              <div class="flex items-baseline justify-between">
                <span class="text-[12px] text-vi">Đúng</span>
                <span class={cx('text-[28px] font-bold tabular-nums', res.score >= 90 ? 'text-accent' : res.score >= 60 ? 'text-warn' : 'text-bad')}>
                  {res.score}%
                </span>
              </div>
              <p class="mt-2 text-[18px] leading-loose" lang="fr">
                {res.tokens.map((t, k) => (
                  <span
                    key={k}
                    title={t.status === 'accent' ? `bạn gõ "${t.typed}"` : t.status === 'missing' ? 'thiếu' : t.status === 'extra' ? 'thừa' : 'đúng'}
                    class={cx(
                      // "l'" dinh lien chu sau — tru khi chu sau la chu THUA (khong thi thanh "l'la").
                      t.w.endsWith("'") && res.tokens[k + 1]?.status !== 'extra' ? 'inline-block' : 'mr-1.5 inline-block',
                      t.status === 'ok' && 'text-en',
                      t.status === 'accent' && 'text-warn underline decoration-warn decoration-wavy underline-offset-4',
                      t.status === 'missing' && 'text-bad underline decoration-bad underline-offset-4',
                      t.status === 'extra' && 'text-vi line-through',
                    )}
                  >
                    {t.w}
                  </span>
                ))}
              </p>
              <p class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-vi">
                <span><b class="text-en">Aa</b> đúng</span>
                <span><b class="text-warn underline decoration-wavy underline-offset-2">Aa</b> sai dấu</span>
                <span><b class="text-bad underline underline-offset-2">Aa</b> thiếu</span>
                <span><b class="text-vi line-through">Aa</b> thừa</span>
              </p>
              <div class="mt-4 border-t border-line pt-3">
                <p class="text-[11.5px] uppercase tracking-wide text-vi">Câu gốc</p>
                <p class="mt-1 text-[17px] font-semibold leading-relaxed text-accent" lang="fr">
                  {res.reference}
                </p>
                <p class="mt-1 text-[13px] text-vi">{res.vi}</p>
              </div>
            </div>
          )}
        </div>
        {error && <p class="mt-4 rounded-xl bg-bad/10 px-3 py-2.5 text-[13.5px] leading-snug text-bad">{error}</p>}
      </div>

      <div class="sticky bottom-0 border-t border-line bg-ink/95 px-4 pb-3 pt-2 backdrop-blur">
        {res ? (
          <button onClick={next} class="mb-1 w-full rounded-xl bg-accent py-3.5 text-[16px] font-semibold text-ink">
            {i + 1 < list.items.length ? 'Câu tiếp' : 'Xem kết quả'}
          </button>
        ) : (
          <button
            // Bam nut khong lay mat con tro cua o go — ban phim giu nguyen.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void submit()}
            disabled={busy || !typed.trim()}
            class="mb-1 w-full rounded-xl bg-accent py-3.5 text-[16px] font-semibold text-ink disabled:opacity-40"
          >
            {busy ? 'Đang chấm…' : 'Nộp'}
          </button>
        )}
      </div>
    </div>
  );
}
