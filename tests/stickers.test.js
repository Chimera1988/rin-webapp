import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { MemoryStorage } from './helpers/runtime.js';

const storage = new MemoryStorage();
globalThis.localStorage = storage;
const stickers = await import('../public/lib/stickers-v6.js');
const contract = await import('../public/lib/sticker-contract.js');
const config = JSON.parse(await readFile(new URL('../public/data/stickers-v6.json', import.meta.url), 'utf8'));

test.beforeEach(() => storage.clear());

test('manifest has one v7 contract, exactly 34 reachable stickers and matching assets', async () => {
  const assets = new Set((await readdir(new URL('../public/stickers/', import.meta.url))).map(name => `/stickers/${name}`));
  const validation = contract.validateStickerConfig(config, assets);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(config.stickers.length, 34);
  for (const sticker of config.stickers) {
    const decision = stickers.decideSticker(config, {
      userText: sticker.reachability.userText,
      replyText: '', mode: 'always', baseProbability: 100,
      mood: { affection: 100, energy: 50 },
      relationship: { trust: 100, closeness: 100, playfulness: 100 },
      context: { preferredStickerId: sticker.id, nonverbalAction: { delivery: 'sticker_only', cause: 'reachability test', intensity: 70 }, scene: sticker.scenes?.[0] || 'everyday' }
    });
    assert.equal(decision.action, 'send', sticker.id);
    assert.equal(decision.sticker.id, sticker.id);
    assert.equal(decision.delivery, 'sticker_only');
    storage.clear();
  }
});

test('zero probability is an absolute off switch in smart mode', () => {
  const decision = stickers.decideSticker(config, { userText: 'Целую тебя 💋', mode: 'smart', baseProbability: 0, context: { preferredStickerId: 'kiss' } });
  assert.equal(decision.action, 'none');
  assert.equal(decision.reason, 'probability_zero');
});

test('negated affection does not become a kiss or hug signal', () => {
  const signals = stickers.deriveStickerSignals('Не целуй меня и не обнимай', '', {});
  assert.equal(signals.kiss, false);
  assert.equal(signals.hug, false);
});

test('safe mode blocks serious scenes', () => {
  const decision = stickers.decideSticker(config, { userText: 'Исправь критическую ошибку', mode: 'always', baseProbability: 100, context: { safeMode: true, scene: 'practical_task', preferredStickerId: 'smile' } });
  assert.equal(decision.action, 'none');
  assert.equal(decision.reason, 'safe_mode_scene');
});

test('sent sticker state persists only under v7 key', () => {
  const sticker = config.stickers.find(item => item.id === 'embrace');
  stickers.markStickerSent(sticker);
  assert.ok(storage.getItem('rin-stickers-v7-stats'));
  assert.equal(storage.getItem('rin-stickers-v6-stats'), null);
});


test('planned sticker executor can only render the exact server semantic decision', () => {
  const decision = stickers.decidePlannedSticker(config, {
    planned: { preferredStickerId: 'agreement', delivery: 'sticker_only', cause: 'сервер решил подтвердить согласие', intensity: 65 },
    mode: 'always', baseProbability: 100
  });
  assert.equal(decision.action, 'send');
  assert.equal(decision.sticker.id, 'agreement');
  assert.equal(decision.delivery, 'sticker_only');
  assert.match(decision.reason, /server_plan/i);
});
