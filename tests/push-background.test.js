import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { seal, openSealed, validateSubscription, validateSnapshot, scheduledOpportunity, freshEnvironment, PUSH_SCHEMA, createDeliveryId } from '../lib/push/core.js';
import { processPushOpportunity } from '../api/push-cron.js';
import { readProtected, writeProtected, pushKey } from '../lib/push/redis.js';

const KEY = randomBytes(32);
function mockRedis() {
  const map = new Map();
  return {
    map,
    async set(k,v,opts={}) { if (opts.nx && map.has(k)) return null;map.set(k,v);return 'OK'; },
    async get(k) { return map.get(k) || null; },
    async del(...keys) { let n=0;for(const key of keys){if(map.delete(key))n++;}return n; }
  };
}
const schedule={...JSON.parse(readFileSync(new URL('../public/data/rin_schedule.json',import.meta.url),'utf8')),windows:[{id:'morning',from:'08:00',to:'10:30',pool:'morning',probability:0.55}]};
const now=Date.parse('2026-10-12T06:00:00.000Z');
const snapshot=()=>({schema:PUSH_SCHEMA,history:[{role:'assistant',content:'Доброе утро',kind:'text',ts:now-60*60000,id:'old'}],memory:{innerLife:{},conversationState:{}},profile:{description:''},env:{},sticker:{mode:'off'},initiation:{},updatedAt:1});
const subscription={endpoint:'https://web.push.apple.com/QWE/test',keys:{p256dh:'A'.repeat(86),auth:'a'.repeat(24)}};

test('protected snapshots use authenticated encryption and reject tampering',()=>{
  const encrypted=seal({secret:'личная память'},KEY);
  assert.ok(!encrypted.includes('личная'));
  assert.deepEqual(openSealed(encrypted,KEY),{secret:'личная память'});
  assert.throws(()=>openSealed(encrypted.slice(0,-1)+'A',KEY));
});
test('accepts Apple Push and rejects arbitrary servers',()=>{
  assert.deepEqual(validateSubscription(subscription).endpoint,subscription.endpoint);
  assert.throws(()=>validateSubscription({...subscription,endpoint:'https://evil.example.net/push'}),/INVALID_PUSH_ENDPOINT/);
  assert.throws(()=>validateSubscription({...subscription,endpoint:'http://web.push.apple.com/push'}),/INVALID_PUSH_SUBSCRIPTION/);
});
test('snapshot accepts compact context but not full diary or oversized data',()=>{
  assert.equal(validateSnapshot(snapshot()).schema,PUSH_SCHEMA);
  assert.throws(()=>validateSnapshot({...snapshot(),history:Array(55).fill({role:'assistant'})}),/TOO_LARGE/);
  assert.throws(()=>validateSnapshot({...snapshot(),memory:null}),/INCOMPLETE/);
});
test('schedule follows Moscow local time, silence threshold, and daily quota',()=>{
  assert.equal(scheduledOpportunity({now,schedule,snapshot:snapshot()}).windowId,'morning');
  assert.equal(scheduledOpportunity({now:now-4*3600000,schedule,snapshot:snapshot()}),null);
  assert.equal(scheduledOpportunity({now,schedule,snapshot:{...snapshot(),history:[{role:'assistant',ts:now-5*60000}]}}),null);
  assert.equal(scheduledOpportunity({now,schedule,snapshot:{...snapshot(),initiation:{days:{'2026-10-12':{sent:2}}}}}),null);
  assert.match(freshEnvironment({},schedule,now).rinHuman,/2026-10-12 09:00/);
});
test('cron generates one queued message, never rerolls, and stores only ciphertext',async()=>{
  const previous=process.env.RIN_PUSH_DATA_KEY;process.env.RIN_PUSH_DATA_KEY=KEY.toString('base64url');
  try {
    const redis=mockRedis();
    await writeProtected(redis,'subscription',subscription);
    await writeProtected(redis,'snapshot',snapshot());
    let generated=0,notified=0;
    const generate=async body=>{generated++;assert.equal(body.trigger.type,'scheduled');return {reply:'Привет)',deliveryPlan:{turnId:'bg-1',mode:'single_text',segments:[{id:'bg-seg-1',type:'text',text:'Привет)'}]},stateTransition:{moodState:{energy:70}}};};
    const notify=async()=>{notified++;};
    const first=await processPushOpportunity({redis,schedule,now,draw:()=>0,generate,notify});
    assert.equal(first.status,'queued_and_notified');
    assert.equal(generated,1);assert.equal(notified,1);
    const pending=(await readProtected(redis,'pending'))[0];
    assert.equal(pending.notificationText,'Привет)');
    assert.equal(pending.id,createDeliveryId(pending.requestId));
    assert.equal(pending.stateTransition.moodState.energy,70);
    assert.ok(!String(redis.map.get(pushKey('pending'))).includes('Привет'));
    const second=await processPushOpportunity({redis,schedule,now,draw:()=>0,generate,notify});
    assert.equal(second.status,'not_eligible');
    assert.equal(generated,1);
  } finally { if (previous===undefined)delete process.env.RIN_PUSH_DATA_KEY;else process.env.RIN_PUSH_DATA_KEY=previous; }
});
test('failed notification does not erase committed server delivery',async()=>{
  const previous=process.env.RIN_PUSH_DATA_KEY;process.env.RIN_PUSH_DATA_KEY=KEY.toString('base64url');
  try {
    const redis=mockRedis();await writeProtected(redis,'subscription',subscription);await writeProtected(redis,'snapshot',snapshot());
    const result=await processPushOpportunity({redis,schedule,now,draw:()=>0,generate:async()=>({reply:'Здесь',deliveryPlan:{turnId:'bg',segments:[{type:'text',text:'Здесь'}]}}),notify:async()=>{throw new Error('transport down');}});
    assert.equal(result.status,'queued_without_push');
    assert.equal((await readProtected(redis,'pending'))[0].reply,'Здесь');
  } finally { if(previous===undefined)delete process.env.RIN_PUSH_DATA_KEY;else process.env.RIN_PUSH_DATA_KEY=previous; }
});

