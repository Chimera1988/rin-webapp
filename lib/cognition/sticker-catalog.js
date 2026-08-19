import { readFileSync } from 'node:fs';

const STICKER_CONFIG_URL = new URL('../../public/data/stickers-v7.json', import.meta.url);
const manifest = JSON.parse(readFileSync(STICKER_CONFIG_URL, 'utf8'));
const stickers = Array.isArray(manifest?.stickers) ? manifest.stickers : [];

export const STICKER_INTENT_VALUES = Object.freeze(stickers
  .map(sticker => String(sticker?.id || '').trim().toLowerCase())
  .filter(Boolean));

export function isSupportedStickerIntent(value = '') {
  return STICKER_INTENT_VALUES.includes(String(value || '').trim().toLowerCase());
}

export function stickerCatalogDefaults() {
  return manifest?.defaults && typeof manifest.defaults === 'object' ? manifest.defaults : {};
}

export function stickerCatalogItems() {
  return stickers;
}

export function stickerIntentGuideText() {
  const grouped = new Map();
  for (const sticker of stickers) {
    const family = String(sticker?.family || 'other').trim().toLowerCase() || 'other';
    if (!grouped.has(family)) grouped.set(family, []);
    grouped.get(family).push(sticker);
  }
  return [...grouped.entries()].map(([family, rows]) => {
    const entries = rows.map(sticker => {
      const id = String(sticker?.id || '').trim();
      const meaning = String(sticker?.meaning || '').replace(/\s+/g, ' ').trim();
      const useWhen = String(sticker?.useWhen || '').replace(/\s+/g, ' ').trim();
      return `${id} — ${meaning}; ${useWhen}`;
    }).join(' | ');
    return `[${family}] ${entries}`;
  }).join('\n');
}
