import { useEffect, useRef, useState } from 'preact/hooks';
import MicButton, { type MicPhase } from './MicButton';
import {
  get,
  postForm,
  ApiError,
  type RaItem,
  type RaItems,
  type RaProgress,
  type RaResult,
} from '../lib/api';
import { extFor } from '../lib/recorder';
import { GOOD_LOW, GOOD_HIGH } from '../lib/pace';
import { cx } from '../lib/cx';

/**
 * Read Aloud — nhin chu, doc to.
 *
 * ⚠️ MAN NAY CHI CHAM DUOC NOI DUNG. PTE cham Read Aloud theo ba tieu chi
 * (Content, Oral Fluency, Pronunciation); app khong co forced alignment nen
 * KHONG lam ra duoc hai cai sau. Vi vay man hinh:
 *   - hien mot con so duy nhat la "tu doc dung / tong tu";
 *   - hien wpm, tu dem, ngap ngung nhu CHI BAO, co nhan "khong phai diem";
 *   - khong bao gio hien chu "phat am" kem con so.
 * Xem chu thich dau api/src/pte-speaking.ts.
 */

const CAP_VI: Record<number, { ten: string; mo_ta: string }> = {
  1: { ten: 'Cấp 1', mo_ta: 'Đoạn ngắn, câu đơn giản' },
  2: { ten: 'Cấp 2', mo_ta: 'Đoạn vừa, văn học thuật' },
  3: { ten: 'Cấp 3', mo_ta: 'Đoạn dài, học thuật dày' },
};

const N = 5;

