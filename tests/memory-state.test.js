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
  assert.equal(recovered._schema, 4);
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
      emotionalState: {
        primary: { type: 'interest', cause: 'совместная работа', target: 'situation', intensity: 38, resolution: 'unresolved', expiresAfterTurns: 3, remainingTurns: 3 },
        tension: 0, warmth: 58, vulnerability: 28, momentum: { direction: 'steady', strength: 38 }, updatedAtTurn: 1
      }
    }
  });
  assert.equal(committed.applied, true);
  const diary = await memory.loadDiary();
  assert.equal(diary.conversationState.revision, 1);
  assert.equal(diary.conversationState.lastCommittedRequestId, 'turn-pure-1');
  assert.equal(diary.conversationState.dialogueState.scene, 'practical_task');
  assert.equal(diary.conversationState.beliefs[0].id, 'belief-project');
  assert.equal(diary.conversationState.openLoops[0].id, 'loop-text');
  assert.equal(diary.conversationState.emotionalState.primary.type, 'interest');
  assert.match(diary.conversationState.emotionalState.primary.cause, /совместная работа/);
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

test('client persists server-owned emotional state exactly and never performs independent decay', async () => {
  const jealousy = {
    primary: { type: 'jealousy', cause: 'контекст', target: 'relationship', intensity: 40, resolution: 'unresolved', expiresAfterTurns: 3, remainingTurns: 3 },
    secondary: null, tension: 32, warmth: 52, vulnerability: 30, momentum: { direction: 'tense', strength: 40 }, updatedAtTurn: 1
  };
  await memory.commitTurnState({
    requestId: 'emotion-1', now: 4_000_000,
    stateTransition: {
      dialogueState: { scene: 'everyday', topic: 'эмоция' }, beliefUpdates: [], openLoopUpdates: [], resolvedLoopIds: [],
      emotionalState: jealousy
    }
  });
  let diary = await memory.loadDiary();
  assert.equal(diary.conversationState.emotionalState.primary.intensity, 40);
  assert.equal(diary.conversationState.emotionalState.primary.remainingTurns, 3);

  // A later server turn explicitly supplies the decayed state. The client stores it; it does not invent a second decay.
  await memory.commitTurnState({
    requestId: 'emotion-2', now: 4_000_100,
    stateTransition: {
      beliefUpdates: [], openLoopUpdates: [], resolvedLoopIds: [],
      emotionalState: { ...jealousy, primary: { ...jealousy.primary, intensity: 34, remainingTurns: 2, resolution: 'sustained' }, updatedAtTurn: 2 }
    }
  });
  diary = await memory.loadDiary();
  assert.equal(diary.conversationState.emotionalState.primary.intensity, 34);
  assert.equal(diary.conversationState.emotionalState.primary.remainingTurns, 2);

  const reloaded = await memory.loadDiary();
  assert.deepEqual(reloaded.conversationState.emotionalState, diary.conversationState.emotionalState);
});

test('legacy emotionalTrace migrates into the canonical emotional state once', async () => {
  const diary = await memory.loadDiary();
  diary.conversationState = {
    ...diary.conversationState,
    emotionalTrace: { emotion: 'mild_jealousy', cause: 'старая запись', intensity: 37, resolution: 'unresolved', expiresAfterTurns: 3, remainingTurns: 2 }
  };
  delete diary.conversationState.emotionalState;
  storage.setItem('rin-diary-v1', JSON.stringify(diary));
  const migrated = await memory.loadDiary();
  assert.equal(migrated.conversationState.emotionalState.primary.type, 'jealousy');
  assert.match(migrated.conversationState.emotionalState.primary.cause, /старая запись/);
  assert.equal(migrated.conversationState.emotionalTrace, undefined);
});


test('explicit correction rejects a stored hypothesis and survives reload', async () => {
  await memory.commitTurnState({ requestId: 'hyp-1', now: 9_000_000, stateTransition: { beliefUpdates: [{ id:'selfcrit-hyp', kind:'hypothesis', subject:'user', predicate:'self_critical', value:'true', source:'rin_inference', confidence:.3, status:'uncertain', evidence:[] }] } });
  await memory.commitTurnState({ requestId: 'hyp-2', now: 9_000_100, stateTransition: { beliefUpdates: [{ id:'selfcrit-hyp', kind:'hypothesis', subject:'user', predicate:'self_critical', value:'true', source:'rin_inference', confidence:.3, status:'rejected', correctedBy:'user-correction' }, { id:'user-correction', kind:'user_statement', subject:'user', predicate:'current_statement', value:'Я не являюсь самокритичным человеком', source:'current_user_turn', confidence:1, status:'current', evidence:['Я не являюсь самокритичным человеком'] }] } });
  const diary = await memory.loadDiary();
  assert.equal(diary.conversationState.beliefs.find(x=>x.id==='selfcrit-hyp').status, 'rejected');
  assert.match(diary.conversationState.beliefs.find(x=>x.id==='user-correction').value, /не являюсь самокритичным/iu);
});

