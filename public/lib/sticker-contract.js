export const STICKER_SCHEMA = 'v7';
export const STICKER_STORE_KEY = 'rin-stickers-v7-stats';
export const STICKER_DELIVERIES = Object.freeze(['sticker_only', 'before_text', 'after_text']);

const clean = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
export const stickerIdFromSrc = src => clean(src).split('/').pop()?.replace(/\.webp$/i, '') || '';
export const isAllowedStickerSrc = src => /^\/stickers\/[a-z0-9_]+\.webp$/i.test(clean(src));

export function semanticStickerText(sticker = {}) {
  const meaning = clean(sticker.meaning || sticker.emotion || sticker.family || 'эмоциональный жест', 240);
  const cause = clean(sticker.cause || '', 280);
  const utterance = clean(sticker.utterance || '', 120);
  return `[Невербальный жест Рин: ${meaning}${cause ? `; причина: ${cause}` : ''}${utterance ? `; подпись: «${utterance}»` : ''}]`;
}

export function validateStickerConfig(config, availablePaths = null) {
  const errors = [];
  if (!config || config._schema !== STICKER_SCHEMA) errors.push(`schema must be ${STICKER_SCHEMA}`);
  if (config?.defaults?.semanticContract !== 'sticker-emotion-v3') errors.push('semanticContract must be sticker-emotion-v3');
  if (config?.defaults?.selectionMode !== 'exact_semantic_intent') errors.push('selectionMode must be exact_semantic_intent');
  if (!Array.isArray(config?.stickers) || config.stickers.length !== 100) errors.push('manifest must contain exactly 100 stickers');
  const ids = new Set();
  const srcs = new Set();
  for (const sticker of config?.stickers || []) {
    const id = clean(sticker.id || stickerIdFromSrc(sticker.src), 80);
    if (!id || ids.has(id)) errors.push(`duplicate or missing id: ${id || '(empty)'}`);
    ids.add(id);
    if (!isAllowedStickerSrc(sticker.src) || srcs.has(sticker.src)) errors.push(`invalid or duplicate src: ${sticker.src}`);
    srcs.add(sticker.src);
    if (id && stickerIdFromSrc(sticker.src) !== id) errors.push(`${id}: src basename must equal semantic id`);
    if (availablePaths && !availablePaths.has(sticker.src)) errors.push(`missing asset: ${sticker.src}`);
    if (!clean(sticker.family, 80)) errors.push(`${id}: family is required`);
    if (!clean(sticker.emotion, 80)) errors.push(`${id}: emotion is required`);
    if (!clean(sticker.meaning, 240)) errors.push(`${id}: meaning is required`);
    if (!clean(sticker.useWhen, 500)) errors.push(`${id}: useWhen is required`);
    if ('intents' in sticker) errors.push(`${id}: intents is obsolete; id is the canonical semantic intent`);
  }
  return { ok: errors.length === 0, errors };
}

export function normalizeStickerEvent(value = {}) {
  const src = clean(value.src, 500);
  if (!isAllowedStickerSrc(src)) return null;
  return {
    id: clean(value.id || stickerIdFromSrc(src), 80),
    src,
    emotion: clean(value.emotion, 80) || 'emotion',
    meaning: clean(value.meaning, 240) || clean(value.emotion, 80) || 'эмоциональный жест',
    cause: clean(value.cause, 280) || null,
    utterance: clean(value.utterance, 120) || null,
    delivery: STICKER_DELIVERIES.includes(value.delivery) ? value.delivery : 'after_text',
    intensity: Math.max(0, Math.min(100, Number(value.intensity) || 50)),
    canExplain: value.canExplain !== false,
    expiresAfterTurns: Math.max(0, Math.min(8, Number(value.expiresAfterTurns) || 0))
  };
}
