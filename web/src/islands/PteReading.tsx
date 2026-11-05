import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  get,
  post,
  ApiError,
  type ReadingItems,
  type ReadingProgress,
  type ReadingResult,
  type ReadingType,
  type ReadingView,
} from '../lib/api';
import { qp } from '../lib/qs';
import { cx } from '../lib/cx';

/**
 * PTE Doc — ba dang may cham duoc hoan toan (them 11/09).
 *
 * Dap an KHONG co tren client truoc khi nop: server chi gui kho chu / lua chon /
 * doan van da xao (xem api/src/pte-reading.ts). Moi bai la mot component rieng
 * co `key` = id bai, nen state bai cu khong bao gio lot sang bai moi.
 *
 * Hai dang trac nghiem Doc chua co: phai viet cau hoi moi, trai quyet dinh
 * 06/09 "trich nguon mo, khong de LLM sinh de".
 */

const DANG: Record<ReadingType, { ten: string; en: string; so_cau: string; mo_ta: string; cham: string }> = {
  rwfib: {
    ten: 'Điền từ (chọn)',
    en: 'Reading & Writing: Fill in the Blanks',
    so_cau: '5–6 câu',
    mo_ta: 'Mỗi ô trống chọn một từ trong danh sách. Đọc cả câu: nghĩa, ngữ pháp, và từ nào hay đi liền với từ nào.',
    cham: 'Mỗi ô đúng 1 điểm.',
  },
  rfib: {
    ten: 'Điền từ (kéo thả)',
    en: 'Reading: Fill in the Blanks',
    so_cau: '4–5 câu',
    mo_ta: 'Kho chữ có thừa vài từ. Bấm một ô trống rồi bấm từ để điền; bấm lại ô đã điền để gỡ ra.',
    cham: 'Mỗi ô đúng 1 điểm.',
  },
  rop: {
    ten: 'Sắp xếp đoạn',
    en: 'Re-order Paragraphs',
    so_cau: '2–3 câu',
    mo_ta: 'Các câu bị xáo. Bấm lần lượt theo thứ tự đúng. Tìm câu mở đầu trước — câu không nhắc lại gì của câu khác.',
    cham: 'Mỗi cặp liền nhau đúng thứ tự được 1 điểm.',
  },
  // Them 12/09.
  mcsa_r: {
    ten: 'Chọn một đáp án',
    en: 'Multiple Choice, Single Answer',
    so_cau: '2–3 câu',
    mo_ta: 'Đọc đoạn văn, trả lời một câu hỏi. Chỉ một phương án đúng — loại dần những cái bài không nói tới.',
    cham: 'Đúng 1 điểm, sai 0.',
  },
  mcma_r: {
    ten: 'Chọn nhiều đáp án',
    en: 'Multiple Choice, Multiple Answers',
    so_cau: '2–3 câu',
    mo_ta: 'Có từ hai phương án đúng trở lên. Chỉ chọn cái bài viết nói RÕ — chọn bừa là bị trừ điểm.',
    cham: 'Mỗi cái đúng +1, mỗi cái sai −1, thấp nhất 0.',
  },
};
const THU_TU: ReadingType[] = ['rwfib', 'rfib', 'rop', 'mcsa_r', 'mcma_r'];

const CAP_VI: Record<number, { ten: string; mo_ta: string }> = {
  1: { ten: 'Cấp 1', mo_ta: 'Đoạn ngắn, câu đơn giản' },
  2: { ten: 'Cấp 2', mo_ta: 'Đoạn vừa, văn học thuật' },
  3: { ten: 'Cấp 3', mo_ta: 'Đoạn dài, học thuật dày — sát đề thật' },
};

const N = 5;

function loaiTuUrl(): ReadingType {
  const t = qp('type');
  return THU_TU.includes(t as ReadingType) ? (t as ReadingType) : 'rwfib';
}

