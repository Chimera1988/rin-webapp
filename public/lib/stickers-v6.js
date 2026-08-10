import { fetchWithTimeout } from '../js/http_client.js';
import {
  STICKER_STORE_KEY,
  isAllowedStickerSrc,
  stickerIdFromSrc,
  validateStickerConfig
} from './sticker-contract.js';

const defaultStats = () => ({ recent: [], sent: 0 });

function loadStats() {
  try {
    const raw = JSON.parse(localStorage.getItem(STICKER_STORE_KEY) || '{}');
    return {
      ...defaultStats(),
      ...raw,
      recent: Array.isArray(raw.recent) ? raw.recent.slice(0, 12) : [],
      sent: Math.max(0, Number(raw.sent) || 0)
    };
  } catch {
    return defaultStats();
  }
}

function saveStats(stats) {
  try { localStorage.setItem(STICKER_STORE_KEY, JSON.stringify(stats)); } catch {}
}

export async function loadStickerConfig(url = '/data/stickers-v6.json') {
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

export function resetStickerState() {
  try { localStorage.removeItem(STICKER_STORE_KEY); } catch {}
}

export { validateStickerConfig, stickerIdFromSrc } from './sticker-contract.js';
