import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { MemoryStorage } from './helpers/runtime.js';
import { selectStickerForIntent } from '../lib/cognition/sticker-selector.js';
import { STICKER_INTENT_VALUES } from '../lib/cognition/sticker-intents.js';

const storage=new MemoryStorage();
globalThis.localStorage=storage;
const client=await import('../public/lib/stickers-v6.js');
const contract=await import('../public/lib/sticker-contract.js');
const config=JSON.parse(await readFile(new URL('../public/data/stickers-v6.json',import.meta.url),'utf8'));

test.beforeEach(()=>storage.clear());

test('manifest has one v7 contract, exactly 34 assets, and every exact semantic id resolves server-side', async () => {
  const assets=new Set((await readdir(new URL('../public/stickers/',import.meta.url))).map(name=>`/stickers/${name}`));
  const validation=contract.validateStickerConfig(config,assets);
  assert.equal(validation.ok,true,validation.errors.join('\n'));
  assert.equal(config.stickers.length,34);
  for (const sticker of config.stickers) {
    const resolved=await selectStickerForIntent(sticker.id,{delivery:'sticker_only',cause:'reachability test',intensity:70});
    assert.ok(resolved,sticker.id);
    assert.equal(resolved.sticker.id,sticker.id);
    assert.equal(resolved.sticker.src,sticker.src);
  }
});


test('every sticker intent allowed by the strict Kernel schema resolves to a real asset', async () => {
  for (const intent of STICKER_INTENT_VALUES) {
    const resolved = await selectStickerForIntent(intent, { delivery: 'sticker_only' });
    assert.ok(resolved, intent);
    assert.match(resolved.sticker.src, /^\/stickers\/[a-z0-9_]+\.webp$/i);
  }
});

test('unknown semantic sticker intent is unresolved instead of silently becoming warm_smile', async () => {
  const resolved=await selectStickerForIntent('definitely_unknown_sticker_intent',{delivery:'after_text'});
  assert.equal(resolved,null);
});

test('semantic aliases may resolve an existing asset but never change delivery chosen by TurnDecision', async () => {
  const resolved=await selectStickerForIntent('tender',{delivery:'after_text'});
  assert.ok(resolved);
  assert.equal(resolved.delivery,'after_text');
  assert.notEqual(resolved.preferredStickerId,'');
});

test('client sticker module is execution and telemetry only, with no probability or semantic decision API', () => {
  assert.equal(typeof client.decideSticker,'undefined');
  assert.equal(typeof client.decidePlannedSticker,'undefined');
  assert.equal(typeof client.deriveStickerSignals,'undefined');
  assert.equal(typeof client.markStickerSent,'function');
  assert.equal(typeof client.loadStickerConfig,'function');
});

test('sent sticker telemetry persists only under v7 key', () => {
  const sticker=config.stickers.find(item=>item.id==='embrace');
  client.markStickerSent(sticker);
  assert.ok(storage.getItem('rin-stickers-v7-stats'));
  assert.equal(storage.getItem('rin-stickers-v6-stats'),null);
});
