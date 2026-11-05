import { useEffect, useState } from 'preact/hooks';
import { get, type FrDeckSummary, type FrRoadmap } from '../lib/api';
import LangPicker from './LangPicker';

/**
 * Trang chu khong gian TIENG PHAP.
 *
 * Duy chot 07/09/2026: tieng Anh va tieng Phap la HAI KHONG GIAN RIENG. Truoc
 * trang nay, chon tieng Phap roi bam bat ky tab nao ngoai "On tu" deu ra noi
 * dung tieng Anh — Duy bao "vao tieng Phap ma hoc tieng Anh".
 *
 * NGUYEN TAC: chua co noi dung thi NOI THANG la chua co. Khong bao gio hien
 * noi dung tieng Anh the cho, va khong dat nut dan toi trang rong gia.
 *
 * Dich: NCLC 7 (B2) CA BON ky nang, qua TEF Canada hoac TCF Canada. Express
 * Entry khong cong diem mot phan — 3 ky nang B2 + 1 ky nang B1 = 0 diem thuong.
 */
export default function FrHome() {
  const [doiNgonNgu, setDoiNgonNgu] = useState(false);
  const [kho, setKho] = useState<FrDeckSummary | null>(null);
  const [lo, setLo] = useState<FrRoadmap | null>(null);

  useEffect(() => {
    // Dot B (12/09): doc /fr/deck/summary — no mo tu moi cua hom nay truoc khi dem.
    get<FrDeckSummary>('/fr/deck/summary')
      .then(setKho)
      .catch(() => setKho(null));
    get<FrRoadmap>('/fr/learn/topics')
      .then(setLo)
      .catch(() => setLo(null));
  }, []);

  if (doiNgonNgu) return <LangPicker />;

  return (
    <div class="px-5 pb-8 pt-7">
      <header>
        <h1 class="text-[24px] font-bold leading-tight text-en">Tiếng Pháp</h1>
        <button
          onClick={() => setDoiNgonNgu(true)}
          class="mt-1 flex items-center gap-1.5 text-[13.5px] text-vi"
        >
          <span>🇫🇷</span>
          <span>TEF / TCF Canada</span>
          <span class="text-vi/60">· đổi</span>
        </button>
      </header>

      <section class="mt-6 rounded-2xl border border-line bg-surface px-4 py-4">
        <p class="text-[13px] uppercase tracking-wide text-vi">Đích</p>
        <p class="mt-1.5 text-[16px] font-semibold text-en">NCLC 7 — B2 cả bốn kỹ năng</p>
        <p class="mt-1.5 text-[13px] leading-snug text-vi">
          Cộng điểm Express Entry. Thiếu một kỹ năng là mất trắng điểm thưởng — kỹ năng yếu nhất
          quyết định tất cả.
        </p>
      </section>

      <section class="mt-6">
        <h2 class="mb-2.5 text-[12px] uppercase tracking-wide text-vi">Hôm nay</h2>
        <div class="flex flex-col gap-2">
          {lo?.next ? (
            <a href={`/fr-lesson?topic=${lo.next.topic_id}&stage=${lo.next.stage}`} class="flex items-center gap-3 rounded-2xl bg-accent px-4 py-3.5 text-ink">
              <span class="text-[24px] leading-none">{lo.next.emoji}</span>
              <span class="min-w-0 flex-1">
                <span class="block text-[11.5px] font-medium opacity-70">Bài tiếp theo · chặng {lo.next.stage}/4</span>
                <span class="block truncate text-[15.5px] font-semibold">{lo.next.name_vi}</span>
              </span>
              <span class="shrink-0">›</span>
            </a>
          ) : lo && lo.topics.length ? (
            <a href="/fr-roadmap" class="rounded-2xl border border-accent/30 bg-accent/[0.06] px-4 py-3.5 text-[14.5px] text-accent">
              Xong cả 8 chủ đề A1 ›
            </a>
          ) : null}

          {kho && kho.total > 0 ? (
            <a href="/fr-review" class="flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3.5">
              <span>
                <span class="block text-[15px] text-en">Ôn từ · gõ lại từ</span>
                <span class="block text-[12px] text-vi">
                  {kho.total} từ · đã thuộc {kho.learned} · còn {kho.waiting} chờ mở ({kho.per_day}/ngày)
                </span>
              </span>
              <span class="shrink-0 text-[13px] text-vi">{kho.due} tới hạn ›</span>
            </a>
          ) : (
            <p class="rounded-xl border border-dashed border-line px-4 py-3.5 text-[13.5px] leading-snug text-vi">
              Chưa có từ tiếng Pháp nào trong kho. Học xong chặng 1 của một chủ đề là 12 từ vào đây.
            </p>
          )}

          <a href="/fr-dictee" class="flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3.5">
            <span>
              <span class="block text-[15px] text-en">Nghe – viết chính tả</span>
              <span class="block text-[12px] text-vi">Máy đọc, bạn gõ. Chấm từng chữ có dấu.</span>
            </span>
            <span class="shrink-0 text-vi">›</span>
          </a>
        </div>
      </section>

      {/* Noi thang cai dang xay. Khong dat nut, vi bam vao se toi trang rong. */}
      <section class="mt-6">
        <h2 class="mb-2.5 text-[12px] uppercase tracking-wide text-vi">Đang soạn</h2>
        <ul class="flex flex-col gap-2">
          {[['Shadowing tiếng Pháp', 'Nghe mẫu, nói đè theo, đo nhịp.']].map(([ten, mo]) => (
            <li key={ten} class="rounded-xl bg-surface/50 px-4 py-3 opacity-70">
              <p class="text-[14.5px] text-en">{ten}</p>
              <p class="mt-0.5 text-[12.5px] text-vi">{mo}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
