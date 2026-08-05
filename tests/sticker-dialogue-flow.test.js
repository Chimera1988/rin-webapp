import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoreDecision } from '../lib/core-personality.js';
import { analyzeConversation } from '../lib/conversation-brain.js';
import { selectModelHistory } from '../lib/chat-contract.js';

const memory = { mood: { affection: 80, energy: 60 }, relationship: { trust: 80, closeness: 80, playfulness: 60 } };

test('jealousy can be a sticker-only turn and the next question refers to that gesture', () => {
  const user = { role: 'user', kind: 'text', status: 'complete', content: 'Сегодня познакомился с красивой девушкой', id: 'u1' };
  const brain = analyzeConversation({ userText: user.content, history: [user], conversationState: 'ongoing' });
  const decision = buildCoreDecision({ userText: user.content, history: [user], memory, conversationBrain: brain });
  assert.equal(decision.nonverbalAction?.preferredStickerId, 'mild_jealousy');
  assert.equal(decision.nonverbalAction?.delivery, 'sticker_only');

  const sticker = { role: 'assistant', kind: 'sticker', status: 'complete', id: 's1', content: '[Невербальный жест Рин: лёгкая ревность; причина: упоминание другой девушки]', sticker: { src: '/stickers/mild_jealousy.webp', emotion: 'jealousy', meaning: 'лёгкая ревность', cause: 'упоминание другой девушки' } };
  const follow = { role: 'user', kind: 'text', status: 'complete', content: 'Ты чего?', id: 'u2' };
  const followBrain = analyzeConversation({ userText: follow.content, history: [user, sticker, follow], conversationState: 'ongoing' });
  assert.equal(followBrain.hiddenIntent.type, 'ask_about_previous_nonverbal');
  const modelHistory = selectModelHistory([user, sticker, follow]);
  assert.ok(modelHistory.some(item => item.kind === 'sticker' && item.content.includes('ревность')));
});

test('answer kiss produces a standalone nonverbal action', () => {
  const text = 'Целую тебя 💋';
  const brain = analyzeConversation({ userText: text, history: [], conversationState: 'ongoing' });
  const decision = buildCoreDecision({ userText: text, history: [], memory, conversationBrain: brain });
  assert.equal(decision.nonverbalAction?.preferredStickerId, 'kiss');
  assert.equal(decision.nonverbalAction?.standalone, true);
});
