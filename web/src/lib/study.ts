export type StudyItem = { en: string; vi: string; focus: string; audio?: string };
export type StudyLesson = { id: string; title: string; category: string; level: string; items: StudyItem[] };
export type Recall = { due: number; interval: number; reviews: number };
export type StudyProgress = { completed: string[]; recalls: Record<string, Recall>; days: string[]; last?: string };
export const STORAGE_KEY = 'evc_public_study_v1';
export const emptyProgress = (): StudyProgress => ({ completed: [], recalls: {}, days: [] });
export function loadProgress(): StudyProgress {
  try {
    const p = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (p && Array.isArray(p.completed) && Array.isArray(p.days) && p.recalls && typeof p.recalls === 'object') return p;
  } catch { /* Storage unavailable or damaged: keep learning. */ }
  return emptyProgress();
}
export function saveProgress(p: StudyProgress): boolean {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); return true; } catch { return false; }
}
export function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function normalizeAnswer(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}'\s]/gu, '').replace(/\s+/g, ' ').trim();
}
// Explicit recall confidence; a pronunciation score is not a memory score.
export function scheduleRecall(previous: Recall | undefined, remembered: boolean, now = Date.now()): Recall {
  const interval = remembered ? Math.min(60, previous ? Math.max(1, previous.interval * 2) : 1) : 0;
  return { interval, due: now + (remembered ? interval * 86400000 : 600000), reviews: (previous?.reviews || 0) + 1 };
}
