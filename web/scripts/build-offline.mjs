import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const dir=resolve(import.meta.dirname,'../dist');
const html=readFileSync(resolve(dir,'index.html'),'utf8');
const assets=[...new Set([...html.matchAll(/(?:src|href|component-url|renderer-url)="(\/_assets\/[^"?#]+)"/g)].map(m=>m[1]))];
// Follow module imports; only public app dependencies are precached.
for(let i=0;i<assets.length;i++){
  if(!assets[i].endsWith('.js'))continue;
  const js=readFileSync(resolve(dir,assets[i].slice(1)),'utf8');
  for(const m of js.matchAll(/["'](\.\/[\w.-]+\.js)["']/g)){
    const path='/_assets/'+m[1].slice(2);if(!assets.includes(path))assets.push(path);
  }
}
const fonts=readdirSync(resolve(dir,'fonts')).filter(f=>f.endsWith('.woff2')).map(f=>'/fonts/'+f);
const core=['/','/manifest.webmanifest','/icon.svg','/icon-192.png','/icon-512.png','/icon-maskable.png',...fonts,...assets];
const hash=createHash('sha256').update(html).digest('hex').slice(0,12);
writeFileSync(resolve(dir,'sw.js'),`
const SHELL='evc-study-shell-${hash}';
const AUDIO='evc-study-audio-v1';
const CORE=${JSON.stringify(core)};
self.addEventListener('install',event=>event.waitUntil(caches.open(SHELL).then(c=>c.addAll(CORE))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k.startsWith('evc-study-shell-')&&k!==SHELL).map(k=>caches.delete(k)));
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const req=event.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==self.location.origin)return;
  // Personal pages and all APIs ALWAYS go to the server.
  if(url.pathname==='/'||url.pathname==='/index.html'){
    event.respondWith((async()=>{
      try{const res=await fetch(req);if(res.ok&&!res.redirected)return res;}catch{}
      return (await caches.open(SHELL)).match('/')||Response.error();
    })());return;
  }
  if(url.pathname.startsWith('/audio/study/')){
    event.respondWith((async()=>{
      const cache=await caches.open(AUDIO);let res=await cache.match(url.pathname);
      if(!res){res=await fetch(new Request(req,{headers:new Headers()}));if(res.ok&&res.headers.get('Content-Type')?.startsWith('audio/')){try{await cache.put(url.pathname,res.clone());}catch{}}}
      if(req.headers.has('range')&&res.status===200){
        const bytes=await res.arrayBuffer(),range=/^bytes=(\\d*)-(\\d*)$/.exec(req.headers.get('range'));
        if(!range)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+bytes.byteLength}});
        const start=range[1]?Number(range[1]):Math.max(0,bytes.byteLength-Number(range[2]));
        let end=range[1]&&range[2]?Number(range[2]):bytes.byteLength-1;
        if(start>end||start>=bytes.byteLength)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+bytes.byteLength}});
        end=Math.min(end,bytes.byteLength-1);
        return new Response(bytes.slice(start,end+1),{status:206,headers:{'Content-Type':'audio/mpeg','Content-Range':'bytes '+start+'-'+end+'/'+bytes.byteLength,'Content-Length':String(end-start+1),'Accept-Ranges':'bytes'}});
      }
      return res;
    })());return;
  }
  if(CORE.includes(url.pathname))event.respondWith(caches.open(SHELL).then(async c=>(await c.match(url.pathname))||fetch(req)));
});
`);
console.log('Offline shell:',hash,core.length,'files');
