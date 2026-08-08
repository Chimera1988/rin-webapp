import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAffectiveTurn } from '../lib/cognition/emotional-state.js';
import { planResponse } from '../lib/cognition/response-planner.js';
import { verifyReply } from '../lib/cognition/response-verifier.js';

function closeMemory(overrides = {}) {
  return {
    mood: { affection: 70, energy: 58, label: 'радостная' },
    relationship: {
      trust: 82, closeness: 76, comfort: 72, respect: 80,
      playfulness: 68, attraction: 58, vulnerability: 42,
      recentDynamic: { lastSignal: 'neutral', positiveStreak: 0, negativeStreak: 0, repairPending: false, lastCause: '', turn: 0 }
    },
    conversationState: { revision: 0, emotionalState: null },
    ...overrides
  };
}

function withAffective(memory, turn) {
  return {
    ...memory,
    mood: { ...memory.mood, ...turn.moodState },
    relationship: turn.relationshipState,
    conversationState: {
      ...(memory.conversationState || {}),
      revision: turn.turn,
      emotionalState: turn.emotionalState
    }
  };
}

function brain({ scene = 'playful_flirt', hidden = 'none', literal = 'statement', relation = 'continuation' } = {}) {
  return {
    literalIntent: literal,
    hiddenIntent: { type: hidden, confidence: 80 },
    relation: { type: relation, confidence: 80 },
    activeScene: { type: scene, topic: 'отношения и поддразнивание', confidence: 88 },
    ambiguity: { shouldClarify: false },
    obligations: [],
    responseFocus: 'Ответить лично и сохранить текущую линию.'
  };
}

function cognition(scene = 'playful_flirt') {
  return {
    dialogueState: {
      scene, sceneGoal: 'сохранить личную линию', continuityStrength: 0.9,
      reactiveStreak: 0, questionStreak: 0, turnsInScene: 4, topicDrift: false
    },
    beliefModel: { factsToUse: [], factsToAvoid: [] },
    openLoops: { active: [], callback: null }
  };
}

test('possible romantic rival creates a caused, bounded jealousy state only when relationship context supports it', () => {
  const close = closeMemory();
  const turn = buildAffectiveTurn({
    userText: 'Меня пригласила девушка на встречу вечером',
    memory: close,
    brain: brain({ scene: 'romance' })
  });
  assert.equal(turn.signal.type, 'romantic_rival');
  assert.equal(turn.emotionalState.primary.type, 'jealousy');
  assert.equal(turn.emotionalState.primary.target, 'relationship');
  assert.ok(turn.emotionalState.primary.intensity >= 24 && turn.emotionalState.primary.intensity <= 58);
  assert.match(turn.emotionalState.primary.cause, /другой девушк/);
  assert.equal(turn.emotionalState.momentum.direction, 'tense');

  const distant = closeMemory({
    relationship: { trust: 15, closeness: 12, comfort: 20, respect: 60, playfulness: 10, attraction: 8, vulnerability: 5 }
  });
  const distantTurn = buildAffectiveTurn({
    userText: 'Меня пригласила девушка на встречу вечером',
    memory: distant,
    brain: brain({ scene: 'everyday' })
  });
  assert.equal(distantTurn.signal.type, 'neutral');
  assert.notEqual(distantTurn.emotionalState.primary?.type, 'jealousy');
});

test('real dialogue jealousy reveal becomes relief plus playful irritation instead of resetting to neutral', () => {
  let memory = closeMemory();
  const rival = buildAffectiveTurn({
    userText: 'Меня пригласила девушка на встречу, вечером', memory,
    brain: brain({ scene: 'romance' })
  });
  memory = withAffective(memory, rival);

  const reveal = buildAffectiveTurn({
    userText: 'Это была шутка, хотел тебя проверить на ревность 😁', memory,
    brain: brain({ hidden: 'continue_playful_tension' })
  });
  assert.equal(reveal.signal.type, 'tease_reveal');
  assert.equal(reveal.emotionalState.primary.type, 'playful_irritation');
  assert.equal(reveal.emotionalState.secondary.type, 'relief');
  assert.equal(reveal.emotionalState.momentum.direction, 'playful');
  assert.ok(reveal.emotionalState.tension < rival.emotionalState.tension);
  assert.match(reveal.emotionalState.primary.cause, /поддразнивал|проверял/);
});

