import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createChatViewportController,
  isNearChatBottom,
  resolveViewportHeight,
  resolveViewportMetrics
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

function createTimerQueue() {
  let nextId = 1;
  const pending = new Map();
  return {
    set(callback, delay) {
      const id = nextId++;
      pending.set(id, { callback, delay });
      return id;
    },
    clear(id) {
      pending.delete(id);
    },
    flush() {
      const entries = [...pending.entries()].sort((a, b) => a[1].delay - b[1].delay);
      pending.clear();
      for (const [, task] of entries) task.callback();
    },
    get size() {
      return pending.size;
    }
  };
}

function createRoot() {
  const values = new Map();
  const classes = new Set();
  return {
    values,
    classes,
    root: {
      style: { setProperty: (name, value) => values.set(name, value) },
      classList: {
        toggle(name, enabled) {
          if (enabled) classes.add(name);
          else classes.delete(name);
        },
        remove(name) {
          classes.delete(name);
        }
      }
    }
  };
}

test('viewport metrics include visual viewport size and layout offsets', () => {
  assert.deepEqual(resolveViewportMetrics({
    visualViewport: { height: 612.4, width: 389.6, offsetTop: 84.2, offsetLeft: 2.4 },
    innerHeight: 800,
    innerWidth: 430
  }), {
    height: 612,
    width: 390,
    offsetTop: 84,
    offsetLeft: 2
  });

  assert.equal(resolveViewportHeight({ visualViewport: { height: 612.4 }, innerHeight: 800 }), 612);
  assert.deepEqual(resolveViewportMetrics({ innerHeight: 744.6, innerWidth: 390.2 }), {
    height: 745,
    width: 390,
    offsetTop: 0,
    offsetLeft: 0
  });
});

test('near-bottom detection distinguishes reading history from the active conversation edge', () => {
  const chat = { scrollHeight: 1600, clientHeight: 600, scrollTop: 890 };
  assert.equal(isNearChatBottom(chat, 120), true);
  chat.scrollTop = 600;
  assert.equal(isNearChatBottom(chat, 120), false);
});

test('controller compensates iOS visual viewport panning while the keyboard is open', () => {
  const frames = createFrameQueue();
  const timers = createTimerQueue();
  const { root, values, classes } = createRoot();
  const chat = Object.assign(new FakeTarget(), {
    scrollHeight: 1800,
    clientHeight: 560,
    scrollTop: 0
  });
  const input = new FakeTarget();
  const visualViewport = Object.assign(new FakeTarget(), {
    height: 760,
    width: 390,
    offsetTop: 0,
    offsetLeft: 0
  });
  const windowRef = Object.assign(new FakeTarget(), { innerHeight: 820, innerWidth: 390, visualViewport });
  const documentRef = { activeElement: null };

  const controller = createChatViewportController({
    root,
    chat,
    input,
    windowRef,
    documentRef,
    visualViewport,
    requestFrame: callback => frames.request(callback),
    cancelFrame: id => frames.cancel(id),
    setTimer: (callback, delay) => timers.set(callback, delay),
    clearTimer: id => timers.clear(id)
  });

  assert.equal(values.get('--rin-viewport-height'), '760px');
  assert.equal(values.get('--rin-viewport-offset-top'), '0px');

  documentRef.activeElement = input;
  input.dispatch('focus');
  visualViewport.height = 430;
  visualViewport.offsetTop = 84;
  visualViewport.dispatch('resize');
  visualViewport.dispatch('scroll');
  frames.flush();

  assert.equal(values.get('--rin-viewport-height'), '430px');
  assert.equal(values.get('--rin-viewport-width'), '390px');
  assert.equal(values.get('--rin-viewport-offset-top'), '84px');
  assert.equal(values.get('--rin-viewport-offset-left'), '0px');
  assert.equal(chat.scrollTop, chat.scrollHeight);
  assert.equal(classes.has('rin-input-active'), true);
  assert.equal(timers.size, 4);

  visualViewport.height = 425;
  visualViewport.offsetTop = 88;
  timers.flush();
  frames.flush();
  assert.equal(values.get('--rin-viewport-height'), '425px');
  assert.equal(values.get('--rin-viewport-offset-top'), '88px');

  documentRef.activeElement = null;
  input.dispatch('blur');
  assert.equal(classes.has('rin-input-active'), false);

  controller.destroy();
  visualViewport.height = 390;
  visualViewport.offsetTop = 100;
  visualViewport.dispatch('resize');
  assert.equal(values.get('--rin-viewport-height'), '425px');
});

test('non-forced scroll does not pull a user away from older messages', () => {
  const frames = createFrameQueue();
  const { root } = createRoot();
  const chat = Object.assign(new FakeTarget(), {
    scrollHeight: 2000,
    clientHeight: 500,
    scrollTop: 300
  });
  const windowRef = Object.assign(new FakeTarget(), { innerHeight: 800, innerWidth: 390 });

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
