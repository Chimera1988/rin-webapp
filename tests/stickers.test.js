import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { MemoryStorage } from './helpers/runtime.js';
import { selectStickerForIntent } from '../lib/cognition/sticker-selector.js';
import { STICKER_INTENT_VALUES, stickerIntentGuideText } from '../lib/cognition/sticker-catalog.js';
import { buildKernelPrompt } from '../lib/cognition/cognitive-kernel.js';

const storage = new MemoryStorage();
globalThis.localStorage = storage;
const client = await import('../public/lib/stickers-v7.js');
const contract = await import('../public/lib/sticker-contract.js');
const config = JSON.parse(await readFile(new URL('../public/data/stickers-v7.json', import.meta.url), 'utf8'));

test.beforeEach(() => storage.clear());

test('manifest has one v7 runtime contract, exactly 100 semantic assets, and every asset is registered exactly once', async () => {
  const assetNames = (await readdir(new URL('../public/stickers/', import.meta.url))).filter(name => name.endsWith('.webp'));
  const assets = new Set(assetNames.map(name => `/stickers/${name}`));
  const validation = contract.validateStickerConfig(config, assets);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(config.stickers.length, 100);
  assert.equal(config.defaults.semanticContract, 'sticker-emotion-v3');
  assert.equal(config.defaults.selectionMode, 'exact_semantic_intent');
  assert.deepEqual([...new Set(config.stickers.map(item => item.src))].sort(), [...assets].sort());
});

test('semantic id is the single sticker intent SSOT and exactly matches every asset basename', () => {
  const manifestIds = config.stickers.map(item => item.id);
  assert.equal(manifestIds.length, new Set(manifestIds).size);
  assert.deepEqual([...STICKER_INTENT_VALUES].sort(), [...manifestIds].sort());
  for (const sticker of config.stickers) {
    assert.equal(sticker.src, `/stickers/${sticker.id}.webp`);
    assert.equal(typeof sticker.meaning, 'string');
    assert.ok(sticker.meaning.length > 0, `${sticker.id}: meaning`);
    assert.equal(typeof sticker.useWhen, 'string');
    assert.ok(sticker.useWhen.length > 0, `${sticker.id}: useWhen`);
    assert.equal('intents' in sticker, false, `${sticker.id}: duplicate intent vocabulary must not exist`);
  }
});

test('every exact Kernel sticker intent resolves to the same concrete asset', async () => {
  for (const intent of STICKER_INTENT_VALUES) {
    const resolved = await selectStickerForIntent(intent, { delivery: 'sticker_only' });
    assert.ok(resolved, intent);
    assert.equal(resolved.preferredStickerId, intent);
    assert.equal(resolved.sticker.id, intent);
    assert.equal(resolved.sticker.src, `/stickers/${intent}.webp`);
    assert.equal(resolved.selection.strategy, 'exact_semantic_intent');
    assert.equal(resolved.selection.candidateCount, 1);
  }
});

test('broad legacy gesture families are not valid intents and cannot silently pick a subtype', async () => {
  for (const oldIntent of ['kiss', 'tender', 'warmth', 'hug', 'flirt', 'playful', 'joy']) {
    assert.equal(STICKER_INTENT_VALUES.includes(oldIntent), false, oldIntent);
    assert.equal(await selectStickerForIntent(oldIntent), null, oldIntent);
  }
});

test('semantically different kiss variants stay distinct instead of rotating as interchangeable assets', async () => {
  const ids = ['kiss_goodnight', 'kiss_comfort', 'kiss_teasing', 'kiss_prompt_soft'];
  const rows = config.stickers.filter(item => ids.includes(item.id));
  assert.equal(rows.length, ids.length);
  assert.equal(new Set(rows.map(item => item.meaning)).size, ids.length);
  assert.equal(new Set(rows.map(item => item.useWhen)).size, ids.length);
  for (const id of ids) {
    const resolved = await selectStickerForIntent(id, { delivery: 'after_text', scene: 'romance', intensity: 70 });
    assert.equal(resolved.sticker.id, id);
  }
});

test('Kernel semantic guide is generated from the manifest and contains all 100 exact ids', () => {
  const guide = stickerIntentGuideText();
  for (const id of STICKER_INTENT_VALUES) assert.match(guide, new RegExp(`\\b${id}\\b`));
  assert.match(guide, /\[kiss\]/);
  assert.match(guide, /kiss_goodnight/);
  assert.match(guide, /нежный поцелуй на ночь/);
});

test('Kernel prompt receives the exact semantic map only when StickerState makes stickers available', () => {
  const enabled = buildKernelPrompt({ state: {
    conversationState:'ongoing', stickerState:{ available:true, reason:'available' }, visualReplyCandidates:[]
  } }).system;
  assert.match(enabled, /ТОЧНАЯ СЕМАНТИКА СТИКЕРОВ/);
  assert.match(enabled, /kiss_goodnight — нежный поцелуй на ночь/);
  assert.match(enabled, /tender_missing_you/);

  const disabled = buildKernelPrompt({ state: {
    conversationState:'ongoing', stickerState:{ available:false, reason:'cooldown' }, visualReplyCandidates:[]
  } }).system;
  assert.match(disabled, /На этом ходе stickerIntent недоступен/);
  assert.doesNotMatch(disabled, /ТОЧНАЯ СЕМАНТИКА СТИКЕРОВ/);
});

test('unknown semantic sticker intent stays unresolved', async () => {
  const resolved = await selectStickerForIntent('definitely_unknown_sticker_intent', { delivery: 'after_text' });
  assert.equal(resolved, null);
});

test('client sticker module is execution and telemetry only, with no probability or semantic decision API', () => {
  assert.equal(typeof client.decideSticker, 'undefined');
  assert.equal(typeof client.decidePlannedSticker, 'undefined');
  assert.equal(typeof client.deriveStickerSignals, 'undefined');
  assert.equal(typeof client.markStickerSent, 'function');
  assert.equal(typeof client.loadStickerConfig, 'function');
});

test('sent sticker telemetry persists under the active v7 runtime key', () => {
  const sticker = config.stickers.find(item => item.id === 'tender_soft_smile');
  client.markStickerSent(sticker);
  assert.ok(storage.getItem('rin-stickers-v7-stats'));
  assert.equal(storage.getItem('rin-stickers-v6-stats'), null);
});

test('delivery is preserved by exact selector and is never re-decided from asset metadata', async () => {
  const before = await selectStickerForIntent('flirt_secret_wink', { delivery: 'before_text' });
  const after = await selectStickerForIntent('flirt_secret_wink', { delivery: 'after_text' });
  assert.equal(before.sticker.id, 'flirt_secret_wink');
  assert.equal(after.sticker.id, 'flirt_secret_wink');
  assert.equal(before.delivery, 'before_text');
  assert.equal(after.delivery, 'after_text');
});
