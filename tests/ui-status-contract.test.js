import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('peer status is restricted to offline, online and typing', async () => {
  const [html, chat] = await Promise.all([
    read('public/index.html'),
    read('public/chat.js')
  ]);

  assert.match(html, /id="peerStatus"[^>]*>онлайн<\/div>/);
  assert.match(chat, /offline:\s*'офлайн'/);
  assert.match(chat, /online:\s*'онлайн'/);
  assert.match(chat, /typing:\s*'печатает…'/);
  assert.match(chat, /addEventListener\('online', syncPeerStatus\)/);
  assert.match(chat, /addEventListener\('offline', syncPeerStatus\)/);
  assert.doesNotMatch(chat, /рассказывает…|формирует ответ|готова к диалогу|была недавно/);
  assert.doesNotMatch(chat, /data\.long\s*\?/);
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
