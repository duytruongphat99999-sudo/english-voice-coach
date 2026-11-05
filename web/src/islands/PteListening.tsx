import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import MicButton, { type MicPhase } from './MicButton';
import {
  get,
  post,
  postForm,
  ApiError,
  type ListeningItems,
  type ListeningProgress,
  type ListeningResult,
  type ListeningType,
  type ListeningView,
} from '../lib/api';
import { extFor } from '../lib/recorder';
import { qp } from '../lib/qs';
import { cx } from '../lib/cx';

/**
 * PTE Nghe — bay dang may cham duoc (them 12/09).
 *
 * Bai nghe KHONG hien chu truoc khi nop (tru fibl da duc o va hiw ban tren man)
 * — server khong gui. Moi bai la mot component rieng co `key` = id bai.
 *
 * De that chi cho nghe MOT lan. O day cho nghe lai (dang hoc), nhung dem so lan
 * va nhac, de nguoi hoc tu tap nghe mot lan.
 */

const DANG: Record<ListeningType, { ten: string; en: string; so_cau: string; mo_ta: string; cham: string; ky_nang: string }> = {
  fibl: {
    ten: 'Nghe điền từ',
    en: 'Fill in the Blanks',
    so_cau: '2–3 câu',
    mo_ta: 'Nghe cả đoạn, gõ từ còn thiếu vào từng ô. Viết sai chính tả là mất điểm ô đó.',
    cham: 'Mỗi ô đúng 1 điểm.',
    ky_nang: 'Nghe',
  },
  hiw: {
    ten: 'Tìm từ sai',
    en: 'Highlight Incorrect Words',
    so_cau: '2–3 câu',
    mo_ta: 'Vừa nghe vừa dò chữ trên màn. Bấm vào từ nào máy đọc KHÁC chữ đang hiện.',
    cham: 'Mỗi từ bấm đúng +1, bấm nhầm −1, thấp nhất 0.',
    ky_nang: 'Nghe + Đọc',
  },
  smw: {
    ten: 'Chọn từ còn thiếu',
    en: 'Select Missing Word',
    so_cau: '1–2 câu',
    mo_ta: 'Đoạn nghe bị tiếng bíp thay mất phần cuối. Chọn phần hợp với ý cả đoạn.',
    cham: 'Đúng 1 điểm, sai 0.',
    ky_nang: 'Nghe',
  },
  mcsa_l: {
    ten: 'Chọn một đáp án',
    en: 'Multiple Choice, Single Answer',
    so_cau: '2–3 câu',
    mo_ta: 'Nghe một đoạn giảng ngắn rồi trả lời một câu hỏi. Chỉ một phương án đúng.',
    cham: 'Đúng 1 điểm, sai 0.',
    ky_nang: 'Nghe',
  },
  mcma_l: {
    ten: 'Chọn nhiều đáp án',
    en: 'Multiple Choice, Multiple Answers',
    so_cau: '2–3 câu',
    mo_ta: 'Chọn mọi phương án đoạn nghe nói RÕ. Chọn bừa là bị trừ điểm.',
    cham: 'Mỗi cái đúng +1, mỗi cái sai −1, thấp nhất 0.',
    ky_nang: 'Nghe',
  },
  hcs: {
    ten: 'Chọn tóm tắt đúng',
    en: 'Highlight Correct Summary',
    so_cau: '2–3 câu',
    mo_ta: 'Nghe xong, chọn đoạn tóm tắt vừa đúng vừa đủ ý chính. Cẩn thận đoạn chỉ nói một chi tiết nhỏ.',
    cham: 'Đúng 1 điểm, sai 0.',
    ky_nang: 'Nghe + Đọc',
  },
  asq: {
    ten: 'Trả lời câu ngắn',
    en: 'Answer Short Question',
    so_cau: '5–6 câu',
    mo_ta: 'Nghe một câu hỏi, NÓI câu trả lời một đến ba từ. Nói nhanh, rõ — không cần nói cả câu.',
    cham: 'Đúng 1 điểm, sai 0.',
    ky_nang: 'Nghe',
  },
};
const THU_TU: ListeningType[] = ['fibl', 'hiw', 'smw', 'mcsa_l', 'mcma_l', 'hcs', 'asq'];

