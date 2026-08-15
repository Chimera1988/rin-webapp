import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_STORAGE_KEY,
  RESETTABLE_STORAGE_KEYS,
  createChatMessage,
  createSerialQueue,
  loadChatHistory,
  persistChatHistoryMutation,
  reconcilePendingDeliveryHistory,
  resetApplicationStorage,
  saveChatHistory,
  toApiHistory,
  updateMessage
} from '../public/js/chat_store.js';
import { MemoryStorage, sleep } from './helpers/runtime.js';

test('typed voice and sticker messages survive persistence and reload', () => {
  const storage = new MemoryStorage();
  const history = [
    createChatMessage({ role: 'assistant', kind: 'voice', content: 'голосовой ответ', id: 'voice' }),
    createChatMessage({ role: 'assistant', kind: 'sticker', content: 'жест', id: 'sticker', sticker: { src: '/stickers/smile.webp', utterance: 'м-м' } })
  ];
  assert.equal(saveChatHistory(history, storage), true);
  const loaded = loadChatHistory(storage);
  assert.equal(loaded[0].kind, 'voice');
  assert.equal(loaded[1].kind, 'sticker');
  assert.equal(loaded[1].sticker.src, '/stickers/smile.webp');
});


test('durable history mutation rolls back in-memory state when persistence fails', () => {
  const history = [createChatMessage({ role: 'user', status: 'failed', content: 'retry me', id: 'u-quota' })];
  const blocked = {
    getItem() { return null; },
    setItem() { throw new Error('quota'); },
    removeItem() {}
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    const ok = persistChatHistoryMutation(history, draft => {
      draft[0].status = 'sent';
      draft.push(createChatMessage({ role: 'user', status: 'pending', content: 'must rollback', id: 'u-new' }));
    }, blocked);
    assert.equal(ok, false);
    assert.equal(history.length, 1);
    assert.equal(history[0].id, 'u-quota');
    assert.equal(history[0].status, 'failed');
  } finally {
    console.error = originalError;
  }
});

test('durable history mutation commits only after the mutated state is stored', () => {
  const storage = new MemoryStorage();
  const history = [];
  const message = createChatMessage({ role: 'user', status: 'pending', content: 'durable', id: 'u-durable' });
  assert.equal(persistChatHistoryMutation(history, draft => draft.push(message), storage), true);
  assert.equal(history.length, 1);
  assert.equal(JSON.parse(storage.getItem(CHAT_STORAGE_KEY))[0].id, 'u-durable');
});

test('reset registry removes all application state and explicitly preserves PIN', () => {
  const initial = Object.fromEntries(RESETTABLE_STORAGE_KEYS.map(key => [key, 'x']));
  initial['rin-pin'] = '1234';
  initial['unrelated'] = 'keep';
  const storage = new MemoryStorage(initial);
  resetApplicationStorage(storage, { preservePin: true });
  for (const key of RESETTABLE_STORAGE_KEYS) assert.equal(storage.getItem(key), null, key);
  assert.equal(storage.getItem('rin-pin'), '1234');
  assert.equal(storage.getItem('unrelated'), 'keep');
});

test('failed turns are excluded and a retried old turn becomes the current final turn', () => {
  const history = [
    createChatMessage({ role: 'user', status: 'failed', requestId: 'r1', content: 'первый', id: 'u1' }),
    createChatMessage({ role: 'user', status: 'complete', requestId: 'r2', content: 'второй', id: 'u2' }),
    createChatMessage({ role: 'assistant', status: 'complete', requestId: 'r2', inReplyTo: 'u2', content: 'ответ', id: 'a2' })
  ];
  updateMessage(history, 'u1', { status: 'sent', requestId: 'retry' });
  const api = toApiHistory(history, 'retry');
  assert.deepEqual(api.map(item => item.id), ['u2', 'a2', 'u1']);
});

test('serial queue preserves user send order despite different worker delays', async () => {
  const completed = [];
  const queue = createSerialQueue(async value => {
    await sleep(value === 1 ? 25 : 1);
    completed.push(value);
    return value;
  });
  const first = queue.enqueue(1);
  const second = queue.enqueue(2);
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(completed, [1, 2]);
});


test('pending or sent user turns are recovered as failed after reload', () => {
  const storage = new MemoryStorage();
  saveChatHistory([
    createChatMessage({ role: 'user', status: 'sent', requestId: 'r1', content: 'незавершённый запрос', id: 'u1' })
  ], storage);
  const [recovered] = loadChatHistory(storage);
  assert.equal(recovered.status, 'failed');
  assert.equal(recovered.errorCode, 'INTERRUPTED_REQUEST');
});

test('legacy history migrates to schema v6 key', () => {
  const storage = new MemoryStorage({ 'rin-history-v3': JSON.stringify([{ role: 'user', content: 'старое', ts: 1 }]) });
  const loaded = loadChatHistory(storage);
  assert.equal(loaded.length, 1);
  assert.ok(storage.getItem(CHAT_STORAGE_KEY));
  assert.equal(storage.getItem('rin-history-v3'), null);
});


