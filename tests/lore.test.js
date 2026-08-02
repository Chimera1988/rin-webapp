import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key)
};
globalThis.fetch = async url => {
  const file = new URL(`../public${url}`, import.meta.url);
  const body = await readFile(file, 'utf8');
  return { ok: true, json: async () => JSON.parse(body) };
};

const { buildLorePayload, getOrCreateDayStory, pickInitiationPhrase } = await import('../public/js/rin_lore.js');

test('обычный smalltalk не подмешивает случайную биографию', async () => {
  assert.deepEqual(await buildLorePayload('Как дела?'), { matchedTriggers: [], memories: [], backstory: [] });
  assert.deepEqual(await buildLorePayload('Это она?'), { matchedTriggers: [], memories: [], backstory: [] });
});

test('прямой вопрос о сестре находит Нацуми', async () => {
  storage.clear();
  const result = await buildLorePayload('Расскажи про сестру');
  const text = [...result.memories, ...result.backstory].map(item => item.text).join(' ');
  assert.match(text, /Нацуми/u);
});

test('событие дня сохраняется до упоминания и имеет продолжение', async () => {
  storage.clear();
  const date = new Date('2026-08-02T09:00:00');
  const first = getOrCreateDayStory(date);
  const second = getOrCreateDayStory(date);
  assert.equal(first.story.topic, second.story.topic);
  assert.ok(first.story.morning && first.story.evening);
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const morning = await pickInitiationPhrase('morning', date);
    const repeat = await pickInitiationPhrase('morning', date);
    assert.equal(morning, first.story.morning);
    assert.notEqual(repeat, first.story.morning);
  } finally {
    Math.random = originalRandom;
  }
});