test('playful emotional momentum survives a neutral bridge and reactivates on the next challenge', () => {
  let memory = closeMemory();
  const rival = buildAffectiveTurn({ userText: 'Познакомился с красивой девушкой сегодня', memory, brain: brain({ scene: 'romance' }) });
  memory = withAffective(memory, rival);
  const reveal = buildAffectiveTurn({ userText: 'Шутка, хотел проверить тебя на ревность 😁', memory, brain: brain() });
  memory = withAffective(memory, reveal);

  const bridge = buildAffectiveTurn({ userText: 'Иногда хочется 😅', memory, brain: brain({ hidden: 'none' }) });
  assert.equal(bridge.signal.type, 'neutral');
  assert.equal(bridge.emotionalState.primary.type, 'playful_irritation');
  assert.equal(bridge.emotionalState.momentum.direction, 'playful');
  assert.ok(bridge.emotionalState.primary.intensity < reveal.emotionalState.primary.intensity);
  memory = withAffective(memory, bridge);

  const challenge = buildAffectiveTurn({ userText: 'Ну и где?) Ты будешь меня смущать???)', memory, brain: brain({ literal: 'question' }) });
  assert.equal(challenge.signal.type, 'playful_challenge');
  assert.equal(challenge.emotionalState.primary.type, 'playful_irritation');
  assert.equal(challenge.emotionalState.secondary.type, 'playfulness');
  assert.equal(challenge.emotionalState.momentum.direction, 'playful');
});

test('response planner carries the emotional line and verifier rejects the two safe-assistant failures from the observed dialogue', () => {
  let memory = closeMemory();
  const rival = buildAffectiveTurn({ userText: 'Меня пригласила девушка на встречу вечером', memory, brain: brain({ scene: 'romance' }) });
  const rivalPlan = planResponse({
    cognition: cognition('romance'), brain: brain({ scene: 'romance' }),
    coreDecision: { mode: 'personal', affectiveTurn: rival, initiative: { mode: 'none' } },
    memory, userText: 'Меня пригласила девушка на встречу вечером', history: []
  });
  assert.equal(rivalPlan.responseAct, 'contained_jealousy');
  assert.equal(rivalPlan.shouldAskQuestion, false);
  const neutralRival = verifyReply('Это звучит захватывающе! Ты уже знаешь, куда пойдёте?', {
    plan: rivalPlan, brain: brain({ scene: 'romance' }), userText: 'Меня пригласила девушка на встречу вечером'
  });
  assert.equal(neutralRival.needsRewrite, true);
  assert.ok(neutralRival.severeWarnings.includes('emotional_state_contradiction'));

  memory = withAffective(memory, rival);
  const reveal = buildAffectiveTurn({ userText: 'Это была шутка, хотел тебя проверить на ревность 😁', memory, brain: brain() });
  memory = withAffective(memory, reveal);
  const bridge = buildAffectiveTurn({ userText: 'Иногда хочется 😅', memory, brain: brain() });
  memory = withAffective(memory, bridge);
  const challenge = buildAffectiveTurn({ userText: 'Ну и где?) Ты будешь меня смущать???)', memory, brain: brain({ literal: 'question' }) });
  const playfulPlan = planResponse({
    cognition: cognition('playful_flirt'), brain: brain({ literal: 'question' }),
    coreDecision: { mode: 'playful', affectiveTurn: challenge, initiative: { mode: 'none' } },
    memory, userText: 'Ну и где?) Ты будешь меня смущать???)', history: []
  });
  assert.equal(playfulPlan.responseAct, 'carry_playful_tension');
  const retreat = verifyReply('Ну, смущать — это не моя цель. Просто хочу, чтобы ты знал, что наш разговор интересен мне.', {
    plan: playfulPlan, brain: brain({ literal: 'question' }), userText: 'Ну и где?) Ты будешь меня смущать???)'
  });
  assert.equal(retreat.needsRewrite, true);
  assert.ok(retreat.severeWarnings.includes('emotional_state_contradiction'));
});

test('unresolved hurt persists across neutral turns, while repair softens rather than instantly erases it', () => {
  let memory = closeMemory();
  const hurt = buildAffectiveTurn({ userText: 'Ты тупая, отвали', memory, brain: brain({ scene: 'everyday' }) });
  assert.equal(hurt.emotionalState.primary.type, 'hurt');
  assert.equal(hurt.relationshipState.recentDynamic.repairPending, true);
  const trustAfterHurt = hurt.relationshipState.trust;
  memory = withAffective(memory, hurt);

  const neutral = buildAffectiveTurn({ userText: 'Какая завтра погода?', memory, brain: brain({ scene: 'everyday', literal: 'question' }) });
  assert.equal(neutral.emotionalState.primary.type, 'hurt');
  assert.ok(neutral.emotionalState.primary.intensity < hurt.emotionalState.primary.intensity);
  assert.equal(neutral.relationshipState.recentDynamic.repairPending, true);
  memory = withAffective(memory, neutral);

  const repair = buildAffectiveTurn({ userText: 'Извини, не хотел тебя обидеть', memory, brain: brain({ scene: 'conflict_repair' }) });
  assert.equal(repair.signal.type, 'repair');
  assert.equal(repair.emotionalState.primary.type, 'relief');
  assert.equal(repair.emotionalState.secondary.type, 'hurt');
  assert.equal(repair.emotionalState.secondary.resolution, 'softening');
  assert.equal(repair.relationshipState.recentDynamic.repairPending, false);
  assert.ok(repair.relationshipState.trust > trustAfterHurt);
  assert.ok(repair.relationshipState.trust < closeMemory().relationship.trust);
});

