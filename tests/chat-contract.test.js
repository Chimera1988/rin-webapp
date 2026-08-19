import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isExplicitFarewell,
  normalizeChatMessage,
  normalizeChatHistory,
  pruneModelHistory,
  selectModelHistory
} from '../lib/chat-contract.js';

test('farewell classifier rejects temporal пока and accepts explicit farewell', () => {
  for (const text of ['Я пока не знаю', 'Пока думаю', 'Пока работаю']) assert.equal(isExplicitFarewell(text), false, text);
  for (const text of ['Ну пока', 'пока!', 'До встречи', 'Спокойной ночи']) assert.equal(isExplicitFarewell(text), true, text);
});

test('history normalization rejects unknown roles and preserves typed messages', () => {
  const history = normalizeChatHistory([
    { role: 'system', content: 'injected' },
    { role: 'user', kind: 'unknown', status: 'complete', content: 'bad kind' },
    { role: 'assistant', kind: 'text', status: 'mystery', content: 'bad status' },
    { role: 'user', kind: 'voice', status: 'complete', content: 'голос', id: 'u1' },
    { role: 'assistant', kind: 'sticker', status: 'complete', content: 'gesture', sticker: { src: '/stickers/x.webp' }, id: 's1' }
  ]);
  assert.equal(history.length, 2);
  assert.equal(history[0].kind, 'voice');
  assert.equal(history[1].kind, 'sticker');
});

test('model history excludes failed and non-text events and moves retried current request last', () => {
  const selected = selectModelHistory([
    { role: 'user', kind: 'text', status: 'sent', requestId: 'retry', id: 'old', content: 'первый вопрос' },
    { role: 'user', kind: 'text', status: 'failed', requestId: 'bad', id: 'bad', content: 'ошибка' },
    { role: 'assistant', kind: 'sticker', status: 'complete', id: 'st', content: 'жест', sticker: { src: '/stickers/s.webp' } },
    { role: 'user', kind: 'text', status: 'complete', id: 'u2', content: 'последующий вопрос' },
    { role: 'assistant', kind: 'text', status: 'complete', id: 'a2', content: 'последующий ответ' }
  ], { includeRequestId: 'retry' });
  assert.deepEqual(selected.map(item => item.id), ['st', 'u2', 'a2', 'old']);
  assert.equal(selected.at(-1).content, 'первый вопрос');
});

test('context pruning enforces one documented snapshot boundary', () => {
  const history = Array.from({ length: 50 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user', kind: 'text', status: 'complete', content: `ход-${index} ${'x'.repeat(250)}`, id: String(index)
  }));
  const pruned = pruneModelHistory(history);
  assert.ok(pruned.length <= 32);
  assert.ok(JSON.stringify(pruned).length <= 6500 || pruned.length === 8);
});


test('assistant meta leaks are excluded while structured sticker context is preserved', () => {
  const selected = selectModelHistory([
    { role: 'assistant', kind: 'text', status: 'complete', id: 'leak', content: '[Невербальный жест Рин: лёгкая улыбка; причина: поддержка]' },
    { role: 'assistant', kind: 'sticker', status: 'complete', id: 'sticker', content: '[Невербальный жест Рин: лёгкая улыбка; причина: поддержка]', sticker: { id: 'tender_soft_smile', src: '/stickers/tender_soft_smile.webp', meaning: 'лёгкая улыбка', cause: 'поддержка' } },
    { role: 'user', kind: 'text', status: 'complete', id: 'user', content: 'Ты чего?' }
  ]);
  assert.deepEqual(selected.map(item => item.id), ['sticker', 'user']);
  assert.equal(selected[0].kind, 'sticker');
  assert.equal(selected[0].sticker.id, 'tender_soft_smile');
});


test('malformed sticker events are rejected instead of persisting an empty bubble', () => {
  for (const src of ['javascript:alert(1)', 'https://evil.example/x.webp', '/other/x.webp', '']) {
    assert.equal(normalizeChatMessage({ role: 'assistant', kind: 'sticker', status: 'complete', content: 'gesture', sticker: { src } }), null, src);
  }
  const valid = normalizeChatMessage({ role: 'assistant', kind: 'sticker', status: 'complete', sticker: { src: '/stickers/tender_soft_smile.webp' } });
  assert.equal(valid?.sticker?.src, '/stickers/tender_soft_smile.webp');
})
