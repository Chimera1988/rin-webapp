import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MemoryStorage } from './helpers/runtime.js';

const storage = new MemoryStorage();
globalThis.localStorage = storage;
const stickers = await import('../public/lib/stickers-v6.js');
const config = JSON.parse(await readFile(new URL('../public/data/stickers-v6.json', import.meta.url), 'utf8'));

test.beforeEach(() => storage.clear());

test('sticker subsystem has one v6 schema and persists only under the v6 key', () => {
  assert.equal(config._schema, 'v6');
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const decision = stickers.decideSticker(config, {
      userText: 'Обнимаю тебя 🤗',
      replyText: 'Иди сюда.',
      mode: 'always',
      baseProbability: 100,
      mood: { affection: 90, energy: 60 },
      relationship: { trust: 90, closeness: 90, playfulness: 0 },
      context: {}
    });
    assert.equal(decision.action, 'send');
    stickers.markStickerSent(decision.sticker);
    assert.ok(storage.getItem('rin-stickers-v6-stats'));
    assert.equal(storage.getItem('rin-stickers-v5-stats'), null);
  } finally {
    Math.random = originalRandom;
  }
});
