import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
const base=process.argv[2]||'http://127.0.0.1:4323';
const engine=process.argv.includes('--webkit')?webkit:chromium;
const browser=await engine.launch({headless:true,...(engine===chromium?{channel:'chrome'}:{})});
try{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();
  await page.goto(base);await page.getByRole('button',{name:'Tạo lộ trình của tôi'}).click();
  await page.getByLabel('Tên hoặc biệt danh').fill('Người học thử');
  await page.getByRole('button',{name:'Tiếp tục',exact:true}).click();
  await page.getByRole('button',{name:'Chọn riêng cho từng kỹ năng'}).click();
  await page.getByRole('combobox',{name:'Nghe',exact:true}).selectOption('B1');
  await page.getByRole('button',{name:'Tiếp tục',exact:true}).click();
  await page.getByRole('button',{name:/^Ngành y/}).click();await page.getByRole('button',{name:'Lưu lộ trình của tôi'}).click();
  await page.locator('.learner-strip').getByText('Người học thử',{exact:false}).waitFor();
  assert.equal(await page.locator('.daily-card h2').innerText(),'Chào hỏi & giới thiệu');
  assert.match(await page.locator('.skill-listen strong').innerText(),/B1/);
  assert.match(await page.locator('.skill-write strong').innerText(),/A1/);
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:resolve(import.meta.dirname,'../../.stitch/designs/personalized-phone.png'),fullPage:true});
  if(process.argv.includes('--offline')){
    await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
    await page.getByRole('button',{name:'Tải để học offline'}).click();await page.getByRole('button',{name:'Đã tải đủ ✓'}).waitFor({timeout:120000});
    await context.setOffline(true);await page.reload();await page.getByText('Đang offline',{exact:true}).waitFor();
    assert.match(await page.locator('.learner-strip').innerText(),/Người học thử/);
    await page.goto(base+'/?view=lesson&id=medical-appointments&mode=listen');
    await page.getByRole('button',{name:'Hiện câu & bản dịch'}).click();
    assert.equal(await page.locator('.english-sentence').innerText(),'Do you have an appointment today?');
    const result=await page.evaluate(async()=>{const r=await fetch('/audio/study/medical-appointments-0.mp3',{headers:{Range:'bytes=0-99'}});return {status:r.status,size:(await r.arrayBuffer()).byteLength};});
    assert.deepEqual(result,{status:206,size:100});
    console.log('Public offline: profile, medical lesson, audio range and reload verified.');
  }
  console.log('Personalization: PTE goal, separate skill levels and foundations-first recommendations verified.');
}finally{await browser.close();}
