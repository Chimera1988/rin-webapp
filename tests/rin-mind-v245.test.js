import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKernelState } from '../lib/cognition/kernel-state.js';
import {
  buildRinMindPrompt,
  buildShortTermDialogue,
  serializeShortTermDialogue
} from '../lib/cognition/rin-mind.js';
import { buildMindMessages } from '../api/chat.js';

function event({ role, request, turn, segment = 0, content = '', kind = 'text', sticker = null }) {
  return {
    id: `${turn}-${segment}`,
    requestId: request,
    turnId: turn,
    segmentIndex: segment,
    role,
    kind,
    status: role === 'user' ? 'sent' : 'complete',
    content,
    ...(sticker ? { sticker } : {})
  };
}

function sevenExchangeHistory() {
  const history = [];
  for (let index = 1; index <= 7; index += 1) {
    history.push(event({ role: 'user', request: `r${index}`, turn: `user-r${index}`, content: `пользователь ${index}` }));
    history.push(event({ role: 'assistant', request: `r${index}`, turn: `rin-r${index}`, segment: 0, content: `Рин ${index}, первый пузырь` }));
    history.push(event({ role: 'assistant', request: `r${index}`, turn: `rin-r${index}`, segment: 1, content: `Рин ${index}, второй пузырь` }));
  }
  history.push(event({ role: 'user', request: 'r8', turn: 'user-r8', content: 'текущий пользовательский ход' }));
  return history;
}

test('kernel keeps enough event metadata for six full exchanges even with split Rin messages', () => {
  const state = buildKernelState({
    requestId: 'r8',
    userText: 'текущий пользовательский ход',
    history: sevenExchangeHistory(),
    conversationState: 'ongoing',
    brain: { activeScene: { type: 'everyday' } }
  });
  assert.ok(state.recentHistory.length > 10);
  const split = state.recentHistory.filter(item => item.turnId === 'rin-r7');
  assert.equal(split.length, 2);
  assert.deepEqual(split.map(item => item.segmentIndex), [0, 1]);
  assert.ok(split.every(item => item.requestId === 'r7'));
});

test('short-term dialogue is six previous exchanges, not four rendered events', () => {
  const dialogue = buildShortTermDialogue({
    requestId: 'r8',
    userText: 'текущий пользовательский ход',
    recentHistory: sevenExchangeHistory()
  });
  assert.equal(dialogue.length, 6);
  assert.equal(dialogue[0].user.messages[0].content, 'пользователь 2');
  assert.equal(dialogue.at(-1).user.messages[0].content, 'пользователь 7');
  assert.deepEqual(dialogue.at(-1).rin.messages.map(item => item.content), [
    'Рин 7, первый пузырь',
    'Рин 7, второй пузырь'
  ]);
  assert.doesNotMatch(JSON.stringify(dialogue), /текущий пользовательский ход/iu);
});

test('short-term serialization preserves multi-message beats inside one Rin turn', () => {
  const serialized = serializeShortTermDialogue({ requestId: 'r8', recentHistory: sevenExchangeHistory() });
  const parsed = JSON.parse(serialized);
  assert.equal(parsed.exchanges.length, 6);
  const lastRin = parsed.exchanges.at(-1).rin.messages;
  assert.equal(lastRin.length, 2);
  assert.equal(lastRin[0].kind, 'text');
  assert.equal(lastRin[1].kind, 'text');
});

test('Rin prompt exposes raw six-exchange dialogue while keeping the explicit cache prefix stable', () => {
  const baseState = {
    requestId: 'r8',
    userText: 'текущий пользовательский ход',
    recentHistory: sevenExchangeHistory(),
    behaviorState: { question: { restraint: 0, strongNoQuestion: false }, space: { strong: false } },
    stickerState: { available: false }
  };
  const first = buildRinMindPrompt({ profile: { prompt_profile: {} }, state: baseState });
  const second = buildRinMindPrompt({
    profile: { prompt_profile: {} },
    state: { ...baseState, userText: 'другой текущий ход', requestId: 'r9', recentHistory: [...sevenExchangeHistory(), event({ role: 'user', request: 'r9', turn: 'user-r9', content: 'другой текущий ход' })] }
  });

  assert.match(first.stableSystem, /shortTermDialogue/iu);
  assert.match(first.dynamicSystem, /Краткосрочная память диалога/iu);
  assert.match(first.dynamicSystem, /Рин 7, первый пузырь/iu);
  assert.match(first.dynamicSystem, /Рин 7, второй пузырь/iu);
  assert.equal(first.shortTermMetrics.exchanges, 6);
  assert.equal(first.shortTermMetrics.speakerTurns, 12);
  assert.ok(first.shortTermMetrics.chars > 0);

  const firstMessages = buildMindMessages(first, 'gpt-6-luna');
  const secondMessages = buildMindMessages(second, 'gpt-6-luna');
  assert.equal(JSON.stringify(firstMessages[0]), JSON.stringify(secondMessages[0]));
  assert.notEqual(JSON.stringify(firstMessages[1]), JSON.stringify(secondMessages[1]));
});
