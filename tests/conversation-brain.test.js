import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeConversation } from '../lib/conversation-brain.js';

const plan = (text, history = []) => analyzeConversation({
  userText: text,
  history: [...history, { role: 'user', content: text }],
  conversationState: history.length ? 'ongoing' : 'new'
});

test('понимает русские приветствия без ASCII-границ слов', () => {
  assert.equal(plan('Привет, Рин').literalIntent, 'greeting');
});

test('распознаёт прямой жест близости', () => {
  const value = plan('Ты мне нравишься');
  assert.equal(value.literalIntent, 'affection');
  assert.equal(value.responseKind, 'personal_closeness');
});

test('короткое да связывает с предыдущим вопросом', () => {
  const value = plan('Да', [{ role: 'assistant', content: 'Ты хочешь, чтобы я продолжила?' }]);
  assert.equal(value.literalIntent, 'short_confirmation');
  assert.equal(value.relation.type, 'answers_previous_question');
});

test('неоднозначное местоимение требует одного уточнения', () => {
  const value = plan('Это она?');
  assert.equal(value.ambiguity.shouldClarify, true);
  assert.equal(value.questionPolicy, 'clarify_once');
});

test('просьба о совете не маскируется поддержкой без действия', () => {
  const value = plan('Мне тяжело. Что мне делать?');
  assert.equal(value.literalIntent, 'request_advice');
  assert.equal(value.responseKind, 'support_with_step');
});
