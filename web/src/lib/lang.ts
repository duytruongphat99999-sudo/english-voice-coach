/**
 * Ngon ngu dang hoc. Duy chot 07/09/2026: tieng Anh va tieng Phap la HAI KHONG
 * GIAN RIENG, khong dung nhau — chon ngay khi vao app.
 *
 * Luu o localStorage chu khong o cookie/session: day la lua chon cua NGUOI
 * DUNG tren THIET BI nay, khong phai trang thai cua tai khoan. Doi may thi
 * chon lai, va do la dung.
 *
 * Moi loi goi API cham vao kho tu deu phai kem `?lang=` — xem lib/api.ts.
 */
export type Lang = 'en' | 'fr';

export const LANGS: { id: Lang; ten: string; co: string; phu: string }[] = [
  { id: 'en', ten: 'Tiếng Anh', co: '🇬🇧', phu: 'PTE Academic' },
  { id: 'fr', ten: 'Tiếng Pháp', co: '🇫🇷', phu: 'TEF / TCF Canada' },
];

const KEY = 'evc_lang';

export function getLang(): Lang {
  try {
    return localStorage.getItem(KEY) === 'fr' ? 'fr' : 'en';
  } catch {
    // Tab an danh, hoac trinh duyet chan luu tru: roi ve tieng Anh.
    return 'en';
  }
}

/** Da tung chon chua? Chua thi man chu hien man chon thay vi vao thang. */
export function daChon(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

export function setLang(l: Lang): void {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* khong luu duoc thi thoi, phien nay van chay dung */
  }
}

/** Trang chu cua tung khong gian. Chon xong thi di thang toi day. */
export function homeOf(l: Lang): string {
  return l === 'fr' ? '/fr' : '/coach';
}

export function tenLang(l: Lang): string {
  return LANGS.find((x) => x.id === l)?.ten ?? 'Tiếng Anh';
}

export function coLang(l: Lang): string {
  return LANGS.find((x) => x.id === l)?.co ?? '🇬🇧';
}