test('relationship hysteresis saturates repeated positive signals instead of farming closeness', () => {
  let memory = closeMemory({
    relationship: { trust: 55, closeness: 45, comfort: 50, respect: 70, playfulness: 45, attraction: 34, vulnerability: 28 }
  });
  const initial = memory.relationship.closeness;
  const initialAttraction = memory.relationship.attraction;
  for (let i = 0; i < 8; i += 1) {
    const turn = buildAffectiveTurn({ userText: 'Ты красивая', memory, brain: brain({ scene: 'everyday' }) });
    memory = withAffective(memory, turn);
  }
  assert.ok(memory.relationship.closeness - initial <= 1);
  assert.ok(memory.relationship.attraction - initialAttraction <= 2);
  assert.ok(memory.relationship.recentDynamic.positiveStreak >= 2);
});

test('active playful affect blocks accidental silence on a short confirmation', () => {
  let memory = closeMemory();
  const playful = buildAffectiveTurn({ userText: 'Попробуй меня смутить 😏', memory, brain: brain() });
  memory = withAffective(memory, playful);
  const next = buildAffectiveTurn({ userText: 'Хорошо)', memory, brain: brain({ literal: 'short_confirmation' }) });
  const plan = planResponse({
    cognition: cognition('playful_flirt'), brain: brain({ literal: 'short_confirmation', relation: 'acknowledges_previous_turn' }),
    coreDecision: { mode: 'playful', affectiveTurn: next, initiative: { mode: 'none' } },
    memory, userText: 'Хорошо)',
    history: [{ role: 'assistant', kind: 'text', status: 'complete', content: 'Тогда попробуй не смутиться первым.' }]
  });
  assert.notEqual(plan.delivery, 'silence');
  assert.equal(plan.responseAct, 'carry_playful_tension');
  assert.ok(plan.characterIntent.strength >= 72);
});

test('a direct practical question is answered directly while unresolved hurt remains in state', () => {
  let memory = closeMemory();
  const hurt = buildAffectiveTurn({ userText: 'Ты тупая, отвали', memory, brain: brain({ scene: 'everyday' }) });
  memory = withAffective(memory, hurt);
  const weather = buildAffectiveTurn({ userText: 'Какая завтра погода?', memory, brain: brain({ scene: 'everyday', literal: 'question' }) });
  const plan = planResponse({
    cognition: cognition('everyday'), brain: brain({ scene: 'everyday', literal: 'question' }),
    coreDecision: { mode: 'contained', affectiveTurn: weather, initiative: { mode: 'none' } },
    memory, userText: 'Какая завтра погода?', history: []
  });
  assert.equal(weather.emotionalState.primary.type, 'hurt');
  assert.equal(plan.responseAct, 'answer_directly');
  assert.equal(plan.emotionalIntent.primary.type, 'hurt');
});

test('late repair clears relationship repairPending even after the original hurt event has expired', () => {
  let memory = closeMemory();
  let turn = buildAffectiveTurn({ userText: 'Ты тупая, отвали', memory, brain: brain({ scene: 'everyday' }) });
  memory = withAffective(memory, turn);
  for (let index = 0; index < 7; index += 1) {
    turn = buildAffectiveTurn({ userText: `Нейтральная тема ${index}`, memory, brain: brain({ scene: 'everyday' }) });
    memory = withAffective(memory, turn);
  }
  assert.equal(memory.relationship.recentDynamic.repairPending, true);
  assert.equal(memory.conversationState.emotionalState.primary, null);
  const repair = buildAffectiveTurn({ userText: 'Извини, я был неправ', memory, brain: brain({ scene: 'conflict_repair' }) });
  assert.equal(repair.relationshipSignal, 'repair');
  assert.equal(repair.relationshipState.recentDynamic.repairPending, false);
  assert.ok(repair.relationshipDelta.trust > 0);
});

test('server-owned neutral turns decay an active emotion to expiry deterministically', () => {
  let memory = closeMemory();
  let turn = buildAffectiveTurn({ userText: 'Меня пригласила девушка на встречу вечером', memory, brain: brain({ scene: 'romance' }) });
  memory = withAffective(memory, turn);
  const intensities = [turn.emotionalState.primary.intensity];
  for (let index = 0; index < 4; index += 1) {
    turn = buildAffectiveTurn({ userText: `Нейтральная рабочая деталь номер ${index}`, memory, brain: brain({ scene: 'everyday' }) });
    memory = withAffective(memory, turn);
    if (turn.emotionalState.primary) intensities.push(turn.emotionalState.primary.intensity);
  }
  assert.deepEqual([...intensities].sort((a, b) => b - a), intensities);
  assert.equal(memory.conversationState.emotionalState.primary, null);
  assert.equal(memory.conversationState.emotionalState.momentum.direction, 'steady');
});
