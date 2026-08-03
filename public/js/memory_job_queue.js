export const MEMORY_JOB_QUEUE_KEY = 'rin-memory-jobs-v1';

const clean = (value, max = 2000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function safeParse(raw) {
  try {
    const value = JSON.parse(raw || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function normalizeJob(value = {}) {
  const id = clean(value.id, 120);
  const userText = clean(value.userText);
  const assistantText = clean(value.assistantText);
  if (!id || !userText || !assistantText) return null;
  return {
    id,
    userText,
    assistantText,
    attempts: Math.max(0, Math.round(Number(value.attempts) || 0)),
    nextAttemptAt: Math.max(0, Number(value.nextAttemptAt) || 0),
    status: value.status === 'failed' ? 'failed' : 'pending',
    createdAt: Number(value.createdAt) || Date.now(),
    lastError: clean(value.lastError, 80) || null
  };
}

export function loadMemoryJobs(storage = localStorage) {
  let raw = null;
  try { raw = storage.getItem(MEMORY_JOB_QUEUE_KEY); } catch { return []; }
  return safeParse(raw).map(normalizeJob).filter(Boolean).slice(-40);
}

export function saveMemoryJobs(jobs, storage = localStorage) {
  try {
    storage.setItem(MEMORY_JOB_QUEUE_KEY, JSON.stringify((Array.isArray(jobs) ? jobs : []).map(normalizeJob).filter(Boolean).slice(-40)));
    return true;
  } catch {
    return false;
  }
}

export function enqueueMemoryJob(job, storage = localStorage) {
  const normalized = normalizeJob({ ...job, attempts: 0, status: 'pending', createdAt: Date.now() });
  if (!normalized) return false;
  const jobs = loadMemoryJobs(storage);
  const index = jobs.findIndex(item => item.id === normalized.id);
  if (index >= 0) jobs[index] = { ...jobs[index], ...normalized };
  else jobs.push(normalized);
  return saveMemoryJobs(jobs, storage);
}

export function createMemoryJobRunner(processor, {
  storage = localStorage,
  now = () => Date.now(),
  maxAttempts = 3,
  retryDelayMs = 30_000
} = {}) {
  if (typeof processor !== 'function') throw new TypeError('Memory job processor must be a function');
  let running = null;

  async function drain() {
    if (running) return running;
    running = (async () => {
      const jobs = loadMemoryJobs(storage);
      for (const job of jobs) {
        if (job.status === 'failed' || job.nextAttemptAt > now()) continue;
        let ok = false;
        let code = 'MEMORY_JOB_FAILED';
        try {
          const result = await processor(job);
          ok = result === true || result?.ok === true;
          code = clean(result?.code, 80) || code;
        } catch (error) {
          code = clean(error?.code || error?.message, 80) || code;
        }

        const current = loadMemoryJobs(storage);
        const index = current.findIndex(item => item.id === job.id);
        if (index < 0) continue;
        if (ok) {
          current.splice(index, 1);
        } else {
          const attempts = current[index].attempts + 1;
          current[index] = {
            ...current[index],
            attempts,
            status: attempts >= maxAttempts ? 'failed' : 'pending',
            nextAttemptAt: now() + retryDelayMs * attempts,
            lastError: code
          };
        }
        saveMemoryJobs(current, storage);
      }
      return loadMemoryJobs(storage);
    })().finally(() => { running = null; });
    return running;
  }

  return { drain };
}
