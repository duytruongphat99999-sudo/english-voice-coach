import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const base=process.argv[2]||'https://english.duytruongphatco.com';
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
  const guest=await browser.newContext({viewport:{width:390,height:844}});
  const page=await guest.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const res=await page.goto(base);assert.equal(res.status(),200);
  await page.getByRole('button',{name:'Bắt đầu 5 phút'}).click();
  await page.getByRole('button',{name:'Phát câu mẫu',exact:true}).click();
  await page.getByText('Đang phát câu mẫu').waitFor();
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(246, 247, 242)','Public stylesheet must load');
  for(const path of ['/api/today','/api/learn/topics','/api/progress'])assert.equal((await guest.request.get(base+path)).status(),401,path);
  const coach=await guest.request.get(base+'/coach',{maxRedirects:0});assert.equal(coach.status(),302);
  assert.equal(errors.length,0);console.log('Public HTTPS: home, lesson, audio and private boundary verified.');
  await page.goto(base);await page.waitForFunction(()=>getComputedStyle(document.body).backgroundColor==='rgb(246, 247, 242)');await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:'../.stitch/designs/deployed-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'../.stitch/designs/deployed-desktop.png',fullPage:true});
  await guest.close();
  if(process.argv.includes('--owner')){
    const env=readFileSync(new URL('../../.env',import.meta.url),'utf8');
    const password=/^APP_PASSWORD=(.*)$/m.exec(env)?.[1]?.trim().replace(/^["']|["']$/g,'');
    assert.ok(password,'Owner password missing');
    const owner=await browser.newContext();
    assert.equal((await owner.request.post(base+'/api/auth/login',{data:{password}})).status(),200);
    for(const path of ['/coach','/api/today','/api/learn/topics','/api/pte/listening/progress'])assert.equal((await owner.request.get(base+path)).status(),200,path);
    const ownerPage=await owner.newPage();
    await ownerPage.addInitScript(()=>localStorage.setItem('evc_lang','en'));
    await ownerPage.goto(base+'/coach');await ownerPage.getByRole('heading',{name:'Nhiệm vụ hôm nay',exact:true}).waitFor();
    console.log('Owner HTTPS: login, personal home, existing lessons and PTE verified.');
    await owner.close();
  }
}finally{await browser.close();}
