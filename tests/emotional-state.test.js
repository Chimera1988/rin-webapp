import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAffectiveTurn } from '../lib/cognition/emotional-state.js';
import { buildKernelState } from '../lib/cognition/kernel-state.js';
import { analyzeConversation } from '../lib/conversation-brain.js';

function closeMemory(overrides = {}) {
  return {
    mood: { affection: 70, energy: 58, label: 'радостная' },
    relationship: {
      trust: 82, closeness: 76, comfort: 72, respect: 80,
      playfulness: 68, attraction: 58, vulnerability: 42,
      recentDynamic: { lastSignal: 'neutral', positiveStreak: 0, negativeStreak: 0, repairPending: false, lastCause: '', turn: 0 }
    },
    conversationState: { revision: 0, emotionalState: null, openLoops: [], rinIntent: null },
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

function perception(userText, { scene = null, state = 'ongoing' } = {}) {
  const brain = analyzeConversation({ userText, history: [], conversationState: state });
  return scene ? { ...brain, activeScene: { ...brain.activeScene, type: scene } } : brain;
}

test('possible romantic rival creates caused bounded jealousy only when relationship context supports it', () => {
  const close = closeMemory();
  const turn = buildAffectiveTurn({ userText: 'Меня пригласила девушка на встречу вечером', memory: close, brain: perception('Меня пригласила девушка на встречу вечером', { scene: 'romance' }) });
  assert.equal(turn.signal.type, 'romantic_rival');
  assert.equal(turn.emotionalState.primary.type, 'jealousy');
  assert.equal(turn.emotionalState.primary.target, 'relationship');
  assert.ok(turn.emotionalState.primary.intensity >= 24 && turn.emotionalState.primary.intensity <= 58);
  assert.match(turn.emotionalState.primary.cause, /другой девушк/);
  assert.equal(turn.emotionalState.momentum.direction, 'tense');

  const distant = closeMemory({ relationship: { trust: 15, closeness: 12, comfort: 20, respect: 60, playfulness: 10, attraction: 8, vulnerability: 5 } });
  const distantTurn = buildAffectiveTurn({ userText: 'Меня пригласила девушка на встречу вечером', memory: distant, brain: perception('Меня пригласила девушка на встречу вечером') });
  assert.equal(distantTurn.signal.type, 'neutral');
  assert.notEqual(distantTurn.emotionalState.primary?.type, 'jealousy');
});

test('jealousy reveal becomes relief plus playful irritation instead of resetting to neutral', () => {
  let memory = closeMemory();
  const rival = buildAffectiveTurn({ userText: 'Меня пригласила девушка на встречу, вечером', memory, brain: perception('Меня пригласила девушка на встречу, вечером', { scene: 'romance' }) });
  memory = withAffective(memory, rival);
  const revealText = 'Это была шутка, хотел тебя проверить на ревность 😁';
  const reveal = buildAffectiveTurn({ userText: revealText, memory, brain: perception(revealText, { scene: 'playful_flirt' }) });
  assert.equal(reveal.signal.type, 'tease_reveal');
  assert.equal(reveal.emotionalState.primary.type, 'playful_irritation');
  assert.equal(reveal.emotionalState.secondary.type, 'relief');
  assert.equal(reveal.emotionalState.momentum.direction, 'playful');
  assert.ok(reveal.emotionalState.tension < rival.emotionalState.tension);
});

test('playful emotional momentum survives a neutral bridge and reactivates on challenge', () => {
  let memory = closeMemory();
  let turn = buildAffectiveTurn({ userText: 'Познакомился с красивой девушкой сегодня', memory, brain: perception('Познакомился с красивой девушкой сегодня', { scene: 'romance' }) });
  memory = withAffective(memory, turn);
  turn = buildAffectiveTurn({ userText: 'Шутка, хотел проверить тебя на ревность 😁', memory, brain: perception('Шутка, хотел проверить тебя на ревность 😁', { scene: 'playful_flirt' }) });
  memory = withAffective(memory, turn);
  const bridge = buildAffectiveTurn({ userText: 'Иногда хочется 😅', memory, brain: perception('Иногда хочется 😅', { scene: 'playful_flirt' }) });
  assert.equal(bridge.signal.type, 'neutral');
  assert.equal(bridge.emotionalState.primary.type, 'playful_irritation');
  assert.equal(bridge.emotionalState.momentum.direction, 'playful');
  memory = withAffective(memory, bridge);
  const challenge = buildAffectiveTurn({ userText: 'Ну и где?) Ты будешь меня смущать???)', memory, brain: perception('Ну и где?) Ты будешь меня смущать???)', { scene: 'playful_flirt' }) });
  assert.equal(challenge.signal.type, 'playful_challenge');
  assert.equal(challenge.emotionalState.secondary.type, 'playfulness');
});

test('unresolved hurt persists across neutral turns while repair softens rather than erases it instantly', () => {
  let memory = closeMemory();
  const hurt = buildAffectiveTurn({ userText: 'Ты тупая, отвали', memory, brain: perception('Ты тупая, отвали') });
  assert.equal(hurt.emotionalState.primary.type, 'hurt');
  assert.equal(hurt.relationshipState.recentDynamic.repairPending, true);
  const trustAfterHurt = hurt.relationshipState.trust;
  memory = withAffective(memory, hurt);
  const neutral = buildAffectiveTurn({ userText: 'Какая завтра погода?', memory, brain: perception('Какая завтра погода?') });
  assert.equal(neutral.emotionalState.primary.type, 'hurt');
  assert.ok(neutral.emotionalState.primary.intensity < hurt.emotionalState.primary.intensity);
  memory = withAffective(memory, neutral);
  const repair = buildAffectiveTurn({ userText: 'Извини, не хотел тебя обидеть', memory, brain: perception('Извини, не хотел тебя обидеть', { scene: 'conflict_repair' }) });
  assert.equal(repair.signal.type, 'repair');
  assert.equal(repair.emotionalState.primary.type, 'relief');
  assert.equal(repair.emotionalState.secondary.type, 'hurt');
  assert.equal(repair.relationshipState.recentDynamic.repairPending, false);
  assert.ok(repair.relationshipState.trust > trustAfterHurt);
  assert.ok(repair.relationshipState.trust < closeMemory().relationship.trust);
});

test('relationship hysteresis saturates repeated positive signals instead of farming closeness', () => {
  let memory = closeMemory({ relationship: { trust: 55, closeness: 45, comfort: 50, respect: 70, playfulness: 45, attraction: 34, vulnerability: 28 } });
  const initial = memory.relationship.closeness;
  const initialAttraction = memory.relationship.attraction;
  for (let i = 0; i < 8; i += 1) {
    const turn = buildAffectiveTurn({ userText: 'Ты красивая', memory, brain: perception('Ты красивая') });
    memory = withAffective(memory, turn);
  }
  assert.ok(memory.relationship.closeness - initial <= 1);
  assert.ok(memory.relationship.attraction - initialAttraction <= 2);
});

test('affect remains a state provider: direct-question signal and unresolved hurt reach Kernel independently', () => {
  let memory = closeMemory();
  const hurt = buildAffectiveTurn({ userText: 'Ты тупая, отвали', memory, brain: perception('Ты тупая, отвали') });
  memory = withAffective(memory, hurt);
  const text = 'Какая завтра погода?';
  const brain = perception(text);
  const affect = buildAffectiveTurn({ userText: text, memory, brain });
  const state = buildKernelState({ requestId: 'q1', userText: text, history: [{ role:'user',kind:'text',status:'sent',requestId:'q1',id:'u1',content:text }], memory, brain, affectiveTurn: affect, conversationState:'ongoing' });
  assert.equal(state.emotion.primary.type, 'hurt');
  assert.ok(state.perception.signals.includes('direct_question_present'));
  assert.equal('responseAct' in state, false);
  assert.equal('behavior' in state, false);
});

test('late repair clears repairPending even after the original hurt emotion expires', () => {
  let memory = closeMemory();
  let turn = buildAffectiveTurn({ userText: 'Ты тупая, отвали', memory, brain: perception('Ты тупая, отвали') });
  memory = withAffective(memory, turn);
  for (let index = 0; index < 7; index += 1) {
    const text = `Нейтральная тема ${index}`;
    turn = buildAffectiveTurn({ userText: text, memory, brain: perception(text) });
    memory = withAffective(memory, turn);
  }
  assert.equal(memory.relationship.recentDynamic.repairPending, true);
  assert.equal(memory.conversationState.emotionalState.primary, null);
  const trustBeforeRepair = memory.relationship.trust;
  const repair = buildAffectiveTurn({ userText: 'Извини, я был неправ', memory, brain: perception('Извини, я был неправ', { scene: 'conflict_repair' }) });
  assert.equal(repair.relationshipState.recentDynamic.repairPending, false);
  assert.ok(repair.relationshipState.trust > trustBeforeRepair);
});

test('server-owned neutral turns decay an active emotion to expiry deterministically', () => {
  let memory = closeMemory();
  let turn = buildAffectiveTurn({ userText: 'Меня пригласила девушка на встречу вечером', memory, brain: perception('Меня пригласила девушка на встречу вечером', { scene: 'romance' }) });
  memory = withAffective(memory, turn);
  const intensities = [turn.emotionalState.primary.intensity];
  for (let index = 0; index < 4; index += 1) {
    const text = `Нейтральная рабочая деталь номер ${index}`;
    turn = buildAffectiveTurn({ userText: text, memory, brain: perception(text) });
    memory = withAffective(memory, turn);
    if (turn.emotionalState.primary) intensities.push(turn.emotionalState.primary.intensity);
  }
  assert.deepEqual([...intensities].sort((a, b) => b - a), intensities);
  assert.equal(memory.conversationState.emotionalState.primary, null);
  assert.equal(memory.conversationState.emotionalState.momentum.direction, 'steady');
});
