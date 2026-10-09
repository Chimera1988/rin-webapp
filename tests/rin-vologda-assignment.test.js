import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeScheduleConfig } from '../public/js/rin_lore.js';
import { environmentIntent } from '../public/js/environment_intent.js';
import { dayTypeForWeekday, resolveDailyRhythm } from '../public/js/daily_rhythm.js';
import { buildServerProfile } from '../lib/server/canonical-profile.js';
import { retrieveCanonicalLore } from '../lib/server/canon-retrieval.js';
import { buildRinMindPrompt } from '../lib/cognition/rin-mind.js';
import { buildKernelPrompt } from '../lib/cognition/cognitive-kernel.js';
import { lifeTextureCard } from '../lib/cognition/life-texture.js';
import { canonicalProfileFacts } from '../lib/cognition/reality-boundary.js';

const readJson = async path => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));

test('the current Vologda trip uses Europe/Moscow time and Vologda weather location together', async () => {
  const schedule = normalizeScheduleConfig(await readJson('public/data/rin_schedule.json'));
  assert.equal(schedule.timezone, 'Europe/Moscow');
  assert.deepEqual(schedule.location, { name: 'Vologda', country: 'RU', lat: 59.2239, lon: 39.884 });
  assert.equal(schedule.weatherGrounding.enabled, true);
  assert.equal(schedule.innerLife.weeklyRhythm.profiles.saturday.workDefault, false);
  assert.equal(schedule.innerLife.weeklyRhythm.profiles.sunday.workDefault, false);
  assert.equal(schedule.maxDailyInitiations, 2);
  assert.equal(schedule.windows[0].from, '08:00');
});

test('local day boundary follows Vologda, not Japan, for daily rhythm and weekends', async () => {
  const schedule = normalizeScheduleConfig(await readJson('public/data/rin_schedule.json'));
  const now = Date.parse('2026-10-09T16:15:00Z');
  const dateTime = new Intl.DateTimeFormat('sv-SE', {
    timeZone: schedule.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(new Date(now));
  assert.match(dateTime, /^2026-10-09 19:15$/);
  assert.equal(dayTypeForWeekday(5, schedule.innerLife), 'weekday');
  assert.equal(dayTypeForWeekday(6, schedule.innerLife), 'saturday');
  const local = resolveDailyRhythm({ rinHuman: '2026-10-09 19:15' }, schedule.innerLife, {}, now, false);
  assert.equal(local.dayType, 'weekday');
  assert.equal(local.workMode, 'normal'); // weekday work mode label, even outside work hours
});

test('canon keeps Kanazawa as birthplace and permanent home while Vologda is the current address', async () => {
  const profile = await buildServerProfile({});
  const identity = profile.prompt_profile.identity;
  assert.match(identity.birthplace, /Канадзава/);
  assert.match(identity.home_base, /Канадзава/);
  assert.match(identity.location, /Вологда/);
  assert.equal(identity.temporary_assignment.status, 'active');
  assert.equal(identity.temporary_assignment.timezone, 'Europe/Moscow');
  assert.equal(identity.temporary_assignment.return_date, null);
  assert.match(identity.temporary_assignment.reason, /ремёслах/);
  assert.match(profile.prompt_profile.canon.home, /Канадзаве/);
  assert.match(profile.prompt_profile.canon.home, /Вологде/);
  assert.ok(!JSON.stringify(profile.prompt_profile.canon.current_assignment).includes('ради Кирилла'));
  assert.ok(canonicalProfileFacts(profile).some(fact => fact.includes('Вологда')));
});

test('live Rin Mind and existing kernel receive current city in canon, without a second action policy', async () => {
  const profile = await buildServerProfile({});
  const mind = buildRinMindPrompt({ profile, state: { behaviorState: {}, recentHistory: [] } });
  const kernel = buildKernelPrompt({ profile, state: {} });
  for (const text of [mind.stableSystem, kernel.system]) {
    assert.match(text, /Вологда/);
    assert.match(text, /Канадзав/);
    assert.match(text, /Europe\/Moscow/);
    assert.match(text, /командировк/iu);
    assert.match(text, /рем[её]сл/iu);
  }
  assert.match(mind.stableSystem, /ОДИН ЦЕЛОСТНЫЙ ХОД/);
});

test('canon retrieval answers where Rin lives, why she moved, and whether she plans to return', async () => {
  for (const question of ['Где ты сейчас живёшь?', 'Почему ты оказалась в Вологде?', 'Когда вернёшься домой в Японию?']) {
    const result = await retrieveCanonicalLore(question, { fresh: true });
    const canon = result.canon.map(item => `${item.section}: ${item.text}`).join('\n');
    assert.match(canon, /Вологд/iu, question);
    assert.match(canon, /Канадзав|дата не назначена|возвращение/iu, question);
  }
});

test('weather and city phrasing now refers to Vologda without losing prior Japanese-time questions', () => {
  assert.equal(environmentIntent('Который час в Вологде?'), 'time');
  assert.equal(environmentIntent('Время в Вологде?'), 'time');
  assert.equal(environmentIntent('Который час в Канадзаве?'), 'time');
  assert.equal(environmentIntent('Какая у тебя погода?'), 'weather');
  assert.match(lifeTextureCard(), /Вологда \(нынешний город\)/);
});

test('assignment is present canon but is not a ready-made collection of lived memories', async () => {
  const story = await readJson('data/canon/rin_backstory.json');
  const chapter = story.chapters.find(item => item.title === 'Рабочая командировка в Вологду');
  assert.ok(chapter);
  assert.match(chapter.years, /без назначенной даты возвращения/);
  assert.ok(!JSON.stringify(chapter).includes('вернулась в Японию'));
  const memories = await readJson('data/canon/rin_memories.json');
  assert.ok(!JSON.stringify(memories).includes('Вологда'));
});
