import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MemoryStorage } from './helpers/runtime.js';
import { normalizeScheduleConfig } from '../public/js/rin_lore.js';
import { activityPeriod, classifyWeather, resolveDailyRhythm } from '../public/js/daily_rhythm.js';
import { buildRinMindPrompt } from '../lib/cognition/rin-mind.js';

const rawSchedule = JSON.parse(await readFile(new URL('../public/data/rin_schedule.json', import.meta.url), 'utf8'));
const schedule = normalizeScheduleConfig(rawSchedule);
const policy = schedule.innerLife;

function epoch(jst) { return Date.parse(jst.replace(' ', 'T') + '+09:00'); }

const profile = {
  prompt_profile: {
    identity: { full_name: 'Рин Акихара', name_japanese: '秋原 凛' },
    reference_character: { core: 'Живая взрослая женщина со своим мнением.', principles: [], imperfections: [] },
    voice: { description: 'Личная русская переписка.', principles: [] },
    relationship: { relationship_philosophy: { core: 'Связь ценна.', principles: [] } }
  },
  base_rules: 'Сохраняй характер Рин.'
};

test('v2.4.11 schedule makes Saturday and Sunday real non-work defaults', () => {
  assert.equal(schedule.schema, 'rin-schedule-v3');
  assert.equal(policy.weeklyRhythm.profiles.weekday.workDefault, true);
  assert.equal(policy.weeklyRhythm.profiles.saturday.workDefault, false);
  assert.equal(policy.weeklyRhythm.profiles.sunday.workDefault, false);
  assert.equal(policy.weeklyRhythm.weekendWork.requiresEstablishedReason, true);
  assert.equal(policy.weeklyRhythm.weekendWork.minimumPressure, 88);
});

test('v2.4.11 an early-morning user message can causally interrupt Rin sleep', () => {
  const now = epoch('2026-10-07 05:50');
  const rhythm = resolveDailyRhythm({ rinHuman: '2026-10-07 05:50' }, policy, {}, now, true);
  assert.equal(rhythm.dayType, 'weekday');
  assert.equal(rhythm.sleep.phase, 'interrupted_sleep');
  assert.equal(rhythm.sleep.wakeReason, 'kirill_message');
  assert.ok(rhythm.sleep.plannedWakeAt > now);
  assert.equal(activityPeriod(rhythm), 'interrupted_sleep');
});

test('v2.4.11 a continuous late conversation keeps Rin awake instead of pretending she fell asleep mid-chat', () => {
  const now = epoch('2026-10-08 00:40');
  const current = {
    sleepCycle: '2026-10-08',
    sleepPhase: 'drowsy',
    lastUserAt: now - 8 * 60000,
    lateConversationMinutes: 15
  };
  const rhythm = resolveDailyRhythm({ rinHuman: '2026-10-08 00:40' }, policy, current, now, true);
  assert.equal(rhythm.sleep.phase, 'drowsy');
  assert.ok(rhythm.sleep.lateConversationMinutes >= 15);
});

test('v2.4.11 weekend daytime activity period stays leisure-oriented', () => {
  const saturday = resolveDailyRhythm({ rinHuman: '2026-10-10 14:00', weather: { desc: 'ясно', temp: 18 } }, policy, {}, epoch('2026-10-10 14:00'), true);
  const sunday = resolveDailyRhythm({ rinHuman: '2026-10-11 14:00', weather: { desc: 'ясно', temp: 18 } }, policy, {}, epoch('2026-10-11 14:00'), true);
  assert.equal(saturday.dayType, 'saturday');
  assert.equal(saturday.workMode, 'off');
  assert.equal(activityPeriod(saturday), 'weekend_day');
  assert.equal(sunday.dayType, 'sunday');
  assert.equal(sunday.workMode, 'off');
  assert.equal(activityPeriod(sunday), 'weekend_day');
});

test('v2.4.11 weather classifier requires adapting or avoiding outdoor plans in bad conditions', () => {
  assert.equal(classifyWeather({ desc: 'гроза и сильный дождь', temp: 11 }).outdoor, 'avoid');
  assert.equal(classifyWeather({ desc: 'небольшой дождь', temp: 14 }).outdoor, 'adapt');
  assert.equal(classifyWeather({ desc: 'ясно', temp: 19 }).outdoor, 'normal');
});

test('v2.4.11 persisted inner life exposes sleep, weekend and weather causality to Rin Mind', () => {
  const prompt = buildRinMindPrompt({
    profile,
    state: {
      behaviorState: {}, driveState: {}, sharedSymbolState: { candidates: [], recentUses: [], guidance: '' },
      innerLife: {
        activity: 'проснулась от сообщения и ещё не до конца вышла из сна',
        energy: 31, mentalLoad: 32, needForQuiet: 72, desireToShare: 58,
        dayType: 'saturday', workday: false, workMode: 'off', activitySetting: 'indoor', weatherGrounded: false,
        sleepPhase: 'interrupted_sleep', sleepCycle: '2026-10-10', sleepDebtMinutes: 74, sleepInterruptions: 1,
        lateConversationMinutes: 46, wakeReason: 'kirill_message',
        sleepCarryover: 'разговор с Кириллом продолжался позже обычного времени сна', realityMode: 'simulated_character_world'
      },
      environment: { rinHuman: '2026-10-10 05:40', rinTz: 'Asia/Tokyo', partOfDay: 'утро', weather: { desc: 'дождь', temp: 13 } },
      recentHistory: []
    }
  });
  assert.match(prompt.stableSystem, /Daily Rhythm \+ Sleep\/Wake Continuity/iu);
  assert.match(prompt.stableSystem, /настоящий выходной/iu);
  assert.match(prompt.stableSystem, /interrupted_sleep/iu);
  assert.match(prompt.stableSystem, /актуальной погодой/iu);
  assert.match(prompt.dynamicSystem, /dayType=saturday/iu);
  assert.match(prompt.dynamicSystem, /wakeReason=kirill_message/iu);
});

test('v2.4.11 memory simulation does not generate work at 05:50 or on a normal weekend', async () => {
  const storage = new MemoryStorage();
  const previous = globalThis.localStorage;
  globalThis.localStorage = storage;
  const memory = await import(`../public/js/rin_memory.js?v2411=${Date.now()}`);
  try {
    const early = await memory.prepareInnerLife({ rinHuman: '2026-10-07 05:50', partOfDay: 'утро' }, 'Доброе утро)', epoch('2026-10-07 05:50'), policy);
    assert.equal(early.sleepPhase, 'interrupted_sleep');
    assert.doesNotMatch(early.activity, /редакт|рабоч|перевод/iu);

    storage.clear();
    const weekend = await memory.prepareInnerLife({ rinHuman: '2026-10-10 14:00', partOfDay: 'день', weather: { desc: 'ясно', temp: 18 } }, 'Привет)', epoch('2026-10-10 14:00'), policy);
    assert.equal(weekend.dayType, 'saturday');
    assert.equal(weekend.workMode, 'off');
    assert.doesNotMatch(weekend.activity, /редакт|издатель|рабочий текст|перевод/iu);
  } finally {
    globalThis.localStorage = previous;
  }
});

test('v2.4.11 chat refreshes stale environment before life selection', async () => {
  const chat = await readFile(new URL('../public/chat.js', import.meta.url), 'utf8');
  assert.match(chat, /environmentIsStale\(schedule\)/u);
  assert.match(chat, /shouldRefreshEnvironment\(combinedUserText\) \|\| environmentIsStale\(schedule\)/u);
  assert.match(chat, /fetchRinWeather\(schedule\.location\)/u);
});
