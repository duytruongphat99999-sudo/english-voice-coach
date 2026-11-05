import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import MicButton, { type MicPhase } from './MicButton';
import {
  get,
  post,
  postForm,
  ApiError,
  type OpenChart,
  type OpenItems,
  type OpenProgress,
  type OpenResult,
  type OpenType,
  type OpenView,
} from '../lib/api';
import { extFor } from '../lib/recorder';
import { qp } from '../lib/qs';
import { cx } from '../lib/cx';

/**
 * PTE Noi / Viet co nguoi cham noi dung (them 12/09).
 *
 * ⚠️ Diem o day la UOC LUONG cua AI (Gemini) theo DUNG mo ta thang cham trong
 * Score Guide 07/2025 — KHONG phai diem PTE. Rieng Form (dem tu, mot cau) thi
 * app tu cham chinh xac. Phat am + do troi chay: app KHONG cham duoc.
 */

const DANG: Record<OpenType, { ten: string; en: string; so_cau: string; mo_ta: string; ky_nang: string; viet: boolean }> = {
  di: { ten: 'Mô tả hình', en: 'Describe Image', so_cau: '5–6 câu', mo_ta: 'Nhìn biểu đồ 25 giây rồi nói 40 giây: xu hướng chính, cao nhất / thấp nhất, một hai so sánh — nói đúng số trong hình.', ky_nang: 'Nói', viet: false },
  rl: { ten: 'Kể lại bài giảng', en: 'Retell Lecture', so_cau: '2–3 câu', mo_ta: 'Nghe bài giảng, ghi vài chữ khoá, chuẩn bị 10 giây rồi kể lại 40 giây bằng lời của mình.', ky_nang: 'Nghe + Nói', viet: false },
  rts: { ten: 'Ứng xử tình huống', en: 'Respond to a Situation', so_cau: '2–3 câu', mo_ta: 'Đọc và nghe tình huống, chuẩn bị 20 giây rồi nói 40 giây như đang nói với người đó thật.', ky_nang: 'Nói', viet: false },
  sgd: { ten: 'Tóm tắt thảo luận nhóm', en: 'Summarize Group Discussion', so_cau: '2–3 câu', mo_ta: 'Nghe ba người bàn một chủ đề, rồi tóm tắt bằng lời trong 2 phút: ai nghĩ gì, chỗ nào đồng ý, chỗ nào không.', ky_nang: 'Nghe + Nói', viet: false },
  swt: { ten: 'Tóm tắt bài đọc', en: 'Summarize Written Text', so_cau: '2 câu', mo_ta: 'Đọc đoạn văn, viết MỘT câu duy nhất 5–75 từ nêu ý chính. Trong 10 phút.', ky_nang: 'Đọc + Viết', viet: true },
  sst: { ten: 'Tóm tắt bài nghe', en: 'Summarize Spoken Text', so_cau: '1 câu', mo_ta: 'Nghe bài giảng, viết tóm tắt 50–70 từ trong 10 phút.', ky_nang: 'Nghe + Viết', viet: true },
  we: { ten: 'Viết luận', en: 'Write Essay', so_cau: '1 câu', mo_ta: 'Viết bài 200–300 từ trong 20 phút: mở bài nêu quan điểm, hai ba đoạn lý lẽ có ví dụ, kết luận.', ky_nang: 'Viết', viet: true },
};
const THU_TU: OpenType[] = ['di', 'rl', 'rts', 'sgd', 'swt', 'sst', 'we'];

const CAP_VI: Record<number, { ten: string; mo_ta: string }> = {
  1: { ten: 'Cấp 1', mo_ta: 'Đề ngắn, chủ đề quen' },
  2: { ten: 'Cấp 2', mo_ta: 'Đề vừa, văn học thuật' },
  3: { ten: 'Cấp 3', mo_ta: 'Đề dài, học thuật dày — sát đề thật' },
};

const N = 3;

function loaiTuUrl(): OpenType {
  const t = qp('type');
  return THU_TU.includes(t as OpenType) ? (t as OpenType) : 'di';
}

