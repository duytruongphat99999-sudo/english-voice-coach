import { LANGS, homeOf, setLang, type Lang } from '../lib/lang';

/**
 * Man chon ngon ngu — hien ngay khi vao app neu chua tung chon.
 *
 * Duy chot 07/09/2026: tieng Anh va tieng Phap la HAI KHONG GIAN RIENG, khong
 * dung nhau. Chon o day, doi thi bam nut o trang chu.
 *
 * KHONG luu o server: day la lua chon cua nguoi dung tren THIET BI nay, khong
 * phai trang thai cua tai khoan.
 */
export default function LangPicker({ onPick }: { onPick?: (l: Lang) => void }) {
  const chon = (l: Lang) => {
    setLang(l);
    if (onPick) onPick(l);
    // Di THANG toi trang chu cua khong gian vua chon. Truoc day chi reload tai
    // cho, nen chon tieng Phap xong van dung o trang chu tieng Anh.
    else window.location.replace(homeOf(l));
  };

  return (
    <div class="flex min-h-[80dvh] flex-col justify-center px-5">
      <h1 class="text-[24px] font-bold text-en">Hôm nay học gì?</h1>
      <p class="mt-2 text-[14px] leading-relaxed text-vi">
        Hai kho tách riêng — từ vựng, lịch ôn, tiến độ đều không đụng nhau. Đổi lúc nào cũng được.
      </p>

      <div class="mt-8 flex flex-col gap-3">
        {LANGS.map((l, i) => (
          <button
            key={l.id}
            onClick={() => chon(l.id)}
            class="flex items-center gap-4 rounded-2xl border border-line bg-surface px-5 py-5 text-left active:bg-surface-2"
          >
            <span class="text-[30px] leading-none">{l.co}</span>
            <span class="flex-1">
              <span class="block text-[17px] font-semibold text-en">
                {i + 1}. {l.ten}
              </span>
              <span class="mt-0.5 block text-[13px] text-vi">{l.phu}</span>
            </span>
            <span class="text-[18px] text-vi">›</span>
          </button>
        ))}
      </div>
    </div>
  );
}
