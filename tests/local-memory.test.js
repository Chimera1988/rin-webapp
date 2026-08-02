import test from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key)
};

const memory = await import('../public/js/rin_memory.js');

test('старая память мигрирует и остаётся локальной', async () => {
  storage.set('rin-diary-v1', JSON.stringify({ facts: { user: { project: 'Рин' }, self: {}, world: {} }, events: [] }));
  const diary = await memory.loadDiary();
  assert.equal(diary.facts.user.project, 'Рин');
  assert.equal(diary.version, 3);
});

test('в запрос попадает максимум три релевантных записи', async () => {
  await memory.upsertFact('user.project', 'Кирилл разрабатывает проект Рин', { importance: 9 });
  await memory.upsertFact('user.city', 'Берлин', { importance: 5 });
  await memory.addEvent('Кирилл планирует закончить проект Рин в августе', { importance: 9, tags: ['проект'] });
  const result = await memory.buildRelevantMemory('Как продвигается проект Рин?', [], 3);
  assert.equal(result.privacy, 'device_only');
  assert.ok(result.items.length >= 1 && result.items.length <= 3);
  assert.ok(result.items.some(item => JSON.stringify(item).includes('проект')));
});

test('нейтральный анализ применяется один раз и не наращивает близость', async () => {
  const before = (await memory.loadDiary()).relationship.affection;
  assert.equal(await memory.applyMemoryExtraction({ relationshipDelta: { affection: 4, confidence: 0.9 }, stateDelta: { confidence: 0.9 } }, 'Как погода?'), true);
  const after = (await memory.loadDiary()).relationship.affection;
  assert.equal(after, before);
});
