import { type Level, type PracticeAttempt, type Skill, type StudyLesson, type StudyProgress } from './study';

export const LEVELS:Level[]=['A1','A2','B1','B2','C1','C2'];
export const SKILLS:Skill[]=['listen','speak','read','write'];
export const SKILL_NAMES:Record<Skill,string>={listen:'Nghe',speak:'Nói',read:'Đọc',write:'Viết'};
export const LEVEL_NAMES:Record<Level,string>={A1:'Làm quen',A2:'Nền tảng',B1:'Giao tiếp vững',B2:'Tiếng Anh học thuật',C1:'Lập luận nâng cao',C2:'Diễn đạt chính xác'};
export const GOALS=[55,63,71,79,86,90];
export const INTEREST_NAMES={general:'Tiếng Anh chung',medical:'Ngành y',electrical:'Ngành điện'};
export type Interest=keyof typeof INTEREST_NAMES;
export type Learner={id:string;name:string;goal:number;minutes:number;interest:Interest;skillStart:Record<Skill,Level>};
export type LearnerBook={activeId:string;learners:Learner[]};
export const LEARNER_KEY='evc_learners_v1';
export const defaultLearner=():Learner=>({id:'',name:'Người học',goal:90,minutes:15,interest:'general',skillStart:{listen:'A1',speak:'A1',read:'A1',write:'A1'}});
export function validLearner(x:unknown):x is Learner{
  if(!x||typeof x!=='object')return false;
  const p=x as Learner;
  return typeof p.id==='string'&&p.id.length>0&&typeof p.name==='string'&&p.name.trim().length>0&&p.name.length<=60&&GOALS.includes(p.goal)&&[5,15,30].includes(p.minutes)&&Object.hasOwn(INTEREST_NAMES,p.interest)&&!!p.skillStart&&SKILLS.every(s=>LEVELS.includes(p.skillStart[s]));
}
export function loadLearners():LearnerBook{
  try{const x=JSON.parse(localStorage.getItem(LEARNER_KEY)||'null');if(x&&Array.isArray(x.learners)&&x.learners.every(validLearner))return {activeId:x.learners.some((l:Learner)=>l.id===x.activeId)?x.activeId:x.learners[0]?.id||'',learners:x.learners};}catch{}
  return {activeId:'',learners:[]};
}
export function saveLearners(book:LearnerBook):boolean{
  try{localStorage.setItem(LEARNER_KEY,JSON.stringify(book));return true;}catch{return false;}
}
export function activeLearner(book:LearnerBook):Learner|undefined{return book.learners.find(l=>l.id===book.activeId);}
export function skillLevel(learner:Learner,progress:StudyProgress,skill:Skill):Level{
  let index=LEVELS.indexOf(learner.skillStart[skill]);
  while(index<LEVELS.length-1&&progress.mastered?.includes(`${skill}:${LEVELS[index]}`))index++;
  return LEVELS[index];
}
export function evidenceFor(progress:StudyProgress,skill:Skill,level:Level){
  const unique=new Map<string,PracticeAttempt>();
  for(const a of progress.attempts||[])if(a.skill===skill&&a.level===level)unique.set(`${a.lessonId}:${a.item}`,a);
  const attempts=[...unique.values()].sort((a,b)=>b.at-a.at).slice(0,20);
  const correct=attempts.filter(a=>a.correct).length;
  const topics=new Set(attempts.map(a=>a.lessonId)).size;
  return {total:attempts.length,correct,topics,ratio:attempts.length?correct/attempts.length:0,ready:attempts.length>=10&&topics>=2&&correct/attempts.length>=.8};
}
export function withEvidence(progress:StudyProgress,attempt:PracticeAttempt):StudyProgress{
  const next={...progress,attempts:[...(progress.attempts||[]),attempt].slice(-2500)};
  if(evidenceFor(next,attempt.skill,attempt.level).ready)next.mastered=[...new Set([...(progress.mastered||[]),`${attempt.skill}:${attempt.level}`])];
  return next;
}
export function allowedInterest(learner:Learner,lesson:StudyLesson):boolean{
  return ['foundation','everyday','academic'].includes(lesson.category)||(learner.interest==='electrical'&&lesson.category==='electrical')||(learner.interest==='medical'&&['medical','derm'].includes(lesson.category));
}
export function recommendForSkill(lessons:StudyLesson[],learner:Learner,progress:StudyProgress,skill:Skill){
  const level=skillLevel(learner,progress,skill);
  const evidence=evidenceFor(progress,skill,level);
  const choices=lessons.filter(l=>l.level===level&&allowedInterest(learner,l));
  const common=choices.filter(l=>['foundation','everyday','academic'].includes(l.category));
  const specialty=choices.filter(l=>!common.includes(l));
  const count=choices.filter(l=>progress.completed.includes(`${l.id}:${skill}`)).length;
  // Two general topics before one optional specialty; never force a beginner into a trade.
  const ordered=count%3===2?[...specialty,...common]:[...common,...specialty];
  let lesson=ordered.find(l=>!progress.completed.includes(`${l.id}:${skill}`))||ordered[0]||lessons.find(l=>l.category==='foundation')||lessons[0];
  const previous=LEVELS[LEVELS.indexOf(level)-1];
  // Finishing two strong common topics may advance the skill immediately.
  // Offer its optional profession context as a bridge, rather than skipping it.
  if(previous&&progress.mastered?.includes(`${skill}:${previous}`)){
    const previousCommon=lessons.filter(l=>l.level===previous&&['foundation','everyday','academic'].includes(l.category)&&progress.completed.includes(`${l.id}:${skill}`));
    const practicedSpecialty=lessons.some(l=>l.level===previous&&!['foundation','everyday','academic'].includes(l.category)&&allowedInterest(learner,l)&&progress.completed.includes(`${l.id}:${skill}`));
    const bridge=lessons.find(l=>l.level===previous&&!['foundation','everyday','academic'].includes(l.category)&&allowedInterest(learner,l)&&!progress.completed.includes(`${l.id}:${skill}`));
    if(previousCommon.length>=2&&!practicedSpecialty&&bridge)lesson=bridge;
  }
  let support=false;
  if(evidence.total>=5&&evidence.ratio<.6){
    const recent=(progress.attempts||[]).filter(a=>a.skill===skill&&a.level===level&&!a.correct).sort((a,b)=>b.at-a.at)[0];
    lesson=lessons.find(l=>l.id===recent?.lessonId)||lesson;support=true;
  }
  return {lesson,skill,level,evidence,support};
}
export function recommend(lessons:StudyLesson[],learner:Learner,progress:StudyProgress){
  return SKILLS.map(skill=>recommendForSkill(lessons,learner,progress,skill)).sort((a,b)=>{
    const levelDifference=LEVELS.indexOf(a.level)-LEVELS.indexOf(b.level);
    if(levelDifference)return levelDifference;
    const practice=(s:Skill)=>progress.completed.filter(k=>k.endsWith(`:${s}`)).length;
    return practice(a.skill)-practice(b.skill)||a.evidence.ratio-b.evidence.ratio;
  })[0];
}
