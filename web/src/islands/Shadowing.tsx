import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  get,
  postForm,
  ApiError,
  type KaraWord,
  type ShadowItem,
  type ShadowItems,
  type ShadowMode,
  type ShadowPassage,
  type ShadowPrep,
  type ShadowResult,
} from '../lib/api';
import { MicRecorder, extFor } from '../lib/recorder';
import { cx } from '../lib/cx';
import { qp } from '../lib/qs';

/**
 * Shadowing — nghe cau mau va noi de theo gan nhu cung luc.
 *
 * Hai che do khop hai dang bai PTE:
 *   rs — Nhai cau:  hien chu mac dinh, TAT duoc de luyen dung dieu kien thi
 *                   (doi 12/09 — Duy: "khong co chu sao nhai noi")
 *   ra — Doc doan:  NHIN chu      (ky nang Read Aloud)
 *
 * ⚠️ PHAI DEO TAI NGHE. Mic co bat khu tieng vong (echoCancellation) nhung tren
 * loa ngoai dien thoai no khong loc sach — may se nghe ra giong MAU trong ban
 * ghi va cham cho giong mau chu khong phai cho nguoi hoc.
 *
 * ⚠️ So nhip la CHI BAO, khong phai diem Oral Fluency cua PTE: khong co trong
 * am, ngu dieu, ngat cum theo nghia. Xem chu thich dau api/src/shadow.ts.
 *
 * Gia tri lon nhat cua shadowing KHONG nam o may cham ma o viec nghe lai giong
 * minh dat canh giong mau — nen nut "xen ke" la nut quan trong nhat man nay.
 *
 * Them 11/09 (Duy bao: tai cau cham, khong co chu chay, khong co che do ca doan):
 *   - Tai truoc cau ke tiep trong luc dang lam cau nay (kho taiAudio/taiKara).
 *   - Chu chay theo giong mau (karaoke), moc lay tu /shadow/prep. Voi 'rs' chu
 *     chi chay SAU khi nop — server khong gui moc truoc do.
 *   - Che do "Nghe roi noi lai ca doan" (ChayDoan): AI doc tung cau, nguoi hoc
 *     noi lai, tu sang cau sau cho het doan. AI doc XONG mic moi mo nen khong
 *     bat buoc deo tai nghe.
 */

const CHE_DO: Record<ShadowMode, { ten: string; phu: string; mo_ta: string }> = {
  rs: {
    ten: 'Nhại câu',
    phu: 'PTE · Repeat Sentence',
    // Doi 12/09: Duy "khong co chu sao nhai noi" — hien chu mac dinh, tat duoc.
    mo_ta: 'Câu ngắn như đề Nhại câu. Chữ chạy theo giọng mẫu; quen rồi thì tắt chữ để luyện đúng như đề thi.',
  },
  ra: {
    ten: 'Đọc đoạn',
    phu: 'PTE · Read Aloud',
    mo_ta: 'Nhìn chữ. Bấm Shadow rồi đọc cùng lúc với mẫu, bám sát nhịp.',
  },
  vocab: {
    ten: 'Câu ví dụ từ vựng',
    phu: '240 câu · 20 chủ đề',
    mo_ta: 'Nói theo câu ví dụ của từng từ — nhớ từ trong ngữ cảnh thật.',
  },
  lesson: {
    ten: 'Câu trong bài học',
    phu: '160 câu · kèm điểm phát âm',
    mo_ta: 'Mỗi câu có sẵn một âm cần chú ý. Nghe kỹ âm đó rồi bắt chước.',
  },
};

// Hai nhom: luyen thi va on noi dung da hoc. Shadowing la PHUONG PHAP, dung cho
// ca hai — Duy chot 10/09 tach no ra khoi tab PTE.
const NHOM: { ten: string; modes: ShadowMode[] }[] = [
  { ten: 'Luyện thi PTE', modes: ['rs', 'ra'] },
  { ten: 'Ôn nội dung đã học', modes: ['vocab', 'lesson'] },
];

const N = 8;
/** Mau het roi thi ghi them bay nhieu nua moi dung — nguoi shadow luon tre hon mau. */
const DUOI_MS = 1200;
/** Chu sang som hon moc Whisper mot chut: mat can thay chu truoc khi tai nghe tieng. */
const SOM_S = 0.08;
/** localStorage: '1' = Nhai cau tat chu. */
const AN_CHU_KEY = 'evc_shadow_rs_an_chu';

type Phase = 'idle' | 'loading' | 'shadowing' | 'busy';

// ---------------------------------------------------------------------------
// Kho tai san theo id cau — dung chung cho che do tung cau va che do ca doan.
// Giu blob URL suot luc o man nay; thu hoi het khi roi man (xoaKho).
// ---------------------------------------------------------------------------

const khoAudio = new Map<string, Promise<string>>();
const khoKara = new Map<string, Promise<KaraWord[] | null>>();

function taiAudio(id: string): Promise<string> {
  let p = khoAudio.get(id);
  if (!p) {
    p = fetch(`/api/shadow/say/${id}`)
      .then((r) => {
        if (r.status === 401) window.location.replace('/login.html');
        if (!r.ok) throw new Error(`Không tải được mẫu (${r.status})`);
        return r.blob();
      })
      .then((b) => URL.createObjectURL(b));
    // Loi thi bo khoi kho de lan sau con tai lai duoc.
    p.catch(() => khoAudio.delete(id));
    khoAudio.set(id, p);
  }
  return p;
}

/**
 * Moc chu chay. Chinh loi goi nay cung bat server tinh san moc mau, luc nop
 * khoi phai cho. Loi thi tra null: chu dung yen, van hoc duoc.
 */
function taiKara(id: string): Promise<KaraWord[] | null> {
  let p = khoKara.get(id);
  if (!p) {
    p = get<ShadowPrep>(`/shadow/prep/${id}`).then(
      (r) => r.karaoke ?? null,
      () => {
        khoKara.delete(id);
        return null;
      },
    );
    khoKara.set(id, p);
  }
  return p;
}

function xoaKho() {
  for (const p of khoAudio.values()) void p.then((u) => URL.revokeObjectURL(u)).catch(() => {});
  khoAudio.clear();
  khoKara.clear();
}