const CAP_VI: Record<number, { ten: string; mo_ta: string }> = {
  1: { ten: 'Cấp 1', mo_ta: 'Đoạn ngắn, nói chậm, từ dễ' },
  2: { ten: 'Cấp 2', mo_ta: 'Đoạn vừa, văn học thuật' },
  3: { ten: 'Cấp 3', mo_ta: 'Đoạn dài, học thuật dày — sát đề thật' },
};

const N = 5;

function loaiTuUrl(): ListeningType {
  const t = qp('type');
  return THU_TU.includes(t as ListeningType) ? (t as ListeningType) : 'fibl';
}

/** Tieng bip thay phan bi mat cua smw — tu phat bang WebAudio, khong can file. */
function bip() {
  try {
    const Ctx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.value = 0.15;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.7);
    o.onended = () => void ctx.close().catch(() => {});
  } catch {
    /* khong phat duoc bip thi thoi — van lam bai duoc */
  }
}

export default function PteListening() {
  const [type, setType] = useState<ListeningType>(loaiTuUrl);
  const [intro, setIntro] = useState<ListeningProgress | null>(null);
  const [items, setItems] = useState<ListeningView[] | null>(null);
  const [i, setI] = useState(0);
  const [done, setDone] = useState<ListeningResult[]>([]);
  const [loadError, setLoadError] = useState('');
  const capTruoc = useRef(1);

  const taiIntro = () =>
    get<ListeningProgress>('/pte/listening/progress')
      .then(setIntro)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : String(e)));

  useEffect(() => {
    void taiIntro();
  }, []);

  const doiDang = (t: ListeningType) => {
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
    get<ListeningItems>(`/pte/listening/items?type=${type}&level=${level}&n=${N}`)
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
        <p class="text-[17px] font-semibold text-en">Không tải được bài nghe</p>
        <p class="mt-2 text-[14px] text-vi">{loadError}</p>
        <a href="/pte" class="mt-6 inline-block rounded-xl bg-accent px-6 py-3 text-[15px] font-semibold text-ink">
          Về màn PTE
        </a>
      </div>
    );
  }

  if (!items) {
    if (!intro) return <p class="px-5 py-16 text-center text-[14px] text-vi">Đang mở…</p>;
    const t = intro.types.find((x) => x.type === type)!;
    const p = t.progress;
    const d = DANG[type];
    return (
      <div class="px-5 pb-10 pt-8">
        <a href="/pte" class="text-[13px] text-vi">‹ PTE</a>
        <h1 class="mt-3 text-[23px] font-bold text-en">Nghe</h1>
        <p class="mt-1 text-[13.5px] text-vi">Listening · bảy dạng máy chấm được · 🎧 nên đeo tai nghe</p>

        <div class="mt-5 grid grid-cols-2 gap-1.5">
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
            {d.en} · đề thi có {d.so_cau} · tính vào {d.ky_nang}
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
                <li key={r.id} class="flex items-center justify-between rounded-xl border border-line bg-surface px-3.5 py-2.5">
                  <span class="text-[13px] text-vi">
                    {CAP_VI[r.level]?.ten} · {r.item_id}
                  </span>
                  <span class={cx('text-[13px] tabular-nums', r.score >= 80 ? 'text-accent' : r.score >= 60 ? 'text-warn' : 'text-bad')}>
                    {r.correct}/{r.total} · {r.score}%
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p class="mt-7 text-[11.5px] leading-snug text-vi/80">
          Bài nghe chuyển thể từ Wikipedia (CC BY-SA 4.0), đọc bằng giọng máy. Câu hỏi, phương án và từ bị
          thay do Claude soạn, đã cho máy làm mù để kiểm. Giọng máy đều và rõ hơn giọng người trong đề thật.
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

  if (i >= items.length) {
    const tong = done.reduce((a, r) => a + r.total, 0);
    const dung = done.reduce((a, r) => a + r.correct, 0);
    const cuoi = done[done.length - 1];
    const moCap = cuoi && cuoi.progress.unlocked_max > capTruoc.current;
    return (
      <div class="px-5 pb-10 pt-10 text-center">
        <h1 class="text-[22px] font-bold text-en">Xong {items.length} bài</h1>
        <p class="mt-2 text-[14px] text-vi">
          {DANG[type].ten} ·{' '}
          {done.length ? `${dung}/${tong} điểm (${Math.round((dung / Math.max(1, tong)) * 100)}%)` : 'không nộp bài nào'}
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
    <BaiNghe
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

function BaiNghe({
  item,
  stt,
  tong,
  onTiep,
  onThoat,
}: {
  item: ListeningView;
  stt: number;
  tong: number;
  onTiep: (r: ListeningResult | null) => void;
  onThoat: () => void;
}) {
  const soO = item.type === 'fibl' ? Math.max(0, (item.segments?.length ?? 1) - 1) : 0;
  const [ans, setAnsState] = useState<string[]>(() => (item.type === 'fibl' ? new Array<string>(soO).fill('') : []));
  // Ban moi nhat, doc dong bo — hai thao tac sat nhau khong de nhau (xem PteReading).
  const ansR = useRef(ans);
  const setAns = (a: string[]) => {
    ansR.current = a;
    setAnsState(a);
  };
  const [kq, setKq] = useState<ListeningResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [loi, setLoi] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [dangPhat, setDangPhat] = useState(false);
  const [soLan, setSoLan] = useState(0);
  const [mic, setMic] = useState<MicPhase>('idle');
  const [xemBai, setXemBai] = useState(false);
  const player = useRef<HTMLAudioElement | null>(null);

  // Tai audio ngay khi mo bai; thu hoi khi roi bai.
  useEffect(() => {
    let huy = false;
    let url = '';
    fetch(`/api/pte/listening/say/${item.id}`)
      .then((r) => {
        if (r.status === 401) window.location.replace('/login.html');
        if (!r.ok) throw new Error(`Không tải được bài nghe (${r.status})`);
        return r.blob();
      })
      .then((b) => {
        url = URL.createObjectURL(b);
        if (huy) URL.revokeObjectURL(url);
        else setAudioUrl(url);
      })
      .catch((e) => {
        if (!huy) setLoi((e as Error).message);
      });
    return () => {
      huy = true;
      player.current?.pause();
      if (url) URL.revokeObjectURL(url);
    };
  }, []);

  const nghe = () => {
    if (!audioUrl) return;
    player.current?.pause();
    const a = new Audio(audioUrl);
    player.current = a;
    setDangPhat(true);
    setSoLan((n) => n + 1);
    a.onended = () => {
      setDangPhat(false);
      // smw: phan bi mat duoc thay bang tieng bip, dung nhu de that.
      if (item.type === 'smw') bip();
    };
    a.onerror = () => setDangPhat(false);
    void a.play().catch(() => setDangPhat(false));
  };

  const laChon = !!item.choices;
  const coTheNop =
    item.type === 'fibl'
      ? ans.some(Boolean)
      : item.type === 'hiw'
        ? true
        : laChon
          ? ans.length > 0
          : false;

  const nop = async () => {
    if (busy || kq) return;
    setBusy(true);
    setLoi('');
    player.current?.pause();
    try {
      setKq(await post<ListeningResult>('/pte/listening/answer', { id: item.id, answer: ansR.current }));
    } catch (e) {
      setLoi(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const nopGiong = async (blob: Blob, mime: string) => {
    setMic('busy');
    setLoi('');
    const form = new FormData();
    form.append('audio', blob, `asq.${extFor(mime)}`);
    form.append('id', item.id);
    try {
      setKq(await postForm<ListeningResult>('/pte/listening/answer/asq', form));
    } catch (e) {
      setLoi(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setMic('idle');
    }
  };

  const bamPhuongAn = (k: string) => {
    if (kq) return;
    const cu = ansR.current;
    if (!item.multi) setAns([k]);
    else setAns(cu.includes(k) ? cu.filter((x) => x !== k) : [...cu, k]);
  };

  const bamTu = (idx: number) => {
    if (kq) return;
    const s = String(idx);
    const cu = ansR.current;
    setAns(cu.includes(s) ? cu.filter((x) => x !== s) : [...cu, s]);
  };

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
        {/* Nut nghe */}
        <div class="flex items-center gap-3">
          <button
            onClick={nghe}
            disabled={!audioUrl || dangPhat}
            class="rounded-full bg-accent px-5 py-3 text-[15px] font-semibold text-ink disabled:opacity-40"
          >
            {!audioUrl ? 'Đang tải…' : dangPhat ? '🔊 Đang phát…' : soLan === 0 ? '▶ Nghe' : '↻ Nghe lại'}
          </button>
          <span class="text-[12px] leading-snug text-vi">
            {soLan === 0 ? 'Đề thật tự phát và chỉ cho nghe 1 lần.' : `Đã nghe ${soLan} lần · đề thật chỉ 1 lần`}
          </span>
        </div>

        {/* --- fibl --- */}
        {item.type === 'fibl' && (
          <p class="mt-5 text-[16px] leading-[2.2] text-en">
            {(item.segments ?? []).map((s, j, arr) => (
              <Fragment key={j}>
                {s}
                {j < arr.length - 1 &&
                  (kq?.blanks ? (
                    <OKetQua b={kq.blanks[j]!} />
                  ) : (
                    <input
                      value={ans[j]}
                      onInput={(e) => {
                        const a = ansR.current.slice();
                        a[j] = (e.currentTarget as HTMLInputElement).value;
                        setAns(a);
                      }}
                      autocomplete="off"
                      autocapitalize="off"
                      spellcheck={false}
                      class="mx-0.5 w-[7.5rem] rounded-md border border-line bg-ink px-2 py-0.5 text-[15px] text-accent"
                    />
                  ))}
              </Fragment>
            ))}
          </p>
        )}

        {/* --- hiw --- */}
        {item.type === 'hiw' && !kq && (
          <>
            <p class="mb-2 mt-5 text-[12px] text-vi">Bấm vào từ máy đọc KHÁC chữ trên màn. Bấm lại để bỏ.</p>
            <p class="text-[16px] leading-[2.1] text-en">
              {(item.words ?? []).map((w, j) => (
                <Fragment key={j}>
                  {j > 0 && ' '}
                  <span
                    onClick={() => bamTu(j)}
                    class={cx('cursor-pointer rounded px-0.5', ans.includes(String(j)) && 'bg-warn/30 text-warn')}
                  >
                    {w}
                  </span>
                </Fragment>
              ))}
            </p>
          </>
        )}

        {/* --- smw / trac nghiem / hcs --- */}
        {laChon && (
          <>
            <p class="mt-5 text-[15px] font-semibold leading-snug text-en">
              {item.type === 'smw' ? 'Phần bị tiếng bíp thay là gì?' : item.question}
            </p>
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

        {/* --- asq --- */}
        {item.type === 'asq' && !kq && (
          <div class="mt-8">
            <MicButton
              phase={mic}
              maxSeconds={10}
              disabled={soLan === 0}
              hint={soLan === 0 ? 'Bấm ▶ Nghe câu hỏi trước' : 'Nói câu trả lời 1–3 từ'}
              onStateChange={(p) => setMic((cur) => (cur === 'busy' ? cur : p))}
              onError={(m) => {
                setLoi(m);
                setMic('idle');
              }}
              onDone={(blob, mime) => void nopGiong(blob, mime)}
            />
          </div>
        )}

        {kq && <KetQuaNghe r={kq} xemBai={xemBai} onXemBai={() => setXemBai(!xemBai)} />}
        {loi && <p class="mt-4 rounded-xl bg-bad/10 px-3 py-2.5 text-[13.5px] leading-snug text-bad">{loi}</p>}

        {item.source && item.source !== 'authored' && (
          <p class="mt-6 text-[11px] leading-snug text-vi/70">
            Chuyển thể từ{' '}
            <a href={item.source} target="_blank" rel="noopener" class="underline">
              {item.source.includes('simple.wikipedia') ? 'Simple English Wikipedia' : 'Wikipedia'}
            </a>{' '}
            · {item.license}
          </p>
        )}
      </div>

      <div class="sticky bottom-0 border-t border-line bg-ink/95 px-4 pb-3 pt-3 backdrop-blur">
        {kq ? (
          <button onClick={() => onTiep(kq)} class="w-full rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink">
            {stt < tong ? 'Bài tiếp theo' : 'Xem tổng kết'}
          </button>
        ) : (
          <div class="flex gap-2">
            {item.type !== 'asq' && (
              <button
                onClick={() => void nop()}
                disabled={!coTheNop || busy}
                class="flex-1 rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink disabled:opacity-40"
              >
                {busy ? 'Đang chấm…' : 'Nộp bài'}
              </button>
            )}
            <button
              onClick={() => onTiep(null)}
              disabled={busy || mic === 'busy'}
              class={cx('rounded-xl border border-line px-4 py-4 text-[15px] text-vi disabled:opacity-40', item.type === 'asq' && 'flex-1')}
            >
              Bỏ ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function OKetQua({ b }: { b: { typed: string | null; answer: string; ok: boolean } }) {
  if (b.ok) return <span class="mx-0.5 rounded bg-accent/15 px-1.5 py-0.5 font-medium text-accent">{b.answer}</span>;
  return (
    <span class="mx-0.5 inline-flex items-baseline gap-1">
      {b.typed && <span class="rounded bg-bad/15 px-1 text-[14px] text-bad line-through">{b.typed}</span>}
      <span class="rounded bg-accent/15 px-1.5 py-0.5 font-medium text-accent">{b.answer}</span>
    </span>
  );
}

function KetQuaNghe({ r, xemBai, onXemBai }: { r: ListeningResult; xemBai: boolean; onXemBai: () => void }) {
  return (
    <div class="mt-5 rounded-2xl border border-line bg-surface p-4">
      <p class={cx('text-[15px] font-medium', r.pte_score >= 80 ? 'text-accent' : r.pte_score >= 60 ? 'text-warn' : 'text-bad')}>
        {r.correct}/{r.total} điểm · {r.pte_score}%
      </p>

      {r.words && (
        <p class="mt-3 text-[15px] leading-[2] text-en">
          {r.words.map((w, j) => (
            <Fragment key={j}>
              {j > 0 && ' '}
              {w.swapped ? (
                <span class={cx('rounded px-1', w.tapped ? 'bg-accent/20 text-accent' : 'bg-warn/25 text-warn')}>
                  {w.shown} <span class="text-[12px] opacity-80">→ {w.spoken}</span>
                </span>
              ) : (
                <span class={cx(w.tapped && 'rounded bg-bad/20 px-0.5 text-bad line-through')}>{w.shown}</span>
              )}
            </Fragment>
          ))}
        </p>
      )}
      {r.words && (
        <p class="mt-1.5 text-[11.5px] text-vi">Xanh: tìm đúng · cam: bỏ sót · đỏ gạch: bấm nhầm (−1).</p>
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
                {!c.correct && c.chosen && r.type === 'mcma_l' && <span class="ml-1 text-[11.5px] text-bad">(−1)</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {r.type === 'asq' && (
        <div class="mt-2 text-[13.5px] leading-snug">
          <p class="text-en">Câu hỏi: {r.transcript}</p>
          <p class="mt-1 text-vi">
            Máy nghe anh nói: <span class="text-en">{r.heard || '(không nghe thấy gì)'}</span>
          </p>
          <p class="mt-1 text-vi">
            Đáp án: <span class="font-medium text-accent">{(r.accepted ?? []).join(' / ')}</span>
          </p>
        </div>
      )}

      {r.why_vi && <p class="mt-3 rounded-lg bg-accent/10 px-3 py-2 text-[13px] leading-snug text-en">💡 {r.why_vi}</p>}

      {r.type !== 'asq' && (
        <>
          <button onClick={onXemBai} class="mt-3 text-[13px] text-accent">
            {xemBai ? 'Ẩn bài nghe' : 'Xem bài nghe (chữ)'}
          </button>
          {xemBai && <p class="mt-2 text-[14px] leading-relaxed text-en">{r.transcript}</p>}
        </>
      )}
    </div>
  );
}
