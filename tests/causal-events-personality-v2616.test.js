import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectMorningSequence, reconcileDailyEpisode, projectDailyEpisodeActivity } from '../public/lib/daily-episode.js';
import { normalizeInnerLife } from '../public/lib/inner-life-contract.js';
import { normalizeEventEvidence, reconcileEventEvidence, formatEventEvidence, guardUnsupportedSharedCompletion } from '../public/lib/event-evidence.js';
import { assessTopicEngagement, topicDepthGuidance } from '../lib/cognition/topic-depth.js';
import { detectUserFutureCallback } from '../lib/cognition/future-callbacks.js';
import { buildKernelState } from '../lib/cognition/kernel-state.js';
import { buildRinMindPrompt } from '../lib/cognition/rin-mind.js';
import { readFileSync } from 'node:fs';
const now=time=>Date.parse(`2026-10-14T${time}:00+03:00`);
const msg=(text,at,role='assistant')=>({id:`${role}-${at}`,role,kind:'text',status:'complete',content:text,ts:now(at)});
const day='2026-10-14';
const inner=(episode,t)=>({activity:'сделала перерыв на обед',workMode:'normal',sleepPhase:'awake',dailyEpisode:episode,lastStateAt:now(t)});

test('lunch and return to editing outrank an unsupported return to morning preparations',()=>{
  const history=[msg('Я только собираюсь, пока не на работе.','10:14'),msg('Я уже пообедала и вернулась к правкам.','13:14'),msg('Я ещё собираюсь, до правок так и не дошла.','13:39')];
  const scene=inspectMorningSequence({history,now:now('13:40')});
  assert.equal(scene.lunch,'claimed_complete');
  assert.equal(scene.work,'claimed_in_progress');
  assert.equal(scene.conflict,true);
  const ledger=reconcileDailyEpisode({history,now:now('13:40'),dayKey:day});
  const projected=projectDailyEpisodeActivity(inner(ledger,'13:40'),ledger,now('13:40'));
  assert.notEqual(projected.source,'causal_daily_episode');
  assert.equal(ledger.conflict,true);
});

test('persisted lunch prevents regression when past transcript is truncated',()=>{
  const completed=reconcileDailyEpisode({history:[msg('Я уже пообедала и вернулась к правкам.','13:14')],now:now('13:15'),dayKey:day});
  const stale=reconcileDailyEpisode({prior:completed,history:[msg('Я ещё собираюсь, до работы не добралась.','13:39')],now:now('13:40'),dayKey:day});
  assert.equal(stale.lunch,'claimed_complete');
  assert.equal(stale.work,'claimed_in_progress');
  assert.equal(stale.conflict,true);
  assert.deepEqual(normalizeInnerLife({dailyEpisode:stale,lastStateAt:now('13:40')}).dailyEpisode,stale);
});

test('genuine explicit correction can revise a mistaken lunch report',()=>{
  const history=[msg('Я уже пообедала и вернулась к правкам.','13:14'),msg('Ты прав, я не обедала, я ещё собираюсь.','13:39')];
  const result=reconcileDailyEpisode({history,now:now('13:40'),dayKey:day});
  assert.equal(result.lunch,'planned');
  assert.equal(result.workplace,'not_arrived');
  assert.equal(result.corrected,true);
});

test('an offered comedy is a proposal, never an accomplished activity',()=>{
  const history=[msg('Давай выберем что-нибудь посмотреть — лёгкое.','21:56')];
  const evidence=reconcileEventEvidence({history,now:now('23:09'),dayKey:day});
  assert.equal(evidence.items.find(e=>e.key==='film')?.phase,'proposed');
  assert.match(formatEventEvidence(evidence,'Помнишь нашу программу на вечер?'),/только предложено/);
  const invalid=guardUnsupportedSharedCompletion([{type:'text',text:'Лёгкая комедия — мы как раз уже посмотрели её.'}],evidence);
  assert.doesNotMatch(invalid[0].text,/мы как раз уже посмотрели/u);
  assert.match(invalid[0].text,/не.*подтверждения/u);
});

test('a Rin-only completion claim cannot certify an unstarted film',()=>{
  const history=[msg('Давай посмотрим фильм.','21:56'),msg('Мы уже посмотрели эту комедию.','23:09')];
  const evidence=reconcileEventEvidence({history,now:now('23:10'),dayKey:day});
  assert.equal(evidence.items.find(e=>e.key==='film')?.phase,'proposed');
});

test('explicitly started and completed joint film advances phase',()=>{
  const history=[msg('Давай посмотрим фильм.','21:00'),msg('Мы смотрим фильм.','21:03','user'),msg('Комедию уже досмотрели.','22:40')];
  const evidence=reconcileEventEvidence({history,now:now('22:41'),dayKey:day});
  assert.equal(evidence.items.find(e=>e.key==='film')?.phase,'claimed_complete');
  assert.equal(guardUnsupportedSharedCompletion([{type:'text',text:'Мы посмотрели комедию.'}],evidence)[0].text,'Мы посмотрели комедию.');
});

