import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresenceController, PRESENCE_LABELS } from '../public/js/presence_controller.js';

class FakeClock {
  #nextId = 1; #now = 0; #tasks = new Map();
  setTimer = (callback, delay) => { const id = this.#nextId++; this.#tasks.set(id, { at: this.#now + Number(delay || 0), callback }); return id; };
  clearTimer = id => this.#tasks.delete(id);
  tick(ms) {
    const target = this.#now + ms;
    while (true) {
      const next = [...this.#tasks.entries()].filter(([, task]) => task.at <= target).sort((a,b) => a[1].at-b[1].at || a[0]-b[0])[0];
      if (!next) break;
      const [id, task] = next; this.#tasks.delete(id); this.#now = task.at; task.callback();
    }
    this.#now = target;
  }
}

function fixture() {
  const clock = new FakeClock(); const rendered = []; let online = true; let visible = true; let typingCalls = 0;
  const controller = createPresenceController({
    render: (mode,label) => rendered.push({mode,label}), random: () => 0,
    setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    isTransportOnline: () => online, isVisible: () => visible
  });
  return { clock, controller, rendered, setOnline:v=>{online=v;}, setVisible:v=>{visible=v;}, typingCalls:()=>typingCalls,
    begin: opts => controller.beginTurn({ ...opts, onTyping: () => { typingCalls += 1; } }) };
}

test('presence timing is externally driven: begin -> online, scheduler phase -> typing, finish -> online -> not online later', () => {
  const f = fixture();
  assert.equal(f.controller.getSnapshot().mode, 'offline');
  assert.equal(f.rendered.at(-1).label, 'не в сети');
  const turn = f.begin({ userInitiated: true });
  assert.equal(f.controller.getSnapshot().mode, 'online');
  assert.equal(f.controller.setTyping(turn), true);
  assert.equal(f.controller.getSnapshot().mode, 'typing');
  assert.equal(f.typingCalls(), 1);
  f.controller.setOnline(turn);
  assert.equal(f.controller.getSnapshot().mode, 'online');
  f.controller.finishTurn(turn);
  f.clock.tick(22_000);
  assert.equal(f.controller.getSnapshot().mode, 'offline');
  assert.equal(PRESENCE_LABELS.offline, 'не в сети');
});

test('presence controller owns no read/compose delays', () => {
  const f = fixture();
  const turn = f.begin({ userInitiated: true });
  f.clock.tick(60_000);
  assert.equal(f.controller.getSnapshot().mode, 'online');
  assert.equal(f.typingCalls(), 0);
  f.controller.setTyping(turn);
  assert.equal(f.typingCalls(), 1);
  f.controller.finishTurn(turn);
});

test('network and page visibility force not-in-network state; active turn restores only online until scheduler says typing', () => {
  const f = fixture();
  f.setOnline(false); f.controller.syncAvailability();
  assert.equal(f.controller.getSnapshot().mode, 'offline');
  f.setOnline(true); f.controller.syncAvailability();
  assert.equal(f.controller.getSnapshot().mode, 'offline');
  const turn = f.begin({ userInitiated: true });
  assert.equal(f.controller.getSnapshot().mode, 'online');
  f.setVisible(false); f.controller.syncAvailability();
  assert.equal(f.controller.getSnapshot().mode, 'offline');
  f.setVisible(true); f.controller.syncAvailability();
  assert.equal(f.controller.getSnapshot().mode, 'online');
  assert.equal(f.typingCalls(), 0);
  f.controller.finishTurn(turn);
});

test('proactive initiative can expose online only while an actual proactive turn is active', () => {
  const f = fixture();
  const turn = f.begin({ userInitiated: false });
  assert.ok(turn);
  assert.equal(f.controller.getSnapshot().mode, 'online');
  assert.equal(f.controller.getSnapshot().engaged, false);
  f.controller.finishTurn(turn);
  assert.equal(f.controller.getSnapshot().mode, 'online');
});
