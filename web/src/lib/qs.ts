/**
 * Doc query param o phia client.
 *
 * Astro build static nen khong the doc query luc build — moi thu phu thuoc
 * `?flow=`, `?scenario=`, `?step=` deu phai doc trong trinh duyet.
 */
export function qp(name: string, fallback = ''): string {
  if (typeof window === 'undefined') return fallback;
  return new URLSearchParams(window.location.search).get(name) ?? fallback;
}