test('removeFact retracts a stale explicit user fact without touching other facts', async () => {
  await memory.upsertFact('user.trait.selfCritical', 'да'); await memory.upsertFact('user.name', 'Алексей');
  assert.equal(await memory.removeFact('user.trait.selfCritical'), true);
  assert.equal(await memory.getFact('user.trait.selfCritical', null), null);
  assert.equal(await memory.getFact('user.name'), 'Алексей');
});

test('persistent Rin intent survives transactional commit and reload exactly', async () => {
  const rinIntent = {
    schema: 'rin-persistent-intent-v1', id: 'intent-persist', status: 'active',
    goal: 'продвинуть игровую линию', motive: 'пользователь поддержал игру', target: 'shared_playful_scene', scene: 'playful_flirt',
    priority: 82, commitment: 80, progress: 0.42, nextMove: 'tease_or_advance',
    completionCondition: 'после нескольких конкретных ходов', abandonmentCondition: 'явный отказ или farewell',
    startedAtTurn: 2, updatedAtTurn: 3, turnCount: 1, minTurns: 2, maxTurns: 4, source: 'character_intent'
  };
  await memory.commitTurnState({ requestId: 'intent-persist-r1', now: 12_000_000, stateTransition: { rinIntent } });
  const first = await memory.loadDiary();
  assert.equal(first.conversationState.schema, 'rin-conversation-state-v3');
  assert.equal(first.conversationState.rinIntent.id, 'intent-persist');
  assert.equal(first.conversationState.rinIntent.status, 'active');
  assert.equal(first.conversationState.rinIntent.progress, 0.42);
  const reloaded = await memory.loadDiary();
  assert.deepEqual(reloaded.conversationState.rinIntent, first.conversationState.rinIntent);
});


test('duplicate request cannot advance persistent intent twice', async () => {
  const intent = { schema:'rin-persistent-intent-v1', id:'intent-idempotent', status:'active', goal:'продвинуть игровую линию', motive:'play', target:'shared_playful_scene', scene:'playful_flirt', priority:80, commitment:80, progress:.3, nextMove:'tease_or_advance', completionCondition:'done', abandonmentCondition:'stop', startedAtTurn:1, updatedAtTurn:1, turnCount:1, minTurns:2, maxTurns:4, source:'character_intent' };
  const first = await memory.commitTurnState({ requestId:'intent-idem-r1', now:14_000_000, stateTransition:{ rinIntent:intent } });
  assert.equal(first.applied, true);
  const snapshot = await memory.loadDiary();
  const duplicate = await memory.commitTurnState({ requestId:'intent-idem-r1', now:14_000_100, stateTransition:{ rinIntent:{ ...intent, progress:.9, turnCount:4, status:'completed' } } });
  assert.equal(duplicate.applied, false);
  assert.deepEqual((await memory.loadDiary()).conversationState, snapshot.conversationState);
});


test('scene-bound persistent intent survives diary commit and reload byte-for-byte semantically', async () => {
  const intent = { schema:'rin-persistent-intent-v3', id:'intent-binding', status:'active', goal:'развить линию про кицунэ', target:'shared_kitsune_identity', sceneBinding:{key:'shared_kitsune_identity',kind:'shared_fantasy',subject:'кицунэ и пользователь',anchor:'Я иногда представляю, что ты кицунэ',source:'last_rin_action'}, scene:'playful_flirt', priority:82, commitment:80, progress:.35, nextMove:'advance_kitsune_thread', progressState:'started', expectedOutcome:'добавить деталь про кицунэ', completionCondition:'конкретный target продвинут', abandonmentCondition:'смена темы', startedAtTurn:20, updatedAtTurn:20, turnCount:1, minTurns:1, maxTurns:4, source:'character_intent' };
  await memory.commitTurnState({ requestId:'binding-persist-r1', now:16_000_000, stateTransition:{ rinIntent:intent } });
  const reloaded = await memory.loadDiary();
  assert.equal(reloaded.conversationState.rinIntent.sceneBinding.key, 'shared_kitsune_identity');
  assert.equal(reloaded.conversationState.rinIntent.nextMove, 'advance_kitsune_thread');
  assert.match(reloaded.conversationState.rinIntent.sceneBinding.anchor, /кицунэ/iu);
});
