import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspectMorningSequence, formatMorningSequence, classifyExplicitActivity } from '../lib/cognition/activity-continuity.js';
import { resolveDailyRhythm, activityPeriod } from '../public/js/daily_rhythm.js';

const time = (clock) => Date.parse(`2026-10-14T${clock}:00+03:00`);
const rin = (content, clock) => ({role: 'assistant', kind: 'text', status: 'complete', content, ts: time(clock)});
const user = (content, clock) => ({role: 'user', kind: 'text', status: 'complete', content, ts: time(clock)});
const morning = [
  rin('Доброе утро. Я ещё не совсем проснулась. Скоро вернусь к абзацу.', '10:03'),
  rin('Сначала разберусь с завтраком, потом снова пойду приручать правки.', '10:06'),
  rin('Думаю сделать тосты с яйцом — что-нибудь простое.', '10:07'),
  rin('Я сейчас не из дома. Я уже в рабочем помещении в Вологде.', '10:11'),
  rin('Сегодня нужно идти — я уже в рабочем помещении в Вологде.', '10:13'),
  user('Странно, ты за 13 минут собралась, позавтракала и уже на работе 😅', '10:14'),
  rin('Поймал меня. Завтрак и сборы были планом, а не уже случившимся. За эти 13 минут я не успела ни позавтракать, ни добраться до работы — я только собираюсь, а потом поеду в рабочее помещение. Исправляюсь.', '10:14'),
  rin('Пока никак — я ещё собираюсь, так что тост с яйцом всё ещё только в планах.', '10:15'),
  rin('Собираюсь по-человечески: умыться, одеться и потом уже ехать на работу.', '10:16'),
  rin('Не забуду. Тост с яйцом уже внесён в мысленный план.', '10:17'),
  rin('Вот и договорились. Я пока приручу один упрямый абзац.', '10:18'),
  user('Когда ты все успеваешь, только говорила что собираешься еще, а тут уже абзац…', '10:19'),
  rin('Опять перескочила через время. Я ещё собираюсь, а абзац уже будто ждёт меня на работе. Завтрак тоже пока впереди.', '10:19')
];

const fixturePolicy = {weeklyRhythm:{profiles:{weekday:{
  sleepWindow:{from:'23:30',to:'00:30'},wakeWindow:{from:'06:45',to:'07:30'},
  workBlocks:[{from:'08:00',to:'11:30'},{from:'13:00',to:'17:30'}],morningPersonalUntil:'08:00'
}}}};
const env = clock => ({rinHuman:`2026-10-14 ${clock}`,rinTz:'Europe/Moscow'});

test('conversational morning correction supersedes previous on-site statement', () => {
  const state=inspectMorningSequence({history:morning,now:time('10:20')});
  assert.ok(state);
  assert.equal(state.workplace,'not_arrived');
  assert.equal(state.preparing,'in_progress');
  assert.equal(state.travel,'planned');
  assert.equal(state.breakfast,'planned');
  assert.equal(state.work,'planned');
  assert.equal(state.corrected,true);
  const cue=formatMorningSequence(state);
  assert.match(cue,/расписания НЕ доказывает/);
  assert.match(cue,/приоритетнее старого заявления/);
});

test('older claim of arrival remains evidence until later explicit correction', () => {
  const state=inspectMorningSequence({history:morning.slice(0,5),now:time('10:13')});
  assert.equal(state.workplace,'claimed_arrived');
  assert.equal(state.travel,'claimed_complete');
});

