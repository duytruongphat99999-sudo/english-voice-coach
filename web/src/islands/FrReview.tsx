import { useEffect, useRef, useState } from 'preact/hooks';
import SpeakButton from './SpeakButton';
import FrKeys from './FrKeys';
import { get, post, ApiError, type FrDueCard, type FrReviewResult, type FrDeckSummary, type FrVerdict } from '../lib/api';
import { cx } from '../lib/cx';

/**
 * On tu tieng Phap — GO lai tu (Duy chot 12/09/2026).
 *
 * Thay nghia tieng Viet -> go tu tieng Phap kem mao tu. App cham CHINH XAC tung
 * chu co dau (routes/fr.ts + fr-text.ts); lich on chi theo phan go. Nghe mau va
 * noi theo sau khi tra loi — KHONG cham (may nghe tieng Phap kem voi giong nguoi
 * moi hoc, de no cham la lich on sai).
 *
 * The moi tu kho 500 tu (chua thay mat bao gio) thi cho XEM truoc roi moi bat
 * go — bat go mot tu chua tung thay la chac chan "quen", vo nghia.
 *
 * Thoi gian nghi = tu luc the hien toi PHIM DAU TIEN, khong tinh luc go.
 */
type Phase = 'learn' | 'ask' | 'result';

const VERDICT_VI: Record<FrVerdict, { label: string; tone: 'good' | 'ok' | 'bad' }> = {
  ok: { label: 'Đúng', tone: 'good' },
  accent: { label: 'Sai dấu', tone: 'ok' },
  article: { label: 'Sai mạo từ', tone: 'ok' },
  no_article: { label: 'Thiếu mạo từ', tone: 'ok' },
  typo: { label: 'Sai một chữ cái', tone: 'bad' },
  wrong: { label: 'Chưa nhớ', tone: 'bad' },
  empty: { label: 'Chưa nhớ', tone: 'bad' },
};

