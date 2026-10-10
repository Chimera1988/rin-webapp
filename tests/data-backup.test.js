import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { MemoryStorage } from './helpers/runtime.js';
import { createBackup, parseBackup, restoreBackup, RIN_BACKUP_FORMAT } from '../public/js/data_backup.js';

function wallpaper(initial = '') {
  let value = initial;
  return {
    get: async () => value,
    set: async next => { value = next; return true; },
    remove: async () => { value = ''; return true; }
  };
}
const picture = 'data:image/png;base64,aGVsbG8=';
const sourceData = {
  'rin-history-v6': JSON.stringify([{role: 'user', content: 'Привет!', ts: 100}, {role: 'assistant', content: 'И тебе привет', ts: 110}]),
  'rin-diary-v1': JSON.stringify({ memories: [{ place: 'Вологда' }], conversationState: { revision: 23 } }),
  'rin-init-state-v2': JSON.stringify({ last: 13 }),
  'rin-theme': 'theme-light',
  'rin-pin': 'SECRET_PIN_MUST_NOT_LEAK'
};

test('backup round-trip moves history, diary, settings and wallpaper, without PIN', async () => {
  const source = new MemoryStorage(sourceData);
  const created = await createBackup({ storage: source, wallpaperStore: wallpaper(picture), cryptoRef: webcrypto, now: Date.parse('2026-10-10T13:20:00Z') });
  assert.equal(created.summary.messages, 2);
  assert.ok(created.filename.includes('2026-10-10'));
  assert.ok(!created.json.includes('SECRET_PIN_MUST_NOT_LEAK'));
  const parsed = await parseBackup(created.json, { cryptoRef: webcrypto });
  assert.equal(parsed.summary.wallpaper, true);
  const dest = new MemoryStorage({ 'rin-history-v6': '[]', 'rin-pin': 'MY_PWA_PIN', 'rin-sticker-prob': '5' });
  const destWallpaper = wallpaper();
  await restoreBackup(parsed, { storage: dest, wallpaperStore: destWallpaper });
  assert.equal(dest.getItem('rin-history-v6'), sourceData['rin-history-v6']);
  assert.equal(dest.getItem('rin-diary-v1'), sourceData['rin-diary-v1']);
  assert.equal(dest.getItem('rin-init-state-v2'), sourceData['rin-init-state-v2']);
  assert.equal(dest.getItem('rin-theme'), 'theme-light');
  assert.equal(dest.getItem('rin-pin'), 'MY_PWA_PIN');
  assert.equal(dest.getItem('rin-sticker-prob'), null);
  assert.equal(await destWallpaper.get(), picture);
});

test('tampered content and unexpected storage keys are rejected before restore', async () => {
  const created = await createBackup({ storage: new MemoryStorage(sourceData), wallpaperStore: wallpaper(), cryptoRef: webcrypto });
  const damaged = JSON.parse(created.json);
  damaged.payload.storage['rin-theme'] = 'theme-dark';
  await assert.rejects(() => parseBackup(JSON.stringify(damaged), { cryptoRef: webcrypto }), /BACKUP_CHECKSUM_INVALID/);
  const unexpected = JSON.parse(created.json);
  unexpected.payload.storage['rin-pin'] = 'stolen';
  await assert.rejects(() => parseBackup(JSON.stringify(unexpected), { cryptoRef: webcrypto }), /BACKUP_STORAGE_INVALID/);
  const stale = { ...JSON.parse(created.json), format: 'other-application' };
  await assert.rejects(() => parseBackup(JSON.stringify(stale), { cryptoRef: webcrypto }), /BACKUP_FORMAT_UNSUPPORTED/);
  assert.equal(JSON.parse(created.json).format, RIN_BACKUP_FORMAT);
});

test('ordinary write failures roll back all local keys and wallpaper', async () => {
  const created = await createBackup({ storage: new MemoryStorage(sourceData), wallpaperStore: wallpaper(picture), cryptoRef: webcrypto });
  const parsed = await parseBackup(created.json, { cryptoRef: webcrypto });
  const dest = new MemoryStorage({ 'rin-history-v6': '[]', 'rin-pin': 'KEEP_ME', 'rin-theme': 'theme-dark' });
  const destWallpaper = wallpaper('data:image/png;base64,ZW5k');
  const oldWallpaper = await destWallpaper.get();
  const oldValues = Object.fromEntries(dest.map.entries());
  let failed = false;
  const original = dest.setItem.bind(dest);
  dest.setItem = (key, value) => {
    if (key === 'rin-diary-v1' && !failed) { failed = true; throw new Error('Quota exceeded'); }
    original(key, value);
  };
  await assert.rejects(() => restoreBackup(parsed, { storage: dest, wallpaperStore: destWallpaper }), /Quota exceeded/);
  assert.deepEqual(Object.fromEntries(dest.map.entries()), oldValues);
  assert.equal(await destWallpaper.get(), oldWallpaper);
});

test('data settings expose backup actions, and script does not change cognitive engine', async () => {
  const [html, chat, js] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/chat.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/js/data_backup.js', import.meta.url), 'utf8')
  ]);
  assert.match(html, /id="backupExport"/);
  assert.match(html, /id="backupImport"/);
  assert.match(chat, /restoreBackup\(/);
  assert.doesNotMatch(js, /fetch\(|\/api\//);
});
