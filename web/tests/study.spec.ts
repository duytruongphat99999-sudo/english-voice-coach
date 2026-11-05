import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import type {StudyLesson} from '../src/lib/study';
const lessons=JSON.parse(readFileSync(new URL('../src/data/study.json',import.meta.url),'utf8')) as StudyLesson[];
import {normalizeAnswer,scheduleRecall} from '../src/lib/study';

test('answer normalization preserves words and recall uses confidence',()=>{
  expect(normalizeAnswer('  The voltage is TWO hundred and thirty volts! ')).toBe(normalizeAnswer(lessons[0].items[0].en));
  expect(normalizeAnswer('The voltage is thirty volts.')).not.toBe(normalizeAnswer(lessons[0].items[0].en));
  const first=scheduleRecall(undefined,true,0);expect(first.due).toBe(86400000);
  const second=scheduleRecall(first,true,0);expect(second.interval).toBe(2);
  expect(scheduleRecall(second,false,0).due).toBe(600000);
});
test('slow JavaScript cannot swallow the first start action',async({page})=>{
  let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/_assets/StudyApp*.js',async route=>{await held;await route.continue();});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  const start=page.getByRole('button',{name:'Bắt đầu 5 phút'});
  await expect(start).toBeDisabled();release();await expect(start).toBeEnabled();await start.click();
  await expect(page.getByRole('button',{name:'Phát câu mẫu',exact:true})).toBeVisible();
});
test('130 audio files and all public content are available',async({request})=>{
  expect(lessons).toHaveLength(26);expect(lessons.filter(l=>l.category==='electrical')).toHaveLength(6);
  for(const l of lessons)for(const i of l.items){const r=await request.get(i.audio!);expect(r.ok(),i.audio).toBeTruthy();expect(r.headers()['content-type']).toContain('audio/');expect((await r.body()).length).toBeGreaterThan(500);}
});
for(const width of [320,390,768,1440])test(`layout is readable without overflow at ${width}px`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width,height:844});await page.goto('/');
  await expect(page.getByRole('heading',{level:1})).toContainText('Mỗi ngày');
  await page.getByRole('button',{name:'Bắt đầu 5 phút'}).click();
  await expect(page.getByRole('heading',{level:1})).toHaveText('Điện cơ bản');
  expect(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor)).toBe('rgb(246, 247, 242)');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  const file=`test-results/lesson-${width}.png`;await page.screenshot({path:file,fullPage:true});
  expect(errors).toEqual([]);
});
test('library filters and searches all electrical lessons',async({page})=>{
  await page.goto('/?view=library');await expect(page.locator('.topic-card')).toHaveCount(26);
  await page.getByRole('button',{name:'Ngành điện',exact:true}).click();await expect(page.locator('.topic-card')).toHaveCount(6);
  await page.getByRole('searchbox').fill('voltage');await expect(page.locator('.topic-card')).toHaveCount(2);
  await page.getByRole('searchbox').fill('no-such-lesson');await expect(page.getByText('Chưa tìm thấy chủ đề')).toBeVisible();
});
test('listening finishes a lesson and persists separate recall cards',async({page})=>{
  await page.goto('/?view=lesson&id=electrical-basics&mode=listen');
  for(let i=0;i<5;i++){await page.getByRole('button',{name:'Hiện câu & bản dịch'}).click();await expect(page.locator('.english-sentence')).toHaveText(lessons[0].items[i].en);await page.getByRole('button',{name:'Đã nhớ',exact:true}).click();}
  await expect(page.getByText('Bạn đã hoàn thành 5 câu!')).toBeVisible();
  await page.reload();
  const p=await page.evaluate(()=>JSON.parse(localStorage.getItem('evc_public_study_v1')!));
  expect(p.completed).toEqual(['electrical-basics:listen']);expect(Object.keys(p.recalls)).toHaveLength(5);
});
test('dictation gives correction, retry and correct result',async({page})=>{
  await page.goto('/?view=lesson&id=electrical-basics&mode=write');
  await page.getByLabel('Viết câu tiếng Anh bạn nghe được').fill('wrong');await page.getByRole('button',{name:'Kiểm tra câu viết'}).click();
  await expect(page.getByRole('status')).toContainText('Chưa khớp');await page.getByRole('button',{name:'Viết lại câu này'}).click();
  await expect(page.locator('.english-sentence')).toHaveCount(0);
  await page.getByLabel('Viết câu tiếng Anh bạn nghe được').fill(lessons[0].items[0].en);await page.getByRole('button',{name:'Kiểm tra câu viết'}).click();
  await expect(page.getByRole('status')).toContainText('Chính xác');
});
test('reading explains a wrong answer and highlights the right one',async({page})=>{
  await page.goto('/?view=lesson&id=electrical-basics&mode=read');await page.getByRole('button',{name:lessons[0].items[1].vi,exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Chưa đúng');await expect(page.locator('.read-options .correct')).toHaveText(lessons[0].items[0].vi);
  await page.getByRole('button',{name:'Câu tiếp theo'}).click();await expect(page.locator('.english-sentence')).toHaveText(lessons[0].items[1].en);
});
test('speaking records locally and releases the microphone',async({page,context})=>{
  await context.grantPermissions(['microphone']);await page.goto('/?view=lesson&id=electrical-basics&mode=speak');
  await page.getByRole('button',{name:'Thu âm câu của bạn'}).click();await expect(page.getByRole('button',{name:/Dừng thu/})).toBeVisible();
  await page.waitForTimeout(600);await page.getByRole('button',{name:/Dừng thu/}).click();
  await expect(page.locator('.record-preview audio')).toHaveAttribute('src',/^blob:/);
  await page.getByRole('button',{name:'Đã nghe & so sánh'}).click();await expect(page.locator('.record-preview')).toHaveCount(0);
});
test('offline download survives reload, plays ranges and never caches private pages',async({page,context})=>{
  test.setTimeout(90000);await page.goto('/');
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.getByRole('button',{name:'Tải để học offline'}).click();await expect(page.getByRole('button',{name:'Đã tải đủ ✓'})).toBeVisible({timeout:60000});
  await page.evaluate(()=>fetch('/coach'));await page.evaluate(()=>fetch('/api/today'));
  const cached=await page.evaluate(async()=>{const keys=await caches.keys();return (await Promise.all(keys.map(async k=>(await(await caches.open(k)).keys()).map(r=>new URL(r.url).pathname)))).flat();});
  expect(cached).not.toContain('/coach');expect(cached).not.toContain('/api/today');expect(cached.filter(p=>p.startsWith('/audio/study/'))).toHaveLength(130);
  await context.setOffline(true);await page.goto('/?view=lesson&id=electrical-basics&mode=listen');
  await expect(page.getByText('Đang offline')).toBeVisible();
  expect(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor)).toBe('rgb(246, 247, 242)');
  await page.getByRole('button',{name:'Phát câu mẫu',exact:true}).click();
  await expect(page.getByText('Đang phát câu mẫu')).toBeVisible();
  const range=await page.evaluate(async()=>{const r=await fetch('/audio/study/electrical-basics-0.mp3',{headers:{Range:'bytes=0-99'}});return {status:r.status,length:(await r.arrayBuffer()).byteLength};});expect(range).toEqual({status:206,length:100});
});
