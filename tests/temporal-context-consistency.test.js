import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspectTemporalContinuity, formatRinEventTime, temporalSceneWeight } from '../lib/cognition/temporal-continuity.js';
import { buildKernelState } from '../lib/cognition/kernel-state.js';
import { buildRinMindPrompt, buildShortTermDialogue } from '../lib/cognition/rin-mind.js';
import { buildBehaviorState } from '../lib/cognition/behavior-state.js';
import { buildDialogueState } from '../lib/cognition/dialogue-state.js';
import { resolveConversationContinuity } from '../lib/conversation-continuity.js';

const time = (local) => Date.parse(`${local}+03:00`);
const event = (role, content, local, id) => ({id, requestId:id, role, content, kind:'text', status:'complete', ts:time(local)});
const morning = [
  event('user','Пойду приму душ и заварю кофе)','2026-10-12T10:10:00','u-coffee'),
  event('assistant','Только кофе не забудь выпить)','2026-10-12T10:11:00','r-coffee')
];
const afternoon = event('user','Я вернулся) Как твой день?','2026-10-12T15:06:00','u-new');

test('v2.6 temporal: elapsed absence uses real timestamps, not count of conversation turns',()=>{
  const t=inspectTemporalContinuity({history:[...morning,afternoon],requestId:'u-new',now:afternoon.ts,timezone:'Europe/Moscow',userText:afternoon.content});
  assert.equal(t.gapMinutes,295);
  assert.equal(t.userGapMinutes,296);
  assert.equal(t.rinGapMinutes,295);
  assert.equal(t.resumed,true);
  assert.equal(t.tier,'long');
  assert.equal(t.periodShift,'morning->afternoon');
  assert.equal(t.dayChanged,false);
  assert.equal(t.lastLocal,'2026-10-12 10:11');
  assert.equal(t.nowLocal,'2026-10-12 15:06');
  assert.equal(t.explicitCallback,false);
});

test('v2.6 temporal: near-term chat remains continuous with no artificial scene reset',()=>{
  const t=inspectTemporalContinuity({history:[...morning], now:time('2026-10-12T10:13:00')});
  assert.equal(t.gapMinutes,2);
  assert.equal(t.resumed,false);
  assert.equal(t.tier,'continuous');
  assert.equal(t.periodShift,'none');
});

test('v2.6 temporal: last Rin turn after proactive initiative counts as last event',()=>{
  const t=inspectTemporalContinuity({history:[event('assistant','Доброе утро','2026-10-12T10:03:00','rin-bg')],now:time('2026-10-12T10:05:00')});
  assert.equal(t.gapMinutes,2);
  assert.equal(t.lastRole,'assistant');
  assert.equal(t.userGapMinutes,null);
});

test('v2.6 temporal: delayed background event timestamp is preserved; device future clock is ignored',()=>{
  const now=time('2026-10-12T15:06:00');
  const t=inspectTemporalContinuity({history:[event('assistant','Инициатива','2026-10-12T12:03:00','rin-bg'),{...afternoon,requestId:'current'},{...morning[0],ts:now+86400000}],requestId:'current',now});
  assert.equal(t.gapMinutes,183);
  assert.equal(t.userGapMinutes,null);
  assert.equal(t.rinGapMinutes,183);
});

test('v2.6 temporal: overnight gap explicitly reports new local day',()=>{
  const t=inspectTemporalContinuity({history:[event('assistant','Спокойной ночи','2026-10-11T23:32:00','a')],now:time('2026-10-12T10:03:00')});
  assert.equal(t.gapMinutes,631);
  assert.equal(t.tier,'new_day');
  assert.equal(t.dayChanged,true);
  assert.equal(t.periodShift,'night->morning');
});

test('v2.6 temporal: invalid/no history yields unknown rather than fabricated absence',()=>{
  const t=inspectTemporalContinuity({history:[{role:'assistant',status:'complete',ts:1500}],now:time('2026-10-12T10:03:00')});
  assert.equal(t.gapMinutes,null);
  assert.equal(t.resumed,false);
  assert.equal(t.tier,'unknown');
  assert.equal(t.lastLocal,null);
});

test('v2.6 temporal: explicit return to prior topic remains permissible after long pause',()=>{
  const t=inspectTemporalContinuity({history:morning,now:time('2026-10-12T15:06:00'),userText:'Давай продолжим наш разговор'});
  assert.equal(t.explicitCallback,true);
  assert.equal(t.resumed,true);
  assert.equal(inspectTemporalContinuity({history:morning,now:time('2026-10-12T15:06:00'),userText:'Я вернулся'}).explicitCallback,false);
});