export default function PteSpeaking() {
  const [intro, setIntro] = useState<RaProgress | null>(null);
  const [items, setItems] = useState<RaItem[] | null>(null);
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<MicPhase>('idle');
  const [result, setResult] = useState<RaResult | null>(null);
  const [done, setDone] = useState<RaResult[]>([]);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  // Cap do TRUOC luot nay, de biet co vua mo cap moi khong.
  const capTruoc = useRef<number>(1);

  useEffect(() => {
    get<RaProgress>('/pte/ra/progress')
      .then((r) => {
        setIntro(r);
        capTruoc.current = r.progress.unlocked_max;
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : String(e)));
  }, []);

  const batDau = (level: number) => {
    setItems(null);
    setI(0);
    setResult(null);
    setDone([]);
    setError('');
    get<RaItems>(`/pte/ra/items?level=${level}&n=${N}`)
      .then((r) => setItems(r.items))
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : String(e)));
  };

  const gui = async (blob: Blob, mime: string, duration: number) => {
    const item = items?.[i];
    if (!item) return;
    setError('');
    setPhase('busy');
    const form = new FormData();
    form.append('audio', blob, `ra.${extFor(mime)}`);
    form.append('id', item.id);
    form.append('duration_s', String(duration));
    try {
      const r = await postForm<RaResult>('/pte/answer/ra', form);
      setResult(r);
      setDone((d) => [...d, r]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setPhase('idle');
    }
  };

  const tiep = () => {
    setResult(null);
    setError('');
    setI(i + 1);
  };

  if (loadError) {
    return <Center title="Không tải được bộ đề" sub={loadError} href="/pte" action="Về màn PTE" />;
  }

  // --- Man mo dau: chon cap do ---------------------------------------------
  if (!items) {
    if (!intro) return <Center title="Đang mở…" sub="" />;
    const p = intro.progress;
    return (
      <div class="px-5 pb-10 pt-8">
        <a href="/pte" class="text-[13px] text-vi">‹ PTE</a>
        <h1 class="mt-3 text-[23px] font-bold text-en">Đọc to</h1>
        <p class="mt-1 text-[13.5px] text-vi">Read Aloud</p>
        <p class="mt-3 text-[14px] leading-relaxed text-vi">
          Nhìn đoạn văn rồi đọc to, rõ, đều. Đề thi có <b>6–7 câu</b> dạng này, tính vào phần{' '}
          <b>Nói</b>. Đọc sót, đọc thay hay chèn thêm một từ đều tính là một lỗi.
        </p>

        <div class="mt-6 rounded-2xl border border-line bg-surface px-4 py-4">
          <p class="text-[13px] text-vi">
            Đang ở <b class="text-en">{CAP_VI[p.unlocked_max]?.ten}</b>
            {p.done > 0 && <> · trung bình {p.avg}%</>}
          </p>
          {p.unlocked_max < intro.max_level && (
            <p class="mt-1.5 text-[12.5px] leading-snug text-vi">
              {p.need > 0
                ? `Làm thêm ${p.need} bài ở cấp này, giữ trung bình từ 80% trở lên thì mở cấp sau.`
                : p.avg >= 80
                  ? 'Đủ điều kiện — bài tiếp theo sẽ mở cấp mới.'
                  : `Trung bình đang ${p.avg}%, cần từ 80% mới lên cấp.`}
            </p>
          )}
        </div>

        <h2 class="mt-7 mb-2.5 text-[12px] uppercase tracking-wide text-vi">Chọn cấp</h2>
        <div class="flex flex-col gap-2">
          {intro.bank.map((b) => {
            const khoa = b.level > p.unlocked_max;
            return (
              <button
                key={b.level}
                onClick={() => !khoa && batDau(b.level)}
                disabled={khoa || b.n === 0}
                class={cx(
                  'flex items-center justify-between rounded-xl border px-4 py-3.5 text-left',
                  khoa || b.n === 0
                    ? 'border-line bg-surface/50 opacity-45'
                    : 'border-line bg-surface',
                )}
              >
                <span>
                  <span class="text-[15px] font-medium text-en">{CAP_VI[b.level]?.ten}</span>
                  <span class="mt-0.5 block text-[12.5px] text-vi">
                    {khoa ? 'Chưa mở' : b.n === 0 ? 'Chưa có đề' : CAP_VI[b.level]?.mo_ta}
                  </span>
                </span>
                <span class="text-[13px] tabular-nums text-vi">{khoa ? '🔒' : `${b.n} bài`}</span>
              </button>
            );
          })}
        </div>

        {intro.recent.length > 0 && (
          <section class="mt-8">
            <h2 class="mb-2.5 text-[12px] uppercase tracking-wide text-vi">Lần trước</h2>
            <ul class="flex flex-col gap-1.5">
              {intro.recent.slice(0, 5).map((r) => (
                <li
                  key={r.id}
                  class="flex items-center justify-between rounded-xl border border-line bg-surface px-3.5 py-2.5"
                >
                  <span class="text-[13px] text-vi">
                    {CAP_VI[r.level]?.ten} · {r.item_id}
                  </span>
                  <span
                    class={cx(
                      'text-[13px] tabular-nums',
                      r.score >= 80 ? 'text-accent' : r.score >= 60 ? 'text-warn' : 'text-bad',
                    )}
                  >
                    {r.correct}/{r.total} · {r.score}%
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  if (items.length === 0) {
    return <Center title="Cấp này chưa có đề" sub="Thêm đoạn vào api/content/pte-read-aloud.json rồi khởi động lại evc-api." href="/pte" action="Về màn PTE" />;
  }

  // --- Xong ca luot ---------------------------------------------------------
  if (i >= items.length) {
    const tongTu = done.reduce((a, r) => a + r.total, 0);
    const duocTu = done.reduce((a, r) => a + r.correct, 0);
    const pct = tongTu ? Math.round((duocTu / tongTu) * 100) : 0;
    const cuoi = done[done.length - 1];
    const moCapMoi = cuoi && cuoi.progress.unlocked_max > capTruoc.current;

    return (
      <div class="px-5 pb-10 pt-8">
        <h1 class="text-[22px] font-bold text-en">Xong {items.length} bài</h1>

        {moCapMoi && (
          <p class="mt-4 rounded-xl bg-accent/10 px-4 py-3 text-[14px] leading-snug text-accent">
            Vừa mở <b>{CAP_VI[cuoi.progress.unlocked_max]?.ten}</b> — đoạn dài hơn, từ học thuật dày hơn.
          </p>
        )}

        <div class="mt-5 rounded-2xl border border-line bg-surface px-5 py-6 text-center">
          <p class="text-[40px] font-bold leading-none tabular-nums text-en">{pct}%</p>
          <p class="mt-2 text-[13.5px] text-vi">
            {duocTu}/{tongTu} từ đọc đúng
          </p>
        </div>

        <p class="mt-4 rounded-xl bg-surface px-4 py-3 text-[12.5px] leading-snug text-vi">
          Con số này là <b>mốc luyện tập</b>, không phải dự đoán điểm thi. Máy nghe của app đoán từ
          theo ngữ cảnh còn máy chấm PTE thì không, nên nó luôn hiền hơn — đoạn càng dài càng lệch.
        </p>

        <button
          onClick={() => {
            setItems(null);
            get<RaProgress>('/pte/ra/progress').then((r) => {
              setIntro(r);
              capTruoc.current = r.progress.unlocked_max;
            }).catch(() => {});
          }}
          class="mt-6 w-full rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink"
        >
          Lượt nữa
        </button>
        <a href="/pte" class="mt-3 block text-center text-[14px] text-vi">Về màn PTE</a>
      </div>
    );
  }

  // --- Dang lam -------------------------------------------------------------
  const item = items[i]!;

  return (
    <div class="flex min-h-[85dvh] flex-col">
      <div class="flex-1 px-5 pt-6">
        <div class="flex items-center justify-between">
          <span class="text-[12.5px] text-vi">
            {CAP_VI[item.level]?.ten} · Bài {i + 1}/{items.length}
          </span>
          <span class="flex items-center gap-3.5 text-[12.5px] text-vi">
            <span>{item.word_count} từ</span>
            {/* Truoc day man nay khong co bat ky duong ra nao luc dang lam bai:
                5 bai lien tiep, muon thoat phai bam nut back cua trinh duyet. */}
            <a href="/pte" class="text-vi">Thoát</a>
          </span>
        </div>

        {/* Van ban goc — Read Aloud PHAI hien, day la bai doc. */}
        <div class="mt-4 rounded-2xl border border-line bg-surface px-4 py-4">
          <p class="text-[17px] leading-relaxed text-en">{item.text}</p>
        </div>

        {!result && (
          <p class="mt-3 text-[12.5px] leading-snug text-vi">
            Đọc to, đều, không dừng giữa chừng. Đọc sót từ nào là mất từ đó.
          </p>
        )}

        {error && (
          <p class="mt-4 rounded-xl bg-bad/10 px-3 py-2.5 text-[13.5px] leading-snug text-bad">
            {error}
          </p>
        )}

        {result && <KetQua r={result} />}
      </div>

      <div class="sticky bottom-0 border-t border-line bg-ink/95 px-4 pb-3 pt-2 backdrop-blur">
        {result ? (
          <button
            onClick={tiep}
            class="mb-2 w-full rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink"
          >
            {i + 1 < items.length ? 'Bài tiếp theo' : 'Xem tổng kết'}
          </button>
        ) : (
          <div class="relative">
            {/* Bo bai: KHONG goi API nen khong ghi gi vao pte_attempts —
                recordPteAttempt chi chay ben trong POST /pte/answer/ra. */}
            {phase === 'idle' && (
              <button
                onClick={tiep}
                class="absolute right-0 top-7 z-10 px-3 py-2.5 text-[13px] text-vi"
              >
                Bỏ bài này ›
              </button>
            )}
          <MicButton
            phase={phase}
            maxSeconds={60}
            hint="Chạm lại khi đọc xong"
            onStateChange={(p) => setPhase((cur) => (cur === 'busy' ? cur : p))}
            onError={(m) => {
              setError(m);
              setPhase('idle');
            }}
            onDone={(blob, mime, duration) => void gui(blob, mime, duration)}
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

function KetQua({ r }: { r: RaResult }) {
  const nhipOk = r.wpm >= GOOD_LOW && r.wpm <= GOOD_HIGH;

  return (
    <div class="mt-4 rounded-2xl border border-line bg-surface p-4">
      <div class="flex items-center justify-between">
        <span
          class={cx(
            'text-[15px] font-medium',
            r.pte_score >= 80 ? 'text-accent' : r.pte_score >= 60 ? 'text-warn' : 'text-bad',
          )}
        >
          {r.correct}/{r.total} từ đúng
        </span>
        <span class="text-[13px] tabular-nums text-vi">{r.pte_score}%</span>
      </div>

      {/* Chi bao nhip noi. CO Y khong goi la diem: app khong cham duoc Oral Fluency. */}
      <div class="mt-3.5 grid grid-cols-3 gap-2">
        <ChiBao value={String(r.wpm)} label="wpm" sub={`${GOOD_LOW}–${GOOD_HIGH}`} tone={nhipOk ? 'good' : 'warn'} />
        <ChiBao value={String(r.pauses)} label="ngập ngừng" sub={r.longest_pause_s ? `dài nhất ${r.longest_pause_s}s` : '—'} tone={r.pauses <= 2 ? 'good' : 'warn'} />
        <ChiBao value={String(r.filler_count + r.extra_count)} label="thừa" sub={`${r.filler_count} đệm`} tone={r.filler_count + r.extra_count <= 2 ? 'good' : 'warn'} />
      </div>

      <div class="mt-3.5 flex flex-wrap gap-1.5">
        {r.words.map((w, k) => (
          <span key={k} class={cx('rounded px-1.5 py-0.5 text-[14px]', STATUS_CLASS[w.status])}>
            {w.target}
            {w.status === 'ending' && w.said && (
              <sub class="ml-0.5 text-[10px] opacity-80">{w.said}</sub>
            )}
          </span>
        ))}
      </div>

      {r.dropped_endings > 0 && (
        <p class="mt-3 rounded-lg bg-warn/10 px-3 py-2 text-[12.5px] leading-snug text-warn">
          Rụng {r.dropped_endings} đuôi từ (ô vàng). PTE tính đó là <b>sai từ</b>, không phải lỗi nhỏ.
        </p>
      )}

      {/* raw_score bay rieng: doc dung het nhung may nghe khong chac thi
          correct/total van 100 trong khi raw tut han. Hai con so, hai y nghia. */}
      {r.raw_score < r.pte_score - 10 && (
        <p class="mt-2.5 rounded-lg bg-warn/10 px-3 py-2 text-[12.5px] leading-snug text-warn">
          Máy nghe ra đúng từ nhưng <b>không chắc</b> (độ rõ {r.raw_score}%). Thường là do đọc nhanh,
          nhỏ, hoặc nuốt âm cuối.
        </p>
      )}

      {r.transcript && (
        <p class="mt-2.5 text-[12.5px] leading-snug text-vi">
          Máy nghe thành: <span class="text-en-dim">{r.transcript}</span>
        </p>
      )}
    </div>
  );
}

function ChiBao({
  value,
  label,
  sub,
  tone,
}: {
  value: string;
  label: string;
  sub: string;
  tone: 'good' | 'warn';
}) {
  return (
    <div class="rounded-xl bg-ink/40 px-2.5 py-2.5 text-center">
      <p class={cx('text-[19px] font-semibold leading-none tabular-nums', tone === 'good' ? 'text-accent' : 'text-warn')}>
        {value}
      </p>
      <p class="mt-1 text-[11px] text-vi">{label}</p>
      <p class="text-[10.5px] text-vi/70">{sub}</p>
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
