import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const chat = fs.readFileSync(new URL('../public/chat.js', import.meta.url), 'utf8');

function functionBody(name, nextName) {
  const start = chat.indexOf(`async function ${name}`);
  assert.ok(start >= 0, `missing ${name}`);
  const end = nextName ? chat.indexOf(`${nextName}`, start + 1) : chat.length;
  assert.ok(end > start, `missing boundary after ${name}`);
  return chat.slice(start, end);
}

test('reactive turn prepares, waits, journals pending delivery, commits semantics, then renders', () => {
  const source = functionBody('processUserBatch', 'async function refreshRinEnv');
  const prepare = source.indexOf('preparedDelivery = await prepareAssistantDelivery');
  const wait = source.indexOf('humanDeliveryScheduler.waitBefore');
  const commit = source.indexOf('await commitSuccessfulTurnState');
  const persist = source.indexOf('persistPreparedDeliveryOrThrow(preparedDelivery)');
  const deliver = source.indexOf('await deliverCommittedAssistantTurn');
  assert.ok(prepare >= 0 && wait > prepare && persist > wait && commit > persist && deliver > commit);
  assert.match(source, /requestId,/u);
  assert.doesNotMatch(source, /requestId:\s*requestId\s*\|\|\s*userMessage/u);
});

test('new user input cancels only a prepared pre-commit turn and requeues the whole batch', () => {
  const source = functionBody('processUserBatch', 'async function refreshRinEnv');
  const commit = source.indexOf('await commitSuccessfulTurnState');
  const cancellations = [...source.matchAll(/requeueInterruptedBatch\(ids\)/gu)].map(match => match.index);
  assert.ok(cancellations.length >= 2);
  assert.ok(cancellations.every(index => index < commit));
  assert.match(source, /shouldCancel:\s*\(\) => inputEpoch !== epochAtStart/u);
  assert.doesNotMatch(source.slice(commit), /requeueInterruptedBatch\(ids\)/u);
});

test('post-commit reactive failures cannot mark the user batch failed or create retry UI', () => {
  const source = functionBody('processUserBatch', 'async function refreshRinEnv');
  const guard = source.indexOf('if (stateCommitted)');
  const failedWrite = source.indexOf('markBatchFailed(ids, code)');
  assert.ok(guard >= 0 && failedWrite > guard);
  const guarded = source.slice(guard, failedWrite);
  assert.match(guarded, /markUserBatchComplete\(ids\)/u);
  assert.match(guarded, /return;/u);
  assert.doesNotMatch(guarded, /renderFailedState/u);
});

test('proactive turn uses the same prepared-delay-commit-delivery boundary and yields to new user input before commit', () => {
  const source = functionBody('requestAssistantInitiative', 'async function tryInitiateBySchedule');
  const prepare = source.indexOf('preparedDelivery = await prepareAssistantDelivery');
  const wait = source.indexOf('humanDeliveryScheduler.waitBefore');
  const commit = source.indexOf('await commitSuccessfulTurnState');
  const persist = source.indexOf('persistPreparedDeliveryOrThrow(preparedDelivery)');
  const deliver = source.indexOf('await deliverCommittedAssistantTurn');
  assert.ok(prepare >= 0 && wait > prepare && persist > wait && commit > persist && deliver > commit);
  assert.match(source.slice(0, commit), /inputEpoch !== epochAtStart/u);
  assert.match(source, /if \(stateCommitted\)[\s\S]*return true;/u);
});

test('pending delivery journal is persisted before semantic commit and reload verifies commit before resuming', () => {
  const persistStart = chat.indexOf('function persistPreparedDelivery');
  const renderStart = chat.indexOf('async function renderPreparedSegment', persistStart);
  const persistSource = chat.slice(persistStart, renderStart);
  assert.match(persistSource, /persistChatHistoryMutation\(history/u);
  assert.match(persistSource, /draft\.push\(message\)/u);
  assert.doesNotMatch(persistSource, /history\.push\(message\)/u);

  const reconcile = functionBody('reconcilePendingAssistantDeliveryCommitState', 'function setTypingRow');
  assert.match(reconcile, /lastCommittedRequestId/u);
  assert.match(reconcile, /reconcilePendingDeliveryHistory/u);

  const resume = functionBody('resumePendingAssistantDeliveries', 'function replyLinkFromTarget');
  assert.match(resume, /reconcilePendingAssistantDeliveryCommitState/u);
  assert.match(resume, /status === 'pending'/u);
  assert.match(resume, /deliveryId/u);
  assert.match(resume, /renderPreparedSegment/u);
  assert.match(resume, /humanDeliveryScheduler\.waitBetweenSegments/u);
});