test('v2.6 temporal: recent local message times are retained per semantic speaker turn and split group',()=>{
  const state={requestId:'current',environment:{rinTz:'Europe/Moscow'},recentHistory:[
    ...morning,
    {...event('assistant','Второй пузырёк','2026-10-12T10:11:01','rin-part2'),requestId:'r-coffee',turnId:'r-coffee'},
    {...afternoon,requestId:'current'}
  ]};
  state.recentHistory[1].turnId='r-coffee';
  const d=buildShortTermDialogue(state);
  assert.equal(d.length,1);
  assert.equal(d[0].user.at,'2026-10-12 10:10');
  assert.equal(d[0].rin.at,'2026-10-12 10:11');
  assert.equal(d[0].rin.messages.length,2);
  assert.equal(d[1],undefined); // current user request omitted from historical exchanges
});

test('v2.6 temporal: Rin-local timezone wins over user device timezone',()=>{
  assert.equal(formatRinEventTime(time('2026-10-12T10:11:00'),'Europe/Moscow'),'2026-10-12 10:11');
  assert.equal(formatRinEventTime(time('2026-10-12T10:11:00'),'Europe/Berlin'),'2026-10-12 09:11');
});

test('v2.6 temporal: old scene evidence weakens across hours, without deleting history',()=>{
  const now=time('2026-10-12T15:06:00');
  assert.equal(temporalSceneWeight(now-1000,now),1);
  assert.ok(temporalSceneWeight(now-5*3600000,now)<0.6);
  assert.equal(temporalSceneWeight(undefined,now),1);
  const h=[event('user','Давай пофлиртуем','2026-10-12T10:10:00','u1'), event('assistant','Хорошо, продолжаем','2026-10-12T10:11:00','a1'),afternoon];
  const result=resolveConversationContinuity({history:h,userText:afternoon.content,rawScene:{type:'everyday',confidence:25}});
  assert.ok(result.scene);
  const callback=event('user','Давай продолжим','2026-10-12T15:06:00','u2');
  const continued=resolveConversationContinuity({history:[...h.slice(0,2),callback],userText:callback.content,rawScene:{type:'everyday',confidence:25}});
  assert.equal(continued.scene,'playful_flirt');
});

test('v2.6 temporal: kernel forwards timestamps and records server-side elapsed time',()=>{
  const now=time('2026-10-12T15:06:00');
  const h=[...morning, {...afternoon,ts:now,requestId:'u-new',status:'sent'}];
  const kernel=buildKernelState({requestId:'u-new',userText:afternoon.content,history:h,memory:{conversationState:{revision:0,openLoops:[]}},env:{rinTz:'Europe/Moscow'},now});
  assert.equal(kernel.recentHistory[0].ts,morning[0].ts);
  assert.equal(kernel.temporalContinuity.lastLocal,'2026-10-12 10:11');
  assert.equal(kernel.temporalContinuity.periodShift,'morning->afternoon');
});

test('v2.6 temporal: short-term clock and gap only affect dynamic prompt, not stable identity',()=>{
  const profile={prompt_profile:{}};
  const base=buildRinMindPrompt({profile,state:{}});
  const next=buildRinMindPrompt({profile,state:{
    temporalContinuity:inspectTemporalContinuity({history:morning,now:time('2026-10-12T15:06:00')}),
    environment:{rinTz:'Europe/Moscow'},recentHistory:morning
  }});
  assert.equal(next.stableSystem,base.stableSystem);
  assert.match(next.dynamicSystem,/ВРЕМЕННАЯ НЕПРЕРЫВНОСТЬ/);
  assert.match(next.dynamicSystem,/295 мин/);
  assert.match(next.dynamicSystem,/собирался выпить кофе/);
  assert.match(next.dynamicSystem,/"at":"2026-10-12 10:10"/);
});

test('v2.6 temporal: conversational corrections are explicit even in colloquial contrast',()=>{
  const examples=['Так это не я текст спасал, а наоборот тебя от текста 🤣','Мы же это уже обсуждали 😁','Наоборот, это я тебе предложил'];
  for(const userText of examples){
    const brain={relation:{type:'continuation'},activeScene:{type:'everyday'}};
    const state=buildBehaviorState({userText,history:[],brain});
    assert.equal(state.literalCorrection.explicit,true,userText);
    const dialogue=buildDialogueState({history:[{...event('user',userText,'2026-10-12T17:07:00','u')}],userText,brain});
    assert.ok(dialogue.corrections.includes(userText),userText);
  }
  assert.equal(buildBehaviorState({userText:'Мы обсудим это завтра)',history:[],brain:{relation:{type:'continuation'}}}).literalCorrection.explicit,false);
});

test('v2.6 temporal: debug emits the three temporal fields, no persistent schema changes',()=>{
  const api=readFileSync(new URL('../api/chat.js',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../public/chat.js',import.meta.url),'utf8');
  assert.match(api,/temporalGapMinutes: kernelState.temporalContinuity/);
  assert.match(ui,/temporalGap=\$\{snapshot.temporalGap/);
  assert.match(ui,/temporalResume=\$\{snapshot.temporalResume/);
  assert.match(ui,/temporalPeriodShift=\$\{snapshot.temporalPeriodShift/);
});