export default function FrReview() {
  const [cards, setCards] = useState<FrDueCard[] | null>(null);
  const [sum, setSum] = useState<FrDeckSummary | null>(null);
  const [error, setError] = useState('');
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<Phase>('ask');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<FrReviewResult | null>(null);
  const [tally, setTally] = useState({ ok: 0, near: 0, miss: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const shownAt = useRef(0);
  const firstKey = useRef<number | null>(null);
  // Man hinh bi an truoc phim dau tien => thoi gian nghi do hong, khong gui (nhu ReviewDeck).
  const dirty = useRef(false);

  useEffect(() => {
    const onVis = () => {
      if (document.hidden && firstKey.current === null) dirty.current = true;
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const load = () => {
    setError('');
    Promise.all([get<FrDueCard[]>('/fr/review/due?limit=50'), get<FrDeckSummary>('/fr/deck/summary')])
      .then(([c, s]) => {
        setCards(c);
        setSum(s);
        setI(0);
        start(c[0]);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  };
  useEffect(load, []);

  const start = (c: FrDueCard | undefined) => {
    setTyped('');
    setRes(null);
    firstKey.current = null;
    dirty.current = false;
    shownAt.current = performance.now();
    setPhase(c?.is_new ? 'learn' : 'ask');
    if (c && !c.is_new) requestAnimationFrame(() => inputRef.current?.focus());
  };

  const card = cards?.[i];

  const submit = async (text: string) => {
    if (!card || busy) return;
    setBusy(true);
    setError('');
    const think = firstKey.current !== null ? firstKey.current - shownAt.current : performance.now() - shownAt.current;
    try {
      const r = await post<FrReviewResult>('/fr/review/answer-text', {
        word_id: card.id,
        text,
        // Khong gui = server coi nhu khong do duoc, khong bao gio cham Easy.
        ...(dirty.current ? {} : { think_ms: Math.round(think) }),
      });
      setRes(r);
      setPhase('result');
      // O go van nam trong cay (an) — nha con tro de ban phim khong che ket qua.
      inputRef.current?.blur();
      setTally((t) =>
        r.verdict === 'ok' ? { ...t, ok: t.ok + 1 } : ['accent', 'article', 'no_article'].includes(r.verdict) ? { ...t, near: t.near + 1 } : { ...t, miss: t.miss + 1 },
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    const n = i + 1;
    const nc = cards?.[n];
    // Goi tu nut "Tiep" => dang trong cu cham: focus ngay de iPhone bat ban phim.
    if (nc && !nc.is_new) inputRef.current?.focus();
    setI(n);
    start(nc);
  };

  const skip = () => {
    // Khong cho "de sau" luc dang cham: ket qua the truoc se hien de len the sau
    // va lo dap an (review 12/09).
    if (!card || busy) return;
    const id = card.id;
    // Sang the ke NGAY trong cu cham (de next() focus duoc, iPhone bat ban phim —
    // review 16/09); lenh "de sau" gui di khong cho. Khong duoc thi thoi, nhu truoc.
    next();
    void post('/review/skip', { word_id: id }).catch(() => {});
  };

  if (error && !cards) {
    return (
      <div class="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
        <p class="text-[19px] font-semibold text-en">Không tải được kho từ</p>
        <p class="mt-2 text-[14px] leading-relaxed text-bad">{error}</p>
        <button onClick={load} class="mt-8 w-full rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink">
          Thử lại
        </button>
        <a href="/fr" class="mt-3 py-2 text-[14px] text-vi">
          Về trang tiếng Pháp
        </a>
      </div>
    );
  }
  if (!cards || !sum) return <p class="px-5 py-16 text-center text-[14px] text-vi">Đang tải…</p>;

  if (!card) {
    const done = tally.ok + tally.near + tally.miss;
    return (
      <div class="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
        <p class="text-[19px] font-semibold text-en">{done ? `Xong ${done} thẻ` : 'Hôm nay hết thẻ phải ôn'}</p>
        {done > 0 && (
          <p class="mt-2 text-[14.5px] text-vi">
            <span class="text-accent">{tally.ok} đúng</span> · <span class="text-warn">{tally.near} gần đúng</span> ·{' '}
            <span class="text-bad">{tally.miss} chưa nhớ</span>
          </p>
        )}
        <p class="mt-3 text-[13.5px] leading-relaxed text-vi">
          Kho: {sum.total} từ · đã thuộc {sum.learned} · còn {sum.waiting} từ chờ mở, mỗi ngày mở {sum.per_day} từ.
        </p>
        <a href="/fr-roadmap" class="mt-8 w-full rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink">
          Học bài tiếp
        </a>
        <a href="/fr" class="mt-3 py-2 text-[14px] text-vi">
          Về trang tiếng Pháp
        </a>
      </div>
    );
  }

  const v = res ? VERDICT_VI[res.verdict] : null;

  return (
    <div class="flex min-h-dvh flex-col">
      <header class="sticky top-0 z-10 border-b border-line bg-ink/95 px-4 py-3 backdrop-blur">
        <div class="flex items-center justify-between gap-3">
          <p class="min-w-0 truncate text-[13.5px] text-en-dim">
            Ôn từ tiếng Pháp <span class="text-vi">· gõ lại từ</span>
          </p>
          <a href="/fr" class="shrink-0 text-[13px] text-vi">
            Thoát
          </a>
        </div>
        <div class="mt-2 flex items-center gap-2">
          <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
            <span class="block h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${(i / cards.length) * 100}%` }} />
          </span>
          <span class="shrink-0 text-[11.5px] tabular-nums text-vi">
            {i + 1}/{cards.length}
          </span>
        </div>
      </header>

      <div class="flex flex-1 flex-col justify-center px-5 py-6">
        <div class="rounded-2xl border border-line bg-surface p-5">
          <p class="text-[11.5px] uppercase tracking-wide text-vi">
            {card.emoji} {card.group_vi}
            {card.is_new && <span class="ml-2 rounded-full bg-accent/15 px-2 py-0.5 normal-case text-accent">từ mới</span>}
          </p>
          <p class="mt-3 text-center text-[24px] font-semibold leading-snug text-en">{card.meaning_vi}</p>

          {phase === 'learn' && (
            <div class="mt-5 border-t border-line pt-4 text-center">
              <p class="text-[28px] font-bold text-accent" lang="fr">
                {card.word}
              </p>
              {card.ipa && <p class="mt-1 text-[14px] text-vi">{card.ipa}</p>}
              {card.gender_vi && <p class="mt-1 text-[13px] text-en-dim">{card.gender_vi}</p>}
              {card.note_vi && <p class="mt-2 text-[12.5px] leading-snug text-warn">{card.note_vi}</p>}
              <p class="mt-4 text-[17px] leading-relaxed text-en" lang="fr">
                {card.example_fr}
              </p>
              <p class="mt-1 text-[13px] text-vi">{card.example_vi}</p>
              <div class="mt-3 flex justify-center">
                <SpeakButton key={card.id} src={`/api/review/say/${card.id}`} label="nghe" autoPlay />
              </div>
              <p class="mt-4 text-[12.5px] text-vi">Nhìn kỹ, nghe, nói theo một lần — rồi bấm để tự gõ lại.</p>
            </div>
          )}

          {/* O go LUON nam trong cay (an bang sr-only khi chua can), de nut bam
              focus duoc no NGAY TRONG cu cham — iPhone chi bat ban phim khi focus
              chay dong bo trong su kien cham, khong bat neu goi o khung hinh sau. */}
          <div class={phase === 'ask' ? 'mt-5' : 'sr-only'} aria-hidden={phase !== 'ask'}>
              <input
                ref={inputRef}
                value={typed}
                lang="fr"
                tabIndex={phase === 'ask' ? 0 : -1}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellcheck={false}
                // readOnly chu KHONG disabled: disabled lam o go mat con tro -> iPhone dong
                // ban phim luc dang cham, cham loi thi khong con gi tra con tro lai (review 16/09).
                readOnly={busy}
                placeholder={card.gender_vi ? "gõ từ tiếng Pháp (kèm le / la / l' / les)" : 'gõ từ tiếng Pháp'}
                onInput={(e) => {
                  if (firstKey.current === null) firstKey.current = performance.now();
                  setTyped((e.target as HTMLInputElement).value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (typed.trim()) void submit(typed);
                  }
                }}
                class="w-full rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-center text-[19px] text-en outline-none placeholder:text-[14px] placeholder:text-vi focus:border-accent"
              />
              {phase === 'ask' && (
                <FrKeys
                  target={inputRef}
                  value={typed}
                  onChange={(val) => {
                    if (firstKey.current === null) firstKey.current = performance.now();
                    setTyped(val);
                  }}
                />
              )}
          </div>

          {phase === 'result' && res && v && (
            <div class="mt-5 border-t border-line pt-4 text-center">
              <p class={cx('text-[13px] font-semibold', v.tone === 'good' ? 'text-accent' : v.tone === 'ok' ? 'text-warn' : 'text-bad')}>{v.label}</p>
              {res.typed.trim() && res.verdict !== 'ok' && (
                <p class="mt-1 text-[16px] text-vi line-through" lang="fr">
                  {res.typed}
                </p>
              )}
              <p class="mt-1 text-[28px] font-bold text-en" lang="fr">
                {res.word}
              </p>
              {res.ipa && <p class="mt-1 text-[14px] text-vi">{res.ipa}</p>}
              {res.gender_vi && <p class="mt-1 text-[13px] text-en-dim">{res.gender_vi}</p>}
              {res.note_vi && <p class="mt-2 text-[12.5px] leading-snug text-warn">{res.note_vi}</p>}
              <p class="mt-4 text-[17px] leading-relaxed text-en" lang="fr">
                {res.example_fr}
              </p>
              <p class="mt-1 text-[13px] text-vi">{res.example_vi}</p>
              <div class="mt-3 flex justify-center">
                <SpeakButton src={`/api/review/say/${card.id}`} label="nghe & nói theo" autoPlay />
              </div>
              <p class={cx('mt-4 rounded-xl px-3 py-2.5 text-[13px] leading-snug', v.tone === 'good' ? 'bg-accent/10 text-accent' : 'bg-warn/10 text-warn')}>
                {res.feedback_vi} Hỏi lại sau {res.interval <= 0 ? 'hôm nay' : `${res.interval} ngày`}.
              </p>
            </div>
          )}
        </div>
        {error && <p class="mt-4 rounded-xl bg-bad/10 px-3 py-2.5 text-[13.5px] leading-snug text-bad">{error}</p>}
      </div>

      <div class="sticky bottom-0 border-t border-line bg-ink/95 px-4 pb-3 pt-2 backdrop-blur">
        {phase === 'learn' && (
          <button
            onClick={() => {
              // Focus TRUOC khi doi state, ngay trong cu cham (xem chu thich o go).
              inputRef.current?.focus();
              setPhase('ask');
              shownAt.current = performance.now();
              firstKey.current = null;
            }}
            class="mb-1 w-full rounded-xl bg-accent py-3.5 text-[16px] font-semibold text-ink"
          >
            Đã xem — kiểm tra tôi
          </button>
        )}
        {phase === 'ask' && (
          <div class="mb-1 flex gap-2.5">
            <button
              // Bam nut khong lay mat con tro cua o go (nhu FrKeys) — ban phim giu nguyen.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void submit('')}
              disabled={busy}
              class="flex-1 rounded-xl border border-line bg-surface py-3.5 text-[15px] font-medium text-en-dim disabled:opacity-40"
            >
              Không nhớ
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void submit(typed)}
              disabled={busy || !typed.trim()}
              class="flex-[1.4] rounded-xl bg-accent py-3.5 text-[15.5px] font-semibold text-ink disabled:opacity-40"
            >
              {busy ? 'Đang chấm…' : 'Kiểm tra'}
            </button>
          </div>
        )}
        {phase === 'result' && (
          <button onClick={next} class="mb-1 w-full rounded-xl bg-accent py-3.5 text-[16px] font-semibold text-ink">
            {i + 1 < cards.length ? 'Tiếp' : 'Xong'}
          </button>
        )}
        {phase !== 'result' && !busy && (
          <button onClick={skip} class="w-full py-1.5 text-center text-[12.5px] text-vi">
            để sau →
          </button>
        )}
      </div>
    </div>
  );
}
