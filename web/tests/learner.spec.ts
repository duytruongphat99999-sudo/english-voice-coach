import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {defaultLearner,evidenceFor,recommendForSkill,recommend,skillLevel,withEvidence,SKILLS,LEVELS} from '../src/lib/learner';
import {emptyProgress,type Level,type Skill,type StudyLesson,type StudyProgress,validProgress} from '../src/lib/study';
const lessons=JSON.parse(readFileSync(new URL('../src/data/study.json',import.meta.url),'utf8')) as StudyLesson[];

test('new learners start with general foundations even when they prefer medicine or electrical work',()=>{
  for(const interest of ['general','medical','electrical'] as const){
    const learner={...defaultLearner(),interest};
    for(const skill of SKILLS){const r=recommendForSkill(lessons,learner,emptyProgress(),skill);expect(r.level).toBe('A1');expect(r.lesson.category).toBe('foundation');}
  }
});
test('every level has two common topics and recommendations respect each skill and optional interest',()=>{
  for(const level of LEVELS)expect(lessons.filter(l=>l.level===level&&['foundation','everyday','academic'].includes(l.category)).length).toBeGreaterThanOrEqual(2);
  const learner={...defaultLearner(),interest:'medical' as const,skillStart:{listen:'B2' as Level,speak:'A2' as Level,read:'C1' as Level,write:'A1' as Level}};
  expect(recommend(lessons,learner,emptyProgress()).skill).toBe('write');
  for(const skill of SKILLS)expect(recommendForSkill(lessons,learner,emptyProgress(),skill).lesson.level).toBe(learner.skillStart[skill]);
  const p=emptyProgress();p.completed=['appointments-basics:listen','directions-basics:listen'];learner.skillStart.listen='A2';
  expect(recommendForSkill(lessons,learner,p,'listen').lesson.category).toBe('medical');
  p.mastered=['listen:A2'];expect(recommendForSkill(lessons,learner,p,'listen').lesson.id).toBe('medical-appointments');
  p.completed.push('medical-appointments:listen');expect(recommendForSkill(lessons,learner,p,'listen').lesson.level).toBe('B1');
  learner.interest='general' as any;expect(recommendForSkill(lessons,learner,p,'listen').lesson.category).not.toBe('medical');
});
test('repeating one item or completing without correctness cannot unlock another level',()=>{
  let p=emptyProgress();
  for(let i=0;i<12;i++)p=withEvidence(p,{lessonId:'hello-basics',item:0,skill:'read',level:'A1',correct:true,source:'objective',at:i});
  expect(evidenceFor(p,'read','A1').total).toBe(1);expect(skillLevel(defaultLearner(),p,'read')).toBe('A1');
  p.completed=['hello-basics:read','daily-basics:read'];expect(skillLevel(defaultLearner(),p,'read')).toBe('A1');
});
test('ten distinct results over two topics promote only the practiced skill, while difficulty stays when accuracy is low',()=>{
  let p=emptyProgress();
  for(let i=0;i<10;i++)p=withEvidence(p,{lessonId:i<5?'hello-basics':'daily-basics',item:i%5,skill:'read',level:'A1',correct:i<8,source:'objective',at:i});
  expect(skillLevel(defaultLearner(),p,'read')).toBe('A2');expect(skillLevel(defaultLearner(),p,'listen')).toBe('A1');
  let weak=emptyProgress();for(let i=0;i<5;i++)weak=withEvidence(weak,{lessonId:'hello-basics',item:i,skill:'write',level:'A1',correct:false,source:'objective',at:i});
  const r=recommendForSkill(lessons,defaultLearner(),weak,'write');expect(r.support).toBe(true);expect(r.lesson.id).toBe('hello-basics');
  expect(validProgress({...p,attempts:[{level:'invalid'}]})).toBe(false);
});
async function setup(page:Page,name:string,interest='Ngành y',level:Level='A1'){
  await page.getByLabel('Tên hoặc biệt danh').fill(name);
  await page.getByRole('button',{name:'Tiếp tục',exact:true}).click();
  await page.getByRole('button',{name:new RegExp(`^${level} `)}).click();
  await page.getByRole('button',{name:'Tiếp tục',exact:true}).click();
  await page.getByRole('button',{name:new RegExp(`^${interest}`)}).click();
  await page.getByRole('button',{name:'Lưu lộ trình của tôi'}).click();
}
test('phone setup, independent skills, separate learners and persistent goals work end to end',async({page})=>{
  await page.goto('/');await expect(page.locator('.daily-card h2')).toHaveText('Chào hỏi & giới thiệu');
  await page.getByRole('button',{name:'Tạo lộ trình của tôi'}).click();
  await page.getByLabel('Tên hoặc biệt danh').fill('Lan');await page.getByRole('button',{name:'Tiếp tục',exact:true}).click();
  await page.getByRole('button',{name:'Chọn riêng cho từng kỹ năng'}).click();
  await page.locator('.individual-levels').getByLabel('Nghe',{exact:true}).selectOption('B1');
  await page.getByRole('button',{name:'Tiếp tục',exact:true}).click();await page.getByRole('button',{name:/^Ngành y/}).click();await page.getByRole('button',{name:'Lưu lộ trình của tôi'}).click();
  await expect(page.locator('.learner-strip')).toContainText('Lan');await expect(page.locator('.daily-card h2')).toHaveText('Chào hỏi & giới thiệu');
  await page.locator('.skill-listen').click();await expect(page.locator('.lesson-title .level-tag')).toHaveText('B1');
  await page.goto('/?view=profile');await expect(page.getByLabel('Hồ sơ đang dùng')).toContainText('Lan');await page.getByRole('button',{name:'Thêm người học'}).click();
  await setup(page,'Minh','Ngành điện');await expect(page.locator('.learner-strip')).toContainText('Minh');
  await page.reload();await expect(page.locator('.learner-strip')).toContainText('Minh');
  await page.goto('/?view=profile');await page.getByLabel('Hồ sơ đang dùng').selectOption({label:'Lan · PTE 90'});await expect(page.locator('.learner-strip')).toContainText('Lan');
  await expect(page.locator('.skill-listen strong')).toContainText('B1');await expect(page.locator('.skill-write strong')).toContainText('A1');
});
test('first profile keeps legacy progress; second profile stays separate',async({page})=>{
  const old={...emptyProgress(),completed:['electrical-basics:listen'],days:['2026-11-01']};
  await page.addInitScript(p=>localStorage.setItem('evc_public_study_v1',JSON.stringify(p)),old);
  await page.goto('/?view=setup');await setup(page,'First');await page.goto('/?view=profile');
  await expect(page.locator('.stats-grid strong').first()).toHaveText('1');await page.getByRole('button',{name:'Thêm người học'}).click();await setup(page,'Second');await page.goto('/?view=profile');
  await expect(page.locator('.stats-grid strong').first()).toHaveText('0');await page.getByLabel('Hồ sơ đang dùng').selectOption({label:'First · PTE 90'});await page.goto('/?view=profile');await expect(page.locator('.stats-grid strong').first()).toHaveText('1');
});
test('wrong dictation corrected after viewing answer still counts as needing practice',async({page})=>{
  await page.goto('/?view=lesson&id=hello-basics&mode=write');await page.getByLabel('Viết câu tiếng Anh bạn nghe được').fill('wrong');await page.getByRole('button',{name:'Kiểm tra câu viết'}).click();await page.getByRole('button',{name:'Viết lại câu này'}).click();
  await page.getByLabel('Viết câu tiếng Anh bạn nghe được').fill('Hello, my name is Alex.');await page.getByRole('button',{name:'Kiểm tra câu viết'}).click();await page.getByRole('button',{name:'Câu tiếp theo',exact:true}).click();
  const p=await page.evaluate(()=>JSON.parse(localStorage.getItem('evc_public_study_v1')!));expect(p.attempts[0].correct).toBe(false);
});
test('all four level paths and public PTE guide remain accessible without private history',async({page})=>{
  await page.goto('/?view=path');await expect(page.locator('.level-path li')).toHaveCount(6);await expect(page.locator('.skill-progress-item')).toHaveCount(4);await page.getByRole('button',{name:'Xem chặng luyện PTE'}).click();
  await expect(page.locator('.pte-task-list article')).toHaveCount(22);await expect(page.getByText(/chưa có chấm thi thử PTE/)).toBeVisible();
});
test('medical lessons filter by level and all setup screens fit narrow phones',async({page})=>{
  await page.setViewportSize({width:320,height:740});await page.goto('/?view=setup');
  for(let i=0;i<3;i++){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);if(i<2)await page.getByRole('button',{name:'Tiếp tục',exact:true}).click();}
  await page.goto('/?view=library');await page.getByRole('button',{name:'Ngành y',exact:true}).click();await expect(page.locator('.topic-card')).toHaveCount(6);await page.getByLabel('Mức luyện trong thư viện').selectOption('A2');await expect(page.locator('.topic-card')).toHaveCount(1);
});
test('version two backup restores a separate learner with their goal and skill levels',async({page})=>{
  await page.goto('/?view=setup');await setup(page,'Backup learner','Ngành y','B1');await page.goto('/?view=profile');
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Xuất tiến độ'}).click();const download=await downloading;const path=await download.path();expect(path).toBeTruthy();
  await page.locator('input[type=file]').setInputFiles(path!);await expect(page.getByRole('status')).toContainText('Đã nhập tiến độ');
  const book=await page.evaluate(()=>JSON.parse(localStorage.getItem('evc_learners_v1')!));expect(book.learners).toHaveLength(2);expect(book.learners[0].id).not.toBe(book.learners[1].id);expect(book.learners[1].interest).toBe('medical');expect(book.learners[1].skillStart.write).toBe('B1');
});
test('offline profiles and medical content persist through reload',async({page,context})=>{
  test.setTimeout(90000);await page.goto('/?view=setup');await setup(page,'Offline learner','Ngành y','A2');
  await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.getByRole('button',{name:'Tải để học offline'}).click();await expect(page.getByRole('button',{name:'Đã tải đủ ✓'})).toBeVisible({timeout:60000});
  await context.setOffline(true);await page.reload();await expect(page.locator('.learner-strip')).toContainText('Offline learner');await page.goto('/?view=lesson&id=medical-appointments&mode=listen');
  await page.getByRole('button',{name:'Hiện câu & bản dịch'}).click();await expect(page.locator('.english-sentence')).toHaveText('Do you have an appointment today?');
});
