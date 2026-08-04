import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('peer status starts offline and is restricted to offline, online and typing', async () => {
  const [html, chat, presence] = await Promise.all([
    read('public/index.html'),
    read('public/chat.js'),
    read('public/js/presence_controller.js')
  ]);
  const activeStatusSource = `${html}\n${chat}\n${presence}`;

  assert.match(html, /id="peerStatus"[^>]*data-mode="offline"[^>]*>офлайн<\/div>/);
  assert.match(chat, /createPresenceController/);
  assert.match(chat, /addEventListener\('online', syncPeerAvailability\)/);
  assert.match(chat, /addEventListener\('offline', syncPeerAvailability\)/);
  assert.match(chat, /addEventListener\('visibilitychange', syncPeerAvailability\)/);
  assert.match(presence, /offline:\s*'офлайн'/);
  assert.match(presence, /online:\s*'онлайн'/);
  assert.match(presence, /typing:\s*'печатает…'/);
  assert.match(presence, /Возвращение сети или вкладки само по себе не делает Рин онлайн/);
  assert.doesNotMatch(activeStatusSource, /рассказывает…|формирует ответ|готова к диалогу|была недавно/);
});

test('all HTML entrypoints reference the current release id', async () => {
  const [releaseSource, indexHtml, loginHtml] = await Promise.all([
    read('public/js/release.js'),
    read('public/index.html'),
    read('public/login.html')
  ]);
  const release = releaseSource.match(/RIN_RELEASE_ID\s*=\s*['"]([^'"]+)['"]/)?.[1];
  assert.ok(release);
  assert.ok(indexHtml.includes(`?v=${release}`));
  assert.ok(loginHtml.includes(`?v=${release}`));
});
