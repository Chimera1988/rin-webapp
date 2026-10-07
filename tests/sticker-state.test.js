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
    history.push(...assistantTurn(turn, { sticker: sendSticker ? (turn % 2 ? 'tender_soft_smile' : 'greeting_soft') : null }));
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
    ...assistantTurn(4, { sticker: 'tender_soft_smile' })
  ];
  const state = await buildStickerState({ history, preference: smart30, scene: 'everyday', userText: 'обычная реплика' });
  assert.equal(state.turnsSinceSticker, 0);
  assert.equal(state.requiredGapTurns, 2);
  assert.equal(state.cooldownRemainingTurns, 2);
  assert.equal(state.semanticAssistantTurns, 4);
  assert.equal(state.lastStickerTurnKey, 'turn-4');
  assert.equal(state.available, false);
  assert.equal(state.reason, 'cooldown');
  assert.deepEqual(state.recentAssetIds.slice(0, 1), ['tender_soft_smile']);
});

test('explicit reciprocal gesture may override rolling budget only after one semantic-turn breathing gap', async () => {
  const adjacent = [
    ...assistantTurn(1, { sticker: 'tender_soft_smile' }),
    ...assistantTurn(2),
    ...assistantTurn(3),
    ...assistantTurn(4, { sticker: 'greeting_soft' })
  ];
  const blocked = await buildStickerState({ history: adjacent, preference: smart30, scene: 'romance', userText: 'целую тебя 😘' });
  assert.equal(blocked.explicitGesture, true);
  assert.equal(blocked.turnsSinceSticker, 0);
  assert.equal(blocked.requiredGapTurns, 1);
  assert.equal(blocked.cooldownRemainingTurns, 1);
  assert.equal(blocked.available, false);
  assert.equal(blocked.reason, 'explicit_gesture_gap');

  const withBreathingTurn = [...adjacent, ...assistantTurn(5)];
  const neutral = await buildStickerState({ history: withBreathingTurn, preference: smart30, scene: 'romance', userText: 'спасибо)' });
  assert.equal(neutral.available, false);
  assert.equal(neutral.reason, 'cooldown');
  const reciprocal = await buildStickerState({ history: withBreathingTurn, preference: smart30, scene: 'romance', userText: 'целую тебя 😘' });
  assert.equal(reciprocal.explicitGesture, true);
  assert.equal(reciprocal.remainingStickerTurns, 0);
  assert.equal(reciprocal.turnsSinceSticker, 1);
  assert.equal(reciprocal.cooldownRemainingTurns, 0);
  assert.equal(reciprocal.available, true);
  assert.equal(reciprocal.reason, 'explicit_gesture_override');
});

test('off, zero-frequency, safe serious scene and always mode have distinct deterministic availability', async () => {
  assert.equal((await buildStickerState({ preference: { mode:'off', probability:100, safeMode:false } })).reason, 'disabled_by_user');
  assert.equal((await buildStickerState({ preference: { mode:'smart', probability:0, safeMode:false } })).reason, 'frequency_zero');
  const safe = await buildStickerState({ preference: { mode:'smart', probability:100, safeMode:true }, scene:'practical_task' });
  assert.equal(safe.available, false);
  assert.equal(safe.reason, 'safe_mode_serious_scene');
  const always = await buildStickerState({ history:[...assistantTurn(1,{sticker:'tender_soft_smile'})], preference:{mode:'always',probability:0,safeMode:false}, scene:'everyday' });
  assert.equal(always.available, true);
  assert.equal(always.reason, 'always_available');
  assert.equal(always.limitStickerTurns, null);
});

test('multi-segment assistant response counts as one sticker turn and preserves exact recent asset order', async () => {
  const history = [
    ...assistantTurn(1, { sticker: 'tender_soft_smile' }),
    ...assistantTurn(2),
    ...assistantTurn(3, { sticker: 'kiss_soft_tender' })
  ];
  const state = await buildStickerState({ history, preference:{mode:'always',probability:100,safeMode:false}, scene:'romance' });
  assert.equal(state.usedStickerTurns, 2);
  assert.deepEqual(state.recentAssetIds.slice(0, 2), ['kiss_soft_tender', 'tender_soft_smile']);
});
