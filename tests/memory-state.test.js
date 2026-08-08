import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage } from './helpers/runtime.js';

const storage = new MemoryStorage();
globalThis.localStorage = storage;
const memory = await import('../public/js/rin_memory.js');

test.beforeEach(() => {
  storage.clear();
  memory.wipeAllPersona();
});

test('zero mood and relationship values remain zero after save and reload', async () => {
  await memory.saveDiary({
    mood: { affection: 0, energy: 0, lastInteractionAt: 0 },
    relationship: { trust: 0, closeness: 0, comfort: 0, respect: 0, playfulness: 0, sharedMoments: [] }
  });
  const diary = await memory.loadDiary();
  assert.equal(diary.mood.affection, 0);
  assert.equal(diary.mood.energy, 0);
  assert.equal(diary.relationship.trust, 0);
  assert.equal(diary.relationship.playfulness, 0);
});

test('serialized diary mutations do not lose concurrent writes', async () => {
  await Promise.all(Array.from({ length: 30 }, (_, index) => memory.addEvent(`Событие ${index}`, { importance: 8 })));
  const diary = await memory.loadDiary();
  assert.equal(diary.events.length, 30);
  assert.equal(new Set(diary.events.map(item => item.key)).size, 30);
});

test('events and shared moments deduplicate by stable content keys', async () => {
  assert.equal(await memory.addEvent('Один и тот же план', { importance: 8 }), true);
  assert.equal(await memory.addEvent('Один и тот же план', { importance: 8 }), false);
  assert.equal(await memory.addSharedMoment({ text: 'Важный общий момент', importance: 8 }), true);
  assert.equal(await memory.addSharedMoment({ text: 'Важный общий момент', importance: 8 }), false);
});

test('consolidation keeps summaries available after old events are archived', async () => {
  for (let index = 0; index < 90; index += 1) await memory.addEvent(`Значимое событие ${index}`, { importance: 8, ts: index + 1 });
  assert.equal(await memory.consolidateDiary(), true);
  const diary = await memory.loadDiary();
  assert.equal(diary.events.length, 50);
  assert.ok(diary.summaries.length >= 1);
  assert.match(diary.summaries.at(-1).text, /Значимое событие/);
});

test('open loops resolve by stable id and do not fall back to broad substring matching', async () => {
  await memory.addOpenLoop({ id: 'loop-a', text: 'Заказать билет в Берлин' });
  await memory.addOpenLoop({ id: 'loop-b', text: 'Билет' });
  assert.equal(await memory.resolveOpenLoop({ id: 'missing', text: 'Билет' }), false);
  let diary = await memory.loadDiary();
  assert.equal(diary.openLoops.length, 2);
  assert.equal(await memory.resolveOpenLoop({ id: 'loop-a', text: 'другой текст' }), true);
  diary = await memory.loadDiary();
  assert.deepEqual(diary.openLoops.map(item => item.id), ['loop-b']);
});


test('corrupted memory falls back to a valid schema and quota failures are explicit', async () => {
  storage.setItem('rin-diary-v1', '{broken');
  const recovered = await memory.loadDiary();
  assert.equal(recovered._schema, 3);
  assert.deepEqual(recovered.events, []);

  const normalStorage = globalThis.localStorage;
  const blocked = {
    getItem() { return null; },
    setItem() { throw new Error('quota'); },
    removeItem() {}
  };
  const originalError = console.error;
  console.error = () => {};
  globalThis.localStorage = blocked;
  try {
    await assert.rejects(memory.saveProfile({ name: 'Рин' }), /PROFILE_STORAGE_FAILED/);
  } finally {
    globalThis.localStorage = normalStorage;
    console.error = originalError;
  }
});