/** Dem tu giong server (pte-open.ts demTu) — chi de hien goi y, server moi cham that. */
function demTu(s: string): number {
  return s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

function goiYForm(type: OpenType, text: string): { ok: 'tot' | 'vua' | 'hong'; chu: string } {
  const n = demTu(text);
  if (type === 'swt') {
    const nhieuCau = /[.!?]["')\]]?\s+\S/.test(text.trim());
    if (nhieuCau) return { ok: 'hong', chu: `${n} từ · đang có hơn một câu` };
    return n >= 5 && n <= 75 ? { ok: 'tot', chu: `${n} từ · một câu` } : { ok: 'hong', chu: `${n} từ · cần 5–75` };
  }
  if (type === 'we') {
    if (n >= 200 && n <= 300) return { ok: 'tot', chu: `${n} từ · đạt 200–300` };
    if ((n >= 120 && n <= 199) || (n >= 301 && n <= 380)) return { ok: 'vua', chu: `${n} từ · mất 1 điểm Form` };
    return { ok: 'hong', chu: `${n} từ · cần 200–300` };
  }
  if (n >= 50 && n <= 70) return { ok: 'tot', chu: `${n} từ · đạt 50–70` };
  if ((n >= 40 && n <= 49) || (n >= 71 && n <= 100)) return { ok: 'vua', chu: `${n} từ · mất 1 điểm Form` };
  return { ok: 'hong', chu: `${n} từ · cần 50–70` };
}

export default function PteOpen() {
  const [type, setType] = useState<OpenType>(loaiTuUrl);
  const [intro, setIntro] = useState<OpenProgress | null>(null);
  const [items, setItems] = useState<OpenView[] | null>(null);
  const [i, setI] = useState(0);
  const [done, setDone] = useState<OpenResult[]>([]);
  const [loadError, setLoadError] = useState('');

  const taiIntro = () =>
    get<OpenProgress>('/pte/open/progress')
      .then(setIntro)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : String(e)));

  useEffect(() => {
    void taiIntro();
  }, []);

  const doiDang = (t: OpenType) => {
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
    get<OpenItems>(`/pte/open/items?type=${type}&level=${level}&n=${N}`)
      .then((r) => setItems(r.items))
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : String(e)));
  };

  const veIntro = () => {
    setItems(null);
    void taiIntro();
  };

  if (loadError) {
    return (
      <div class="px-8 py-24 text-center">
        <p class="text-[17px] font-semibold text-en">Không tải được bài</p>
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
        <h1 class="mt-3 text-[23px] font-bold text-en">Nói &amp; Viết</h1>
        <p class="mt-1 text-[13.5px] text-vi">Bảy dạng có người chấm nội dung · AI góp ý theo thang Pearson</p>

        <p class="mt-4 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-[12.5px] leading-snug text-warn">
          Số điểm ở đây là <b>ước lượng của AI</b> dựa trên đúng mô tả thang chấm của Pearson —{' '}
          <b>không phải điểm PTE</b>. Riêng phần Hình thức (đếm từ) app chấm chính xác. Phát âm và độ trôi
          chảy app không chấm được.
        </p>

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
              {DANG[k].viet ? '✍️ ' : '🎙 '}
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
          <p class="mt-1.5 text-[12px] text-bad">Không học văn mẫu thuộc lòng — Pearson cho Nội dung 0.</p>
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
            <h2 class="mb-2.5 text-[12px] uppercase tracking-wide text-vi">Lần trước (ước lượng AI)</h2>
            <ul class="flex flex-col gap-1.5">
              {t.recent.map((r) => (
                <li key={r.id} class="flex items-center justify-between rounded-xl border border-line bg-surface px-3.5 py-2.5">
                  <span class="text-[13px] text-vi">
                    {CAP_VI[r.level]?.ten} · {r.item_id}
                  </span>
                  <span class={cx('text-[13px] tabular-nums', r.score >= 80 ? 'text-accent' : r.score >= 60 ? 'text-warn' : 'text-bad')}>
                    {r.correct}/{r.total}
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
    return (
      <div class="px-5 pb-10 pt-10 text-center">
        <h1 class="text-[22px] font-bold text-en">Xong {items.length} bài</h1>
        <p class="mt-2 text-[14px] text-vi">
          {DANG[type].ten} · đã nộp {done.length} bài
        </p>
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
    <BaiMo
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

function BaiMo({
  item,
  stt,
  tong,
  onTiep,
  onThoat,
}: {
  item: OpenView;
  stt: number;
  tong: number;
  onTiep: (r: OpenResult | null) => void;
  onThoat: () => void;
}) {
  const viet = DANG[item.type].viet;
  const [text, setText] = useState('');
  const [kq, setKq] = useState<OpenResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [loi, setLoi] = useState('');
  const [mic, setMic] = useState<MicPhase>('idle');
  const [soLan, setSoLan] = useState(0);
  const [dangPhat, setDangPhat] = useState(false);
  const [giay, setGiay] = useState(0);
  const player = useRef<HTMLAudioElement | null>(null);
  const dung = useRef(false);
  const banGhi = useRef<{ blob: Blob; mime: string } | null>(null);

  // Dong ho dem tu luc mo bai — chi de biet minh dang cham hay nhanh so voi de that.
  useEffect(() => {
    const t0 = Date.now();
    const h = window.setInterval(() => setGiay(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => {
      window.clearInterval(h);
      dung.current = true;
      player.current?.pause();
    };
  }, []);

  /** Phat audio (sgd: phat lan luot tung luot noi). */
  const nghe = async () => {
    if (dangPhat) return;
    setDangPhat(true);
    setSoLan((n) => n + 1);
    dung.current = false;
    const luot = item.type === 'sgd' ? (item.turns ?? []).map((_, k) => k) : [0];
    try {
      for (const k of luot) {
        if (dung.current) break;
        const r = await fetch(`/api/pte/open/say/${item.id}${item.type === 'sgd' ? `?turn=${k}` : ''}`);
        if (r.status === 401) window.location.replace('/login.html');
        if (!r.ok) throw new Error(`Không tải được audio (${r.status})`);
        const url = URL.createObjectURL(await r.blob());
        await new Promise<void>((res) => {
          const a = new Audio(url);
          player.current = a;
          a.onended = () => res();
          a.onerror = () => res();
          void a.play().catch(() => res());
        });
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      setLoi((e as Error).message);
    } finally {
      setDangPhat(false);
    }
  };

  const nopViet = async () => {
    if (busy || kq || !text.trim()) return;
    setBusy(true);
    setLoi('');
    try {
      setKq(await post<OpenResult>('/pte/open/answer', { id: item.id, text }));
    } catch (e) {
      setLoi(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const nopNoi = async (blob: Blob, mime: string) => {
    banGhi.current = { blob, mime };
    setMic('busy');
    setLoi('');
    const form = new FormData();
    form.append('audio', blob, `open.${extFor(mime)}`);
    form.append('id', item.id);
    try {
      setKq(await postForm<OpenResult>('/pte/open/answer/voice', form));
    } catch (e) {
      setLoi(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setMic('idle');
    }
  };

  const fy = viet ? goiYForm(item.type, text) : null;
  const phutDe = item.timing.minutes;
  const canNghe = item.audio && item.type !== 'rts';

  return (
    <div class="flex min-h-[85dvh] flex-col">
      <header class="flex items-center justify-between border-b border-line px-4 py-3">
        <span class="text-[13px] text-vi">
          {DANG[item.type].ten} · {CAP_VI[item.level]?.ten} · Bài {stt}/{tong}
        </span>
        <span class="flex items-center gap-3 text-[13px] text-vi">
          <span class="tabular-nums">
            {Math.floor(giay / 60)}:{String(giay % 60).padStart(2, '0')}
            {phutDe ? ` / ${phutDe}:00` : ''}
          </span>
          <button onClick={onThoat}>Thoát</button>
        </span>
      </header>

      <div class="flex-1 px-5 pb-6 pt-5">
        {item.topic && <p class="mb-2 text-[11.5px] uppercase tracking-wide text-vi">{item.topic}</p>}

        {item.type === 'di' && item.chart && <ChartSvg c={item.chart} />}
        {item.type === 'swt' && <p class="text-[15px] leading-relaxed text-en">{item.text}</p>}
        {item.type === 'we' && <p class="rounded-xl border border-line bg-surface px-4 py-3 text-[15px] leading-relaxed text-en">{item.prompt}</p>}
        {item.type === 'rts' && (
          <div class="rounded-xl border border-line bg-surface px-4 py-3">
            <p class="text-[15px] leading-relaxed text-en">{item.situation}</p>
            <button onClick={() => void nghe()} disabled={dangPhat} class="mt-2 text-[13px] text-accent disabled:opacity-40">
              {dangPhat ? '🔊 Đang đọc…' : '▶ Nghe tình huống'}
            </button>
          </div>
        )}

        {canNghe && (
          <div class="flex items-center gap-3">
            <button
              onClick={() => void nghe()}
              disabled={dangPhat}
              class="rounded-full bg-accent px-5 py-3 text-[15px] font-semibold text-ink disabled:opacity-40"
            >
              {dangPhat ? '🔊 Đang phát…' : soLan === 0 ? '▶ Nghe' : '↻ Nghe lại'}
            </button>
            <span class="text-[12px] leading-snug text-vi">
              {item.type === 'sgd' ? `3 người nói · ` : ''}
              {soLan === 0 ? 'Đề thật chỉ nghe 1 lần — nhớ ghi chữ khoá.' : `Đã nghe ${soLan} lần`}
            </span>
          </div>
        )}

        {!kq && (item.timing.prep_s || item.timing.answer_s) && (
          <p class="mt-3 text-[12px] text-vi">
            Đề thật: chuẩn bị {item.timing.prep_s} giây, nói {item.timing.answer_s} giây.
          </p>
        )}

        {/* --- Viet --- */}
        {viet && !kq && (
          <>
            <textarea
              value={text}
              onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
              placeholder={item.type === 'swt' ? 'Một câu duy nhất, 5–75 từ…' : item.type === 'sst' ? 'Tóm tắt 50–70 từ…' : 'Bài luận 200–300 từ…'}
              rows={item.type === 'we' ? 14 : 6}
              spellcheck={false}
              autocomplete="off"
              class="mt-4 w-full rounded-xl border border-line bg-ink px-3.5 py-3 text-[15px] leading-relaxed text-en"
            />
            {fy && (
              <p class={cx('mt-1.5 text-[12.5px]', fy.ok === 'tot' ? 'text-accent' : fy.ok === 'vua' ? 'text-warn' : 'text-bad')}>
                {fy.chu}
              </p>
            )}
            <p class="mt-1 text-[11.5px] text-vi/80">Đề thật không có sửa chính tả tự động — app cũng tắt.</p>
          </>
        )}

        {/* --- Noi --- */}
        {!viet && !kq && (
          <div class="mt-6">
            <MicButton
              phase={mic}
              maxSeconds={item.timing.answer_s ?? 40}
              disabled={canNghe && soLan === 0}
              hint={canNghe && soLan === 0 ? 'Nghe trước rồi mới nói' : `Nói tối đa ${item.timing.answer_s} giây`}
              onStateChange={(p) => setMic((cur) => (cur === 'busy' ? cur : p))}
              onError={(m) => {
                setLoi(m);
                setMic('idle');
              }}
              onDone={(blob, mime) => void nopNoi(blob, mime)}
            />
            {mic === 'busy' && <p class="mt-3 text-center text-[13px] text-vi">Đang nghe lại bài nói và nhờ AI góp ý… (10–30 giây)</p>}
          </div>
        )}

        {kq && <KetQuaMo r={kq} />}
        {loi && (
          <div class="mt-4 rounded-xl bg-bad/10 px-3 py-2.5 text-[13.5px] leading-snug text-bad">
            {loi}
            {!viet && banGhi.current && !kq && (
              <button
                onClick={() => banGhi.current && void nopNoi(banGhi.current.blob, banGhi.current.mime)}
                class="ml-2 underline"
              >
                Gửi lại bài nói
              </button>
            )}
          </div>
        )}

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
            {viet && (
              <button
                onClick={() => void nopViet()}
                disabled={!text.trim() || busy}
                class="flex-1 rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink disabled:opacity-40"
              >
                {busy ? 'AI đang đọc bài…' : 'Nộp bài'}
              </button>
            )}
            <button
              onClick={() => onTiep(null)}
              disabled={busy || mic === 'busy'}
              class={cx('rounded-xl border border-line px-4 py-4 text-[15px] text-vi disabled:opacity-40', !viet && 'flex-1')}
            >
              Bỏ ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function KetQuaMo({ r }: { r: OpenResult }) {
  const [xemMau, setXemMau] = useState(false);
  const [xemBai, setXemBai] = useState(false);
  return (
    <div class="mt-5 rounded-2xl border border-line bg-surface p-4">
      <p class="text-[11.5px] uppercase tracking-wide text-warn">Ước lượng của AI theo thang Pearson — không phải điểm PTE</p>
      <p class={cx('mt-1 text-[18px] font-semibold tabular-nums', r.pte_score >= 80 ? 'text-accent' : r.pte_score >= 55 ? 'text-warn' : 'text-bad')}>
        {r.correct}/{r.total}
      </p>
      {r.cut_off && (
        <p class="mt-1 text-[12.5px] leading-snug text-bad">
          Nội dung hoặc Hình thức bằng 0 nên các tiêu chí khác không được chấm — đúng luật Pearson.
        </p>
      )}

      <ul class="mt-3 flex flex-col gap-1.5">
        {r.form && (
          <li class="rounded-lg border border-line px-3 py-2 text-[13px]">
            <span class="flex justify-between">
              <span class="font-medium text-en">Hình thức (app chấm chính xác)</span>
              <span class="tabular-nums text-en">
                {r.form.band}/{r.form.max}
              </span>
            </span>
            <span class="text-vi">{r.form.ly_do_vi}</span>
          </li>
        )}
        {r.traits.map((t) => (
          <li key={t.name} class="rounded-lg border border-line px-3 py-2 text-[13px]">
            <span class="flex justify-between gap-2">
              <span class="font-medium text-en">{t.name}</span>
              <span class={cx('shrink-0 tabular-nums', t.band / t.max >= 0.7 ? 'text-accent' : t.band / t.max >= 0.4 ? 'text-warn' : 'text-bad')}>
                {t.band}/{t.max}
              </span>
            </span>
            {t.why_vi && <span class="text-vi">{t.why_vi}</span>}
          </li>
        ))}
        {r.not_scored.length > 0 && (
          <li class="px-1 text-[12px] text-vi/80">Không chấm được: {r.not_scored.join(', ')} — cần máy chấm của Pearson.</li>
        )}
      </ul>

      {r.template_like && (
        <p class="mt-3 rounded-lg bg-bad/10 px-3 py-2 text-[13px] leading-snug text-bad">⚠️ Giống văn mẫu: {r.template_vi}</p>
      )}

      {r.key_points.length > 0 && (
        <>
          <p class="mb-1 mt-4 text-[11.5px] uppercase tracking-wide text-vi">Ý chính</p>
          <ul class="flex flex-col gap-1">
            {r.key_points.map((k, j) => (
              <li key={j} class={cx('text-[13px] leading-snug', k.covered ? 'text-accent' : 'text-warn')}>
                {k.covered ? '✓' : '✗'} {k.point}
              </li>
            ))}
          </ul>
        </>
      )}

      {r.stats && (
        <p class="mt-3 text-[12px] text-vi">
          {r.stats.words} từ trong {r.stats.duration_s} giây · {r.stats.wpm} từ/phút · ngừng dài {r.stats.long_pauses} lần · từ đệm{' '}
          {r.stats.fillers} — chỉ báo thô, không phải điểm trôi chảy.
        </p>
      )}

      {r.fixes.length > 0 && (
        <>
          <p class="mb-1 mt-4 text-[11.5px] uppercase tracking-wide text-vi">Sửa câu của anh</p>
          <ul class="flex flex-col gap-2">
            {r.fixes.map((f, j) => (
              <li key={j} class="text-[13px] leading-snug">
                <span class="text-bad line-through">{f.you_said}</span>
                <br />
                <span class="text-accent">{f.better}</span>
                <br />
                <span class="text-vi">{f.why_vi}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {r.summary_vi && <p class="mt-4 rounded-lg bg-accent/10 px-3 py-2 text-[13px] leading-snug text-en">💡 {r.summary_vi}</p>}

      <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {r.better_en && (
          <button onClick={() => setXemMau(!xemMau)} class="text-[13px] text-accent">
            {xemMau ? 'Ẩn bài mẫu' : 'Xem bài mẫu'}
          </button>
        )}
        {(r.material || r.response) && (
          <button onClick={() => setXemBai(!xemBai)} class="text-[13px] text-accent">
            {xemBai ? 'Ẩn bài làm' : r.material ? 'Xem bài làm + bài nghe' : 'Xem bài làm'}
          </button>
        )}
      </div>
      {xemMau && <p class="mt-2 text-[14px] leading-relaxed text-en">{r.better_en}</p>}
      {xemBai && (
        <div class="mt-2 text-[13.5px] leading-relaxed">
          <p class="text-vi">Anh {r.stats ? 'nói (máy nghe thành)' : 'viết'}:</p>
          <p class="text-en">{r.response || '(trống)'}</p>
          {r.material && (
            <>
              <p class="mt-2 text-vi">Bài nghe:</p>
              <p class="whitespace-pre-line text-en">{r.material}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bieu do cho "Mo ta hinh" — ve bang SVG tu du lieu, khong can anh.
// ---------------------------------------------------------------------------

const MAU = ['#34d399', '#60a5fa', '#fbbf24', '#f472b6', '#a78bfa', '#f87171', '#2dd4bf', '#fb923c'];

function soDep(v: number): string {
  return Math.abs(v) >= 1000 ? v.toLocaleString('en-US') : String(Math.round(v * 100) / 100);
}

/**
 * Ngat nhan truc x thanh toi da 2 dong theo tu, moi dong ~n ky tu. Truoc 12/09
 * nhan bi CAT CUT o 11 ky tu ("United Stat…") — agent kiem de bat duoc.
 */
function ngatDong(s: string, n = 14): string[] {
  const out: string[] = [];
  let dong = '';
  for (const w of s.split(/\s+/)) {
    if (!dong) dong = w;
    else if ((dong + ' ' + w).length <= n) dong += ' ' + w;
    else {
      out.push(dong);
      dong = w;
    }
  }
  if (dong) out.push(dong);
  if (out.length <= 2) return out;
  const hai = out.slice(1).join(' ');
  return [out[0]!, hai.length > n + 2 ? `${hai.slice(0, n + 1)}…` : hai];
}

function ChartSvg({ c }: { c: OpenChart }) {
  const W = 340;
  const H = 230;
  const le = { t: 18, r: 10, b: 50, l: 40 };
  const tatCa = c.series.flatMap((s) => s.values);
  const max = Math.max(1, ...tatCa);
  const w = W - le.l - le.r;
  const h = H - le.t - le.b;
  const y = (v: number) => le.t + h - (v / max) * h;

  let ve: JSX.Element | null = null;
  if (c.kind === 'table') {
    ve = (
      <div class="overflow-x-auto">
        <table class="w-full text-[12.5px] text-en">
          <thead>
            <tr>
              <th class="border-b border-line px-2 py-1 text-left text-vi" />
              {c.labels.map((l) => (
                <th key={l} class="border-b border-line px-2 py-1 text-right text-vi">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {c.series.map((s) => (
              <tr key={s.name}>
                <td class="border-b border-line/50 px-2 py-1 text-vi">{s.name}</td>
                {s.values.map((v, k) => (
                  <td key={k} class="border-b border-line/50 px-2 py-1 text-right tabular-nums">
                    {soDep(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else if (c.kind === 'pie') {
    const vals = c.series[0]!.values;
    const tong = vals.reduce((a, v) => a + v, 0) || 1;
    let goc = -Math.PI / 2;
    const cx0 = 110;
    const cy0 = 110;
    const R = 90;
    ve = (
      <div class="flex items-center gap-3">
        <svg viewBox="0 0 220 220" class="h-44 w-44 shrink-0">
          {vals.map((v, k) => {
            const a0 = goc;
            const a1 = goc + (v / tong) * Math.PI * 2;
            goc = a1;
            const lon = a1 - a0 > Math.PI ? 1 : 0;
            const d = `M${cx0},${cy0} L${cx0 + R * Math.cos(a0)},${cy0 + R * Math.sin(a0)} A${R},${R} 0 ${lon} 1 ${cx0 + R * Math.cos(a1)},${cy0 + R * Math.sin(a1)} Z`;
            return <path key={k} d={d} fill={MAU[k % MAU.length]} stroke="rgba(0,0,0,.35)" stroke-width="1" />;
          })}
        </svg>
        <ul class="flex flex-col gap-1 text-[12px] text-en">
          {c.labels.map((l, k) => (
            <li key={l} class="flex items-center gap-1.5">
              <span class="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: MAU[k % MAU.length] }} />
              {l}: {soDep(vals[k]!)}
              {c.unit ? ` ${c.unit}` : ''}
            </li>
          ))}
        </ul>
      </div>
    );
  } else {
    const nL = c.labels.length;
    const buoc = w / Math.max(1, nL);
    ve = (
      <svg viewBox={`0 0 ${W} ${H}`} class="w-full">
        {[0, 0.5, 1].map((p) => (
          <g key={p}>
            <line x1={le.l} x2={W - le.r} y1={y(max * p)} y2={y(max * p)} stroke="currentColor" class="text-line" stroke-width="1" />
            <text x={le.l - 4} y={y(max * p) + 3} text-anchor="end" font-size="9" fill="currentColor" class="text-vi">
              {soDep(max * p)}
            </text>
          </g>
        ))}
        {c.kind === 'bar'
          ? c.series[0]!.values.map((v, k) => {
              const bw = Math.min(34, buoc * 0.6);
              const x = le.l + buoc * k + (buoc - bw) / 2;
              return (
                <g key={k}>
                  <rect x={x} y={y(v)} width={bw} height={le.t + h - y(v)} fill={MAU[0]} rx="2" />
                  <text x={x + bw / 2} y={y(v) - 3} text-anchor="middle" font-size="9" fill="currentColor" class="text-en">
                    {soDep(v)}
                  </text>
                </g>
              );
            })
          : c.series.map((s, si) => (
              <g key={s.name}>
                <polyline
                  fill="none"
                  stroke={MAU[si % MAU.length]}
                  stroke-width="2"
                  points={s.values.map((v, k) => `${le.l + buoc * k + buoc / 2},${y(v)}`).join(' ')}
                />
                {s.values.map((v, k) => (
                  <g key={k}>
                    <circle cx={le.l + buoc * k + buoc / 2} cy={y(v)} r="2.5" fill={MAU[si % MAU.length]} />
                    {/* Ghi so tung diem — de noi dung so khi mo ta (agent kiem de nhac). */}
                    <text
                      x={le.l + buoc * k + buoc / 2}
                      y={y(v) - 5 - si * 9}
                      text-anchor="middle"
                      font-size="8.5"
                      fill={MAU[si % MAU.length]}
                    >
                      {soDep(v)}
                    </text>
                  </g>
                ))}
              </g>
            ))}
        {c.labels.map((l, k) => (
          <text
            key={l}
            x={le.l + buoc * k + buoc / 2}
            y={H - le.b + 14}
            text-anchor="middle"
            font-size={nL > 5 ? 8 : 9.5}
            fill="currentColor"
            class="text-vi"
          >
            {ngatDong(l, nL > 5 ? 11 : 14).map((d, j) => (
              <tspan key={j} x={le.l + buoc * k + buoc / 2} dy={j === 0 ? 0 : 11}>
                {d}
              </tspan>
            ))}
          </text>
        ))}
      </svg>
    );
  }

  return (
    <figure class="rounded-xl border border-line bg-surface px-3 py-3">
      <figcaption class="mb-2 text-[13px] font-medium leading-snug text-en">
        {c.title}
        {c.unit ? <span class="font-normal text-vi"> ({c.unit})</span> : null}
      </figcaption>
      {ve}
      {c.kind === 'line' && c.series.length > 1 && (
        <ul class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-en">
          {c.series.map((s, si) => (
            <li key={s.name} class="flex items-center gap-1.5">
              <span class="inline-block h-2 w-3 rounded-sm" style={{ background: MAU[si % MAU.length] }} />
              {s.name}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
