import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.GEMINI_API_KEY='test-only';
process.env.APP_PASSWORD='test-only';
process.env.APP_SECRET='test-only';
process.env.DB_PATH=join(mkdtempSync(join(tmpdir(),'evc-tts-test-')),'test.db');
const {synthesize}=await import('../dist/tts.js');
test('concurrent identical speech is synthesized once, cached, and failed jobs can retry',async()=>{
  const original=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async()=>{calls++;await new Promise(r=>setTimeout(r,25));return new Response(new Uint8Array([1,2,3,4]),{headers:{'Content-Type':'audio/mpeg'}});};
  try{
    const clips=await Promise.all([synthesize('shared sentence'),synthesize('shared sentence'),synthesize('shared sentence')]);
    assert.equal(calls,1);assert.deepEqual(clips[0],clips[1]);
    await synthesize('shared sentence');assert.equal(calls,1);
    globalThis.fetch=async()=>{calls++;throw new Error('temporary outage');};
    await assert.rejects(synthesize('retry sentence'),/temporary outage/);
    globalThis.fetch=async()=>{calls++;return new Response(new Uint8Array([5,6]));};
    assert.deepEqual(await synthesize('retry sentence'),Buffer.from([5,6]));assert.equal(calls,3);
  }finally{globalThis.fetch=original;}
});
