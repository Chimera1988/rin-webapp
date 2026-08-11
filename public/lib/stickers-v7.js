import { fetchWithTimeout } from '../js/http_client.js';
import { storageReadJson, storageRemove, storageWriteJson } from '../js/storage.js';
import {
  STICKER_STORE_KEY,
  isAllowedStickerSrc,
  stickerIdFromSrc,
  validateStickerConfig
} from './sticker-contract.js';

const defaultStats = () => ({ recent: [], sent: 0 });

function loadStats(storage = localStorage) {
  const raw = storageReadJson(storage, STICKER_STORE_KEY, {});
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    ...defaultStats(),
    ...source,
    recent: Array.isArray(source.recent) ? source.recent.slice(0, 12) : [],
    sent: Math.max(0, Number(source.sent) || 0)
  };
}

function saveStats(stats, storage = localStorage) {
  return storageWriteJson(storage, STICKER_STORE_KEY, stats, { log: false });
}

export async function loadStickerConfig(url = '/data/stickers-v7.json') {
  const response = await fetchWithTimeout(url, { cache: 'no-store' }, 12_000);
  if (!response.ok) throw new Error(`Failed to load stickers config: ${response.status}`);
  const config = await response.json();
  const validation = validateStickerConfig(config);
  if (!validation.ok) throw new Error(`Invalid sticker manifest: ${validation.errors.join('; ')}`);
  return config;
}

// Client responsibility is execution telemetry only. Semantic selection and
// delivery mode are already frozen in the server DeliveryPlan.
export function markStickerSent(sticker) {
  if (!sticker?.src || !isAllowedStickerSrc(sticker.src)) return false;
  const stats = loadStats();
  stats.sent += 1;
  stats.recent = [sticker.src, ...stats.recent.filter(src => src !== sticker.src)].slice(0, 12);
  saveStats(stats);
  return true;
}

export function resetStickerState(storage = localStorage) {
  return storageRemove(storage, STICKER_STORE_KEY);
}

export { validateStickerConfig, stickerIdFromSrc } from './sticker-contract.js';
