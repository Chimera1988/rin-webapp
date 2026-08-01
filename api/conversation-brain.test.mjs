import assert from 'node:assert/strict';
import { analyzeConversation } from './conversation-brain.js';

const cases = [
  {
    name: 'short answer binds to previous question',
    history: [
      { role: 'assistant', content: 'Ты сегодня устал?' },
      { role: 'user', content: 'Да, очень.' }
    ],
    check: b => assert.equal(b.relation.type, 'answers_previous_question')
  },
  {
    name: 'negative reassurance bid',
    history: [{ role: 'user', content: 'Ты по мне совсем не скучала?' }],
    check: b => assert.equal(b.hiddenIntent.type, 'bid_for_reassurance')
  },
  {
    name: 'distress seeks presence without advice request',
    history: [{ role: 'user', content: 'Мне сегодня очень тяжело и одиноко.' }],
    check: b => assert.equal(b.hiddenIntent.type, 'seek_emotional_presence')
  },
  {
    name: 'explicit help seeks solution',
    history: [{ role: 'user', content: 'Мне тревожно. Помоги понять, что делать.' }],
    check: b => assert.equal(b.hiddenIntent.type, 'seek_solution')
  },
  {
    name: 'correction relation',
    history: [
      { role: 'assistant', content: 'Ты говоришь о своей знакомой?' },
      { role: 'user', content: 'Нет, я про тебя.' }
    ],
    check: b => assert.equal(b.relation.type, 'correction')
  }
];

for (const item of cases) {
  const last = item.history.at(-1)?.content || '';
  const brain = analyzeConversation({ userText: last, history: item.history });
  item.check(brain);
  console.log(`✓ ${item.name}`);
}