test('prepareInnerLife is pure until a successful turn is committed', async () => {
  await memory.saveDiary(await memory.loadDiary());
  const before = await memory.loadDiary();
  const prepared = await memory.prepareInnerLife({ partOfDay: 'вечер', rinHuman: '2026-08-07 20:00' }, 'Я сегодня работал с текстом', 1_000_000);
  const afterPrepare = await memory.loadDiary();
  assert.deepEqual(afterPrepare, before);
  assert.notDeepEqual(prepared, before.innerLife);

  const committed = await memory.commitTurnState({
    requestId: 'turn-pure-1',
    innerLife: prepared,
    now: 1_000_000,
    moodDelta: { affection: 2, energy: -1 },
    relationshipDelta: { trust: 1, closeness: 2 },
    stateTransition: {
      dialogueState: { scene: 'practical_task', topic: 'текст' },
      beliefUpdates: [{ id: 'belief-project', kind: 'user_statement', subject: 'user', predicate: 'works_on', value: 'текст' }],
      openLoopUpdates: [{ id: 'loop-text', subject: 'закончить текст', status: 'waiting_for_user' }],
      resolvedLoopIds: [],
      emotionalTrace: { emotion: 'focused', cause: 'совместная работа', intensity: 38, resolution: 'unresolved', expiresAfterTurns: 3 }
    }
  });
  assert.equal(committed.applied, true);
  const diary = await memory.loadDiary();
  assert.equal(diary.conversationState.revision, 1);
  assert.equal(diary.conversationState.lastCommittedRequestId, 'turn-pure-1');
  assert.equal(diary.conversationState.dialogueState.scene, 'practical_task');
  assert.equal(diary.conversationState.beliefs[0].id, 'belief-project');
  assert.equal(diary.conversationState.openLoops[0].id, 'loop-text');
  assert.equal(diary.conversationState.emotionalTrace.emotion, 'focused');
  assert.equal(diary.innerLife.interactionCount, prepared.interactionCount);
});

test('commitTurnState is idempotent for the same request and state survives reload', async () => {
  const initial = await memory.loadDiary();
  const first = await memory.commitTurnState({
    requestId: 'same-request',
    now: 2_000_000,
    moodDelta: { affection: 5 },
    relationshipDelta: { trust: 4 },
    stateTransition: {
      dialogueState: { scene: 'everyday', topic: 'проверка retry' },
      beliefUpdates: [], openLoopUpdates: [], resolvedLoopIds: [], emotionalTrace: null
    }
  });
  assert.equal(first.applied, true);
  const afterFirst = await memory.loadDiary();

  const duplicate = await memory.commitTurnState({
    requestId: 'same-request',
    now: 2_000_100,
    moodDelta: { affection: 30 },
    relationshipDelta: { trust: 30 }
  });
  assert.equal(duplicate.applied, false);
  assert.equal(duplicate.duplicate, true);
  const afterDuplicate = await memory.loadDiary();
  assert.deepEqual(afterDuplicate, afterFirst);
  assert.equal(afterDuplicate._updated_at, afterFirst._updated_at);
  assert.equal(afterDuplicate.conversationState.revision, 1);
  assert.equal(afterDuplicate.mood.affection, initial.mood.affection + 5);
  assert.equal(afterDuplicate.relationship.trust, initial.relationship.trust + 4);

  const reloaded = await memory.loadDiary();
  assert.deepEqual(reloaded.conversationState, afterFirst.conversationState);
});

test('failed prepared turn leaves conversation, mood and relationship state unchanged', async () => {
  await memory.saveDiary(await memory.loadDiary());
  const before = await memory.loadDiary();
  await memory.prepareInnerLife({ partOfDay: 'день' }, 'важная новая тема', 3_000_000);
  const after = await memory.loadDiary();
  assert.deepEqual(after.conversationState, before.conversationState);
  assert.deepEqual(after.mood, before.mood);
  assert.deepEqual(after.relationship, before.relationship);
  assert.deepEqual(after.innerLife, before.innerLife);
});

test('emotional trace decays by committed turns and expires deterministically', async () => {
  await memory.commitTurnState({
    requestId: 'emotion-1', now: 4_000_000,
    stateTransition: {
      dialogueState: { scene: 'everyday', topic: 'эмоция' }, beliefUpdates: [], openLoopUpdates: [], resolvedLoopIds: [],
      emotionalTrace: { emotion: 'mild_jealousy', cause: 'контекст', intensity: 40, resolution: 'unresolved', expiresAfterTurns: 2 }
    }
  });
  let diary = await memory.loadDiary();
  assert.equal(diary.conversationState.emotionalTrace.remainingTurns, 2);

  await memory.commitTurnState({ requestId: 'emotion-2', now: 4_000_100, stateTransition: { beliefUpdates: [], openLoopUpdates: [], resolvedLoopIds: [], emotionalTrace: null } });
  diary = await memory.loadDiary();
  assert.equal(diary.conversationState.emotionalTrace.remainingTurns, 1);

  await memory.commitTurnState({ requestId: 'emotion-3', now: 4_000_200, stateTransition: { beliefUpdates: [], openLoopUpdates: [], resolvedLoopIds: [], emotionalTrace: null } });
  diary = await memory.loadDiary();
  assert.equal(diary.conversationState.emotionalTrace, null);
});
