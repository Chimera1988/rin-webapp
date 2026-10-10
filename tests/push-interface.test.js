import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pushHandler from '../api/push.js';
import cronHandler from '../api/push-cron.js';

function response() {
  return {code:200,body:null,headers:{},setHeader(k,v){this.headers[k]=v;return this;},status(c){this.code=c;return this;},json(v){this.body=v;return this;}};
}
test('push endpoint refuses unauthenticated requests before any Redis access',async()=>{
  const previous=process.env.ACCESS_PIN;process.env.ACCESS_PIN='correct-pin';
  try {
    const res=response();await pushHandler({method:'POST',headers:{'x-rin-pin':'wrong'},body:{action:'status'}},res);
    assert.equal(res.code,401);assert.equal(res.body.code,'UNAUTHORIZED');
  } finally {if(previous===undefined)delete process.env.ACCESS_PIN;else process.env.ACCESS_PIN=previous;}
});
test('push endpoint validates action before accessing Redis',async()=>{
  const previous=process.env.ACCESS_PIN;process.env.ACCESS_PIN='correct-pin';
  try {
    const res=response();await pushHandler({method:'POST',headers:{'x-rin-pin':'correct-pin'},body:{action:'unrecognized'}},res);
    assert.equal(res.code,400);assert.equal(res.body.code,'INVALID_PUSH_ACTION');
  } finally {if(previous===undefined)delete process.env.ACCESS_PIN;else process.env.ACCESS_PIN=previous;}
});
test('background cron denies requests without a dedicated CRON_SECRET',async()=>{
  const previous=process.env.CRON_SECRET;delete process.env.CRON_SECRET;
  try {
    const res=response();await cronHandler({method:'GET',headers:{}},res);
    assert.equal(res.code,401);assert.equal(res.body.code,'UNAUTHORIZED');
  } finally {if(previous!==undefined)process.env.CRON_SECRET=previous;}
});
test('PWA integration keeps backup UI and explicit, non-chat push test',()=>{
  const index=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
  const vercel=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
  assert.match(index,/id="backupExport"/);assert.match(index,/id="backupImport"/);
  assert.match(index,/id="pushEnable"/);assert.match(index,/id="pushDisable"/);assert.match(index,/id="pushTest"/);
  assert.match(worker,/Это тест, не сообщение Рин/);
  assert.equal(vercel.crons.length,3);
  assert.equal(new Set(vercel.crons.map(c=>c.path)).size,3);
  assert.ok(vercel.crons.every(c=>/^\d+ \d+ \* \* \*$/.test(c.schedule)));
});
