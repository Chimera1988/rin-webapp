import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresenceController, PRESENCE_LABELS } from '../public/js/presence_controller.js';

class FakeClock {
  #nextId = 1;
  #now = 0;
  #tasks = new Map();

  setTimer = (callback, delay) => {
    const id = this.#nextId++;
    this.#tasks.set(id, { at: this.#now + Number(delay || 0), callback });
    return id;
  };

  clearTimer = id => {
    this.#tasks.delete(id);
  };

  tick(ms) {
    const target = this.#now + ms;
    while (true) {
      const next = [...this.#tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      const [id, task] = next;
      this.#tasks.delete(id);
      this.#now = task.at;
      task.callback();
    }
    this.#now = target;
  }
}

function createFixture(overrides = {}) {
  const clock = new FakeClock();
  const rendered = [];
  let online = true;
  let visible = true;
  let typingCalls = 0;
  const controller = createPresenceController({
    render: (mode, label) => rendered.push({ mode, label }),
    random: () => 0,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    isTransportOnline: () => online,
    isVisible: () => visible,
    ...overrides
  });
  return {
    clock,
    controller,
    rendered,
    setOnline: value => { online = value; },
    setVisible: value => { visible = value; },
    beginUserTurn: () => controller.beginTurn({ userInitiated: true, onTyping: () => { typingCalls += 1; } }),
    typingCalls: () => typingCalls
  };
}

test('presence is offline until the first user message, then becomes online and typing', () => {
  const fixture = createFixture();
  assert.deepEqual(fixture.controller.getSnapshot(), { mode: 'offline', engaged: false, active: false });
  assert.equal(fixture.rendered.at(-1).label, PRESENCE_LABELS.offline);

  const turn = fixture.beginUserTurn();
  assert.equal(fixture.controller.getSnapshot().mode, 'offline');
  fixture.clock.tick(449);
  assert.equal(fixture.controller.getSnapshot().mode, 'offline');
  fixture.clock.tick(1);
  assert.equal(fixture.controller.getSnapshot().mode, 'online');
  fixture.clock.tick(649);
  assert.equal(fixture.controller.getSnapshot().mode, 'online');
  fixture.clock.tick(1);
  assert.equal(fixture.controller.getSnapshot().mode, 'typing');
  assert.equal(fixture.typingCalls(), 1);

  assert.equal(fixture.controller.finishTurn(turn), true);
  assert.equal(fixture.controller.getSnapshot().mode, 'online');
  fixture.clock.tick(21_999);
  assert.equal(fixture.controller.getSnapshot().mode, 'online');
  fixture.clock.tick(1);
  assert.equal(fixture.controller.getSnapshot().mode, 'offline');
});

test('after distraction an incoming message brings presence back with a delayed return', () => {
  const fixture = createFixture();
  const first = fixture.beginUserTurn();
  fixture.clock.tick(450 + 650);
  fixture.controller.finishTurn(first);
  fixture.clock.tick(22_000);
  assert.equal(fixture.controller.getSnapshot().mode, 'offline');

  const second = fixture.beginUserTurn();
  fixture.clock.tick(1_199);
  assert.equal(fixture.controller.getSnapshot().mode, 'offline');
  fixture.clock.tick(1);
  assert.equal(fixture.controller.getSnapshot().mode, 'online');
  fixture.clock.tick(650);
  assert.equal(fixture.controller.getSnapshot().mode, 'typing');
  fixture.controller.finishTurn(second);
});

test('network and page visibility force offline without making presence online on restoration', () => {
  const fixture = createFixture();
  fixture.setOnline(false);
  fixture.controller.syncAvailability();
  assert.equal(fixture.controller.getSnapshot().mode, 'offline');

  fixture.setOnline(true);
  fixture.controller.syncAvailability();
  assert.equal(fixture.controller.getSnapshot().mode, 'offline');

  const turn = fixture.beginUserTurn();
  fixture.clock.tick(450);
  assert.equal(fixture.controller.getSnapshot().mode, 'online');
  fixture.setVisible(false);
  fixture.controller.syncAvailability();
  assert.equal(fixture.controller.getSnapshot().mode, 'offline');

  fixture.setVisible(true);
  fixture.controller.syncAvailability();
  assert.equal(fixture.controller.getSnapshot().mode, 'online');
  fixture.clock.tick(650);
  assert.equal(fixture.controller.getSnapshot().mode, 'typing');
  fixture.controller.finishTurn(turn);
});

test('assistant initiative cannot expose online before user engagement', () => {
  const fixture = createFixture();
  const turn = fixture.controller.beginTurn({ userInitiated: false });
  assert.equal(turn, null);
  assert.deepEqual(fixture.controller.getSnapshot(), { mode: 'offline', engaged: false, active: false });
});
