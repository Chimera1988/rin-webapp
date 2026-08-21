import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBehaviorState } from '../lib/cognition/behavior-state.js';
import { buildDriveState } from '../lib/cognition/drive-state.js';
import { parseRinMind } from '../lib/cognition/rin-mind.js';
import { buildStickerState } from '../lib/cognition/sticker-state.js';
import { STICKER_INTENT_VALUES } from '../lib/cognition/sticker-catalog.js';
import { buildStickerCandidates } from '../lib/cognition/sticker-candidates.js';
import { fitMessengerText, repairMaleUserAddress, stabilizeTurn } from '../lib/cognition/turn-stabilizer.js';
function assistantMessage({ id, turnId, content = '', sticker = null }) {
  return {
    id,
    role: 'assistant',
    kind: sticker ? 'sticker' : 'text',
    status: 'complete',
    turnId,
    content,
    sticker
  };
}

test('explicit stop-questions request becomes a strong behavioral boundary', () => {
  const state = buildBehaviorState({
    userText: 'Хватит вопросов пока)',
    history: [
      assistantMessage({ id: 'a1', turnId: 't1', content: 'Как прошёл день?' }),
      assistantMessage({ id: 'a2', turnId: 't2', content: 'А что ты бы выбрал?' })
    ]
  });
  assert.equal(state.explicitBoundary.noQuestions, true);
  assert.equal(state.question.strongNoQuestion, true);
  assert.equal(state.question.restraint, 100);
});

test('question fatigue grows from repeated assistant question turns', () => {
  const history = [
    assistantMessage({ id: 'a1', turnId: 't1', content: 'Как ты?' }),
    assistantMessage({ id: 'a2', turnId: 't2', content: 'Что думаешь?' }),
    assistantMessage({ id: 'a3', turnId: 't3', content: 'Расскажешь?' })
  ];
  const state = buildBehaviorState({ userText: 'нормально', history });
  assert.ok(state.question.fatigue >= 70);
  assert.equal(state.question.streak, 3);
});



test('drive state keeps curiosity while suppressing question impulse under a boundary', () => {
  const behaviorState = { question: { restraint: 100, strongNoQuestion: true }, space: { pressure: 0 } };
  const drives = buildDriveState({
    state: {
      relationship: { closeness: 80, comfort: 80, respect: 80, playfulness: 60, attraction: 50 },
      mood: { affection: 75, energy: 70 },
      emotion: { tension: 0, warmth: 75 },
      scene: { type: 'everyday' }
    },
    behaviorState,
    brain: { activeScene: { type: 'everyday' }, hiddenIntent: { type: 'none' } }
  });
  assert.ok(drives.curiosity >= 50);
  assert.ok(drives.questionImpulse <= 20);
});

test('Rin Mind parser deterministically removes information questions under a strong boundary', () => {
  const output = {
    act: 'playful_retreat',
    focus: 'уважить просьбу пользователя',
    stance: 'мягко и с улыбкой',
    question: { mode: 'natural', reason: 'curiosity' },
    replyLink: { targetEventId: null, reason: null },
    delivery: {
      segments: [{
        type: 'text', purpose: 'accept_boundary', stickerIntent: null, maxChars: 240,
        text: 'Ладно, отступаю) А что бы ты всё-таки рассказал?'
      }]
    },
    intentTransition: { operation: 'none', goal: null, motive: null, target: null, nextMove: null, progress: null, commitment: null, reason: null },
    openLoops: { open: [], resolveIds: [] },
    realityMode: 'grounded',
    mind: {
      felt: 'игривое принятие', wants: 'не давить', restraint: 'граница пользователя', socialIntent: 'retreat', confidence: 90
    }
  };
  const result = parseRinMind(output, { behaviorState: { question: { strongNoQuestion: true } } });
  assert.equal(result.decision.question.mode, 'none');
  assert.equal(result.realization.segments.length, 1);
  assert.equal(result.realization.segments[0].text.includes('?'), false);
  assert.match(result.realization.segments[0].text, /Ладно, отступаю/);
});

test('smart sticker cooldown is soft pressure, not a hard block', async () => {
  const stickerId = STICKER_INTENT_VALUES[0];
  assert.ok(stickerId);
  const history = [
    assistantMessage({
      id: 's1', turnId: 'turn-1', content: '[gesture]',
      sticker: { id: stickerId, src: `/stickers/${stickerId}.webp`, emotion: 'warmth' }
    })
  ];
  const state = await buildStickerState({
    history,
    preference: { mode: 'smart', probability: 30, safeMode: true },
    scene: 'everyday',
    userText: 'ага)'
  });
  assert.equal(state.hardAvailable, true);
  assert.equal(state.available, false); // legacy scheduler signal
  assert.equal(state.hardAvailable, true); // Rin Mind may still choose an emotionally justified gesture
  assert.ok(state.cooldownPressure >= 0);
  assert.ok(state.desireModifier > 0);
});

test('sticker mode off remains a real hard boundary', async () => {
  const state = await buildStickerState({
    history: [],
    preference: { mode: 'off', probability: 100, safeMode: false },
    scene: 'everyday',
    userText: 'обними меня'
  });
  assert.equal(state.hardAvailable, false);
  assert.equal(state.available, false);
  assert.equal(state.propensity, 0);
});



test('sticker candidate shortlist follows current nonverbal intent without another model call', () => {
  const candidates = buildStickerCandidates({
    userText: 'целую тебя 😘',
    state: { stickerState: { recentAssetIds: [] }, scene: { type: 'romance' }, emotion: { primary: { type: 'tenderness' } } },
    brain: { activeScene: { type: 'romance' }, hiddenIntent: { type: 'seek_closeness' }, literalIntent: 'affection' },
    limit: 12
  });
  assert.ok(candidates.length >= 4);
  assert.ok(candidates.some(item => /kiss|поцел/iu.test(`${item.id} ${item.meaning} ${item.useWhen}`)));
});

test('local stabilizer repairs common feminine address without a model retry', () => {
  assert.equal(repairMaleUserAddress('О, ты решила добавить искру.'), 'О, ты решил добавить искру.');
  assert.equal(repairMaleUserAddress('Ты готова продолжить?'), 'Ты готов продолжить?');
});

test('local stabilizer fits a bubble without clipping a half-word', () => {
  const source = 'Это первое законченное предложение. А это второе предложение, которое уже не должно целиком помещаться в маленький лимит.';
  const fitted = fitMessengerText(source, 52);
  assert.ok(fitted.length <= 52);
  assert.match(fitted, /[.!?…]$/u);
});

test('hard sticker unavailability is repaired locally to a text fallback', () => {
  const stickerId = STICKER_INTENT_VALUES[0];
  const stabilized = stabilizeTurn({
    decision: {
      act: 'gesture', focus: 'ответить жестом', stance: 'тепло', question: { mode: 'none', reason: null },
      replyLink: { targetEventId: null, reason: null },
      delivery: { segments: [{ type: 'sticker', purpose: 'gesture', stickerIntent: stickerId, maxChars: 20 }] },
      intentTransition: { operation: 'none', goal: null, motive: null, target: null, nextMove: null, progress: null, commitment: null, reason: null },
      openLoops: { open: [], resolveIds: [] }, realityMode: 'grounded'
    },
    realization: { segments: [] },
    stickerState: { hardAvailable: false, available: false },
    fallbackText: 'Я тебя услышала.'
  });
  assert.equal(stabilized.decision.delivery.mode, 'single_text');
  assert.equal(stabilized.realization.segments[0].text, 'Я тебя услышала.');
  assert.ok(stabilized.warnings.includes('sticker_removed_hard_unavailable'));
});
