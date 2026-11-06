import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
const base=process.argv[2]||'https://english.duytruongphatco.com';
const engine=process.argv.includes('--webkit')?webkit:chromium;
const expectHttp2=process.argv.includes('--expect-http2');
const browser=await engine.launch({headless:true,...(engine===chromium?{channel:'chrome'}:{})});
try{
  for(let run=1;run<=3;run++){
    const context=await browser.newContext({viewport:{width:390,height:844}});
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const start=Date.now();
    const response=await page.goto(base,{waitUntil:'domcontentloaded',timeout:15000});
    assert.equal(response.status(),200);
    await page.getByRole('button',{name:'Bắt đầu 5 phút'}).click({timeout:10000});
    await page.getByRole('button',{name:'Phát câu mẫu',exact:true}).waitFor({timeout:5000});
    const interactiveMs=Date.now()-start;
    assert.ok(interactiveMs<15000,`Cold start took ${interactiveMs}ms`);
    assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(246, 247, 242)');
    const protocols=await page.evaluate(()=>[...new Set(performance.getEntriesByType('resource').filter(r=>r.name.startsWith(location.origin)).map(r=>r.nextHopProtocol).filter(Boolean))]);
    if(expectHttp2){
      assert.ok(!response.headers()['alt-svc']?.includes('h3'),'Cloudflare must not advertise HTTP/3 while the Chrome workaround is active');
      assert.ok(protocols.includes('h2')&&!protocols.includes('h3'),`Expected public assets over HTTP/2; got ${protocols}`);
    }
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({run,interactiveMs,protocols,altSvc:response.headers()['alt-svc']||null}));
    await page.evaluate(()=>navigator.serviceWorker.ready);
    await page.waitForFunction(()=>!!navigator.serviceWorker.controller,null,{timeout:30000});
    await context.setOffline(true);const reloadStart=Date.now();
    await page.goto(base,{waitUntil:'domcontentloaded',timeout:3000});
    await page.getByRole('button',{name:'Bắt đầu 5 phút'}).click({timeout:3000});
    await page.getByRole('button',{name:'Phát câu mẫu',exact:true}).waitFor({timeout:3000});
    console.log(JSON.stringify({run,offlineInteractiveMs:Date.now()-reloadStart}));
    await context.close();
  }
}finally{await browser.close();}
