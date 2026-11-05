import {LEVELS,LEVEL_NAMES,SKILLS,SKILL_NAMES,skillLevel,evidenceFor,recommendForSkill,INTEREST_NAMES,type Learner} from '../lib/learner';
import type {Skill,StudyLesson,StudyProgress} from '../lib/study';
export function SkillProgress({learner,progress}:{learner:Learner;progress:StudyProgress}){
  return <div class="skill-progress-grid">{SKILLS.map(skill=>{
    const level=skillLevel(learner,progress,skill),evidence=evidenceFor(progress,skill,level);
    return <div class="skill-progress-item"><div><b>{SKILL_NAMES[skill]}</b><span>{level}</span></div><progress max={10} value={Math.min(10,evidence.total)} aria-label={`Thực hành ${SKILL_NAMES[skill]}`}/><small>{evidence.total} câu · {evidence.topics} chủ đề</small></div>;
  })}</div>;
}
export default function LearningPath({learner,progress,lessons,open,edit,showPte}:{learner:Learner;progress:StudyProgress;lessons:StudyLesson[];open:(l:StudyLesson,s:Skill)=>void;edit:()=>void;showPte:()=>void}){
  return <><span class="eyebrow">TỪ ĐIỂM BẮT ĐẦU ĐẾN MỤC TIÊU</span><h1 class="page-title">Lộ trình đến PTE {learner.goal}</h1><p class="page-sub">{learner.name} · {INTEREST_NAMES[learner.interest]} · {learner.minutes} phút/ngày</p><SkillProgress learner={learner} progress={progress}/><section class="settings-card"><h2>Việc tiếp theo cho từng kỹ năng</h2><div class="path-next">{SKILLS.map(skill=>{const r=recommendForSkill(lessons,learner,progress,skill);return <button class="path-next-row" onClick={()=>open(r.lesson,skill)}><span><b>{SKILL_NAMES[skill]} · {r.lesson.level}</b><small>{r.lesson.title}</small></span><span>→</span></button>;})}</div></section><ol class="level-path">{LEVELS.map((level,index)=>{
    const active=SKILLS.filter(s=>skillLevel(learner,progress,s)===level);
    const count=lessons.filter(l=>l.level===level&&['foundation','academic','everyday'].includes(l.category)).length;
    return <li class={active.length?'active':''}><span class="path-level">{level}</span><div><h2>{LEVEL_NAMES[level]}</h2><p>{count} chủ đề chung · {index<2?'Nền tảng trước thuật ngữ chuyên ngành':index<4?'Mở rộng hiểu ý, từ vựng và diễn đạt':'Lập luận, sắc thái và độ chính xác'}</p>{active.length>0&&<small>Đang luyện: {active.map(s=>SKILL_NAMES[s]).join(', ')}</small>}</div></li>;
  })}</ol><section class="settings-card"><h2>Khi nào tăng mức luyện?</h2><p>Từng kỹ năng cần ít nhất 10 câu khác nhau ở 2 chủ đề cùng mức, đạt 80% trở lên trong tối đa 20 câu gần nhất. Nghe và nói dùng tự đánh giá; đọc và viết dùng câu trả lời lần đầu. Xem đáp án vẫn được học tiếp, nhưng không được tính là đã làm đúng. Có thể tự chỉnh mức khi bài quá dễ hoặc quá khó.</p><p>Tăng mức luyện không xác nhận CEFR hay dự báo điểm thi. Hoàn thành các câu ngắn chưa thay thế luyện đầy đủ dạng bài và thi thử PTE.</p><div class="button-row"><button class="secondary" onClick={edit}>Chỉnh mức bắt đầu</button><button class="primary" onClick={showPte}>Xem chặng luyện PTE</button></div></section></>;
}
