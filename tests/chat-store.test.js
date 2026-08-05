import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_STORAGE_KEY,
  RESETTABLE_STORAGE_KEYS,
  createChatMessage,
  createSerialQueue,
  loadChatHistory,
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

test('legacy history migrates to schema v5 key', () => {
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
