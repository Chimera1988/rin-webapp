// Canonical semantic vocabulary for TurnDecision sticker intent.
// The Cognitive Kernel chooses one of these semantic intents; StickerSelector
// only resolves that intent to a concrete existing asset.
export const STICKER_INTENT_ALIASES = Object.freeze({
  tender: Object.freeze(['shy_warmth', 'warm_smile', 'support']),
  warmth: Object.freeze(['warm_smile', 'smile', 'shy_warmth']),
  kiss: Object.freeze(['kiss', 'tender_kiss', 'playful_kiss']),
  tender_kiss: Object.freeze(['tender_kiss', 'kiss']),
  playful_kiss: Object.freeze(['playful_kiss', 'kiss']),
  hug: Object.freeze(['hug', 'support']),
  flirt: Object.freeze(['flirt', 'shy_warmth', 'invitation']),
  playful: Object.freeze(['flirt', 'smile', 'shy']),
  shy: Object.freeze(['shy', 'shy_warmth', 'shy_pride']),
  jealousy: Object.freeze(['jealousy', 'annoyance']),
  joy: Object.freeze(['joy', 'warm_smile']),
  gratitude: Object.freeze(['warm_smile', 'smile']),
  curiosity: Object.freeze(['curiosity', 'warm_interest']),
  thoughtful: Object.freeze(['thoughtful', 'pensive']),
  fatigue: Object.freeze(['fatigue', 'pensive']),
  support: Object.freeze(['support', 'hope']),
  regret: Object.freeze(['regret', 'deep_regret']),
  annoyance: Object.freeze(['annoyance', 'frustration']),
  surprise: Object.freeze(['surprise', 'surprise_curiosity']),
  agreement: Object.freeze(['agreement', 'smile']),
  neutral: Object.freeze(['neutral', 'smile'])
});

export const STICKER_INTENT_VALUES = Object.freeze(Object.keys(STICKER_INTENT_ALIASES));

export function isSupportedStickerIntent(value = '') {
  return STICKER_INTENT_VALUES.includes(String(value || '').trim().toLowerCase());
}