export default function PteReading() {
  const [type, setType] = useState<ReadingType>(loaiTuUrl);
  const [intro, setIntro] = useState<ReadingProgress | null>(null);
  const [items, setItems] = useState<ReadingView[] | null>(null);
  const [i, setI] = useState(0);
  const [done, setDone] = useState<ReadingResult[]>([]);
  const [loadError, setLoadError] = useState('');
  // Cap do TRUOC luot nay, de biet co vua mo cap moi khong.
  const capTruoc = useRef(1);

  const taiIntro = () =>
    get<ReadingProgress>('/pte/reading/progress')
      .then(setIntro)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : String(e)));

  useEffect(() => {
    void taiIntro();
  }, []);

  const doiDang = (t: ReadingType) => {
    setType(t);
    setItems(null);
    try {
      history.replaceState(null, '', `?type=${t}`);
    } catch {
      /* khong doi duoc URL cung khong sao */
    }
  };

  const batDau = (level: number) => {
    setItems(null);
    setI(0);
    setDone([]);
    get<ReadingItems>(`/pte/reading/items?type=${type}&level=${level}&n=${N}`)
      .then((r) => {
        capTruoc.current = r.progress.unlocked_max;
        setItems(r.items);
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : String(e)));
  };

  const veIntro = () => {
    setItems(null);
    void taiIntro();
  };

  if (loadError) {
    return (
      <div class="px-8 py-24 text-center">
        <p class="text-[17px] font-semibold text-en">Không tải được bài đọc</p>
        <p class="mt-2 text-[14px] text-vi">{loadError}</p>
        <a href="/pte" class="mt-6 inline-block rounded-xl bg-accent px-6 py-3 text-[15px] font-semibold text-ink">
          Về màn PTE
        </a>
      </div>
    );
  }

  // --- Man mo dau: chon dang + cap ------------------------------------------
  if (!items) {
    if (!intro) return <p class="px-5 py-16 text-center text-[14px] text-vi">Đang mở…</p>;
    const t = intro.types.find((x) => x.type === type)!;
    const p = t.progress;
    const d = DANG[type];
    return (
      <div class="px-5 pb-10 pt-8">
        <a href="/pte" class="text-[13px] text-vi">‹ PTE</a>
        <h1 class="mt-3 text-[23px] font-bold text-en">Đọc</h1>
        <p class="mt-1 text-[13.5px] text-vi">Reading · ba dạng máy chấm được</p>

        <div class="mt-5 grid grid-cols-3 gap-1.5">
          {THU_TU.map((k) => (
            <button
              key={k}
              onClick={() => doiDang(k)}
              class={cx(
                'rounded-lg border px-2 py-2 text-[12.5px] leading-tight',
                k === type ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-line text-vi',
              )}
            >
              {DANG[k].ten}
            </button>
          ))}
        </div>

        <div class="mt-4 rounded-2xl border border-line bg-surface px-4 py-4">
          <p class="text-[15px] font-semibold text-en">{d.ten}</p>
          <p class="text-[12px] text-vi">
            {d.en} · đề thi có {d.so_cau} · chỉ tính phần Đọc
          </p>
          <p class="mt-2 text-[13.5px] leading-snug text-vi">{d.mo_ta}</p>
          <p class="mt-1.5 text-[12.5px] text-vi">Chấm như Pearson: {d.cham}</p>
        </div>

        <div class="mt-3 rounded-2xl border border-line bg-surface px-4 py-3">
          <p class="text-[13px] text-vi">
            Đang ở <b class="text-en">{CAP_VI[p.unlocked_max]?.ten}</b>
            {p.done > 0 && <> · trung bình {p.avg}%</>}
          </p>
          {p.unlocked_max < intro.max_level && (
            <p class="mt-1 text-[12.5px] leading-snug text-vi">
              {p.need > 0
                ? `Làm thêm ${p.need} bài ở cấp này, giữ trung bình từ 80% trở lên thì mở cấp sau.`
                : p.avg >= 80
                  ? 'Đủ điều kiện — bài tiếp theo sẽ mở cấp mới.'
                  : `Trung bình đang ${p.avg}%, cần từ 80% mới lên cấp.`}
            </p>
          )}
        </div>

        <h2 class="mb-2.5 mt-6 text-[12px] uppercase tracking-wide text-vi">Chọn cấp</h2>
        <div class="flex flex-col gap-2">
          {t.bank.map((b) => {
            const khoa = b.level > p.unlocked_max;
            return (
              <button
                key={b.level}
                onClick={() => !khoa && b.n > 0 && batDau(b.level)}
                disabled={khoa || b.n === 0}
                class={cx(
                  'flex items-center justify-between rounded-xl border px-4 py-3.5 text-left',
                  khoa || b.n === 0 ? 'border-line bg-surface/50 opacity-45' : 'border-line bg-surface',
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

        {t.recent.length > 0 && (
          <section class="mt-7">
            <h2 class="mb-2.5 text-[12px] uppercase tracking-wide text-vi">Lần trước</h2>
            <ul class="flex flex-col gap-1.5">
              {t.recent.map((r) => (
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

        <p class="mt-7 text-[11.5px] leading-snug text-vi/80">
          Bài đọc chuyển thể từ Wikipedia (CC BY-SA 4.0). Ba dạng điền từ / sắp xếp: đáp án là chính chữ
          của bài gốc. Hai dạng trắc nghiệm: câu hỏi do Claude soạn, mỗi câu đã cho máy làm mù (không
          thấy đáp án) để chắc chỉ có một cách hiểu.
        </p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div class="px-8 py-24 text-center">
        <p class="text-[17px] font-semibold text-en">Cấp này chưa có đề</p>
        <button onClick={veIntro} class="mt-6 rounded-xl bg-accent px-6 py-3 text-[15px] font-semibold text-ink">
          Quay lại
        </button>
      </div>
    );
  }

  // --- Xong ca luot ---------------------------------------------------------
  if (i >= items.length) {
    const tong = done.reduce((a, r) => a + r.total, 0);
    const dung = done.reduce((a, r) => a + r.correct, 0);
    const cuoi = done[done.length - 1];
    const moCap = cuoi && cuoi.progress.unlocked_max > capTruoc.current;
    return (
      <div class="px-5 pb-10 pt-10 text-center">
        <h1 class="text-[22px] font-bold text-en">Xong {items.length} bài</h1>
        <p class="mt-2 text-[14px] text-vi">
          {DANG[type].ten} · {done.length ? `${dung}/${tong} điểm (${Math.round((dung / Math.max(1, tong)) * 100)}%)` : 'không nộp bài nào'}
        </p>
        {moCap && (
          <p class="mt-4 rounded-xl bg-accent/10 px-4 py-3 text-[14px] font-medium text-accent">
            🎉 Vừa mở {CAP_VI[cuoi.progress.unlocked_max]?.ten}
          </p>
        )}
        <button onClick={veIntro} class="mt-8 w-full rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink">
          Làm tiếp
        </button>
        <a href="/pte" class="mt-3 block w-full py-2 text-[14px] text-vi">
          Về màn PTE
        </a>
      </div>
    );
  }

  const item = items[i]!;
  return (
    <BaiDoc
      key={item.id}
      item={item}
      stt={i + 1}
      tong={items.length}
      onTiep={(r) => {
        if (r) setDone((d) => [...d, r]);
        setI(i + 1);
      }}
      onThoat={veIntro}
    />
  );
}

// ---------------------------------------------------------------------------

function BaiDoc({
  item,
  stt,
  tong,
  onTiep,
  onThoat,
}: {
  item: ReadingView;
  stt: number;
  tong: number;
  onTiep: (r: ReadingResult | null) => void;
  onThoat: () => void;
}) {
  const laTracNghiem = item.type === 'mcsa_r' || item.type === 'mcma_r';
  const soO = item.type === 'rop' || laTracNghiem ? 0 : Math.max(0, (item.segments?.length ?? 1) - 1);
  // FIB: chu da dien cho tung o ('' = trong). rop: nhan doan theo thu tu da xep.
  const [ans, setAnsState] = useState<string[]>(() => (item.type === 'rop' ? [] : new Array<string>(soO).fill('')));
  const [sel, setSelState] = useState(0);
  // Ban MOI NHAT cua bai lam, doc dong bo. Hai thao tac sat nhau (cham nhanh hai
  // lan truoc khi ve lai) ma doc `ans` tu closure thi thao tac sau ghi de thao
  // tac truoc — da bat duoc khi thu 11/09.
  const ansR = useRef(ans);
  const selR = useRef(sel);
  const setAns = (a: string[]) => {
    ansR.current = a;
    setAnsState(a);
  };
  const setSel = (j: number) => {
    selR.current = j;
    setSelState(j);
  };
  const [kq, setKq] = useState<ReadingResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [loi, setLoi] = useState('');

  const conTrong = laTracNghiem
    ? 0
    : item.type === 'rop'
      ? (item.paragraphs?.length ?? 0) - ans.length
      : ans.filter((x) => !x).length;
  const coTheNop = laTracNghiem ? ans.length > 0 : item.type === 'rop' ? conTrong === 0 : conTrong < soO;

  /** Trac nghiem: chon mot thi thay, chon nhieu thi bat/tat. */
  const bamPhuongAn = (k: string) => {
    if (kq) return;
    const cu = ansR.current;
    if (!item.multi) setAns([k]);
    else setAns(cu.includes(k) ? cu.filter((x) => x !== k) : [...cu, k]);
  };

  const nop = async () => {
    if (busy || kq) return;
    setBusy(true);
    setLoi('');
    try {
      setKq(await post<ReadingResult>('/pte/reading/answer', { id: item.id, answer: ans }));
    } catch (e) {
      setLoi(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // --- rfib: bam o roi bam tu --------------------------------------------------
  const oTrongDau = (a: string[], tu = 0) => {
    for (let k = 0; k < a.length; k += 1) if (!a[(tu + k) % a.length]) return (tu + k) % a.length;
    return -1;
  };
  const bamO = (j: number) => {
    if (kq) return;
    if (ansR.current[j]) {
      const a = ansR.current.slice();
      a[j] = '';
      setAns(a);
    }
    setSel(j);
  };
  const bamTu = (w: string) => {
    const cu = ansR.current;
    if (kq || cu.includes(w)) return;
    const dich = !cu[selR.current] ? selR.current : oTrongDau(cu, selR.current);
    if (dich < 0) return;
    const a = cu.slice();
    a[dich] = w;
    setAns(a);
    const sau = oTrongDau(a, dich);
    if (sau >= 0) setSel(sau);
  };

  const segs = item.segments ?? [];
  const byKey = new Map((item.paragraphs ?? []).map((p) => [p.key, p.text]));

  return (
    <div class="flex min-h-[85dvh] flex-col">
      <header class="flex items-center justify-between border-b border-line px-4 py-3">
        <span class="text-[13px] text-vi">
          {DANG[item.type].ten} · {CAP_VI[item.level]?.ten} · Bài {stt}/{tong}
        </span>
        <button onClick={onThoat} class="text-[13px] text-vi">
          Thoát
        </button>
      </header>

      <div class="flex-1 px-5 pb-6 pt-5">
        {item.topic && <p class="mb-2 text-[11.5px] uppercase tracking-wide text-vi">{item.topic}</p>}

        {/* --- Trac nghiem (them 12/09) --- */}
        {laTracNghiem && (
          <>
            <p class="text-[15.5px] leading-relaxed text-en">{item.text}</p>
            <p class="mt-4 text-[15px] font-semibold leading-snug text-en">{item.question}</p>
            <p class="mt-1 text-[12px] text-vi">
              {item.multi ? 'Chọn tất cả phương án đúng — chọn sai bị trừ 1 điểm.' : 'Chọn một phương án.'}
            </p>
            {!kq && (
              <ul class="mt-3 flex flex-col gap-2">
                {(item.choices ?? []).map((c) => {
                  const chon = ans.includes(c.key);
                  return (
                    <li key={c.key}>
                      <button
                        onClick={() => bamPhuongAn(c.key)}
                        class={cx(
                          'flex w-full gap-2.5 rounded-xl border px-3.5 py-3 text-left text-[14.5px] leading-snug',
                          chon ? 'border-accent bg-accent/10 text-en' : 'border-line bg-surface text-en',
                        )}
                      >
                        <span class={cx('shrink-0 text-accent', !chon && 'text-vi/50')}>
                          {item.multi ? (chon ? '☑' : '☐') : chon ? '◉' : '○'}
                        </span>
                        <span>{c.text}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        {/* --- Dien tu (chon / keo tha) --- */}
        {(item.type === 'rwfib' || item.type === 'rfib') && (
          <p class="text-[16px] leading-[2.15] text-en">
            {segs.map((s, j) => (
              <Fragment key={j}>
                {s}
                {j < segs.length - 1 &&
                  (kq?.blanks ? (
                    <OKetQua b={kq.blanks[j]!} />
                  ) : item.type === 'rwfib' ? (
                    <select
                      value={ans[j]}
                      onChange={(e) => {
                        const a = ansR.current.slice();
                        a[j] = (e.currentTarget as HTMLSelectElement).value;
                        setAns(a);
                      }}
                      class={cx(
                        'mx-0.5 rounded-md border bg-ink px-1.5 py-0.5 text-[15px]',
                        ans[j] ? 'border-accent/60 text-accent' : 'border-line text-vi',
                      )}
                    >
                      <option value="">— chọn —</option>
                      {(item.options?.[j] ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <button
                      onClick={() => bamO(j)}
                      class={cx(
                        'mx-0.5 inline-block min-w-[4.5rem] rounded-md border px-2 py-0 text-[15px] leading-7',
                        sel === j ? 'border-accent bg-accent/10' : 'border-line',
                        ans[j] ? 'text-accent' : 'text-vi/40',
                      )}
                    >
                      {ans[j] || `ô ${j + 1}`}
                    </button>
                  ))}
              </Fragment>
            ))}
          </p>
        )}

        {item.type === 'rfib' && !kq && (
          <div class="mt-5 rounded-xl border border-line bg-surface p-3">
            <p class="mb-2 text-[11.5px] text-vi">Kho chữ — bấm để điền vào ô đang chọn</p>
            <div class="flex flex-wrap gap-2">
              {(item.bank ?? []).map((w) => {
                const daDung = ans.includes(w);
                return (
                  <button
                    key={w}
                    onClick={() => bamTu(w)}
                    disabled={daDung}
                    class={cx(
                      'rounded-lg border px-3 py-2 text-[15px]',
                      daDung ? 'border-line/40 text-vi/30' : 'border-line bg-ink text-en active:bg-surface-2',
                    )}
                  >
                    {w}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* --- Sap xep doan --- */}
        {item.type === 'rop' && !kq && (
          <>
            <p class="mb-2 text-[11.5px] uppercase tracking-wide text-vi">Thứ tự của anh</p>
            {ans.length === 0 ? (
              <p class="rounded-xl border border-dashed border-line px-4 py-3 text-[13px] text-vi">
                Bấm câu mở đầu ở dưới trước.
              </p>
            ) : (
              <ol class="flex flex-col gap-2">
                {ans.map((k, t) => (
                  <li key={k}>
                    <button
                      onClick={() => setAns(ansR.current.filter((x) => x !== k))}
                      class="flex w-full gap-2.5 rounded-xl border border-accent/50 bg-accent/5 px-3.5 py-3 text-left"
                    >
                      <span class="shrink-0 text-[14px] font-semibold tabular-nums text-accent">{t + 1}</span>
                      <span class="text-[14.5px] leading-snug text-en">{byKey.get(k)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {conTrong > 0 && (
              <>
                <p class="mb-2 mt-5 text-[11.5px] uppercase tracking-wide text-vi">Chưa xếp · bấm theo thứ tự đúng</p>
                <ul class="flex flex-col gap-2">
                  {(item.paragraphs ?? [])
                    .filter((p) => !ans.includes(p.key))
                    .map((p) => (
                      <li key={p.key}>
                        <button
                          onClick={() => {
                            if (!ansR.current.includes(p.key)) setAns([...ansR.current, p.key]);
                          }}
                          class="w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-left text-[14.5px] leading-snug text-en active:bg-surface-2"
                        >
                          {p.text}
                        </button>
                      </li>
                    ))}
                </ul>
              </>
            )}
            {ans.length > 0 && <p class="mt-2 text-[11.5px] text-vi">Bấm một câu đã xếp để gỡ nó ra.</p>}
          </>
        )}

        {kq && <KetQuaDoc r={kq} />}
        {loi && <p class="mt-4 rounded-xl bg-bad/10 px-3 py-2.5 text-[13.5px] leading-snug text-bad">{loi}</p>}

        <p class="mt-6 text-[11px] leading-snug text-vi/70">
          Chuyển thể từ{' '}
          <a href={item.source} target="_blank" rel="noopener" class="underline">
            {item.source.includes('simple.wikipedia') ? 'Simple English Wikipedia' : 'Wikipedia'}
          </a>{' '}
          · {item.license}
        </p>
      </div>

      <div class="sticky bottom-0 border-t border-line bg-ink/95 px-4 pb-3 pt-3 backdrop-blur">
        {kq ? (
          <button
            onClick={() => onTiep(kq)}
            class="w-full rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink"
          >
            {stt < tong ? 'Bài tiếp theo' : 'Xem tổng kết'}
          </button>
        ) : (
          <div class="flex gap-2">
            <button
              onClick={() => void nop()}
              disabled={!coTheNop || busy}
              class="flex-1 rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink disabled:opacity-40"
            >
              {busy ? 'Đang chấm…' : conTrong > 0 && item.type !== 'rop' ? `Nộp (còn ${conTrong} ô trống)` : 'Nộp bài'}
            </button>
            <button
              onClick={() => onTiep(null)}
              disabled={busy}
              class="rounded-xl border border-line px-4 py-4 text-[15px] text-vi disabled:opacity-40"
            >
              Bỏ ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function OKetQua({ b }: { b: { chosen: string | null; answer: string; ok: boolean } }) {
  if (b.ok) return <span class="mx-0.5 rounded bg-accent/15 px-1.5 py-0.5 font-medium text-accent">{b.answer}</span>;
  return (
    <span class="mx-0.5 inline-flex items-baseline gap-1">
      {b.chosen && <span class="rounded bg-bad/15 px-1 text-[14px] text-bad line-through">{b.chosen}</span>}
      <span class="rounded bg-accent/15 px-1.5 py-0.5 font-medium text-accent">{b.answer}</span>
    </span>
  );
}

function KetQuaDoc({ r }: { r: ReadingResult }) {
  return (
    <div class="mt-5 rounded-2xl border border-line bg-surface p-4">
      <p
        class={cx(
          'text-[15px] font-medium',
          r.pte_score >= 80 ? 'text-accent' : r.pte_score >= 60 ? 'text-warn' : 'text-bad',
        )}
      >
        {r.correct}/{r.total} điểm · {r.pte_score}%
      </p>

      {r.your_order && r.correct_order && (
        <>
          <p class="mb-1.5 mt-3 text-[11.5px] uppercase tracking-wide text-vi">Anh xếp</p>
          <ol class="flex flex-col">
            {r.your_order.map((x, t) => (
              <li key={t}>
                <p class="rounded-lg border border-line px-3 py-2 text-[13.5px] leading-snug text-en">{x.text}</p>
                {x.pair_ok !== null && (
                  <p class={cx('py-0.5 pl-3 text-[12px]', x.pair_ok ? 'text-accent' : 'text-bad')}>
                    {x.pair_ok ? '✓ nối đúng' : '✗ câu sau không nối tiếp câu này'}
                  </p>
                )}
              </li>
            ))}
          </ol>
          {r.correct < r.total && (
            <>
              <p class="mb-1.5 mt-4 text-[11.5px] uppercase tracking-wide text-vi">Thứ tự đúng</p>
              <ol class="flex flex-col gap-1.5">
                {r.correct_order.map((text, t) => (
                  <li key={t} class="flex gap-2 text-[13.5px] leading-snug text-en">
                    <span class="shrink-0 font-semibold tabular-nums text-accent">{t + 1}</span>
                    <span>{text}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}

      {r.choices && (
        <ul class="mt-3 flex flex-col gap-1.5">
          {r.choices.map((c, t) => (
            <li
              key={t}
              class={cx(
                'flex gap-2 rounded-lg border px-3 py-2 text-[13.5px] leading-snug',
                c.correct && c.chosen
                  ? 'border-accent/60 bg-accent/10 text-en'
                  : c.correct
                    ? 'border-accent/40 text-en'
                    : c.chosen
                      ? 'border-bad/50 bg-bad/10 text-en'
                      : 'border-line text-vi',
              )}
            >
              <span class={cx('shrink-0', c.correct ? 'text-accent' : c.chosen ? 'text-bad' : 'text-vi/50')}>
                {c.correct && c.chosen ? '✓' : c.correct ? '○' : c.chosen ? '✗' : '·'}
              </span>
              <span>
                {c.text}
                {c.correct && !c.chosen && <span class="ml-1 text-[11.5px] text-accent">(đáp án đúng)</span>}
                {!c.correct && c.chosen && r.type === 'mcma_r' && <span class="ml-1 text-[11.5px] text-bad">(−1)</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {r.why_vi && (
        <p class="mt-3 rounded-lg bg-accent/10 px-3 py-2 text-[13px] leading-snug text-en">💡 {r.why_vi}</p>
      )}

      {r.blanks && r.correct < r.total && (
        <p class="mt-2 text-[12.5px] leading-snug text-vi">
          Chữ gạch đỏ là chữ anh chọn, chữ xanh là chữ trong bài gốc. Đọc lại cả câu xem vì sao chỉ chữ xanh
          khớp — thường do từ đi liền (collocation) hoặc ngữ pháp.
        </p>
      )}
    </div>
  );
}