/** Chi so chu cuoi cung da bat dau tai giay t; -1 = chua toi chu nao. */
function viTriChu(chu: KaraWord[], t: number): number {
  let k = -1;
  for (let j = 0; j < chu.length; j += 1) {
    if (chu[j]!.s <= t) k = j;
    else break;
  }
  return k;
}

/**
 * Chu chay theo mot the audio. Chi setState khi chu doi (khong phai moi khung
 * hinh). Moi lan chay() moi thi vong cu tu dung.
 */
function useChuChay() {
  const [idx, setIdx] = useState<number | null>(null);
  const raf = useRef<number | null>(null);
  const luot = useRef(0);

  const dung = () => {
    luot.current += 1;
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    setIdx(null);
  };

  const chay = (a: HTMLAudioElement, chu: KaraWord[]) => {
    dung();
    const toi = luot.current;
    let cu = -2;
    const buoc = () => {
      if (toi !== luot.current) return;
      if (a.paused || a.ended) {
        raf.current = null;
        setIdx(null);
        return;
      }
      const k = viTriChu(chu, a.currentTime + SOM_S);
      if (k !== cu) {
        cu = k;
        setIdx(k);
      }
      raf.current = requestAnimationFrame(buoc);
    };
    raf.current = requestAnimationFrame(buoc);
  };

  useEffect(
    () => () => {
      luot.current += 1;
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    },
    [],
  );

  return { idx, chay, dung };
}

