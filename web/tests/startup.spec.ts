import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('cached public shell opens even when the network never responds',async()=>{
  const handlers:Record<string,Function>={};
  const html='<html><body>Cached learning app</body></html>';
  const shell={match:async()=>new Response(html,{headers:{'Content-Type':'text/html'}})};
  runInNewContext(readFileSync(new URL('../dist/sw.js',import.meta.url),'utf8'),{
    self:{location:{origin:'https://study.test'},addEventListener:(name:string,fn:Function)=>{handlers[name]=fn;}},
    caches:{open:async()=>shell},URL,Response,Request,Headers,
    fetch:()=>new Promise(()=>{}),setTimeout,clearTimeout,
  });
  let response:Promise<Response>|undefined;
  handlers.fetch({request:new Request('https://study.test/?view=library'),respondWith:(r:Promise<Response>)=>{response=r;},waitUntil:()=>{}});
  const result=await Promise.race([response!.then(r=>r.text()),new Promise(resolve=>setTimeout(()=>resolve('NETWORK_STALLED'),200))]);
  expect(result).toBe(html);
  let intercepted=false;
  for(const path of ['/coach','/api/today']){
    handlers.fetch({request:new Request('https://study.test'+path),respondWith:()=>{intercepted=true;}});
  }
  expect(intercepted).toBe(false);
});

test('public first paint does not wait for external stylesheets or fonts',async({page})=>{
  const response=await page.request.get('/');const html=await response.text();
  expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/);
  await page.goto('/');
  expect(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor)).toBe('rgb(246, 247, 242)');
  expect(await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('/fonts/')).length)).toBe(0);
});
