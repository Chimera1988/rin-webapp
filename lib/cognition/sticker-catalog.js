import { readFile } from 'node:fs/promises';

const STICKER_CONFIG_URL = new URL('../../public/data/stickers-v7.json', import.meta.url);
let cached = null;

async function loadStickerManifest({ fresh = false } = {}) {
  if (!fresh && cached) return cached;
  const parsed = JSON.parse(await readFile(STICKER_CONFIG_URL, 'utf8'));
  cached = parsed && typeof parsed === 'object' ? parsed : { defaults: {}, stickers: [] };
  return cached;
}

export async function stickerCatalogDefaults() {
  const manifest = await loadStickerManifest();
  return manifest?.defaults && typeof manifest.defaults === 'object' ? manifest.defaults : {};
}

export async function stickerCatalogItems() {
  const manifest = await loadStickerManifest();
  return Array.isArray(manifest?.stickers) ? manifest.stickers : [];
}