export default function Shadowing() {
  const [mode, setMode] = useState<ShadowMode | null>(null);
  const [items, setItems] = useState<ShadowItem[] | null>(null);
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<ShadowResult | null>(null);
  const [error, setError] = useState('');
  // Them 11/09. Gan kem id cau: effect doi cau chay SAU lan ve dau tien cua cau
  // moi, nen neu khong so id thi mot khung hinh se hien chu chay cua cau CU.
  const [kara, setKara] = useState<{ id: string; chu: KaraWord[] | null } | null>(null);
  const [chonDoan, setChonDoan] = useState(false);
  const [doan, setDoan] = useState<ShadowPassage | null>(null);
  const cc = useChuChay();
  // Them 12/09: che do Nhai cau co nut TAT chu (luyen dung dieu kien thi). Nho
  // lua chon tren may; localStorage co the nem loi (che do rieng tu) nen boc try.
  const [anChu, setAnChuState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AN_CHU_KEY) === '1';
    } catch {
      return false;
    }
  });
  const setAnChu = (v: boolean) => {
    setAnChuState(v);
    try {
      localStorage.setItem(AN_CHU_KEY, v ? '1' : '0');
    } catch {
      /* khong luu duoc thi thoi */
    }
  };

  // Audio mau cua cau hien tai (blob URL, thuoc kho chung) va ban ghi cua nguoi hoc.
  const mauUrl = useRef<string>('');
  const minhUrl = useRef<string>('');
  const player = useRef<HTMLAudioElement | null>(null);
  const rec = useRef<MicRecorder | null>(null);
  const timer = useRef<number | null>(null);

  const donDep = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    player.current?.pause();
    // Khong de MediaStream mo coi: den mic phai tat khi roi man.
    if (rec.current?.state === 'recording') void rec.current.stop().catch(() => {});
    rec.current = null;
  };

  useEffect(() => () => {
    donDep();
    // Audio mau nam trong kho chung — thu hoi mot lan o day.
    xoaKho();
    if (minhUrl.current) URL.revokeObjectURL(minhUrl.current);
  }, []);

  const batDau = (m: ShadowMode) => {
    setMode(m);
    setItems(null);
    setI(0);
    setResult(null);
    setError('');
    get<ShadowItems>(`/shadow/items?mode=${m}&n=${N}`)
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  };

  const item = items?.[i];
  const karaCur = kara && item && kara.id === item.id ? kara.chu : null;
  // Cau nay co hien chu khong: moi che do deu co chu, tru Nhai cau khi da tat.
  const hienChu = !!item?.text && !(mode === 'rs' && anChu);

  // Them 12/09: /shadowing?mode=rs mo thang che do do (link tu bai Nhai cau ben tab PTE).
  useEffect(() => {
    const m = qp('mode') as ShadowMode;
    if ((['rs', 'ra', 'vocab', 'lesson'] as ShadowMode[]).includes(m)) batDau(m);
  }, []);

  // Cau moi: lay audio mau + moc chu chay tu kho (thuong da tai truoc), roi tai
  // truoc cau ke tiep.
  useEffect(() => {
    if (!item) return;
    let huy = false;
    donDep();
    if (minhUrl.current) URL.revokeObjectURL(minhUrl.current);
    mauUrl.current = '';
    minhUrl.current = '';
    setResult(null);
    setError('');
    setKara(null);
    setPhase('loading');
    // Lan dau mot cau mat 2-7 giay de tinh moc mau (neu chua dung san). Goi
    // truoc, trong luc nguoi hoc dang nghe mau, de luc nop khong phai cho them.
    void taiKara(item.id).then((k) => {
      if (!huy) setKara({ id: item.id, chu: k });
    });
    taiAudio(item.id)
      .then((u) => {
        if (huy) return;
        mauUrl.current = u;
        setPhase('idle');
      })
      .catch((e) => {
        if (huy) return;
        setError((e as Error).message);
        setPhase('idle');
      });
    // Tai truoc cau sau: bam "Cau tiep theo" la co ngay.
    const sau = items?.[i + 1];
    if (sau) {
      void taiAudio(sau.id).catch(() => {});
      void taiKara(sau.id);
    }
    return () => {
      huy = true;
    };
  }, [item?.id]);

  /** `chu` co thi chu chay theo audio nay. Chi truyen cho audio MAU. */
  const phat = (url: string, onEnd?: () => void, chu?: KaraWord[] | null) => {
    player.current?.pause();
    cc.dung();
    const a = new Audio(url);
    player.current = a;
    a.onended = () => onEnd?.();
    void a
      .play()
      .then(() => {
        if (chu?.length && player.current === a) cc.chay(a, chu);
      })
      .catch(() => onEnd?.());
  };

  /** Xen ke: mau roi toi minh, de tu nghe ra cho lech. */
  const xenKe = () => {
    if (!mauUrl.current || !minhUrl.current) return;
    phat(mauUrl.current, () => phat(minhUrl.current), result?.karaoke ?? null);
  };

  const shadow = async () => {
    if (!item || !mauUrl.current || phase !== 'idle') return;
    setError('');
    const r = new MicRecorder();
    rec.current = r;
    try {
      // Mo mic TRUOC roi moi phat mau: mo mic mat mot khoang khong xac dinh,
      // lam nguoc thi mat vai tu dau cua nguoi hoc.
      await r.start();
    } catch (e) {
      rec.current = null;
      setError((e as Error).message);
      return;
    }
    setPhase('shadowing');
    navigator.vibrate?.(15);
    // Nhai cau dang tat chu thi KHONG chay chu — dung dieu kien thi.
    phat(
      mauUrl.current,
      () => {
        timer.current = window.setTimeout(() => void ketThuc(), DUOI_MS);
      },
      hienChu ? karaCur : null,
    );
  };

  const ketThuc = async () => {
    const r = rec.current;
    if (!r || r.state !== 'recording' || !item) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    player.current?.pause();
    setPhase('busy');
    try {
      const { blob, mime } = await r.stop();
      rec.current = null;
      if (minhUrl.current) URL.revokeObjectURL(minhUrl.current);
      minhUrl.current = URL.createObjectURL(blob);
      const form = new FormData();
      form.append('audio', blob, `shadow.${extFor(mime)}`);
      form.append('id', item.id);
      form.append('nhin_chu', hienChu ? '1' : '0');
      setResult(await postForm<ShadowResult>('/shadow/answer', form));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setPhase('idle');
    }
  };

  const tiep = () => {
    donDep();
    setI(i + 1);
  };

  // --- Che do ca doan (them 11/09) ------------------------------------------
  if (doan) return <ChayDoan key={doan.id} p={doan} onThoat={() => setDoan(null)} />;
  if (chonDoan) return <ChonDoan onChon={setDoan} onThoat={() => setChonDoan(false)} />;

  // --- Man chon che do ------------------------------------------------------
  if (!mode) {
    return (
      <div class="px-5 pb-10 pt-8">
        <a href="/coach" class="text-[13px] text-vi">‹ Trang chủ</a>
        <h1 class="mt-3 text-[23px] font-bold text-en">Shadowing</h1>
        <p class="mt-2 text-[14px] leading-relaxed text-vi">
          Nghe mẫu rồi nói đè theo gần như cùng lúc. Luyện nhịp, nối âm, độ đều — đúng thứ PTE chấm ở
          phần Oral Fluency.
        </p>

        <p class="mt-5 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-[13.5px] leading-snug text-warn">
          🎧 <b>Đeo tai nghe.</b> Không đeo thì mic thu luôn cả giọng mẫu từ loa, và máy chấm cho giọng
          mẫu chứ không chấm cho anh.
        </p>

        {NHOM.map((g) => (
          <section key={g.ten} class="mt-6">
            <h2 class="mb-2.5 text-[12px] uppercase tracking-wide text-vi">{g.ten}</h2>
            <div class="flex flex-col gap-2.5">
              {g.modes.map((m) => (
                <button
                  key={m}
                  onClick={() => batDau(m)}
                  class="rounded-2xl border border-line bg-surface px-5 py-4 text-left active:bg-surface-2"
                >
                  <span class="block text-[16px] font-semibold text-en">{CHE_DO[m].ten}</span>
                  <span class="block text-[12.5px] text-vi">{CHE_DO[m].phu}</span>
                  <span class="mt-1.5 block text-[13px] leading-snug text-vi">{CHE_DO[m].mo_ta}</span>
                </button>
              ))}
            </div>
          </section>
        ))}

        <section class="mt-6">
          <h2 class="mb-2.5 text-[12px] uppercase tracking-wide text-vi">Nghe rồi nói lại</h2>
          <button
            onClick={() => setChonDoan(true)}
            class="w-full rounded-2xl border border-line bg-surface px-5 py-4 text-left active:bg-surface-2"
          >
            <span class="block text-[16px] font-semibold text-en">Cả đoạn, từng câu một</span>
            <span class="block text-[12.5px] text-vi">12 đoạn Đọc to · 20 chủ đề bài học</span>
            <span class="mt-1.5 block text-[13px] leading-snug text-vi">
              AI đọc một câu, anh nói lại, tự sang câu sau tới hết đoạn — không phải bấm. Không bắt buộc
              đeo tai nghe.
            </span>
          </button>
        </section>
      </div>
    );
  }

  if (error && !items) {
    return <Center title="Không tải được bộ câu" sub={error} />;
  }
  if (!items) return <Center title="Đang rút câu…" sub="" />;

  // --- Xong luot -----------------------------------------------------------
  if (i >= items.length) {
    return (
      <div class="px-5 pb-10 pt-10 text-center">
        <h1 class="text-[22px] font-bold text-en">Xong {items.length} câu</h1>
        <p class="mt-2 text-[14px] text-vi">{CHE_DO[mode].ten} · {CHE_DO[mode].phu}</p>
        <button
          onClick={() => batDau(mode)}
          class="mt-8 w-full rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink"
        >
          Lượt nữa
        </button>
        <button onClick={() => setMode(null)} class="mt-3 block w-full py-2 text-[14px] text-vi">
          Đổi chế độ
        </button>
      </div>
    );
  }

  const cur = item!;
  const dangNoi = phase === 'shadowing';

  return (
    <div class="flex min-h-[85dvh] flex-col">
      <header class="flex items-center justify-between border-b border-line px-4 py-3">
        <span class="text-[13px] text-vi">
          {CHE_DO[mode].ten} · Câu {i + 1}/{items.length}
        </span>
        <span class="flex items-center gap-3.5 text-[13px] text-vi">
          <button onClick={() => { donDep(); setMode(null); }}>Đổi</button>
          <a href="/coach">Thoát</a>
        </span>
      </header>

      <div class="flex-1 px-5 pt-6">
        <div class="rounded-2xl border border-line bg-surface px-5 py-6 text-center">
          {/* Moi che do hien chu truoc; Nhai cau tat chu duoc (doi 12/09). */}
          {cur.group && <p class="mb-2 text-[11.5px] uppercase tracking-wide text-vi">{cur.group}</p>}
          {mode === 'rs' && !result && (
            <button
              onClick={() => setAnChu(!anChu)}
              class="mb-3 rounded-full border border-line px-3 py-1 text-[12px] text-vi"
            >
              {anChu ? '👁 Hiện chữ' : '🙈 Tắt chữ — luyện như đề thi'}
            </button>
          )}
          {result ? (
            result.karaoke?.length ? (
              <ChuChay chu={result.karaoke} idx={cc.idx} cls="text-[18px] font-semibold leading-snug text-en" />
            ) : (
              <p class="text-[18px] font-semibold leading-snug text-en">{result.target}</p>
            )
          ) : hienChu ? (
            <>
              {karaCur?.length ? (
                <ChuChay chu={karaCur} idx={cc.idx} cls="text-[18px] leading-relaxed text-en" />
              ) : (
                <p class="text-[18px] leading-relaxed text-en">{cur.text}</p>
              )}
              {cur.vi && <p class="mt-2 text-[13px] leading-snug text-vi">{cur.vi}</p>}
              {/* Diem phat am can chu y — co san trong cau bai hoc. Day la
                  thu giup shadowing co trong tam thay vi bat chuoc chung chung. */}
              {cur.focus_vi && (
                <p class="mt-3 rounded-lg bg-accent/10 px-3 py-2 text-[12.5px] leading-snug text-accent">
                  🎯 {cur.focus_vi}
                </p>
              )}
            </>
          ) : (
            <p class="text-[13px] uppercase tracking-wide text-vi">Câu {cur.word_count} từ · không nhìn chữ</p>
          )}

          {!result && (
            <button
              onClick={() => mauUrl.current && phat(mauUrl.current, undefined, hienChu ? karaCur : null)}
              disabled={phase !== 'idle' || !mauUrl.current}
              class="mt-5 rounded-full border border-line px-5 py-2.5 text-[14px] text-en disabled:opacity-40"
            >
              {phase === 'loading' ? 'Đang tải mẫu…' : '▶ Nghe mẫu'}
            </button>
          )}
        </div>

        {dangNoi && (
          <p class="mt-5 text-center text-[15px] font-medium text-accent">
            Đang nghe và thu — nói đè theo mẫu…
          </p>
        )}

        {error && items && (
          <p class="mt-4 rounded-xl bg-bad/10 px-3 py-2.5 text-[13.5px] leading-snug text-bad">{error}</p>
        )}

        {result && (
          <KetQua
            r={result}
            coMinh={!!minhUrl.current}
            onMau={() => phat(mauUrl.current, undefined, result.karaoke ?? null)}
            onMinh={() => phat(minhUrl.current)}
            onXenKe={xenKe}
          />
        )}
      </div>

      <div class="sticky bottom-0 border-t border-line bg-ink/95 px-4 pb-3 pt-3 backdrop-blur">
        {result ? (
          <button onClick={tiep} class="w-full rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink">
            {i + 1 < items.length ? 'Câu tiếp theo' : 'Xem tổng kết'}
          </button>
        ) : dangNoi ? (
          <button onClick={() => void ketThuc()} class="w-full rounded-xl bg-bad py-4 text-[16px] font-semibold text-ink">
            ■ Dừng
          </button>
        ) : (
          <div class="flex gap-2">
            <button
              onClick={() => void shadow()}
              disabled={phase !== 'idle' || !mauUrl.current}
              class="flex-1 rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink disabled:opacity-40"
            >
              {phase === 'busy' ? 'Đang chấm…' : '🎙 Shadow'}
            </button>
            <button
              onClick={tiep}
              disabled={phase === 'busy'}
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

// ---------------------------------------------------------------------------

/** Van ban chu chay. idx null = khong phat, hien nhu chu thuong. */
function ChuChay({ chu, idx, cls }: { chu: KaraWord[]; idx: number | null; cls: string }) {
  return (
    <p class={cls}>
      {chu.map((c, k) => (
        <Fragment key={k}>
          {k > 0 && ' '}
          <span
            class={cx(
              'rounded-sm transition-colors duration-100',
              idx !== null && (k < idx ? 'text-en' : k === idx ? 'bg-accent/25 text-accent' : 'text-vi/70'),
            )}
          >
            {c.w}
          </span>
        </Fragment>
      ))}
    </p>
  );
}

/** Lech duoi nguong nay coi nhu khop nhip. */
const LECH_MS = 250;

function KetQua({
  r,
  coMinh,
  onMau,
  onMinh,
  onXenKe,
}: {
  r: ShadowResult;
  coMinh: boolean;
  onMau: () => void;
  onMinh: () => void;
  onXenKe: () => void;
}) {
  const t = r.timing;
  const tempo = t.tempo_ratio;
  const tempoChu =
    tempo === null
      ? 'Không so được nhịp (ghép được quá ít từ)'
      : tempo > 1.1
        ? `Chậm hơn mẫu ${Math.round((tempo - 1) * 100)}%`
        : tempo < 0.9
          ? `Nhanh hơn mẫu ${Math.round((1 - tempo) * 100)}%`
          : 'Tốc độ khớp mẫu';
  const tempoTot = tempo !== null && tempo >= 0.9 && tempo <= 1.1;

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
        <span class={cx('text-[13px]', tempoTot ? 'text-accent' : 'text-warn')}>{tempoChu}</span>
      </div>

      {/* Tung tu: mau theo do lech nhip. Xam = khong ghep duoc. */}
      <div class="mt-3 flex flex-wrap gap-1.5">
        {t.words.map((w, k) => {
          const lech = w.offset_ms;
          const cls =
            lech === null
              ? 'bg-surface-2 text-vi/60'
              : Math.abs(lech) <= LECH_MS
                ? 'bg-accent/15 text-accent'
                : 'bg-warn/20 text-warn';
          return (
            <span key={k} class={cx('rounded px-1.5 py-0.5 text-[14px]', cls)}>
              {w.word}
              {lech !== null && Math.abs(lech) > LECH_MS && (
                <sub class="ml-0.5 text-[10px] opacity-80">{lech > 0 ? 'muộn' : 'sớm'}</sub>
              )}
            </span>
          );
        })}
      </div>

      {t.extra_pauses > 0 && (
        <p class="mt-3 rounded-lg bg-warn/10 px-3 py-2 text-[12.5px] leading-snug text-warn">
          Ngừng thừa {t.extra_pauses} chỗ — mẫu nói liền mà anh ngắt. PTE trừ điểm trôi chảy ở đây.
        </p>
      )}

      {r.dropped_endings > 0 && (
        <p class="mt-2.5 rounded-lg bg-warn/10 px-3 py-2 text-[12.5px] leading-snug text-warn">
          Rụng {r.dropped_endings} đuôi từ. PTE tính đó là sai từ.
        </p>
      )}

      {/* Nut quan trong nhat: nghe lai giong minh canh giong mau. */}
      <div class="mt-4 grid grid-cols-3 gap-2">
        <button onClick={onMau} class="rounded-lg border border-line py-2.5 text-[13px] text-en">
          ▶ Mẫu
        </button>
        <button
          onClick={onMinh}
          disabled={!coMinh}
          class="rounded-lg border border-line py-2.5 text-[13px] text-en disabled:opacity-40"
        >
          ▶ Mình
        </button>
        <button
          onClick={onXenKe}
          disabled={!coMinh}
          class="rounded-lg bg-accent/15 py-2.5 text-[13px] font-medium text-accent disabled:opacity-40"
        >
          ▶ Xen kẽ
        </button>
      </div>

      <p class="mt-3 text-[11.5px] leading-snug text-vi">
        Nhịp ở đây là chỉ báo, không phải điểm Oral Fluency của PTE — app không chấm được ngữ điệu
        và trọng âm. Cách dùng tốt nhất: bấm <b>Xen kẽ</b> rồi tự nghe ra chỗ lệch.
      </p>

      {r.transcript && (
        <p class="mt-2.5 text-[12px] leading-snug text-vi">
          Máy nghe thành: <span class="text-en-dim">{r.transcript}</span>
        </p>
      )}
    </div>
  );
}

function Center({ title, sub }: { title: string; sub: string }) {
  return (
    <div class="flex min-h-[70dvh] flex-col items-center justify-center px-8 text-center">
      <p class="text-[18px] font-semibold text-en">{title}</p>
      {sub && <p class="mt-2 text-[14px] leading-relaxed text-vi">{sub}</p>}
      <a href="/coach" class="mt-7 rounded-xl bg-accent px-6 py-3 text-[15px] font-semibold text-ink">
        Về trang chủ
      </a>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Che do "Nghe roi noi lai ca doan" — them 11/09
//
// Duy chot: AI doc TUNG CAU, nguoi hoc noi lai, tu sang cau sau cho het doan.
// Khac shadow o cho KHONG noi de: AI doc xong mic moi mo.
// ---------------------------------------------------------------------------

/** Danh sach doan khong doi trong mot phien — tai mot lan, quay lai khong tai nua. */
let dsDoanDaTai: ShadowPassage[] | null = null;

function ChonDoan({ onChon, onThoat }: { onChon: (p: ShadowPassage) => void; onThoat: () => void }) {
  const [ds, setDs] = useState<ShadowPassage[] | null>(dsDoanDaTai);
  const [loi, setLoi] = useState('');

  useEffect(() => {
    if (dsDoanDaTai) return;
    get<{ passages: ShadowPassage[] }>('/shadow/passages')
      .then((r) => {
        dsDoanDaTai = r.passages;
        setDs(r.passages);
      })
      .catch((e) => setLoi(e instanceof ApiError ? e.message : String(e)));
  }, []);

  const nhom = ds
    ? [
        {
          ten: 'Đọc to — PTE Read Aloud',
          ds: ds.filter((p) => p.src === 'ra').sort((a, b) => (a.level ?? 0) - (b.level ?? 0)),
        },
        { ten: 'Câu trong bài học', ds: ds.filter((p) => p.src === 'lesson') },
      ]
    : [];

  return (
    <div class="px-5 pb-10 pt-8">
      <button onClick={onThoat} class="text-[13px] text-vi">‹ Shadowing</button>
      <h1 class="mt-3 text-[23px] font-bold text-en">Nghe rồi nói lại cả đoạn</h1>
      <p class="mt-2 text-[14px] leading-relaxed text-vi">
        AI đọc từng câu. Nghe xong mic tự mở — anh nói lại câu vừa nghe, ngừng khoảng một giây là tự
        sang câu sau. Hết đoạn thì xem lại từng câu.
      </p>

      {loi && <p class="mt-4 rounded-xl bg-bad/10 px-3 py-2.5 text-[13.5px] leading-snug text-bad">{loi}</p>}
      {!ds && !loi && <p class="mt-6 text-[14px] text-vi">Đang tải…</p>}

      {nhom.map(
        (g) =>
          g.ds.length > 0 && (
            <section key={g.ten} class="mt-6">
              <h2 class="mb-2.5 text-[12px] uppercase tracking-wide text-vi">{g.ten}</h2>
              <div class="flex flex-col gap-2">
                {g.ds.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => onChon(p)}
                    class="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left active:bg-surface-2"
                  >
                    <span class="min-w-0">
                      <span class="block text-[15px] font-medium text-en">
                        {p.emoji ? `${p.emoji} ` : ''}
                        {p.title}
                      </span>
                      <span class="block text-[12px] text-vi">{p.sub}</span>
                    </span>
                    <span class="shrink-0 text-[12px] tabular-nums text-vi">{p.items.length} câu</span>
                  </button>
                ))}
              </div>
            </section>
          ),
      )}
    </div>
  );
}

type Buoc = 'chuan_bi' | 'san_sang' | 'nghe' | 'noi' | 'tam_dung' | 'xong';
type CauKq = { tt: 'cho' | 'cham' | 'xong' | 'loi'; kq?: ShadowResult; minh?: string; loi?: string };

// Nguong am luong mic, thang 0..1 cua MicRecorder.level(). CHUA do tren may
// that cua Duy — tu dung sai (cat som / khong chiu dung) thi chinh o day.
/** Tren muc nay = dang noi. */
const NGUONG_NOI = 0.2;
/** Duoi muc nay = im lang. */
const NGUONG_IM = 0.08;
/** Da noi roi ma im lien tuc bay lau thi coi nhu noi xong cau. */
const IM_MS = 1000;
/** Phai co it nhat bay nhieu tieng noi moi tinh la da noi (loc tieng go, tieng ho). */
const TOI_THIEU_NOI_MS = 300;
/** Nghi giua luc thu xong va luc AI doc cau sau. */
const NGHI_MS = 500;

function ChayDoan({ p, onThoat }: { p: ShadowPassage; onThoat: () => void }) {
  const n = p.items.length;
  const [k, setK] = useState(0);
  const [buoc, setBuoc] = useState<Buoc>('chuan_bi');
  const [kq, setKq] = useState<CauKq[]>(() => p.items.map(() => ({ tt: 'cho' as const })));
  const [dangChay, setDangChay] = useState<number | null>(null);
  const [conLai, setConLai] = useState(1);
  const [loi, setLoi] = useState('');
  const cc = useChuChay();

  // Moi lan bat dau / dung / thoat tang `phien` — moi chuoi async cu tu bo.
  const phien = useRef(0);
  // Moi lan "lam lai ca doan" tang `vong` — ket qua cham cua vong cu bi bo.
  const vong = useRef(0);
  const song = useRef(true);
  // MOT the audio dung lai suot doan: Safari iOS chi cho the da phat trong cu
  // bam cua nguoi dung duoc phat tiep ma khong can bam lai.
  const audio = useRef<HTMLAudioElement | null>(null);
  const rec = useRef<MicRecorder | null>(null);
  const hen = useRef<number | null>(null);
  const moKhoa = useRef<(() => void) | null>(null);
  const bamXong = useRef(false);
  const tiepTu = useRef(0);
  const daTai = useRef(new Map<string, string>());
  const daChu = useRef(new Map<string, KaraWord[] | null>());
  const minhUrls = useRef<string[]>([]);
  const khoiCau = useRef<(HTMLDivElement | null)[]>([]);

  const dungHet = () => {
    if (hen.current) window.clearTimeout(hen.current);
    hen.current = null;
    audio.current?.pause();
    cc.dung();
    if (rec.current?.state === 'recording') rec.current.cancel();
    rec.current = null;
    moKhoa.current?.();
    moKhoa.current = null;
  };

  // Tai het audio + moc cua doan ngay khi mo. Cau 1 co la bam Bat dau duoc.
  useEffect(() => {
    song.current = true;
    p.items.forEach((it, j) => {
      void taiKara(it.id).then((c) => {
        daChu.current.set(it.id, c);
      });
      const pa = taiAudio(it.id).then((u) => {
        daTai.current.set(it.id, u);
        return u;
      });
      if (j === 0) {
        pa.then(
          () => {
            if (song.current) setBuoc((b) => (b === 'chuan_bi' ? 'san_sang' : b));
          },
          (e) => {
            if (!song.current) return;
            setLoi((e as Error).message);
            setBuoc((b) => (b === 'chuan_bi' ? 'san_sang' : b));
          },
        );
      } else {
        pa.catch(() => {});
      }
    });
    return () => {
      song.current = false;
      phien.current += 1;
      dungHet();
      for (const u of minhUrls.current) URL.revokeObjectURL(u);
    };
  }, []);

  // Cau dang lam luon nam giua man.
  useEffect(() => {
    if (buoc === 'nghe') khoiCau.current[k]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [k, buoc]);

  const capNhat = (j: number, patch: Partial<CauKq>) =>
    setKq((ds) => ds.map((x, t) => (t === j ? { ...x, ...patch } : x)));

  /** Phat cau mau j tren the audio dung chung, chu chay theo. true = phat het. */
  const phatMau = (j: number, url: string): Promise<boolean> =>
    new Promise((res) => {
      const a = audio.current ?? (audio.current = new Audio());
      a.pause();
      cc.dung();
      setDangChay(j);
      a.onended = () => {
        setDangChay(null);
        res(true);
      };
      a.onerror = () => {
        setDangChay(null);
        res(false);
      };
      a.src = url;
      const chu = daChu.current.get(p.items[j]!.id) ?? null;
      void a.play().then(
        () => {
          if (chu?.length) cc.chay(a, chu);
        },
        () => {
          setDangChay(null);
          res(false);
        },
      );
    });

  const phatMinh = (u: string) => {
    const a = audio.current ?? (audio.current = new Audio());
    a.pause();
    cc.dung();
    setDangChay(null);
    a.onended = null;
    a.onerror = null;
    a.src = u;
    void a.play().catch(() => {});
  };

  const cham = async (j: number, blob: Blob, mime: string) => {
    const v = vong.current;
    const form = new FormData();
    form.append('audio', blob, `shadow.${extFor(mime)}`);
    form.append('id', p.items[j]!.id);
    // Che do ca doan luon hien chu.
    form.append('nhin_chu', '1');
    try {
      const r = await postForm<ShadowResult>('/shadow/answer', form);
      if (song.current && v === vong.current) capNhat(j, { tt: 'xong', kq: r });
    } catch (e) {
      if (song.current && v === vong.current) {
        capNhat(j, { tt: 'loi', loi: e instanceof ApiError ? e.message : (e as Error).message });
      }
    }
  };

  const thuCau = async (j: number, id: number, dur: number) => {
    const r = new MicRecorder();
    rec.current = r;
    try {
      await r.start();
    } catch (e) {
      rec.current = null;
      if (id === phien.current) {
        setLoi((e as Error).message);
        setBuoc('tam_dung');
      }
      return;
    }
    if (id !== phien.current) {
      r.cancel();
      return;
    }
    setBuoc('noi');
    setConLai(1);
    navigator.vibrate?.(15);
    bamXong.current = false;

    // Nghe am luong mic: da noi roi ma im ~1 giay la xong cau. Co tran thoi
    // gian, phong khi phong on khong bao gio xuong duoi nguong im.
    const tran = Math.max(3000, dur * 2000 + 1500);
    let noiMs = 0;
    await new Promise<void>((res) => {
      moKhoa.current = res;
      const t0 = performance.now();
      let truoc = t0;
      let imTu: number | null = null;
      const tick = () => {
        if (id !== phien.current || r.state !== 'recording') return res();
        const now = performance.now();
        const lv = r.level();
        if (lv >= NGUONG_IM) {
          imTu = null;
          if (lv >= NGUONG_NOI) noiMs += now - truoc;
        } else if (imTu === null) {
          imTu = now;
        }
        truoc = now;
        setConLai(Math.max(0, 1 - (now - t0) / tran));
        if (now - t0 >= tran) return res();
        if (noiMs >= TOI_THIEU_NOI_MS && imTu !== null && now - imTu >= IM_MS) return res();
        hen.current = window.setTimeout(tick, 100);
      };
      tick();
    });
    moKhoa.current = null;
    if (hen.current) window.clearTimeout(hen.current);
    hen.current = null;
    if (id !== phien.current) {
      if (r.state === 'recording') r.cancel();
      return;
    }

    // Khong nghe thay tieng nao: dung lai cho nguoi hoc, KHONG nop ban ghi rong.
    if (noiMs < TOI_THIEU_NOI_MS && !bamXong.current) {
      r.cancel();
      rec.current = null;
      setLoi('Không nghe thấy anh nói. Bấm Tiếp tục để nghe lại câu này.');
      setBuoc('tam_dung');
      return;
    }

    let ghi: { blob: Blob; mime: string };
    try {
      ghi = await r.stop();
    } catch (e) {
      rec.current = null;
      if (id === phien.current) {
        setLoi((e as Error).message);
        setBuoc('tam_dung');
      }
      return;
    }
    rec.current = null;
    const u = URL.createObjectURL(ghi.blob);
    minhUrls.current.push(u);
    capNhat(j, { tt: 'cham', minh: u, kq: undefined, loi: undefined });
    // Cham NGAM — khong bat cho giua cac cau.
    void cham(j, ghi.blob, ghi.mime);
    tiepTu.current = j + 1;
    if (id !== phien.current) return;
    hen.current = window.setTimeout(() => void chayCau(j + 1, id), NGHI_MS);
  };

  const chayCau = async (j: number, id: number) => {
    if (id !== phien.current) return;
    tiepTu.current = j;
    if (j >= n) {
      setDangChay(null);
      setBuoc('xong');
      return;
    }
    const it = p.items[j]!;
    setK(j);
    setBuoc('nghe');
    setLoi('');
    // Co san thi phat NGAY, van con nam trong cu bam cua nguoi hoc. Chua co
    // moi phai cho tai.
    let url = daTai.current.get(it.id);
    if (!url) {
      try {
        url = await taiAudio(it.id);
        daTai.current.set(it.id, url);
      } catch (e) {
        if (id === phien.current) {
          setLoi((e as Error).message);
          setBuoc('tam_dung');
        }
        return;
      }
      if (id !== phien.current) return;
    }
    const ok = await phatMau(j, url);
    if (id !== phien.current) return;
    if (!ok) {
      setLoi('Máy không phát được câu mẫu. Bấm Tiếp tục để thử lại.');
      setBuoc('tam_dung');
      return;
    }
    const a = audio.current!;
    const dur = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 3;
    await thuCau(j, id, dur);
  };

  /** Goi TU CU BAM cua nguoi hoc (xem chayCau). */
  const batDauTu = (j: number) => {
    dungHet();
    const id = ++phien.current;
    setLoi('');
    void chayCau(j, id);
  };

  const tamDung = () => {
    phien.current += 1;
    dungHet();
    setDangChay(null);
    setBuoc('tam_dung');
  };

  const xongCau = () => {
    bamXong.current = true;
    moKhoa.current?.();
  };

  const lamLai = () => {
    vong.current += 1;
    for (const u of minhUrls.current) URL.revokeObjectURL(u);
    minhUrls.current = [];
    setKq(p.items.map(() => ({ tt: 'cho' as const })));
    batDauTu(0);
  };

  const thoat = () => {
    phien.current += 1;
    dungHet();
    onThoat();
  };

  const daCham = kq.filter((x) => x.tt === 'xong' && x.kq);
  const tongDung = daCham.reduce((a, x) => a + x.kq!.correct, 0);
  const tongTu = daCham.reduce((a, x) => a + x.kq!.total, 0);
  const conCham = kq.some((x) => x.tt === 'cham');
  // Chi cho bam nghe lai tung cau khi khong dang chay doan.
  const ranh = buoc === 'xong' || buoc === 'tam_dung';

  return (
    <div class="flex min-h-[85dvh] flex-col">
      <header class="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <span class="min-w-0 truncate text-[13px] text-vi">
          {p.emoji ? `${p.emoji} ` : ''}
          {p.title} · Câu {Math.min(k + 1, n)}/{n}
        </span>
        <button onClick={thoat} class="shrink-0 text-[13px] text-vi">
          Đoạn khác
        </button>
      </header>

      <div class="flex-1 px-5 pt-5">
        {(buoc === 'chuan_bi' || buoc === 'san_sang') && (
          <p class="mb-4 text-[13.5px] leading-snug text-vi">
            Bấm <b class="text-en">Bắt đầu</b>. AI đọc câu 1 — nghe hết rồi nói lại. Ngừng khoảng một giây là
            tự sang câu sau.
          </p>
        )}

        {buoc === 'xong' && (
          <div class="mb-4 rounded-2xl border border-accent/40 bg-accent/10 px-4 py-3">
            <p class="text-[16px] font-semibold text-en">Xong cả đoạn</p>
            <p class="mt-0.5 text-[13px] text-vi">
              {conCham ? 'Đang chấm nốt…' : tongTu ? `${tongDung}/${tongTu} từ đúng` : 'Chưa chấm được câu nào.'}
            </p>
            <p class="mt-1.5 text-[12px] leading-snug text-vi">
              Bấm ▶ Mẫu rồi ▶ Mình ở từng câu để tự nghe ra chỗ lệch.
            </p>
          </div>
        )}

        <div class="flex flex-col gap-2.5 pb-4">
          {p.items.map((it, j) => {
            const x = kq[j]!;
            const dangLam = j === k && (buoc === 'nghe' || buoc === 'noi');
            const chu = daChu.current.get(it.id) ?? null;
            const sai = x.kq?.words.filter((w) => w.status === 'missing' || w.status === 'wrong') ?? [];
            return (
              <div
                key={it.id}
                ref={(el) => {
                  khoiCau.current[j] = el;
                }}
                class={cx(
                  'rounded-xl border px-4 py-3',
                  dangLam ? 'border-accent bg-surface' : 'border-line',
                  !dangLam && buoc !== 'xong' && j > k && 'opacity-60',
                )}
              >
                {dangChay === j && chu?.length ? (
                  <ChuChay chu={chu} idx={cc.idx} cls="text-[16.5px] leading-relaxed text-en" />
                ) : (
                  <p class="text-[16.5px] leading-relaxed text-en">{it.text}</p>
                )}
                {it.vi && <p class="mt-1 text-[12.5px] leading-snug text-vi">{it.vi}</p>}
                {dangLam && it.focus_vi && (
                  <p class="mt-2 rounded-lg bg-accent/10 px-3 py-1.5 text-[12px] leading-snug text-accent">
                    🎯 {it.focus_vi}
                  </p>
                )}
                {dangLam && buoc === 'noi' && (
                  <p class="mt-2 text-[13.5px] font-medium text-accent">🎙 Tới anh — nói lại câu này</p>
                )}
                {x.tt === 'cham' && <p class="mt-2 text-[12.5px] text-vi">Đang chấm…</p>}
                {x.tt === 'loi' && <p class="mt-2 text-[12.5px] text-bad">{x.loi}</p>}
                {x.tt === 'xong' && x.kq && <DongKq r={x.kq} sai={sai.map((w) => w.target)} />}
                {ranh && x.minh && (
                  <div class="mt-2.5 flex gap-2">
                    <button
                      onClick={() => {
                        const u = daTai.current.get(it.id);
                        if (u) void phatMau(j, u);
                      }}
                      class="rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-en"
                    >
                      ▶ Mẫu
                    </button>
                    <button
                      onClick={() => phatMinh(x.minh!)}
                      class="rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-en"
                    >
                      ▶ Mình
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div class="sticky bottom-0 border-t border-line bg-ink/95 px-4 pb-3 pt-3 backdrop-blur">
        {loi && (
          <p class="mb-2 rounded-lg bg-bad/10 px-3 py-2 text-[13px] leading-snug text-bad">{loi}</p>
        )}
        {buoc === 'chuan_bi' && (
          <button disabled class="w-full rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink opacity-40">
            Đang tải mẫu…
          </button>
        )}
        {buoc === 'san_sang' && (
          <button
            onClick={() => batDauTu(0)}
            class="w-full rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink"
          >
            ▶ Bắt đầu
          </button>
        )}
        {buoc === 'nghe' && (
          <div class="flex items-center gap-2">
            <p class="flex-1 text-[14.5px] text-en">🔊 AI đang đọc câu {k + 1}…</p>
            <button onClick={tamDung} class="rounded-xl border border-line px-4 py-3 text-[14px] text-vi">
              ⏸ Dừng
            </button>
          </div>
        )}
        {buoc === 'noi' && (
          <>
            <div class="mb-2 h-1 overflow-hidden rounded bg-surface-2">
              <div class="h-full bg-accent" style={{ width: `${Math.round(conLai * 100)}%` }} />
            </div>
            <div class="flex gap-2">
              <button
                onClick={xongCau}
                class="flex-1 rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink"
              >
                ✓ Xong câu
              </button>
              <button onClick={tamDung} class="rounded-xl border border-line px-4 py-4 text-[14px] text-vi">
                ⏸
              </button>
            </div>
          </>
        )}
        {buoc === 'tam_dung' && (
          <div class="flex gap-2">
            <button
              onClick={() => batDauTu(tiepTu.current)}
              class="flex-1 rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink"
            >
              ▶ Tiếp tục · câu {Math.min(tiepTu.current + 1, n)}
            </button>
            <button onClick={lamLai} class="rounded-xl border border-line px-4 py-4 text-[14px] text-vi">
              Từ đầu
            </button>
          </div>
        )}
        {buoc === 'xong' && (
          <div class="flex gap-2">
            <button
              onClick={lamLai}
              class="flex-1 rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink"
            >
              Làm lại đoạn này
            </button>
            <button onClick={thoat} class="rounded-xl border border-line px-4 py-4 text-[14px] text-vi">
              Đoạn khác
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Mot dong ket qua gon cho tung cau trong che do ca doan. */
function DongKq({ r, sai }: { r: ShadowResult; sai: string[] }) {
  const t = r.timing.tempo_ratio;
  const nhip =
    t === null
      ? ''
      : t > 1.1
        ? ` · chậm hơn mẫu ${Math.round((t - 1) * 100)}%`
        : t < 0.9
          ? ` · nhanh hơn mẫu ${Math.round((1 - t) * 100)}%`
          : ' · tốc độ khớp mẫu';
  return (
    <div class="mt-2 text-[12.5px] leading-snug">
      <span
        class={cx('font-medium', r.pte_score >= 80 ? 'text-accent' : r.pte_score >= 60 ? 'text-warn' : 'text-bad')}
      >
        {r.correct}/{r.total} từ đúng
      </span>
      <span class="text-vi">{nhip}</span>
      {r.dropped_endings > 0 && <span class="text-warn"> · rụng {r.dropped_endings} đuôi</span>}
      {sai.length > 0 && <p class="mt-1 text-vi">Sai/thiếu: <span class="text-warn">{sai.join(', ')}</span></p>}
    </div>
  );
}
