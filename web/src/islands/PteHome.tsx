import { useEffect, useState } from 'preact/hooks';
import { get, post, put, ApiError, type PtePlanView, type PteSkillView, type PteTaskFact } from '../lib/api';
import { qp } from '../lib/qs';
import { cx } from '../lib/cx';

/**
 * Tab PTE — tong quan lo trinh (11/09/2026).
 *
 * Duy thi PTE Academic thang 03/2027, muc tieu 65. Man nay tra loi ba cau:
 * con bao lau · dang o giai doan nao · HOM NAY hoc gi.
 *
 * ⚠️ Diem trong app KHONG du doan diem PTE. Can cu that duy nhat la diem thi
 * thu chinh thuc cua Pearson, Duy tu nhap. Man hinh noi thang dieu nay.
 *
 * Su that ve de thi (22 dang, luat cham) lay tu api/content/pte-exam-facts.json
 * — nguon pearsonpte.com, khong phai blog luyen thi.
 */

const KY_NANG_VI: Record<string, string> = { L: 'Nghe', R: 'Đọc', S: 'Nói', W: 'Viết' };

export default function PteHome() {
  // Moi hook PHAI goi truoc bat ky lenh return nao — goi hook co dieu kien la
  // sai quy tac hook, thu tu hook lech giua cac lan render.
  const [v, setV] = useState<PtePlanView | null>(null);
  const [err, setErr] = useState('');
  const [suaNgay, setSuaNgay] = useState(false);
  const [nhapThiThu, setNhapThiThu] = useState(false);
  const [xemDang, setXemDang] = useState(false);

  // Link cu /pte?mode=rs|wfd van phai chay: chuyen sang man bai tap.
  const modeCu = qp('mode');
  const chuyenCu = modeCu === 'rs' || modeCu === 'wfd';

  const tai = () =>
    get<PtePlanView>('/pte/plan')
      .then(setV)
      .catch((e) => setErr(e instanceof ApiError ? e.message : String(e)));

  useEffect(() => {
    if (chuyenCu) window.location.replace(`/pte-drill?mode=${modeCu}`);
    else void tai();
  }, []);

  if (chuyenCu) return null;

  if (err) return <p class="px-5 py-16 text-center text-[14px] text-bad">{err}</p>;
  if (!v) return <p class="px-5 py-16 text-center text-[14px] text-vi">Đang mở lộ trình…</p>;

  const ph = v.today.phase;
  const tpl = v.facts?.template_rule;

  return (
    <div class="px-5 pb-8 pt-7">
      <header class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-[24px] font-bold leading-tight text-en">PTE Academic</h1>
          <button onClick={() => setSuaNgay(!suaNgay)} class="mt-1 text-[13.5px] text-vi">
            Đích <b class="text-en">{v.plan.target}</b> · thi {ngayVi(v.plan.exam_date)} <span class="text-vi/60">· sửa</span>
          </button>
        </div>
        <div class="text-right">
          <p class="text-[30px] font-bold leading-none tabular-nums text-accent">{Math.max(0, ph.days_left)}</p>
          <p class="mt-1 text-[11.5px] text-vi">ngày nữa</p>
        </div>
      </header>

      {suaNgay && <SuaKeHoach plan={v.plan} onXong={() => { setSuaNgay(false); void tai(); }} />}

      {/* Bon ky nang — them 11/09: Duy bao "chua ro ve nghe noi doc viet". */}
      {v.skills && v.skills.length > 0 && (
        <section class="mt-5">
          <h2 class="mb-2.5 text-[12px] uppercase tracking-wide text-vi">Bốn kỹ năng · luyện 14 ngày qua</h2>
          <div class="grid grid-cols-2 gap-2">
            {v.skills.map((s) => (
              <OKyNang key={s.skill} s={s} />
            ))}
          </div>
          <p class="mt-2 text-[11.5px] leading-snug text-vi">
            Góc phải: điểm thi thử chính thức gần nhất / đích. Một lượt Nhại câu tính cho cả Nghe lẫn Nói —
            Pearson chấm dạng này vào cả hai.
          </p>
        </section>
      )}

      {/* Giai doan */}
      <section class="mt-5 rounded-2xl border border-line bg-surface px-4 py-4">
        <p class="text-[12px] uppercase tracking-wide text-vi">Giai đoạn · còn {ph.weeks_left} tuần</p>
        <p class="mt-1 text-[17px] font-semibold text-en">{ph.ten}</p>
        <p class="mt-1.5 text-[13px] leading-snug text-vi">{ph.mo_ta}</p>
        {ph.next_mock && (
          <p class="mt-2.5 text-[12.5px] text-accent">
            Thi thử chính thức bộ {ph.next_mock.set_no}: {ph.next_mock.khi_vi}
          </p>
        )}
      </section>

      {/* Hom nay hoc gi */}
      <section class="mt-6">
        <h2 class="mb-2.5 text-[12px] uppercase tracking-wide text-vi">
          Hôm nay · {v.today.minutes_total} phút
        </h2>
        <ul class="flex flex-col gap-2">
          {v.today.blocks.map((b) => {
            const noiDung = (
              <>
                <span class="flex items-center justify-between gap-3">
                  <span class="text-[15px] font-medium text-en">{b.name_vi}</span>
                  <span class="shrink-0 text-[12.5px] tabular-nums text-vi">
                    {b.id === 'mock' ? '~2 giờ' : `${b.minutes} phút`}
                  </span>
                </span>
                <span class="mt-1 block text-[12px] leading-snug text-vi">{b.why_vi}</span>
                {!b.in_app && (
                  <span class="mt-1.5 inline-block rounded bg-warn/15 px-1.5 py-0.5 text-[11px] text-warn">
                    ngoài app
                  </span>
                )}
              </>
            );
            const cls = cx(
              'block rounded-xl border px-4 py-3',
              b.id === 'mock' ? 'border-accent/50 bg-accent/10' : 'border-line bg-surface',
            );
            return (
              <li key={b.id}>
                {b.href ? (
                  <a href={b.href} target={b.in_app ? undefined : '_blank'} rel="noopener" class={cls}>
                    {noiDung}
                  </a>
                ) : (
                  <div class={cls}>{noiDung}</div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Luat template — dieu quan trong nhat nhieu khoa luyen van day sai */}
      {tpl && (
        <section class="mt-6 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3">
          <p class="text-[13px] font-semibold text-bad">⚠️ Không học template thuộc lòng</p>
          <p class="mt-1 text-[12.5px] leading-snug text-bad/90">{tpl.vi}</p>
          {tpl.quote && <p class="mt-1.5 text-[11.5px] italic text-bad/80">Pearson: “{tpl.quote}”</p>}
        </section>
      )}

      {/* Diem luyen tap */}
      <section class="mt-6">
        <h2 class="mb-2.5 text-[12px] uppercase tracking-wide text-vi">Luyện trong app · 14 ngày qua</h2>
        <div class="grid grid-cols-3 gap-2">
          {v.practice.map((p) => (
            <a key={p.id} href={p.href ?? '#'} class="rounded-xl border border-line bg-surface px-2 py-3 text-center">
              <p class={cx('text-[20px] font-semibold tabular-nums', p.avg_14d === null ? 'text-vi/50' : p.avg_14d >= 80 ? 'text-accent' : 'text-warn')}>
                {p.avg_14d === null ? '—' : `${p.avg_14d}%`}
              </p>
              <p class="mt-1 text-[11.5px] leading-tight text-vi">{p.name_vi}</p>
              <p class="text-[10.5px] text-vi/70">{p.attempts_14d} lượt</p>
            </a>
          ))}
        </div>
        <p class="mt-2 text-[11.5px] leading-snug text-vi">
          Mốc luyện tập, <b>không dự đoán điểm PTE</b> — máy chấm của app hiền hơn máy của Pearson.
        </p>
        <div class="mt-2.5 flex flex-wrap gap-x-2 gap-y-1">
          <a href="/pte-speaking" class="text-[13px] text-accent">Đọc to →</a>
          <span class="text-vi/40">·</span>
          <a href="/pte-drill?mode=rs" class="text-[13px] text-accent">Nhại câu →</a>
          <span class="text-vi/40">·</span>
          <a href="/pte-drill?mode=wfd" class="text-[13px] text-accent">Nghe — gõ →</a>
          <span class="text-vi/40">·</span>
          <a href="/pte-reading" class="text-[13px] text-accent">Đọc →</a>
          <span class="text-vi/40">·</span>
          <a href="/pte-listening" class="text-[13px] text-accent">Nghe →</a>
          <span class="text-vi/40">·</span>
          <a href="/pte-open" class="text-[13px] text-accent">Nói &amp; Viết →</a>
        </div>
      </section>

      {/* Thi thu chinh thuc */}
      <section class="mt-6">
        <div class="mb-2.5 flex items-center justify-between">
          <h2 class="text-[12px] uppercase tracking-wide text-vi">Thi thử chính thức</h2>
          <button onClick={() => setNhapThiThu(!nhapThiThu)} class="text-[13px] text-accent">
            {nhapThiThu ? 'Đóng' : '+ Nhập điểm'}
          </button>
        </div>
        {nhapThiThu && <NhapThiThu onXong={() => { setNhapThiThu(false); void tai(); }} />}
        {v.mocks.length === 0 ? (
          <p class="rounded-xl border border-dashed border-line px-4 py-3 text-[13px] leading-snug text-vi">
            Chưa có. Đây là căn cứ thật duy nhất — nhập điểm 4 kỹ năng từ báo cáo Pearson, lộ trình sẽ tự
            dồn vào kỹ năng thấp nhất.{' '}
            {v.facts?.sources.practice_test && (
              <a href={v.facts.sources.practice_test} target="_blank" rel="noopener" class="text-accent">Mua bài thi thử ›</a>
            )}
          </p>
        ) : (
          <ul class="flex flex-col gap-1.5">
            {v.mocks.map((m) => (
              <li key={m.id} class="rounded-xl border border-line bg-surface px-3.5 py-2.5">
                <div class="flex items-center justify-between">
                  <span class="text-[13px] text-vi">{ngayVi(m.taken_on)}{m.set_no ? ` · bộ ${m.set_no}` : ''}</span>
                  <span class="text-[16px] font-semibold tabular-nums text-en">{m.overall}</span>
                </div>
                <p class="mt-1 text-[12px] tabular-nums text-vi">
                  Nghe {m.listening} · Đọc {m.reading} · Nói {m.speaking} · Viết {m.writing}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 22 dang bai */}
      <section class="mt-6">
        <button onClick={() => setXemDang(!xemDang)} class="text-[13px] text-accent">
          {xemDang ? 'Ẩn' : 'Xem'} cả {v.facts?.task_count ?? 22} dạng bài · app có {v.facts?.in_app ?? 3}
        </button>
        {xemDang && <DanhSachDang />}
      </section>

      {v.facts && (
        <p class="mt-6 text-[11px] leading-snug text-vi/70">
          Thông tin đề thi kiểm lần cuối {ngayVi(v.facts.checked_at)} từ pearsonpte.com. Đề đổi từ{' '}
          {ngayVi(v.facts.format_changed_on)} (20 → 22 dạng). PTE 63 ≈ IELTS 7.0.
        </p>
      )}
    </div>
  );
}

/** Mot o ky nang: de co may dang, app luyen duoc may, luyen bao nhieu, thi thu bao nhieu. */
function OKyNang({ s }: { s: PteSkillView }) {
  const trong = s.in_app.length === 0;
  return (
    <div class={cx('rounded-xl border px-3 py-3', trong ? 'border-dashed border-line' : 'border-line bg-surface')}>
      <div class="flex items-baseline justify-between gap-2">
        <span class="text-[16px] font-semibold text-en">{s.name_vi}</span>
        {s.mock ? (
          <span class={cx('text-[13px] font-medium tabular-nums', s.mock.score >= s.target ? 'text-accent' : 'text-bad')}>
            {s.mock.score}
            <span class="font-normal text-vi/60">/{s.target}</span>
          </span>
        ) : (
          <span class="text-[10.5px] text-vi/60">chưa thi thử</span>
        )}
      </div>
      <p class="mt-0.5 text-[11.5px] text-vi">
        {s.task_count} dạng trong đề · app có {s.in_app.length}
      </p>
      {trong ? (
        <p class="mt-2 text-[12px] leading-snug text-warn">App chưa có bài {s.name_vi.toLowerCase()} — đợt kế tiếp sẽ có.</p>
      ) : (
        <>
          <p
            class={cx(
              'mt-2 text-[20px] font-semibold leading-none tabular-nums',
              s.avg_14d === null ? 'text-vi/50' : s.avg_14d >= 80 ? 'text-accent' : 'text-warn',
            )}
          >
            {s.avg_14d === null ? '—' : `${s.avg_14d}%`}
          </p>
          <p class="mt-1 text-[11px] text-vi/80">
            {s.attempts_14d} lượt{s.shadow_14d ? ` · ${s.shadow_14d} lượt shadow` : ''}
          </p>
          <div class="mt-2 flex flex-wrap gap-1">
            {s.in_app.map(
              (t) =>
                t.href && (
                  <a key={t.id} href={t.href} class="rounded bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent">
                    {t.name_vi} ›
                  </a>
                ),
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SuaKeHoach({ plan, onXong }: { plan: { exam_date: string; target: number }; onXong: () => void }) {
  const [ngay, setNgay] = useState(plan.exam_date);
  const [dich, setDich] = useState(String(plan.target));
  const [loi, setLoi] = useState('');
  const luu = async () => {
    setLoi('');
    try {
      await put('/pte/plan', { exam_date: ngay, target: Number(dich) });
      onXong();
    } catch (e) {
      setLoi(e instanceof ApiError ? e.message : String(e));
    }
  };
  return (
    <div class="mt-3 rounded-xl border border-line bg-surface px-4 py-3">
      <label class="block text-[12.5px] text-vi">
        Ngày thi
        <input type="date" value={ngay} onInput={(e) => setNgay((e.target as HTMLInputElement).value)}
          class="mt-1 block w-full rounded-lg border border-line bg-ink px-3 py-2 text-[15px] text-en" />
      </label>
      <label class="mt-2.5 block text-[12.5px] text-vi">
        Điểm mục tiêu (10–90)
        <input type="number" min={10} max={90} value={dich} onInput={(e) => setDich((e.target as HTMLInputElement).value)}
          class="mt-1 block w-full rounded-lg border border-line bg-ink px-3 py-2 text-[15px] text-en" />
      </label>
      {loi && <p class="mt-2 text-[12.5px] text-bad">{loi}</p>}
      <button onClick={() => void luu()} class="mt-3 w-full rounded-lg bg-accent py-2.5 text-[14px] font-semibold text-ink">
        Lưu
      </button>
    </div>
  );
}

function NhapThiThu({ onXong }: { onXong: () => void }) {
  const homNay = new Date().toLocaleDateString('en-CA');
  const [f, setF] = useState<Record<string, string>>({ taken_on: homNay, set_no: '', overall: '', listening: '', reading: '', speaking: '', writing: '' });
  const [loi, setLoi] = useState('');
  const doi = (k: string) => (e: Event) => setF({ ...f, [k]: (e.target as HTMLInputElement).value });
  const luu = async () => {
    setLoi('');
    try {
      await post('/pte/mock', {
        taken_on: f.taken_on,
        set_no: f.set_no ? Number(f.set_no) : null,
        overall: Number(f.overall),
        listening: Number(f.listening),
        reading: Number(f.reading),
        speaking: Number(f.speaking),
        writing: Number(f.writing),
      });
      onXong();
    } catch (e) {
      setLoi(e instanceof ApiError ? e.message : String(e));
    }
  };
  const o = (k: string, nhan: string) => (
    <label class="block text-[12px] text-vi">
      {nhan}
      <input type="number" min={10} max={90} value={f[k]} onInput={doi(k)}
        class="mt-1 block w-full rounded-lg border border-line bg-ink px-2 py-2 text-center text-[15px] tabular-nums text-en" />
    </label>
  );
  return (
    <div class="mb-3 rounded-xl border border-line bg-surface px-4 py-3">
      <div class="grid grid-cols-2 gap-2">
        <label class="block text-[12px] text-vi">
          Ngày thi thử
          <input type="date" value={f.taken_on} onInput={doi('taken_on')}
            class="mt-1 block w-full rounded-lg border border-line bg-ink px-2 py-2 text-[14px] text-en" />
        </label>
        <label class="block text-[12px] text-vi">
          Bộ đề Pearson
          <select value={f.set_no} onChange={doi('set_no')}
            class="mt-1 block w-full rounded-lg border border-line bg-ink px-2 py-2 text-[14px] text-en">
            <option value="">khác</option>
            <option value="1">bộ 1</option>
            <option value="2">bộ 2</option>
            <option value="3">bộ 3</option>
          </select>
        </label>
      </div>
      <div class="mt-2.5">{o('overall', 'Điểm tổng')}</div>
      <div class="mt-2.5 grid grid-cols-4 gap-2">
        {o('listening', 'Nghe')}
        {o('reading', 'Đọc')}
        {o('speaking', 'Nói')}
        {o('writing', 'Viết')}
      </div>
      {loi && <p class="mt-2 text-[12.5px] text-bad">{loi}</p>}
      <button onClick={() => void luu()} class="mt-3 w-full rounded-lg bg-accent py-2.5 text-[14px] font-semibold text-ink">
        Lưu điểm
      </button>
    </div>
  );
}

const PHAN_VI: Record<string, string> = { speaking_writing: 'Nói & Viết', reading: 'Đọc', listening: 'Nghe' };

function DanhSachDang() {
  const [ds, setDs] = useState<PteTaskFact[] | null>(null);
  useEffect(() => void get<PteTaskFact[]>('/pte/tasks').then(setDs).catch(() => setDs([])), []);
  if (!ds) return <p class="mt-2 text-[12.5px] text-vi">Đang tải…</p>;
  return (
    <div class="mt-3 flex flex-col gap-4">
      {['speaking_writing', 'reading', 'listening'].map((sec) => (
        <div key={sec}>
          <p class="mb-1.5 text-[11.5px] uppercase tracking-wide text-vi">{PHAN_VI[sec]}</p>
          <ul class="flex flex-col gap-1.5">
            {ds.filter((t) => t.section === sec).map((t) => (
              <li key={t.id} class="rounded-lg border border-line bg-surface px-3 py-2">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-[13.5px] text-en">
                    {t.name_vi}
                    {t.new_2025 && <span class="ml-1.5 rounded bg-accent/15 px-1 text-[10px] text-accent">mới 2025</span>}
                  </span>
                  <span class="shrink-0 text-[11.5px] text-vi">
                    {t.items[0]}–{t.items[1]} câu · {t.skills.map((s) => KY_NANG_VI[s]).join('+')}
                  </span>
                </div>
                <p class="text-[11px] text-vi/70">{t.name}{t.app ? '' : ' · ngoài app'}</p>
                {t.strategies_vi.map((s, i) => (
                  <p key={i} class="mt-1 text-[12px] leading-snug text-vi">• {s}</p>
                ))}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ngayVi(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
