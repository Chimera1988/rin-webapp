import { STICKER_INTENT_ALIASES } from './sticker-intents.js';
import { stickerCatalogItems } from './sticker-catalog.js';

const clean = (value, max = 200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function hashUnit(value = '') {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function candidateRows(stickers = [], intent = '') {
  const wanted = clean(intent, 80).toLowerCase().replace(/\s+/g, '_');
  if (!wanted) return [];
  const aliases = [wanted, ...(STICKER_INTENT_ALIASES[wanted] || [])];
  const aliasRank = new Map(aliases.map((name, index) => [name, index]));
  const rows = [];
  for (const sticker of Array.isArray(stickers) ? stickers : []) {
    const id = clean(sticker?.id, 80).toLowerCase();
    const emotion = clean(sticker?.emotion, 80).toLowerCase();
    const directIntents = Array.isArray(sticker?.intents)
      ? sticker.intents.map(value => clean(value, 80).toLowerCase()).filter(Boolean)
      : [];
    const direct = directIntents.includes(wanted);
    const matching = [id, emotion].filter(value => aliasRank.has(value));
    if (!direct && !matching.length) continue;
    rows.push({
      sticker,
      aliasRank: direct ? 0 : Math.min(...matching.map(value => aliasRank.get(value))),
      exact: direct || id === wanted || emotion === wanted
    });
  }
  return rows;
}

function scoreCandidate(row, { recentStickerIds = [], scene = '', intensity = 50, rotationSeed = '' } = {}, catalogById = new Map()) {
  const sticker = row.sticker;
  const id = clean(sticker.id, 80);
  let score = Number(sticker.weight) || 1;
  score += row.exact ? 0.28 : 0;
  score -= row.aliasRank * 0.14;

  const normalizedScene = clean(scene, 100);
  if (normalizedScene && Array.isArray(sticker.scenes)) {
    score += sticker.scenes.includes(normalizedScene) ? 0.24 : -0.08;
  }

  const level = 1 + Math.max(0, Math.min(100, Number(intensity) || 50)) / 25;
  const min = Number(sticker.minIntensity) || 1;
  const max = Number(sticker.maxIntensity) || 5;
  if (level >= min && level <= max) score += 0.12;
  else score -= Math.min(0.36, Math.min(Math.abs(level - min), Math.abs(level - max)) * 0.08);

  const recent = Array.isArray(recentStickerIds) ? recentStickerIds.map(value => clean(value, 80)).filter(Boolean) : [];
  const exactIndex = recent.indexOf(id);
  if (exactIndex === 0) score -= 100;
  else if (exactIndex === 1) score -= 2.4;
  else if (exactIndex === 2) score -= 1.4;
  else if (exactIndex >= 3 && exactIndex <= 5) score -= 0.55;
  else if (exactIndex >= 6) score -= 0.18;

  const lastSticker = catalogById.get(recent[0]);
  if (lastSticker?.family && sticker.family && lastSticker.family === sticker.family && lastSticker.id !== id) score -= 0.32;

  // Tiny deterministic rotation term prevents fixed first-match selection while
  // preserving semantic score dominance and reproducibility for a given turn.
  score += hashUnit(`${rotationSeed}|${id}`) * 0.07;
  return score;
}

async function resolveStickerAsset(intent = '', options = {}) {
  const stickers = await stickerCatalogItems();
  const candidates = candidateRows(stickers, intent);
  if (!candidates.length) return null;
  const catalogById = new Map(stickers.map(sticker => [clean(sticker.id, 80), sticker]));
  const scored = candidates
    .map(row => ({ ...row, score: scoreCandidate(row, options, catalogById) }))
    .sort((a, b) => b.score - a.score || String(a.sticker.id).localeCompare(String(b.sticker.id)));
  return { selected: scored[0]?.sticker || null, candidates: scored };
}


export async function isStickerIntentResolvable(intent = '') {
  return Boolean((await resolveStickerAsset(intent))?.selected);
}

export async function selectStickerForIntent(intent = '', {
  delivery = 'sticker_only', scene = '', cause = null, intensity = 50,
  recentStickerIds = [], rotationSeed = ''
} = {}) {
  const resolved = await resolveStickerAsset(intent, { recentStickerIds, scene, intensity, rotationSeed });
  const sticker = resolved?.selected || null;
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
    canExplain: sticker.followUp?.canExplain !== false,
    selection: {
      strategy: 'semantic_rank_with_recent_rotation',
      candidateCount: resolved.candidates.length,
      recentAssetIds: (Array.isArray(recentStickerIds) ? recentStickerIds : []).slice(0, 8),
      selectedScore: Number(resolved.candidates[0]?.score?.toFixed?.(4) ?? resolved.candidates[0]?.score ?? 0)
    }
  };
}
