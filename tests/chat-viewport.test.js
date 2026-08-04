import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createChatViewportController,
  isNearChatBottom,
  resolveViewportHeight
} from '../public/js/chat_viewport.js';

class FakeTarget {
  constructor() {
    this.listeners = new Map();
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }
  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener({ type, target: this, ...event });
  }
}

function createFrameQueue() {
  let nextId = 1;
  const pending = new Map();
  return {
    request(callback) {
      const id = nextId++;
      pending.set(id, callback);
      return id;
    },
    cancel(id) {
      pending.delete(id);
    },
    flush() {
      while (pending.size) {
        const entries = [...pending.entries()];
        pending.clear();
        for (const [, callback] of entries) callback();
      }
    }
  };
}

test('viewport height prefers visualViewport and has a safe fallback', () => {
  assert.equal(resolveViewportHeight({ visualViewport: { height: 612.4 }, innerHeight: 800 }), 612);
  assert.equal(resolveViewportHeight({ visualViewport: null, innerHeight: 744.6 }), 745);
  assert.equal(resolveViewportHeight({}), 1);
});

test('near-bottom detection distinguishes reading history from the active conversation edge', () => {
  const chat = { scrollHeight: 1600, clientHeight: 600, scrollTop: 890 };
  assert.equal(isNearChatBottom(chat, 120), true);
  chat.scrollTop = 600;
  assert.equal(isNearChatBottom(chat, 120), false);
});

test('controller fixes the app height and keeps the composer edge visible after keyboard resize', () => {
  const frames = createFrameQueue();
  const rootValues = new Map();
  const root = { style: { setProperty: (name, value) => rootValues.set(name, value) } };
  const chat = Object.assign(new FakeTarget(), {
    scrollHeight: 1800,
    clientHeight: 560,
    scrollTop: 0
  });
  const input = new FakeTarget();
  const visualViewport = Object.assign(new FakeTarget(), { height: 760 });
  const windowRef = Object.assign(new FakeTarget(), { innerHeight: 820, visualViewport });
  const documentRef = { activeElement: null };

  const controller = createChatViewportController({
    root,
    chat,
    input,
    windowRef,
    documentRef,
    visualViewport,
    requestFrame: callback => frames.request(callback),
    cancelFrame: id => frames.cancel(id)
  });

  assert.equal(rootValues.get('--rin-viewport-height'), '760px');

  documentRef.activeElement = input;
  visualViewport.height = 430;
  visualViewport.dispatch('resize');
  frames.flush();

  assert.equal(rootValues.get('--rin-viewport-height'), '430px');
  assert.equal(chat.scrollTop, chat.scrollHeight);

  controller.destroy();
  visualViewport.height = 390;
  visualViewport.dispatch('resize');
  assert.equal(rootValues.get('--rin-viewport-height'), '430px');
});

test('non-forced scroll does not pull a user away from older messages', () => {
  const frames = createFrameQueue();
  const root = { style: { setProperty() {} } };
  const chat = Object.assign(new FakeTarget(), {
    scrollHeight: 2000,
    clientHeight: 500,
    scrollTop: 300
  });
  const windowRef = Object.assign(new FakeTarget(), { innerHeight: 800 });

  const controller = createChatViewportController({
    root,
    chat,
    windowRef,
    documentRef: { activeElement: null },
    requestFrame: callback => frames.request(callback),
    cancelFrame: id => frames.cancel(id)
  });

  assert.equal(controller.requestScrollToBottom({ force: false }), false);
  frames.flush();
  assert.equal(chat.scrollTop, 300);
  controller.destroy();
});
