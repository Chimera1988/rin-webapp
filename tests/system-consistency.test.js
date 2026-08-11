import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeScheduleConfig } from '../public/js/rin_lore.js';
import { resolveInitiationPolicy } from '../public/js/conversation_policy.js';
import { buildServerProfile } from '../lib/server/canonical-profile.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFile(path.join(root, file), 'utf8');
const exists = file => access(path.join(root, file)).then(() => true, () => false);

test('public schedule is one validated source for initiative, timezone, location and inner-life timing', async () => {
  const raw = JSON.parse(await read('public/data/rin_schedule.json'));
  const schedule = normalizeScheduleConfig(raw);
  const policy = resolveInitiationPolicy(schedule);
  assert.equal(schedule.schema, 'rin-schedule-v2');
  assert.equal(schedule.timezone, 'Asia/Tokyo');
  assert.deepEqual(schedule.windows.map(item => item.id), ['morning', 'day_ping', 'evening']);
  assert.deepEqual(schedule.windows.map(item => item.probability), [0.55, 0.28, 0.5]);
  assert.equal(schedule.probabilitySemantics, 'one_draw_per_window_when_eligible');
  assert.deepEqual(policy.innerLife, { activityMinMinutes: 35, activityMaxMinutes: 104, continueAcrossMessages: true });
  assert.equal(policy.location.lat, 36.5613);
  assert.equal(policy.location.lon, 136.6562);
});

test('client profile overrides expose only fields that the server actually consumes', async () => {
  const server = await buildServerProfile({
    name: 'CLIENT_NAME',
    starters: ['CLIENT_STARTER'],
    initiation: { max_per_day: 9 },
    base_rules: 'CLIENT_RULES',
    description: 'Описание',
    instructions_extra: 'Инструкция',
    knowledge: 'Знание'
  });
  assert.equal(server.name, 'Рин Акихара');
  assert.equal(server.description, 'Описание');
  assert.equal(server.instructions_extra, 'Инструкция');
  assert.equal(server.knowledge, 'Знание');
  assert.doesNotMatch(server.base_rules, /CLIENT_RULES/);
  assert.equal('starters' in server, false);
  assert.equal('initiation' in server, false);

  const ui = await read('public/index.html');
  for (const deadId of ['pName', 'pInstrBase', 'pStarters', 'pInitMax', 'pWin1', 'pWin2']) assert.doesNotMatch(ui, new RegExp(`id=["']${deadId}["']`));
  for (const liveId of ['pDesc', 'pInstrExtra', 'pKnowledge']) assert.match(ui, new RegExp(`id=["']${liveId}["']`));
});

test('canonical biography and prompt files are physically server-only', async () => {
  for (const name of ['rin_prompt_profile.json', 'rin_backstory.json', 'rin_memories.json', 'rin_triggers.json']) {
    assert.equal(await exists(`data/canon/${name}`), true, `missing server canon ${name}`);
    assert.equal(await exists(`public/data/${name}`), false, `server canon leaked into public/data: ${name}`);
  }
});

test('sticker runtime has one physical v7 entrypoint and manifest', async () => {
  assert.equal(await exists('public/lib/stickers-v7.js'), true);
  assert.equal(await exists('public/data/stickers-v7.json'), true);
  assert.equal(await exists('public/lib/stickers-v6.js'), false);
  assert.equal(await exists('public/data/stickers-v6.json'), false);
  const chat = await read('public/chat.js');
  assert.match(chat, /stickers-v7\.js/);
  assert.match(chat, /stickers-v7\.json/);
  assert.doesNotMatch(chat, /stickers-v6/);
});

test('weather and environment use schedule coordinates instead of duplicate city constants', async () => {
  const chat = await read('public/chat.js');
  const weather = await read('api/weather.js');
  assert.doesNotMatch(chat, /RIN_TZ|RIN_CITY|RIN_COUNTRY/);
  assert.match(chat, /schedule\.timezone/);
  assert.match(chat, /fetchRinWeather\(schedule\.location\)/);
  assert.match(chat, /\/api\/weather\?lat=/);
  assert.doesNotMatch(weather, /query\.q|Kanazawa/);
  assert.match(weather, /query\.lat/);
  assert.match(weather, /query\.lon/);
});


test('large wallpaper media is isolated from conversational localStorage state', async () => {
  const chat = await read('public/chat.js');
  const chatStore = await read('public/js/chat_store.js');
  const wallpaperStore = await read('public/js/wallpaper_store.js');
  assert.match(chat, /createWallpaperStore/);
  assert.match(wallpaperStore, /rin-media-v1/);
  assert.match(wallpaperStore, /indexedDBRef/);
  assert.doesNotMatch(chat, /LS_WP_DATA|['"]rin-wallpaper-data['"]/);
  assert.match(chatStore, /LEGACY_RESET_ONLY_STORAGE_KEYS[\s\S]*rin-wallpaper-data/);
  assert.doesNotMatch(chatStore, /ACTIVE_RESETTABLE_STORAGE_KEYS[\s\S]{0,500}rin-wallpaper-data/);
});

test('user request lifecycle has a durable history boundary before network work', async () => {
  const chat = await read('public/chat.js');
  const store = await read('public/js/chat_store.js');
  assert.match(store, /export function persistChatHistoryMutation/);
  assert.match(chat, /persistedForRequest = persistChatHistoryMutation/);
  assert.match(chat, /HISTORY_STORAGE_FAILED/);
});