test('user correction invalidates a claimed film completion across shortened history',()=>{
  const started=reconcileEventEvidence({history:[msg('Мы смотрим комедию.','21:03','user'),msg('Мы досмотрели комедию.','22:20')],now:now('22:21'),dayKey:day});
  const corrected=reconcileEventEvidence({prior:started,history:[msg('Мы не смотрели никакой комедии.','23:10','user')],now:now('23:11'),dayKey:day});
  assert.equal(corrected.items.find(e=>e.key==='film')?.phase,'corrected_not_done');
  assert.match(guardUnsupportedSharedCompletion([{type:'text',text:'Мы посмотрели комедию.'}],corrected)[0].text,/нет подтверждения/);
});

test('imagined film scenes do not become shared experiences',()=>{
  assert.equal(reconcileEventEvidence({history:[msg('Представь, как будто мы посмотрели комедию.','21:50')],now:now('22:00'),dayKey:day}),null);
});

test('no promotion from time passage or schedule',()=>{
  const planned=reconcileEventEvidence({history:[msg('Давай посмотрим фильм.','19:00')],now:now('19:01'),dayKey:day});
  const after=reconcileEventEvidence({prior:planned,history:[],now:now('22:20'),dayKey:day});
  assert.equal(after.items.find(e=>e.key==='film')?.phase,'proposed');
  assert.equal(normalizeEventEvidence(after,Date.parse('2026-10-15T22:21:00+03:00'),'2026-10-15'),null);
});

test('Rin inner-life persists a shared event ledger in the existing schema',()=>{
  const ev=reconcileEventEvidence({history:[msg('Давай посмотрим фильм.','19:00')],now:now('19:01'),dayKey:day});
  const recovered=normalizeInnerLife({eventEvidence:ev,lastStateAt:now('19:01')});
  assert.deepEqual(recovered.eventEvidence,ev);
});

test('a negated promise never becomes a future callback',()=>{
  assert.equal(detectUserFutureCallback('Не обещаю, что потом выдержу и не поцелую тебя.'),null);
  assert.equal(detectUserFutureCallback('Не обещаю что потом напишу.'),null);
  assert.ok(detectUserFutureCallback('Обещаю, завтра напишу.'));
});

test('work, books and culture can earn deep answers without romantic framing',()=>{
  assert.equal(assessTopicEngagement('Почему этот перевод было сложно отредактировать?').topic,'work');
  assert.equal(assessTopicEngagement('Расскажи подробнее, что тебе не понравилось в книге?').topic,'literature');
  assert.match(topicDepthGuidance('Как ты считаешь, что важнее в японской каллиграфии?'),/normal\/extended/);
  assert.equal(assessTopicEngagement('😘'),null);
  assert.equal(assessTopicEngagement('Поцелуй меня'),null);
});

test('server kernel and Rin Mind see shared evidence and topic-depth instruction',()=>{
  const events=[msg('Давай выберем что-нибудь посмотреть — лёгкое.','21:56')];
  const state=buildKernelState({requestId:'x',userText:'Помнишь нашу программу на вечер?',history:events,now:now('23:09'),env:{rinHuman:'2026-10-14 23:09',rinTz:'Europe/Moscow'},memory:{innerLife:{},conversationState:{revision:1}}});
  assert.equal(state.innerLife.eventEvidence.items[0].phase,'proposed');
  assert.match(buildRinMindPrompt({state}).dynamicSystem,/ЖУРНАЛ СОВМЕСТНЫХ СОБЫТИЙ/);
  const interested=buildKernelState({requestId:'y',userText:'Почему тебе нравится работать с японскими переводами?',history:events,now:now('23:09'),env:{rinHuman:'2026-10-14 23:09'},memory:{innerLife:{},conversationState:{revision:1}}});
  assert.match(buildRinMindPrompt({state:interested}).dynamicSystem,/СОДЕРЖАТЕЛЬНЫЙ ИНТЕРЕС/);
});

test('release, both HTML entry points and test runner are integrated',()=>{
  const read=x=>readFileSync(new URL(`../${x}`,import.meta.url),'utf8');
  const release=read('public/js/release.js').match(/'(2026-[^']+)'/)?.[1];
  assert.ok(release);
  assert.ok(read('public/index.html').includes(`?v=${release}`));
  assert.ok(read('public/login.html').includes(`?v=${release}`));
  assert.match(read('package.json'),/tests\/\*\.test\.mjs/);
  assert.match(read('api/chat.js'),/guardUnsupportedSharedCompletion/);
});
