import { useEffect, useRef, useState } from 'preact/hooks';
import MicButton, { type MicPhase } from './MicButton';
import SpeakButton from './SpeakButton';
import { get, post, postForm, ApiError, type DueCard, type ReviewAnswer, type VocabTopicCount } from '../lib/api';
import { extFor } from '../lib/recorder';
import { qp } from '../lib/qs';
import { getLang, homeOf, tenLang } from '../lib/lang';
import { cx } from '../lib/cx';

/**
 * On tu — mot the mot luc.
 *
 * De bai la NGHIA TIENG VIET, tu tieng Anh bi giau di; nguoi hoc phai bat ra
 * duoc tu roi noi to. Ban truoc bat "dat 1 cau dung tu X" — bo, vi voi tu
 * chuyen nganh thi de bai do mong lung, va moi the phai cho Gemini 4-6 giay.
 */
export default function ReviewDeck() {
  const flow = qp('flow', 'extra') === 'daily' ? 'daily' : 'extra';

  const [cards, setCards] = useState<DueCard[] | null>(null);
  const [topics, setTopics] = useState<VocabTopicCount[]>([]);
  const [filter, setFilter] = useState(qp('topic'));
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<MicPhase>('idle');
  const [result, setResult] = useState<ReviewAnswer | null>(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');

  // ---------------------------------------------------------------------
  // Do thoi gian phan xa: tu luc the hien ra toi luc cham mic.
  //
  // Vi sao can: diem phat am do DO RO, khong do DO CHAC. Nguoi bat ra tu
  // trong mot giay va nguoi nghi tam giay deu duoc 100 neu doc ro, trong khi
  // FSRS can biet nho de hay nho kho. Con so nay la thu re nhat de phan biet
  // hai nguoi do. Server tron no vao rating — xem api/src/srs.ts reviewRating.
  //
  // Do toi luc CHAM MIC chu khong phai luc bat dau phat ra tieng: trinh duyet
  // khong cho biet moc do ma khong phai phan tich luong am, va cham mic da la
  // dau hieu "toi nho ra roi" du tot.
  // ---------------------------------------------------------------------
  const shownAt = useRef(0);
  const thinkMs = useRef<number | null>(null);
  /** Man hinh tung bi an giua chung => phep do hong, bo di thay vi phat oan. */
  const dirty = useRef(false);

  useEffect(() => {
    const onVis = () => {
      if (document.hidden) dirty.current = true;
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // So thu tu cua lan tai hien tai. Ket qua ve TRE hon mot lan tai moi thi bi
  // vut di, khong duoc ghi de. Truoc day khong co chot nay nen doi chip trong
  // luc dang tai co the lam chip sang mot dang, danh sach the lai la dang khac.
  const gen = useRef(0);

  // Kho tu tach theo ngon ngu. Thieu tham so nay la the tieng Phap lot vao
  // buoi on tieng Anh va nguoc lai.
  const lang = getLang();

  const load = (topic: string) => {
    const my = ++gen.current;
    setCards(null);
    setI(0);
    setResult(null);
    get<DueCard[]>(`/review/due?limit=20&lang=${lang}${topic ? `&topic=${encodeURIComponent(topic)}` : ''}`)
      .then((c) => {
        if (my === gen.current) setCards(c);
      })
      .catch((e) => {
        if (my === gen.current) setLoadError(e instanceof ApiError ? e.message : String(e));
      });
  };

  useEffect(() => {
    load(filter);
    get<VocabTopicCount[]>(`/review/topics?lang=${lang}`)
      .then((t) => setTopics(t.filter((x) => x.due > 0)))
      .catch(() => {});
  }, []);

  // The moi hien ra -> bam lai dong ho. `result` vao day vi sau khi bam
  // "Tu tiep theo" thi result ve null truoc khi the sau ve tren man.
  useEffect(() => {
    shownAt.current = Date.now();
    thinkMs.current = null;
    dirty.current = false;
  }, [i, cards, result]);

  const nextStep = () => {
    const home = homeOf(getLang());
    window.location.href = flow === 'daily' && home === '/coach' ? '/coach?step=2' : home;
  };

  if (loadError) {
    return <Center title="Không tải được kho từ" sub={loadError} action={{ label: 'Về trang chủ', href: homeOf(lang) }} />;
  }
  if (!cards) return <Center title="Đang mở kho từ…" sub="" />;

  if (cards.length === 0) {
    return (
      <Center
        title={filter ? 'Nhóm này chưa có từ tới hạn' : `Kho ${tenLang(lang)} chưa có từ nào tới hạn`}
        sub={
          filter
            ? 'Bỏ lọc để xem các nhóm khác.'
            : lang === 'fr'
              // Tieng Phap chua co lo trinh (dot B). Khong duoc goi y "vao Lo
              // trinh" — trang do la tieng Anh, bam vao la lai lon ngon ngu.
              ? 'Chưa có bài tiếng Pháp nào để nạp từ. Nội dung A1 đang soạn.'
              : flow === 'daily'
                ? 'Hôm nay bỏ qua bước ôn. Từ mới rơi vào kho sau khi học chặng Từ vựng.'
                : 'Học chặng Từ vựng trong Lộ trình để nạp từ vào kho.'
        }
        action={
          filter
            ? { label: 'Bỏ lọc', onClick: () => { setFilter(''); load(''); } }
            : lang === 'fr'
              ? { label: 'Về trang chủ', onClick: nextStep }
              : { label: flow === 'daily' ? 'Sang bước tiếp theo' : 'Xem lộ trình', onClick: flow === 'daily' ? nextStep : () => (window.location.href = '/roadmap') }
        }
      />
    );
  }

  if (i >= cards.length) {
    return (
      <Center
        title={`Xong ${cards.length} từ`}
        sub="Lịch ôn đã giãn ra hoặc kéo lại theo mức bạn nhớ."
        action={{ label: flow === 'daily' ? 'Sang bước tiếp theo' : 'Về trang chủ', onClick: nextStep }}
      />
    );
  }

  const card = cards[i]!;

  const send = async (blob: Blob, mime: string) => {
    setError('');
    setPhase('busy');
    const form = new FormData();
    form.append('audio', blob, `answer.${extFor(mime)}`);
    form.append('word_id', String(card.id));
    // Khong gui khi phep do hong (man hinh tung bi an). Thieu truong nay thi
    // server coi nhu khong biet va se khong bao gio cham Easy — ben an toan.
    if (thinkMs.current !== null && !dirty.current) form.append('think_ms', String(thinkMs.current));
    const my = gen.current;
    try {
      const ans = await postForm<ReviewAnswer>('/review/answer', form);
      // Danh sach the da bi thay giua chung (doi chip) thi vut ket qua nay di:
      // hien no ra la ghep tu cua the cu voi nghia cua the moi.
      if (my !== gen.current) return;
      // Giu KEM the da tra loi. Truoc day khoi ket qua doc `card` cua lan
      // render hien tai, nen neu danh sach doi thi tu / nghia / nut nghe co
      // the la cua ba the khac nhau.
      setResult({ ...ans, card });
    } catch (e) {
      if (my === gen.current) setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setPhase('idle');
    }
  };

  /**
   * "De sau" — bo qua the nay ma KHONG tinh la tra loi sai.
   *
   * Ly do bam thuong la on, hong mic, met, hoac STT loi — khong phai quen tu.
   * Ghi Again cho mot lan bo qua se keo day khoang on tu 3-12-52-180 ngay xuong
   * 1-3-8-20 va day difficulty len vinh vien, tuc ghi sai su that vao mo hinh.
   * Server chi day rieng due_date sang mai, khong dong vao FSRS.
   */
  const skip = async () => {
    if (phase === 'busy') return;
    setError('');
    setPhase('busy');
    try {
      await post<{ word_id: number; next_due: string }>('/review/skip', { word_id: card.id });
    } catch {
      // Bo qua that bai thi van cho di tiep — day la nut go bi, khong duoc ket.
    } finally {
      setPhase('idle');
      advance();
    }
  };

  const advance = () => {
    setResult(null);
    setError('');
    setI(i + 1);
  };

  const recording = phase === 'recording';

  return (
    <div class="flex min-h-dvh flex-col">
      {!recording && (
        <header class="border-b border-line px-4 py-3">
          <div class="flex items-center justify-between">
            <p class="text-[13px] text-vi">
              {tenLang(lang)} · Từ {i + 1}/{cards.length}
            </p>
            <a href={homeOf(lang)} class="text-[13px] text-vi">
              Thoát
            </a>
          </div>

          {/* An hang chip khi dang cham: doi nhom giua chung la cua ngo
              lam tron the (ket qua the cu ghep voi the moi). */}
          {topics.length > 1 && phase === 'idle' && (
            <div class="mt-2 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
              <Chip active={!filter} onClick={() => { setFilter(''); load(''); }}>
                tất cả
              </Chip>
              {topics.map((t) => (
                <Chip
                  key={t.topic_id}
                  active={filter === t.topic_id}
                  onClick={() => { setFilter(t.topic_id); load(t.topic_id); }}
                >
                  {/* Nhan TIENG VIET tu server. Truoc day in nguyen slug
                      tieng Anh ("negotiation") — cung chuoi do con bi in len
                      mat truoc the va bi doc nham la tu can hoc. */}
                  {t.emoji ? `${t.emoji} ` : ''}
                  {t.label ?? t.topic_id.replace(/_/g, ' ')} ({t.due})
                </Chip>
              ))}
            </div>
          )}
        </header>
      )}

      <div class="flex flex-1 flex-col justify-center px-5">
        {!recording && (
          <>
            <div class="rounded-2xl border border-line bg-surface p-6 text-center">
              {result ? (
                <>
                  {/* Tra loi xong moi lo tu ra.
                      Doc tu `result.card` chu KHONG phai `card` cua lan render
                      hien tai: neu danh sach the doi giua chung thi tu, nghia
                      va nut nghe co the la cua ba the khac nhau. */}
                  <p class="text-[30px] font-bold leading-tight text-en">{result.word}</p>
                  {result.ipa && <p class="mt-1 text-[14px] text-vi">{result.ipa}</p>}
                  <p class="mt-2 text-[14.5px] text-vi">{(result.card ?? card).meaning_vi}</p>
                  {result.example_en && (
                    <p class="mt-4 border-t border-line pt-4 text-[15px] italic leading-relaxed text-en-dim">
                      “{result.example_en}”
                    </p>
                  )}
                  <div class="mt-3 flex justify-center gap-2">
                    <SpeakButton src={`/api/review/say/${result.word_id}?part=word`} label="nghe từ" />
                    <SpeakButton src={`/api/review/say/${result.word_id}`} label="nghe cả câu" />
                  </div>
                  {/* Nhan nhom day XUONG DAY, sau khi da lo dap an. O mat hoi
                      bai no tung la chu tieng Anh DUY NHAT tren man hinh nen
                      nguoi hoc doc luon no thay vi tu can hoc. */}
                  {(result.card ?? card).domain && (
                    <p class="mt-4 text-[11.5px] text-vi">
                      nhóm · {(result.card ?? card).domain.replace(/_/g, ' ')}
                    </p>
                  )}
                </>
              ) : (
                <>
                  {/* ⚠️ MAT HOI BAI KHONG DUOC CO BAT KY CHUOI TIENG ANH NAO.
                      Truoc day o day in vien {card.domain} — nhan linh vuc do
                      Gemini gan, khong dich. No la chu tieng Anh duy nhat tren
                      man, nam ngay duoi de bai, cung kieu vien tron nhu chip
                      loc, trong khi de bai lai bao "Noi tu tieng Anh...".
                      Nguoi hoc doc dung cai chu do va bi cham 0 diem oan.
                      Truy duoc trong log 07/09: the id=18 word="in bulk"
                      domain="negotiation". Da day nhan xuong nhanh ket qua. */}
                  <p class="text-[11.5px] uppercase tracking-wide text-vi">Nói từ tiếng Anh nghĩa là</p>
                  {/* De bai — tieng Viet nen o day no phai to va ro. */}
                  <p class="mt-3 text-[25px] font-semibold leading-snug text-en">{card.meaning_vi || '—'}</p>
                  {/* Noi ca cau de nghe hon han cho may: do tren 250 the,
                      truot oan 4,0% -> 2,4% va so the bi chan tran 85 la 17 -> 0.
                      matchPhrase da tim cum ben trong cau san, va con thuong +5. */}
                  <p class="mt-4 text-[13px] leading-snug text-vi">
                    Nói riêng từ đó, <b class="text-en-dim">hoặc đặt nó vào một câu</b> — cả hai đều tính.
                  </p>
                  <p class="mt-3 text-[12.5px] text-vi">
                    {card.reps === 0 ? 'Lần đầu ôn từ này' : `Đã ôn ${card.reps} lần`}
                  </p>
                </>
              )}
            </div>

            {result && <ResultCard r={result} />}
            {error && <p class="mt-4 rounded-xl bg-bad/10 px-3 py-2.5 text-[13.5px] text-bad">{error}</p>}
          </>
        )}
      </div>

      <div class="sticky bottom-0 border-t border-line bg-ink/95 px-4 pb-3 pt-2 backdrop-blur">
        {result ? (
          <button
            onClick={advance}
            class="mb-2 w-full rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink"
          >
            {i + 1 < cards.length ? 'Từ tiếp theo' : 'Xong'}
          </button>
        ) : (
          <div class="relative">
            {/* Nut go bi. Chi hien luc ranh — dang thu am hay dang cham thi an,
                de khong bam nham giua chung. */}
            {phase === 'idle' && (
              <button
                onClick={() => void skip()}
                class="absolute right-0 top-7 z-10 px-3 py-2.5 text-[13px] text-vi"
              >
                Để sau ›
              </button>
            )}
          <MicButton
            phase={phase}
            maxSeconds={20}
            hint="Nói từ đó, hoặc cả câu chứa nó"
            onTap={() => {
              // Cham mic = "toi nho ra roi". Chi lay lan dau, thu lai khong tinh.
              //
              // Chot o DAY chu khong o moc 'recording': moc do chi bat sau khi
              // trinh duyet xin xong quyen mic va tao xong MediaRecorder, nen
              // truoc day toan bo khoang cho may bat mic bi tinh la nguoi hoc
              // nghi lau — an thang vao ngan sach 6 giay cua muc Easy.
              if (thinkMs.current === null) thinkMs.current = Date.now() - shownAt.current;
            }}
            onStateChange={(p) => {
              setPhase((cur) => (cur === 'busy' ? cur : p));
            }}
            onError={(m) => {
              setError(m);
              setPhase('idle');
            }}
            onDone={(blob, mime) => void send(blob, mime)}
          />
          </div>
        )}
      </div>
    </div>
  );
}

function ResultCard({ r }: { r: ReviewAnswer }) {
  const tone = r.score >= 90 ? 'good' : r.ok ? 'ok' : 'bad';
  return (
    <div class="mt-4 rounded-2xl border border-line bg-surface p-4">
      <div class="flex items-center justify-between">
        <span class={cx('text-[15px] font-medium', tone === 'good' ? 'text-accent' : tone === 'ok' ? 'text-warn' : 'text-bad')}>
          {tone === 'good' ? '✅ Chuẩn' : tone === 'ok' ? '⚠️ Tạm được' : '❌ Chưa được'}
        </span>
        <span class="text-[13px] tabular-nums text-vi">{r.score}/100</span>
      </div>

      <p class="mt-2.5 text-[13.5px] leading-snug text-vi">{r.feedback_vi}</p>

      {r.transcript && (
        <p class="mt-2 text-[12.5px] text-vi">
          Máy nghe thành: <span class="text-en-dim">{r.transcript}</span>
        </p>
      )}

      <p class="mt-3 border-t border-line pt-3 text-[12px] text-vi">
        Điểm nhớ {r.grade}/5 · gặp lại sau {r.interval} ngày ({r.next_due})
      </p>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: preact.ComponentChildren;
}) {
  return (
    <button
      onClick={onClick}
      class={cx(
        'shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[12px]',
        active ? 'bg-accent text-ink font-medium' : 'bg-surface-2 text-vi',
      )}
    >
      {children}
    </button>
  );
}

function Center({
  title,
  sub,
  action,
}: {
  title: string;
  sub: string;
  action?: { label: string; href?: string; onClick?: () => void };
}) {
  return (
    <div class="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
      <p class="text-[19px] font-semibold text-en">{title}</p>
      {sub && <p class="mt-2 text-[14.5px] leading-relaxed text-vi">{sub}</p>}
      {action &&
        (action.href ? (
          <a href={action.href} class="mt-8 w-full rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink">
            {action.label}
          </a>
        ) : (
          <button onClick={action.onClick} class="mt-8 w-full rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink">
            {action.label}
          </button>
        ))}
    </div>
  );
}
