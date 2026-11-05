export type StudyItem = { en: string; vi: string; focus: string; audio?: string };
export type StudyLesson = { id: string; title: string; category: string; level: string; items: StudyItem[] };
export type Skill = 'listen' | 'speak' | 'read' | 'write';
export type Level = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
export type PracticeAttempt = { lessonId:string; item:number; skill:Skill; level:Level; correct:boolean; source:'objective'|'self'; at:number };
export type Recall = { due: number; interval: number; reviews: number };
export type StudyProgress = { completed: string[]; recalls: Record<string, Recall>; days: string[]; last?: string; attempts?:PracticeAttempt[]; mastered?:string[]; sessions?:{lessonId:string;skill:Skill;at:number}[] };
export const STORAGE_KEY = 'evc_public_study_v1';
export const emptyProgress = (): StudyProgress => ({ completed: [], recalls: {}, days: [] });
export function validProgress(x:unknown):x is StudyProgress{
  if(!x||typeof x!=='object')return false;
  const p=x as StudyProgress;
  return Array.isArray(p.completed)&&p.completed.every(s=>typeof s==='string')&&Array.isArray(p.days)&&p.days.every(s=>typeof s==='string')&&!!p.recalls&&typeof p.recalls==='object'&&!Array.isArray(p.recalls)&&Object.values(p.recalls).every(r=>r&&Number.isFinite(r.due)&&Number.isFinite(r.interval)&&r.interval>=0&&Number.isFinite(r.reviews))&&(p.last===undefined||typeof p.last==='string')&&(p.mastered===undefined||(Array.isArray(p.mastered)&&p.mastered.every(s=>typeof s==='string')))&&(p.attempts===undefined||(Array.isArray(p.attempts)&&p.attempts.every(a=>a&&typeof a.lessonId==='string'&&Number.isInteger(a.item)&&a.item>=0&&['listen','speak','read','write'].includes(a.skill)&&['A1','A2','B1','B2','C1','C2'].includes(a.level)&&typeof a.correct==='boolean'&&['objective','self'].includes(a.source)&&Number.isFinite(a.at))))&&(p.sessions===undefined||(Array.isArray(p.sessions)&&p.sessions.every(s=>s&&typeof s.lessonId==='string'&&['listen','speak','read','write'].includes(s.skill)&&Number.isFinite(s.at))));
}
export const progressStorageKey = (learnerId?:string) => learnerId ? `${STORAGE_KEY}:${learnerId}` : STORAGE_KEY;
export function loadProgress(learnerId?:string): StudyProgress {
  try {
    const p = JSON.parse(localStorage.getItem(progressStorageKey(learnerId)) || 'null');
    if (validProgress(p)) return p;
  } catch { /* Storage unavailable or damaged: keep learning. */ }
  return emptyProgress();
}
export function saveProgress(p: StudyProgress, learnerId?:string): boolean {
  try { localStorage.setItem(progressStorageKey(learnerId), JSON.stringify(p)); return true; } catch { return false; }
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