test('two background windows can queue without reopening PWA; second sees evolved continuity',async()=>{
  const previous=process.env.RIN_PUSH_DATA_KEY;process.env.RIN_PUSH_DATA_KEY=KEY.toString('base64url');
  try {
    const redis=mockRedis();await writeProtected(redis,'subscription',subscription);await writeProtected(redis,'snapshot',snapshot());
    const multiple={...schedule,windows:[...schedule.windows,{id:'day_ping',from:'13:00',to:'16:30',pool:'day',probability:1}]};
    const seen=[];
    const generate=async body=>{
      seen.push({history:body.history,memory:body.memory});
      return {reply:`Сообщение ${seen.length}`,deliveryPlan:{turnId:`turn-${seen.length}`,segments:[{id:`segment-${seen.length}`,type:'text',text:`Сообщение ${seen.length}`}]},stateTransition:{moodState:{energy:70+seen.length},dialogueState:{scene:'everyday',topic:'знакомая тема'}}};
    };
    const first=await processPushOpportunity({redis,schedule:multiple,now,draw:()=>0,generate,notify:async()=>{}});
    const later=await processPushOpportunity({redis,schedule:multiple,now:now+5*3600000,draw:()=>0,generate,notify:async()=>{}});
    assert.equal(first.status,'queued_and_notified');assert.equal(later.status,'queued_and_notified');
    assert.equal(seen.length,2);
    assert.ok(seen[1].history.some(item=>item.content==='Сообщение 1'));
    assert.equal(seen[1].memory.mood.energy,71);
    const pending=await readProtected(redis,'pending');
    assert.equal(pending.length,2);
    assert.equal(pending[0].reply,'Сообщение 1');assert.equal(pending[1].reply,'Сообщение 2');
  } finally {if (previous===undefined)delete process.env.RIN_PUSH_DATA_KEY;else process.env.RIN_PUSH_DATA_KEY=previous;}
});
