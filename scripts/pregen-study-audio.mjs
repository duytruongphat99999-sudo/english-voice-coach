import { readFileSync, mkdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const lessons = JSON.parse(readFileSync(resolve(root,'web/src/data/study.json'),'utf8'));
const dir = resolve(root,'web/public/audio/study');
mkdirSync(dir,{recursive:true});
let done = 0;
for (const lesson of lessons) {
  for (const item of lesson.items) {
    const file = resolve(root,'web/public'+item.audio);
    if (existsSync(file) && statSync(file).size > 0) { done++; continue; }
    const res = await fetch('http://127.0.0.1:8010/v1/audio/speech', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:'speaches-ai/Kokoro-82M-v1.0-ONNX',voice:'af_heart',input:item.en,response_format:'mp3',speed:0.95}),
      signal:AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`Audio ${item.audio}: ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length) throw new Error('Empty audio');
    writeFileSync(file,bytes); done++;
  }
  console.log(`${lesson.id}: ready (${done})`);
}
