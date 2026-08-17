import test from 'node:test';
import assert from 'node:assert/strict';
import { openaiChat } from '../api/chat.js';

const okResponse = (content='ok') => ({
  ok:true, status:200, headers:{get(){return null;}},
  async text(){ return JSON.stringify({ choices:[{message:{content},finish_reason:'stop'}], usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}, model:'mock' }); }
});
const failResponse = status => ({ ok:false, status, headers:{get(){return null;}}, async text(){ return JSON.stringify({error:{message:'transient'}}); } });
const call = () => openaiChat({model:'mock',messages:[{role:'system',content:'x'}],temperature:0,max_tokens:20});

test('OpenAI 429 is retried once server-side and hidden when the retry succeeds', async () => {
  const original=globalThis.fetch; let calls=0;
  globalThis.fetch=async()=> (++calls===1 ? failResponse(429) : okResponse('after retry'));
  try { const result=await call(); assert.equal(result.content,'after retry'); assert.equal(calls,2); }
  finally { globalThis.fetch=original; }
});

test('OpenAI 5xx is retried only once and preserves UPSTREAM_UNAVAILABLE after the second failure', async () => {
  const original=globalThis.fetch; let calls=0;
  globalThis.fetch=async()=> { calls+=1; return failResponse(503); };
  try { await assert.rejects(call(), error => error?.code==='UPSTREAM_UNAVAILABLE' && error?.upstreamStatus===503); assert.equal(calls,2); }
  finally { globalThis.fetch=original; }
});

test('one transient network failure is retried and may recover on the second attempt', async () => {
  const original=globalThis.fetch; let calls=0;
  globalThis.fetch=async()=> { calls+=1; if (calls===1) throw new TypeError('network down'); return okResponse('network recovered'); };
  try { const result=await call(); assert.equal(result.content,'network recovered'); assert.equal(calls,2); }
  finally { globalThis.fetch=original; }
});

test('two consecutive network failures stop after one retry and preserve UPSTREAM_NETWORK_ERROR', async () => {
  const original=globalThis.fetch; let calls=0;
  globalThis.fetch=async()=> { calls+=1; throw new TypeError('network down'); };
  try { await assert.rejects(call(), error => error?.code==='UPSTREAM_NETWORK_ERROR'); assert.equal(calls,2); }
  finally { globalThis.fetch=original; }
});
