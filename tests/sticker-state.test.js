import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStickerState } from '../lib/cognition/sticker-state.js';

function assistantTurn(index, { sticker = null } = {}) {
  const turnId = `turn-${index}`;
  const rows = [{ role: 'assistant', status: 'complete', kind: 'text', id: `${turnId}-text`, turnId, requestId: `r-${index}`, content: `reply ${index}` }];
  if (sticker) rows.push({
    role: 'assistant', status: 'complete', kind: 'sticker', id: `${turnId}-sticker`, turnId, requestId: `r-${index}`,
    sticker: { id: sticker, src: `/stickers/${sticker}.webp`, emotion: sticker }
  });
  return rows;
}

const smart30 = { mode: 'smart', probability: 30, safeMode: true };

test('smart 30% is a hard rolling budget: a greedy caller can spend only three sticker turns in the first ten turns', async () => {
  const history = [];
  const usedAt = [];
  for (let turn = 1; turn <= 10; turn += 1) {
    const state = await buildStickerState({ history, preference: smart30, scene: 'everyday', userText: 'обычная реплика' });
    const sendSticker = state.available;
    if (sendSticker) usedAt.push(turn);
    history.push(...assistantTurn(turn, { sticker: sendSticker ? (turn % 2 ? 'warm_smile' : 'smile') : null }));
  }
  assert.deepEqual(usedAt, [1, 4, 7]);
  const state = await buildStickerState({ history, preference: smart30, scene: 'everyday', userText: 'ещё сообщение' });
  assert.equal(state.usedStickerTurns, 2); // current ten-turn window excludes turn 1
  assert.equal(state.limitStickerTurns, 3);
  assert.equal(state.available, true);
});

test('cooldown is reconstructed from server-visible assistant turn history, not client telemetry', async () => {
  const history = [
    ...assistantTurn(1),
    ...assistantTurn(2),
    ...assistantTurn(3),
    ...assistantTurn(4, { sticker: 'warm_smile' })
  ];
  const state = await buildStickerState({ history, preference: smart30, scene: 'everyday', userText: 'обычная реплика' });
  assert.equal(state.turnsSinceSticker, 0);
  assert.equal(state.available, false);
  assert.equal(state.reason, 'cooldown');
  assert.deepEqual(state.recentAssetIds.slice(0, 1), ['warm_smile']);
});

test('explicit reciprocal kiss can shorten cooldown only when rolling budget still has room', async () => {
  const history = [
    ...assistantTurn(1, { sticker: 'warm_smile' }),
    ...assistantTurn(2),
    ...assistantTurn(3),
    ...assistantTurn(4, { sticker: 'smile' })
  ];
  const neutral = await buildStickerState({ history, preference: smart30, scene: 'romance', userText: 'спасибо)' });
  assert.equal(neutral.available, false);
  assert.equal(neutral.reason, 'rolling_budget_exhausted');
  const reciprocal = await buildStickerState({ history, preference: smart30, scene: 'romance', userText: 'целую тебя 😘' });
  assert.equal(reciprocal.explicitGesture, true);
  assert.equal(reciprocal.remainingStickerTurns, 0);
  assert.equal(reciprocal.available, false);
  assert.equal(reciprocal.reason, 'rolling_budget_exhausted');

  const moreRoom = [
    ...assistantTurn(1, { sticker: 'warm_smile' }),
    ...assistantTurn(2),
    ...assistantTurn(3),
    ...assistantTurn(4),
    ...assistantTurn(5),
    ...assistantTurn(6),
    ...assistantTurn(7, { sticker: 'kiss' })
  ];
  const neutralWithRoom = await buildStickerState({ history: moreRoom, preference: smart30, scene: 'romance', userText: 'спасибо)' });
  assert.equal(neutralWithRoom.available, false);
  assert.equal(neutralWithRoom.reason, 'cooldown');
  const allowed = await buildStickerState({ history: moreRoom, preference: smart30, scene: 'romance', userText: 'целую тебя 😘' });
  assert.equal(allowed.explicitGesture, true);
  assert.equal(allowed.remainingStickerTurns, 1);
  assert.equal(allowed.available, true);
  assert.equal(allowed.requiredGapTurns, 0);
});

test('off, zero-frequency, safe serious scene and always mode have distinct deterministic availability', async () => {
  assert.equal((await buildStickerState({ preference: { mode:'off', probability:100, safeMode:false } })).reason, 'disabled_by_user');
  assert.equal((await buildStickerState({ preference: { mode:'smart', probability:0, safeMode:false } })).reason, 'frequency_zero');
  const safe = await buildStickerState({ preference: { mode:'smart', probability:100, safeMode:true }, scene:'practical_task' });
  assert.equal(safe.available, false);
  assert.equal(safe.reason, 'safe_mode_serious_scene');
  const always = await buildStickerState({ history:[...assistantTurn(1,{sticker:'warm_smile'})], preference:{mode:'always',probability:0,safeMode:false}, scene:'everyday' });
  assert.equal(always.available, true);
  assert.equal(always.reason, 'always_available');
  assert.equal(always.limitStickerTurns, null);
});

test('multi-segment assistant response counts as one sticker turn and preserves exact recent asset order', async () => {
  const history = [
    ...assistantTurn(1, { sticker: 'warm_smile' }),
    ...assistantTurn(2),
    ...assistantTurn(3, { sticker: 'kiss' })
  ];
  const state = await buildStickerState({ history, preference:{mode:'always',probability:100,safeMode:false}, scene:'romance' });
  assert.equal(state.usedStickerTurns, 2);
  assert.deepEqual(state.recentAssetIds.slice(0, 2), ['kiss', 'warm_smile']);
});
