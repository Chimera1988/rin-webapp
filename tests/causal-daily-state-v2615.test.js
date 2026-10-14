import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage } from './helpers/runtime.js';
import { normalizeScheduleConfig } from '../public/js/rin_lore.js';
import { readFileSync } from 'node:fs';
import { inspectMorningSequence, reconcileDailyEpisode, projectDailyEpisodeActivity } from '../public/lib/daily-episode.js';
import { normalizeInnerLife } from '../public/lib/inner-life-contract.js';
import { buildKernelState } from '../lib/cognition/kernel-state.js';
import { buildRinMindPrompt } from '../lib/cognition/rin-mind.js';

const rawSchedule=JSON.parse(readFileSync(new URL('../public/data/rin_schedule.json',import.meta.url),'utf8'));
const policy=normalizeScheduleConfig(rawSchedule).innerLife;
const time=clock=>Date.parse(`2026-10-14T${clock}:00+03:00`);
const rin=(content,clock)=>({role:'assistant',kind:'text',status:'complete',content,ts:time(clock)});
const env=clock=>({rinHuman:`2026-10-14 ${clock}`,rinTz:'Europe/Moscow'});
const events=[
 rin('Я ещё не совсем проснулась.','10:03'),
 rin('Сначала разберусь с завтраком, потом пойду приручать правки.','10:06'),
 rin('Я уже в рабочем помещении в Вологде.','10:13'),
 rin('Поймал меня: я только собираюсь, не успела ни позавтракать, ни добраться до работы. Потом поеду.','10:14'),
 rin('Я ещё собираюсь, завтрак пока не состоялся.','11:51')
];
const storage=new MemoryStorage();
const prev=globalThis.localStorage;
globalThis.localStorage=storage;
const memory=await import('../public/js/rin_memory.js');

test.after(()=>{globalThis.localStorage=prev;});
test.beforeEach(()=>storage.clear());

test('v2.6.15 correction supersedes old on-site report and survives serialization',()=>{
 const episode=reconcileDailyEpisode({history:events,now:time('11:52'),dayKey:'2026-10-14'});
 assert.equal(episode.workplace,'not_arrived');
 assert.equal(episode.breakfast,'planned');
 assert.equal(episode.preparing,'in_progress');
 assert.deepEqual(normalizeInnerLife({dailyEpisode:episode}).dailyEpisode,episode);
});

test('v2.6.15 schedule cannot assign lunch break after unresolved preparations',async()=>{
 const prepared=await memory.prepareInnerLife(env('11:55'),'Как дела?',time('11:55'),policy,{history:events});
 assert.equal(prepared.dailyEpisode.workplace,'not_arrived');
 assert.equal(prepared.source,'causal_daily_episode');
 assert.match(prepared.activity,/собирается/);
 assert.doesNotMatch(prepared.activity,/обеденн|правк|редакт|обед/iu);
 await memory.commitTurnState({innerLife:prepared,requestId:'first',now:time('11:55'),stateTransition:{}});
 const again=await memory.prepareInnerLife(env('11:56'),'А обед?',time('11:56'),policy,{history:[]});
 assert.equal(again.dailyEpisode.workplace,'not_arrived');
 assert.equal(again.source,'causal_daily_episode');
 assert.doesNotMatch(again.activity,/обеденн|правк|редакт/iu);
});

test('v2.6.15 first reported travel selects commute, not scheduled office work',()=>{
 const now=time('12:02');
 const state=reconcileDailyEpisode({history:[rin('Я сейчас еду на работу.','12:01')],now,dayKey:'2026-10-14'});
 assert.equal(state.travel,'in_progress');
 assert.equal(state.workplace,'not_arrived');
 const projected=projectDailyEpisodeActivity({activity:'редактирует перевод',workMode:'normal',sleepPhase:'awake'},state,now);
 assert.match(projected.activity,/едет на работу/);
});

