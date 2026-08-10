import { readFile } from 'node:fs/promises';

const STICKER_CONFIG_URL = new URL('../../public/data/stickers-v6.json', import.meta.url);
const clean = (value, max = 200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
let cached = null;

const INTENT_ALIASES = {
  tender: ['shy_warmth', 'warm_smile', 'support'],
  warmth: ['warm_smile', 'smile', 'shy_warmth'],
  kiss: ['kiss', 'tender_kiss', 'playful_kiss'],
  tender_kiss: ['tender_kiss', 'kiss'],
  playful_kiss: ['playful_kiss', 'kiss'],
  hug: ['hug', 'support'],
  flirt: ['flirt', 'shy_warmth', 'invitation'],
  playful: ['flirt', 'smile', 'shy'],
  shy: ['shy', 'shy_warmth', 'shy_pride'],
  jealousy: ['jealousy', 'annoyance'],
  joy: ['joy', 'warm_smile'],
  gratitude: ['warm_smile', 'smile'],
  curiosity: ['curiosity', 'warm_interest'],
  thoughtful: ['thoughtful', 'pensive'],
  fatigue: ['fatigue', 'pensive'],
  support: ['support', 'hope'],
  regret: ['regret', 'deep_regret'],
  annoyance: ['annoyance', 'frustration'],
  surprise: ['surprise', 'surprise_curiosity'],
  agreement: ['agreement', 'smile'],
  neutral: ['neutral', 'smile']
};

export async function loadStickerManifest({ fresh = false } = {}) {
  if (!fresh && cached) return cached;
  cached = JSON.parse(await readFile(STICKER_CONFIG_URL, 'utf8'));
  return cached;
}

async function resolveStickerAsset(intent = '') {
  const config = await loadStickerManifest();
  const wanted = clean(intent, 80).toLowerCase().replace(/\s+/g, '_');
  if (!wanted) return null;
  const aliases = [wanted, ...(INTENT_ALIASES[wanted] || [])];
  return aliases.map(name => (config.stickers || []).find(item => item.id === name || item.emotion === name)).find(Boolean) || null;
}

export async function isStickerIntentResolvable(intent = '') {
  return Boolean(await resolveStickerAsset(intent));
}

export async function selectStickerForIntent(intent = '', { delivery = 'sticker_only', scene = '', cause = null, intensity = 50 } = {}) {
  const sticker = await resolveStickerAsset(intent);
  if (!sticker) return null;
  // Delivery semantics belong to TurnDecision. The selector resolves only
  // semantic sticker intent to an existing asset and never vetoes/replans it.
  const supportedDelivery = clean(delivery, 40) || 'sticker_only';
  return {
    preferredStickerId: sticker.id,
    sticker: {
      id: sticker.id,
      src: sticker.src,
      emotion: sticker.emotion,
      meaning: sticker.meaning,
      utterance: sticker.utterances?.[0] || null
    },
    delivery: supportedDelivery,
    emotion: sticker.emotion,
    meaning: sticker.meaning,
    cause: clean(cause, 280) || null,
    intensity: Math.max(0, Math.min(100, Number(intensity) || 50)),
    scene: clean(scene, 100) || null,
    standalone: supportedDelivery === 'sticker_only',
    expiresAfterTurns: Number(sticker.followUp?.maxTurns || 0),
    canExplain: sticker.followUp?.canExplain !== false
  };
}
