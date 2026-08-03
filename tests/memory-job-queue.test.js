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