test('v2.6.15 explicit arrival supersedes stale not-arrived claim',()=>{
 const now=time('12:12');
 const original=reconcileDailyEpisode({history:events,now:time('11:55'),dayKey:'2026-10-14'});
 const arrived=reconcileDailyEpisode({prior:original,history:[rin('Я уже приехала на работу.','12:11')],now,dayKey:'2026-10-14'});
 assert.equal(arrived.workplace,'claimed_arrived');
 const projected=projectDailyEpisodeActivity({activity:'занимается правками',workMode:'normal',sleepPhase:'awake'},arrived,now);
 assert.equal(projected.activity,'занимается правками');
});

test('v2.6.15 old unconfirmed episode expires and does not cross calendar day',()=>{
 const episode=reconcileDailyEpisode({history:events,now:time('11:52'),dayKey:'2026-10-14'});
 assert.equal(reconcileDailyEpisode({prior:episode,history:[],now:time('16:30'),dayKey:'2026-10-14'}),null);
 assert.equal(reconcileDailyEpisode({prior:episode,history:[],now:Date.parse('2026-10-15T10:00:00+03:00'),dayKey:'2026-10-15'}),null);
});

test('v2.6.15 recent assistant statements cannot be manufactured by user or schedule',()=>{
 const now=time('11:52');
 assert.equal(reconcileDailyEpisode({history:[{role:'user',kind:'text',status:'complete',content:'Я сейчас на работе',ts:time('11:50')}],now,dayKey:'2026-10-14'}),null);
 assert.equal(projectDailyEpisodeActivity({activity:'обеденный перерыв',workMode:'normal',sleepPhase:'awake'},null,now).activity,'обеденный перерыв');
});

test('v2.6.15 kernel reconciles client stale scheduled activity before Rin Mind',()=>{
 const now=time('11:55');
 const state=buildKernelState({requestId:'req-x',userText:'Чем занимаешься?',history:events,
  memory:{innerLife:{activity:'сделала перерыв на обед',dayType:'weekday',workMode:'normal',sleepPhase:'awake'},conversationState:{revision:1,openLoops:[]}},
  env:env('11:55'),now});
 assert.equal(state.innerLife.dailyEpisode.workplace,'not_arrived');
 assert.match(state.innerLife.activity,/собирается/);
 assert.equal(state.innerLife.source,'causal_daily_episode');
 const mind=buildRinMindPrompt({state});
 assert.match(mind.dynamicSystem,/УСТОЙЧИВЫЙ DAILY EPISODE/);
 assert.match(mind.dynamicSystem,/dailyEpisode/);
});

test('v2.6.15 fallback from partial recent history preserves a newer persisted statement',()=>{
 const original=reconcileDailyEpisode({history:events,now:time('11:52'),dayKey:'2026-10-14'});
 const prior={...original,evidenceAt:time('11:52'),workplace:'not_arrived'};
 const result=reconcileDailyEpisode({prior,history:[rin('Я уже в рабочем помещении в Вологде.','10:13')],now:time('11:55'),dayKey:'2026-10-14'});
 assert.equal(result.workplace,'not_arrived');
});

test('v2.6.15 unrelated replies do not refresh stale morning evidence',()=>{
 const h=[rin('Я только собираюсь и потом поеду на работу.','10:14'),rin('Раз уж мы заговорили о книгах, у меня появилась мысль.','14:00')];
 const observed=inspectMorningSequence({history:h,now:time('14:01')});
 assert.equal(observed.evidenceAt,time('10:14'));
 assert.equal(reconcileDailyEpisode({history:h,now:time('14:30'),dayKey:'2026-10-14'}),null);
});


test('v2.6.15 elapsed time produces unknown current activity, never fictional workplace arrival',async()=>{
 const prepared=await memory.prepareInnerLife(env('11:55'),'Чем занимаешься?',time('11:55'),policy,
  {history:[rin('Я ещё собираюсь, потом поеду на работу.','10:19')]});
 assert.equal(prepared.dailyEpisode.workplace,'not_arrived');
 assert.match(prepared.activity,/не подтверждён/);
 assert.doesNotMatch(prepared.activity,/обед|работает|редактирует/iu);
});
