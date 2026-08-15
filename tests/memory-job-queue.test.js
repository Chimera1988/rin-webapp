import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryJobRunner, enqueueMemoryJob, loadMemoryJobs } from '../public/js/memory_job_queue.js';
import { MemoryStorage } from './helpers/runtime.js';

test('memory jobs retry with backoff and are removed after success', async () => {
  const storage = new MemoryStorage();
  let now = 1000;
  let calls = 0;
  enqueueMemoryJob({ id: 'u1', userText: 'мой проект', assistantText: 'поняла' }, storage);
  const runner = createMemoryJobRunner(async () => {
    calls += 1;
    return calls >= 2 ? { ok: true } : { ok: false, code: 'TEMP' };
  }, { storage, now: () => now, retryDelayMs: 100, maxAttempts: 3 });

  await runner.drain();
  let jobs = loadMemoryJobs(storage);
  assert.equal(jobs[0].attempts, 1);
  assert.equal(jobs[0].status, 'pending');
  await runner.drain();
  assert.equal(calls, 1, 'backoff prevents an immediate duplicate request');
  now = 1100;
  await runner.drain();
  assert.equal(loadMemoryJobs(storage).length, 0);
  assert.equal(calls, 2);
});

test('memory jobs retain an explicit failed state after max attempts', async () => {
  const storage = new MemoryStorage();
  let now = 0;
  enqueueMemoryJob({ id: 'u2', userText: 'план', assistantText: 'ответ' }, storage);
  const runner = createMemoryJobRunner(async () => ({ ok: false, code: 'PERM' }), {
    storage, now: () => now, retryDelayMs: 1, maxAttempts: 2
  });
  await runner.drain();
  now = 1;
  await runner.drain();
  const [job] = loadMemoryJobs(storage);
  assert.equal(job.status, 'failed');
  assert.equal(job.attempts, 2);
  assert.equal(job.lastError, 'PERM');
});


test('failed memory job becomes recoverable after the failed retry cooldown', async () => {
  const storage = new MemoryStorage();
  let now = 0;
  let calls = 0;
  enqueueMemoryJob({ id: 'u3', userText: 'важный факт', assistantText: 'запомнила' }, storage);
  const runner = createMemoryJobRunner(async () => {
    calls += 1;
    return calls >= 3 ? { ok: true } : { ok: false, code: 'TEMP' };
  }, { storage, now: () => now, retryDelayMs: 10, failedRetryDelayMs: 100, maxAttempts: 2 });

  await runner.drain();
  now = 10;
  await runner.drain();
  let [job] = loadMemoryJobs(storage);
  assert.equal(job.status, 'failed');
  assert.equal(job.nextAttemptAt, 110);
  assert.equal(calls, 2);

  now = 109;
  await runner.drain();
  assert.equal(calls, 2);
  now = 110;
  await runner.drain();
  assert.equal(calls, 3);
  assert.equal(loadMemoryJobs(storage).length, 0);
});

test('a completed memory job is not processed twice when queue removal persistence fails once', async () => {
  const storage = new MemoryStorage();
  enqueueMemoryJob({ id: 'job-once', userText: 'важный факт', assistantText: 'запомнила' }, storage);
  let failRemovalOnce = true;
  const originalSet = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    if (String(key) === 'rin-memory-jobs-v1' && String(value) === '[]' && failRemovalOnce) {
      failRemovalOnce = false;
      return;
    }
    originalSet(key, value);
  };
  let calls = 0;
  let completed = false;
  const runner = createMemoryJobRunner(async () => {
    calls += 1;
    completed = true;
    return { ok: true };
  }, {
    storage,
    isCompleted: async job => job.id === 'job-once' && completed
  });

  await runner.drain();
  assert.equal(calls, 1);
  assert.equal(loadMemoryJobs(storage).length, 1, 'failed queue cleanup must leave the durable job for recovery');
  await runner.drain();
  assert.equal(calls, 1, 'completion marker must prevent a duplicate processor/API call');
  assert.equal(loadMemoryJobs(storage).length, 0);
});
