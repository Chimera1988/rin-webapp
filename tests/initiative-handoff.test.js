import test from 'node:test';
import assert from 'node:assert/strict';
import { detectInitiativeHandoff, isInitiativeHandoff } from '../lib/cognition/initiative-handoff.js';

test('canonical initiative handoff recognizes direct transfer phrases without requiring scene context', () => {
  for (const text of ['Твой ход 😉', 'Теперь ты', 'Так что можешь начинать 😎', 'Ну, начинай.']) {
    const result = detectInitiativeHandoff(text);
    assert.equal(result.active, true, text);
    assert.equal(result.kind, 'explicit_handoff', text);
    assert.ok(result.confidence >= 90, text);
  }
});

test('follow-through demand recognizes a promised playful move from recent context', () => {
  const context = {
    scene: 'playful_flirt',
    previousAssistant: 'Тогда держись крепче, мы начинаем! 😉',
    recentText: 'Твой ход. Да уже уже 😅'
  };
  for (const text of ['Мы начнем или нет?', 'Ну начинаем?', 'Так ты начнешь или нет?', 'Давай уже']) {
    const result = detectInitiativeHandoff(text, context);
    assert.equal(result.active, true, text);
    assert.equal(result.kind, 'follow_through', text);
    assert.ok(result.confidence >= 90, text);
  }
});

test('ambiguous start-language is not treated as character initiative in an unrelated practical context', () => {
  const context = {
    scene: 'practical_task',
    previousAssistant: 'Отчёт готов. Встречу можно открыть после проверки цифр.',
    recentText: 'Обсуждаем отчёт и повестку рабочего созвона.'
  };
  assert.equal(isInitiativeHandoff('Мы начнем или нет?', context), false);
  assert.equal(isInitiativeHandoff('Когда начнем?', context), false);
});

test('waiting for a promised move is initiative handoff only inside an interactive context', () => {
  const playful = detectInitiativeHandoff('Ты же обещала', {
    scene: 'playful_flirt',
    previousAssistant: 'Готовься, сейчас будет мой ход 😏'
  });
  assert.equal(playful.active, true);
  assert.equal(playful.kind, 'waiting_for_move');

  const neutral = detectInitiativeHandoff('Ты же обещала', {
    scene: 'everyday',
    previousAssistant: 'Я обещала прислать название книги завтра.',
    recentText: 'Разговор о книге.'
  });
  assert.equal(neutral.active, false);
});