test('no schedule-only inference about work, transit or breakfast', () => {
  assert.equal(inspectMorningSequence({history:[user('Завтрак?', '10:04')],now:time('10:05')}),null);
  assert.equal(inspectMorningSequence({history:[],now:time('10:04')}),null);
  const r=resolveDailyRhythm(env('10:04'),fixturePolicy,{},time('10:04'),true);
  assert.equal(activityPeriod(r),'work_morning');
  // A work schedule is an intended availability window, not a proof of arrival.
  const source=readFileSync(new URL('../lib/cognition/rin-mind.js',import.meta.url),'utf8');
  assert.match(source,/Расписание и innerLife\.activity описывают ожидаемый ритм/);
  assert.match(source,/formatMorningSequence\(inspectMorningSequence/);
});

test('breakfast remains planned rather than magically completed a minute later', () => {
  const h=[rin('Думаю сделать тосты с яйцом.', '10:07'),rin('Тост тебе оставлю мысленно.', '10:08')];
  assert.equal(inspectMorningSequence({history:h,now:time('10:09')}).breakfast,'planned');
});

test('Rin can explicitly skip breakfast without being forced to eat', () => {
  const h=[rin('Думаю сделать тосты с яйцом.', '10:07'),rin('Решила пропустить завтрак и поехать на работу.', '10:20')];
  assert.equal(inspectMorningSequence({history:h,now:time('10:21')}).breakfast,'skipped');
});

test('later explicitly reported arrival supersedes former plan', () => {
  const h=[...morning,rin('Я уже приехала на работу.', '10:40')];
  const state=inspectMorningSequence({history:h,now:time('10:41')});
  assert.equal(state.workplace,'claimed_arrived');
  assert.equal(state.travel,'claimed_complete');
});

test('a prospective work paragraph cannot cancel the corrections', () => {
  const h=[rin('Я только собираюсь, потом поеду на работу.', '10:14'),rin('Вот и договорились. Я пока приручу один упрямый абзац.', '10:18')];
  assert.equal(inspectMorningSequence({history:h,now:time('10:20')}).workplace,'not_arrived');
});

test('older scenes naturally expire and unrelated user text cannot invent events', () => {
  assert.equal(inspectMorningSequence({history:[rin('Я только собираюсь.', '10:14')],now:time('16:15')}),null);
  assert.equal(inspectMorningSequence({history:[user('Я собираюсь', '10:14')],now:time('10:15')}),null);
});

test('does not classify quoted hypotheticals about breakfast as completed', () => {
  const h=[rin('Представь: если бы я позавтракала, то уже была бы на работе!', '10:14')];
  assert.notEqual(inspectMorningSequence({history:h,now:time('10:15')})?.breakfast,'claimed_complete');
});

test('old lunch and walk classification remains intact',()=>{
  assert.equal(classifyExplicitActivity(rin('Собираюсь пообедать','10:07'))?.activity,'meal');
  assert.equal(classifyExplicitActivity(rin('Пойду прогуляться','10:07'))?.activity,'walk');
});

test('night sleep debt is reconciled once, not reduced by each morning message',()=>{
  const firstNow=time('10:05');
  const previousNight={sleepCycle:'2026-10-14',sleepPhase:'interrupted_sleep',sleepDebtMinutes:83,
    lastSleepMinutes:0,sleepStartedAt:time('00:55'),lastWakeAt:time('02:35'),
    lastUserAt:time('02:35'),sleepInterruptions:1,lateConversationMinutes:185};
  const a=resolveDailyRhythm(env('10:05'),fixturePolicy,previousNight,firstNow,true).sleep;
  assert.ok(a.sleepDebtMinutes>0);
  assert.ok(a.lastSleepMinutes>0);
  const b=resolveDailyRhythm(env('10:06'),fixturePolicy,{
    ...previousNight,sleepPhase:a.phase,sleepCycle:a.cycle,sleepDebtMinutes:a.sleepDebtMinutes,
    lastSleepMinutes:a.lastSleepMinutes,lastWakeAt:a.lastWakeAt,lastUserAt:time('10:05')
  },time('10:06'),true).sleep;
  const c=resolveDailyRhythm(env('10:08'),fixturePolicy,{
    ...previousNight,sleepPhase:b.phase,sleepCycle:b.cycle,sleepDebtMinutes:b.sleepDebtMinutes,
    lastSleepMinutes:b.lastSleepMinutes,lastWakeAt:b.lastWakeAt,lastUserAt:time('10:06')
  },time('10:08'),true).sleep;
  assert.equal(b.sleepDebtMinutes,a.sleepDebtMinutes);
  assert.equal(c.sleepDebtMinutes,a.sleepDebtMinutes);
  assert.equal(b.lastSleepMinutes,a.lastSleepMinutes);
});

test('sleep carryover no longer presupposes an actively continued conversation',()=>{
  const result=resolveDailyRhythm(env('10:05'),fixturePolicy,{sleepCycle:'2026-10-14',
    sleepPhase:'interrupted_sleep',sleepDebtMinutes:83,lateConversationMinutes:185,
    sleepInterruptions:1,lastUserAt:time('02:35'),sleepStartedAt:time('00:55')},time('10:05'),true);
  assert.match(result.sleep.carryover,/не доказывает непрерывный разговор/);
  assert.doesNotMatch(result.sleep.carryover,/Рин сама участвовала в решении/);
});

test('late wake-up self-report defeats a scheduled work period',()=>{
  const state=inspectMorningSequence({history:[morning[0]],now:time('10:04')});
  assert.equal(state.workplace,'not_arrived');
  assert.notEqual(state.work,'claimed_in_progress');
  assert.match(formatMorningSequence(state),/рабочее место: ещё не прибыла/);
});

test('mentioning a future editing task is not the same as editing right now',()=>{
  const h=[rin('Я ещё собираюсь и потом поеду.', '10:14'),rin('Пойду приручать этот абзац, когда доберусь.', '10:15')];
  const state=inspectMorningSequence({history:h,now:time('10:16')});
  assert.equal(state.work,'planned');
  assert.equal(state.workplace,'not_arrived');
});

test('weather and weekday schedule metadata remain unchanged',()=>{
  const one=resolveDailyRhythm({...env('10:04'),weather:{desc:'дождь',temp:7}},fixturePolicy,{},time('10:04'),true);
  const two=resolveDailyRhythm({...env('10:04'),weather:{desc:'дождь',temp:7}},fixturePolicy,{},time('10:04'),true);
  assert.equal(one.dayType,'weekday');
  assert.equal(one.workMode,'normal');
  assert.equal(one.weather.kind,'precipitation');
  assert.deepEqual(one.weather,two.weather);
});

test('a different sleep cycle is allowed to reconcile a different night',()=>{
  const input={sleepCycle:'2026-10-13',sleepPhase:'awake',sleepDebtMinutes:44,
    lastSleepMinutes:400,lastUserAt:time('02:35')};
  const result=resolveDailyRhythm(env('10:05'),fixturePolicy,input,time('10:05'),true).sleep;
  assert.equal(result.cycle,'2026-10-14');
  assert.notEqual(result.sleepDebtMinutes,44);
});

test('prompt does not claim silent late-night emojis were a continued conversation',()=>{
  const source=readFileSync(new URL('../lib/cognition/rin-mind.js',import.meta.url),'utf8');
  assert.match(source,/одиночные эмодзи и сознательное молчание/);
  assert.doesNotMatch(source,/причинный след позднего совместного разговора/);
});