test('corrupted or unavailable history storage recovers without crashing the dialog', () => {
  const corrupted = new MemoryStorage({ [CHAT_STORAGE_KEY]: '{broken' });
  assert.deepEqual(loadChatHistory(corrupted), []);
  assert.equal(corrupted.getItem(CHAT_STORAGE_KEY), '[]');

  const blocked = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('quota'); },
    removeItem() { throw new Error('blocked'); }
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(loadChatHistory(blocked), []);
    assert.equal(saveChatHistory([], blocked), false);
    assert.doesNotThrow(() => resetApplicationStorage(blocked));
  } finally {
    console.error = originalError;
  }
});


test('stored assistant meta leaks are removed during history migration', () => {
  const storage = new MemoryStorage({
    [CHAT_STORAGE_KEY]: JSON.stringify([
      { role: 'assistant', kind: 'text', status: 'complete', id: 'leak', content: '[Невербальный жест Рин: кивок; причина: поддержка]', ts: 1 },
      { role: 'assistant', kind: 'sticker', status: 'complete', id: 'sticker', content: '[Невербальный жест Рин: кивок; причина: поддержка]', sticker: { id: 'agreement', src: '/stickers/agreement.webp', meaning: 'кивок' }, ts: 2 },
      { role: 'user', kind: 'text', status: 'complete', id: 'user', content: 'Ага', ts: 3 }
    ])
  });
  const loaded = loadChatHistory(storage);
  assert.deepEqual(loaded.map(item => item.id), ['sticker', 'user']);
  assert.doesNotMatch(storage.getItem(CHAT_STORAGE_KEY), /\"id\":\"leak\"/);
});

test('pending delivery journal is resumed only when its request was semantically committed', () => {
  const base = [
    createChatMessage({ role:'user', kind:'text', status:'failed', requestId:'r-commit', turnId:'user-r-commit', content:'сообщение', id:'u-commit' }),
    createChatMessage({ role:'assistant', kind:'text', status:'pending', requestId:'r-commit', turnId:'rin-r-commit', deliveryId:'delivery-r-commit', segmentId:'a-commit', segmentIndex:0, content:'подготовленный ответ', id:'a-commit' }),
    createChatMessage({ role:'assistant', kind:'text', status:'pending', requestId:'r-uncommitted', turnId:'rin-r-uncommitted', deliveryId:'delivery-r-uncommitted', segmentId:'a-uncommitted', segmentIndex:0, content:'не должен появиться', id:'a-uncommitted' })
  ];
  const reconciled = reconcilePendingDeliveryHistory(base, 'r-commit');
  assert.equal(reconciled.find(item => item.id === 'u-commit')?.status, 'complete');
  assert.equal(reconciled.find(item => item.id === 'a-commit')?.status, 'pending');
  assert.equal(reconciled.some(item => item.id === 'a-uncommitted'), false);
});

test('uncommitted pending delivery journal is discarded and user retry state remains intact', () => {
  const base = [
    createChatMessage({ role:'user', kind:'text', status:'failed', requestId:'r-lost', content:'повтори меня', id:'u-lost' }),
    createChatMessage({ role:'assistant', kind:'text', status:'pending', requestId:'r-lost', turnId:'rin-r-lost', deliveryId:'delivery-r-lost', segmentId:'a-lost', segmentIndex:0, content:'невидимый черновик', id:'a-lost' })
  ];
  const reconciled = reconcilePendingDeliveryHistory(base, 'different-request');
  assert.equal(reconciled.find(item => item.id === 'u-lost')?.status, 'failed');
  assert.equal(reconciled.some(item => item.id === 'a-lost'), false);
});

test('legacy history is never deleted when the v6 migration commit fails', () => {
  const legacyKey = 'rin-history-v5';
  const legacyValue = JSON.stringify([{ role: 'user', content: 'не потерять', ts: 1 }]);
  const storage = new MemoryStorage({ [legacyKey]: legacyValue });
  const originalSet = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    if (String(key) === CHAT_STORAGE_KEY) throw new Error('quota');
    originalSet(key, value);
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    const loaded = loadChatHistory(storage);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].content, 'не потерять');
    assert.equal(storage.getItem(CHAT_STORAGE_KEY), null);
    assert.equal(storage.getItem(legacyKey), legacyValue);
  } finally {
    console.error = originalError;
  }
});

test('verified history persistence detects a silent storage write failure', () => {
  const storage = new MemoryStorage();
  storage.setItem = () => {};
  const history = [];
  const message = createChatMessage({ role: 'user', status: 'pending', content: 'silent failure', id: 'u-silent' });
  assert.equal(persistChatHistoryMutation(history, draft => draft.push(message), storage), false);
  assert.deepEqual(history, []);
  assert.equal(storage.getItem(CHAT_STORAGE_KEY), null);
});
