import test from 'node:test';
import assert from 'node:assert/strict';
import {
  USER_AGGREGATION_WINDOW_MS,
  computeHumanReadDelay,
  computeHumanComposeDelay,
  computeInterSegmentDelay,
  createHumanDeliveryScheduler,
  createInputAggregator
} from '../public/js/delivery_scheduler.js';

const immediateTimer = callback => { callback(); return 1; };

test('human timing scales with content and remains bounded instead of displaying instantly', () => {
  const low = () => 0;
  const high = () => 1;
  assert.equal(USER_AGGREGATION_WINDOW_MS, 1250);
  assert.ok(computeHumanReadDelay({ userChars: 20, random: low }) >= 450);
  assert.ok(computeHumanReadDelay({ userChars: 500, messageCount: 3, random: high }) <= 2400);
  assert.ok(computeHumanComposeDelay({ chars: 12, random: low }) >= 800);
  assert.ok(computeHumanComposeDelay({ chars: 70, random: high }) <= 3200);
  assert.ok(computeHumanComposeDelay({ chars: 150, random: high }) <= 5000);
  assert.ok(computeHumanComposeDelay({ chars: 290, random: high }) <= 7600);
  assert.ok(computeHumanComposeDelay({ chars: 900, random: high }) <= 10500);
  assert.ok(computeInterSegmentDelay({ nextKind: 'text', random: low }) >= 520);
  assert.ok(computeInterSegmentDelay({ nextKind: 'sticker', random: high }) <= 850);
});

test('scheduler owns presence timing: read online, then typing, while silence never fakes typing', async () => {
  const presence = [];
  const scheduler = createHumanDeliveryScheduler({ random: () => 0, setTimer: immediateTimer });
  const text = await scheduler.waitBeforeFirstSegment({
    userChars: 30,
    firstSegment: { type: 'text', text: 'Небольшой ответ.' },
    onPresence: mode => presence.push(mode)
  });
  assert.equal(text.cancelled, false);
  assert.deepEqual(presence, ['online', 'typing']);

  presence.length = 0;
  const silence = await scheduler.waitBeforeSilence({ userChars: 20, onPresence: mode => presence.push(mode) });
  assert.equal(silence.cancelled, false);
  assert.deepEqual(presence, ['online']);
});

test('prepared delivery can be cancelled before semantic commit during human delay', async () => {
  let ticks = 0;
  const scheduler = createHumanDeliveryScheduler({
    random: () => 0,
    setTimer: callback => { ticks += 1; callback(); return ticks; }
  });
  const result = await scheduler.waitBeforeFirstSegment({
    userChars: 100,
    firstSegment: { type: 'text', text: 'Ответ, который ещё не был отправлен.' },
    shouldCancel: () => ticks >= 2
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.phase, 'read');
});

test('input aggregator groups fast consecutive user messages in order and preserves requeued older messages', async () => {
  let latestTimer = null;
  const cleared = new Set();
  let serial = 0;
  const flushed = [];
  const aggregator = createInputAggregator({
    delayMs: USER_AGGREGATION_WINDOW_MS,
    onFlush: async batch => { flushed.push(batch); },
    setTimer: callback => { const token = { id: ++serial, callback }; latestTimer = token; return token; },
    clearTimer: token => cleared.add(token.id)
  });
  aggregator.push('u1');
  const firstTimer = latestTimer;
  aggregator.push('u2');
  assert.ok(cleared.has(firstTimer.id), 'second quick message must reset the aggregation window');
  assert.deepEqual(aggregator.pending(), ['u1', 'u2']);
  await latestTimer.callback();
  assert.deepEqual(flushed, [['u1', 'u2']]);

  aggregator.push('u4');
  aggregator.prepend(['u2', 'u3']);
  assert.deepEqual(aggregator.pending(), ['u2', 'u3', 'u4']);
  await aggregator.flushNow();
  assert.deepEqual(flushed.at(-1), ['u2', 'u3', 'u4']);
});
