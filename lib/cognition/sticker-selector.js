import { stickerCatalogItems } from './sticker-catalog.js';

const clean = (value, max = 200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

async function resolveStickerAsset(intent = '') {
  const wanted = clean(intent, 80).toLowerCase().replace(/\s+/g, '_');
  if (!wanted) return null;
  const stickers = await stickerCatalogItems();
  return stickers.find(sticker => clean(sticker?.id, 80).toLowerCase() === wanted) || null;
}

export async function isStickerIntentResolvable(intent = '') {
  return Boolean(await resolveStickerAsset(intent));
}

export async function selectStickerForIntent(intent = '', {
  delivery = 'sticker_only', scene = '', cause = null, intensity = 50
} = {}) {
  const sticker = await resolveStickerAsset(intent);
  if (!sticker) return null;
  // Delivery semantics belong to TurnDecision. The selector performs only an
  // exact semantic-intent -> asset lookup and never rotates, aliases or replans.
  const supportedDelivery = clean(delivery, 40) || 'sticker_only';
  return {
    preferredStickerId: sticker.id,
    sticker: {
      id: sticker.id,
      src: sticker.src,
      emotion: sticker.emotion,
      meaning: sticker.meaning,
      utterance: null
    },
    delivery: supportedDelivery,
    emotion: sticker.emotion,
    meaning: sticker.meaning,
    cause: clean(cause, 280) || null,
    intensity: Math.max(0, Math.min(100, Number(intensity) || 50)),
    scene: clean(scene, 100) || null,
    standalone: supportedDelivery === 'sticker_only',
    expiresAfterTurns: 1,
    canExplain: true,
    selection: {
      strategy: 'exact_semantic_intent',
      candidateCount: 1
    }
  };
}
