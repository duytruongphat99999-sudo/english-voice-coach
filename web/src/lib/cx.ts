/**
 * Ghep class co dieu kien.
 *
 * KHONG dung `class:list` trong file .tsx — do la directive cua Astro, chi
 * chay trong .astro. Preact se render nguyen chuoi "class:list" thanh mot
 * attribute vo nghia va toan bo style bien mat.
 */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
