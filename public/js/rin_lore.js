import { fetchWithTimeout } from './http_client.js';

// Client lore owns schedule metadata only. Canonical biography and proactive
// content are server-owned by the Cognitive Kernel / Canon Store.
const SCHEDULE_URL = '/data/rin_schedule.json';
let cache = null;

export function resetLoreCache() { cache = null; }

export async function getSchedule() {
  if (cache) return cache;
  const response = await fetchWithTimeout(SCHEDULE_URL, { cache: 'no-store' }, 12_000);
  if (!response.ok) throw new Error(`${SCHEDULE_URL}: HTTP ${response.status}`);
  cache = await response.json();
  return cache;
}
