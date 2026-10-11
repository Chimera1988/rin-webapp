import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rinCalendarForPrompt, formatRinCalendarGrounding } from '../lib/cognition/temporal-grounding.js';
import { inspectExpressionNovelty, formatExpressionGuidance } from '../lib/cognition/expression-novelty.js';
import { buildRinMindPrompt } from '../lib/cognition/rin-mind.js';

const schedule = JSON.parse(readFileSync(new URL('../public/data/rin_schedule.json', import.meta.url), 'utf8')).weekly_rhythm;
const env = text => ({ rinTz: 'Europe/Moscow', rinHuman: text });
const calendar = (text, rhythm = schedule, mode = 'off') => rinCalendarForPrompt({environment:env(text),weeklyRhythm:rhythm,currentWorkMode:mode});

// The actual regression from the Sunday evening chat.
test('Sunday -> Monday has correct tomorrow, after-tomorrow, and work schedule', () => {
  const result = calendar('2026-10-11 23:06');
  assert.deepEqual(result.days.slice(0, 3).map(d=>[d.dateKey,d.weekday,d.scheduledWork]), [
    ['2026-10-11','воскресенье',false],
    ['2026-10-12','понедельник',true],
    ['2026-10-13','вторник',true]
  ]);
  const instruction = formatRinCalendarGrounding(result);
  assert.match(instruction,/завтра: 2026-10-12, понедельник/u);
  assert.match(instruction,/послезавтра: 2026-10-13, вторник/u);
  assert.match(instruction,/отвечай именно о соответствующей строке/u);
});

test('Monday, Friday, month boundary, year boundary and leap date resolve deterministically', () => {
  for (const [source,next,nextDay] of [
    ['2026-10-12 00:03', '2026-10-13', '2026-10-14'],
    ['2026-10-16 23:59', '2026-10-17', '2026-10-18'],
    ['2026-10-31 23:59', '2026-11-01', '2026-11-02'],
    ['2026-12-31 23:59', '2027-01-01', '2027-01-02'],
    ['2028-02-28 23:59', '2028-02-29', '2028-03-01']
  ]) {
    const days = calendar(source).days;
    assert.equal(days[1].dateKey,next);
    assert.equal(days[2].dateKey,nextDay);
  }
});

test('Local date is authoritative regardless of host OS timezone or UTC date', () => {
  assert.equal(calendar('2026-10-11 00:01').days[1].dateKey, '2026-10-12');
  assert.equal(calendar('2026-10-11 23:59').days[1].dateKey, '2026-10-12');
});

test('Work schedule changes are taken from supplied schedule, not hard-coded weekday', () => {
  const custom = { ...schedule, work_days: [0], sunday: {...schedule.sunday,work_default:true}, weekday:{...schedule.weekday,work_default:false} };
  const days = calendar('2026-10-11 17:00', custom).days;
  assert.equal(days[0].scheduledWork, true);
  assert.equal(days[1].scheduledWork, false);
  assert.equal(days[7].scheduledWork, true);
});

test('Current off mode does not leak into tomorrow work mode', () => {
  const days = calendar('2026-10-11 23:50').days;
  assert.equal(days[0].workMode, 'off');
  assert.equal(days[1].workMode, null);
  assert.equal(days[1].scheduledWork, true);
});

test('Invalid calendar / schedule must not fabricate dates', () => {
  for (const source of ['2026-02-30 22:15', '2026-10-11 25:00', '', '2026-10-11', 'October 11']) {
    assert.equal(calendar(source), null);
  }
  assert.equal(rinCalendarForPrompt({environment:env('2026-10-11 23:00')}), null);
  assert.equal(formatRinCalendarGrounding(null), '');
});

const turns = texts => texts.flatMap((content,i)=>[{role:'user',kind:'text',content:'Продолжай'}, {role:'assistant',kind:'text',content,requestId:`r${i}` }]);
test('Repetitive openings and multiword phrases get flagged and prompt guidance', () => {
  const result = inspectExpressionNovelty(turns([
    'Только не думай что это победа! Я выбираю сама.',
    'Это просто вечер — я рада, что ты рядом.',
    'Только не думай что это уступка! Я не сдаюсь.',
    'Вопрос хороший, но я выбираю сама.',
    'Только не думай что это случайность!'
  ]));
  assert.ok(result.pressure > 20);
  assert.ok(result.repeatedOpenings.some(i=>i.text==='только не думай'));
  assert.match(formatExpressionGuidance(result,4), /РЕЧЕВОЕ РАЗНООБРАЗИЕ/u);
});

test('Assistant split messages in one turn do not count as separate repetitions', () => {
  const result = inspectExpressionNovelty([
    {role:'assistant',turnId:'t1',kind:'text',content:'Не думай что это всё.'},
    {role:'assistant',turnId:'t1',kind:'text',content:'Не думай что это всё.'},
    {role:'user',kind:'text',content:'Хорошо'},
    {role:'assistant',turnId:'t2',kind:'text',content:'Может сегодня посмотрим фильм?'},
    {role:'assistant',turnId:'t3',kind:'text',content:'Можем выпить чаю.'},
    {role:'assistant',turnId:'t4',kind:'text',content:'Давно хотела спросить о доме.'}
  ]);
  assert.equal(result.repeatedPhrases.length,0);
});

test('Plain dialogue with independent response beats is not restricted', () => {
  const result = inspectExpressionNovelty(turns([
    'Я сделала чай и смотрю в окно.',
    'Можем поговорить о книге.',
    'У меня есть интересная история о Вологде.',
    'Да, согласна — ты правильно вспомнил.',
    'Погода изменилась, вечер стал прохладнее.'
  ]));
  assert.equal(result.pressure,0);
  assert.equal(formatExpressionGuidance(result,2),'');
});

test('Long scenes get semantic anti-echo guidance even when exact wording differs', () => {
  const result = inspectExpressionNovelty(turns([
    'Ты снова хитришь и надеешься на победу.',
    'Сама решаю, когда мне уступать.',
    'Ладно, признаю твою находчивость.',
    'Но продолжим наш спор, мне нравится.',
    'Ещё немного — и я сама определю победителя.'
  ]));
  const instruction = formatExpressionGuidance(result,9);
  assert.match(instruction,/продолжительная сцена=да/u);
  assert.match(instruction,/сохраняй намерение, флирт и тему/iu);
});

test('Both new directives enter dynamic system prompt without changing stable prefix', () => {
  const base = { prompt_profile: {} };
  const prev = buildRinMindPrompt({profile:base,state:{}});
  const sample = inspectExpressionNovelty(turns([
    'Только не думай что я сдаюсь.',
    'Сегодня чудесный вечер.',
    'Только не думай что я уступаю.',
    'Я вспоминаю наш разговор.'
  ]));
  const curr = buildRinMindPrompt({profile:base,state:{
    environment:env('2026-10-11 23:06'),
    calendarGrounding:calendar('2026-10-11 23:06'),
    expressionNovelty:sample,
    activeIntent:{turnCount:12}
  }});
  assert.equal(curr.stableSystem,prev.stableSystem);
  assert.match(curr.dynamicSystem,/завтра: 2026-10-12, понедельник/u);
  assert.match(curr.dynamicSystem,/РЕЧЕВОЕ РАЗНООБРАЗИЕ/u);
});
