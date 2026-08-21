import { stickerCatalogDefaults } from './sticker-catalog.js';

export const STICKER_STATE_SCHEMA = 'rin-sticker-state-v2';
const MODES = new Set(['smart', 'always', 'off']);
const SERIOUS_SCENES = new Set(['practical_task', 'medical', 'financial', 'legal', 'crisis', 'conflict_repair']);
const EXPLICIT_GESTURE_RE = /(?:😘|💋|🤗|целу(?:ю|й|ет|ешь|ем|ют)|поцелу(?:й|и|ев|ями?)|обнима(?:ю|й|ет|ешь|ем|ют)|объя(?:тие|тия|тий|ть))/iu;

const clean = (value, max = 120) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};

function assistantTurns(history = []) {
  const turns = [];
  const byKey = new Map();
  for (const message of Array.isArray(history) ? history : []) {
    if (message?.role !== 'assistant' || !['complete', 'sent'].includes(message?.status || 'complete')) continue;
    const key = clean(message.turnId || message.requestId || message.id, 140);
    if (!key) continue;
    let turn = byKey.get(key);
    if (!turn) {
      turn = { key, stickerIds: [], stickerEmotions: [], hasSticker: false };
      byKey.set(key, turn);
      turns.push(turn);
    }
    if (message.kind === 'sticker' || message.sticker?.src) {
      turn.hasSticker = true;
      const id = clean(message.sticker?.id, 80);
      const emotion = clean(message.sticker?.emotion, 80);
      if (id) turn.stickerIds.push(id);
      if (emotion) turn.stickerEmotions.push(emotion);
    }
  }
  return turns;
}

function recentStickerSequence(turns = [], max = 12) {
  const out = [];
  for (let index = turns.length - 1; index >= 0 && out.length < max; index -= 1) {
    const ids = Array.isArray(turns[index]?.stickerIds) ? turns[index].stickerIds : [];
    for (let inner = ids.length - 1; inner >= 0 && out.length < max; inner -= 1) {
      if (ids[inner]) out.push(ids[inner]);
    }
  }
  return out;
}

function recentEmotionSequence(turns = [], max = 12) {
  const out = [];
  for (let index = turns.length - 1; index >= 0 && out.length < max; index -= 1) {
    const values = Array.isArray(turns[index]?.stickerEmotions) ? turns[index].stickerEmotions : [];
    for (let inner = values.length - 1; inner >= 0 && out.length < max; inner -= 1) {
      if (values[inner]) out.push(values[inner]);
    }
  }
  return out;
}

function turnsSinceLastSticker(turns = []) {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index]?.hasSticker) return turns.length - 1 - index;
  }
  return null;
}

function softPressure({ mode, targetFrequency, usedStickerTurns, effectiveWindowTurns, turnsSinceSticker, requiredGapTurns, explicitGesture }) {
  if (mode === 'always') return { frequencyPressure: 0, cooldownPressure: 0, desireModifier: 1.2 };
  if (mode === 'off' || targetFrequency <= 0) return { frequencyPressure: 1, cooldownPressure: 1, desireModifier: 0 };

  const observedFrequency = effectiveWindowTurns > 1
    ? usedStickerTurns / Math.max(1, effectiveWindowTurns - 1)
    : 0;
  const overshoot = Math.max(0, observedFrequency - targetFrequency);
  const frequencyPressure = clamp(overshoot / Math.max(0.1, targetFrequency), 0, 1, 0);
  const gap = turnsSinceSticker == null ? requiredGapTurns : turnsSinceSticker;
  const cooldownPressure = requiredGapTurns <= 0
    ? 0
    : clamp((requiredGapTurns - gap) / requiredGapTurns, 0, 1, 0);

  // Explicit kiss/hug context is allowed to override most ordinary fatigue because
  // the gesture is semantically anchored by the user, not decorative noise.
  const gestureRelief = explicitGesture ? 0.65 : 0;
  const combined = Math.max(0, Math.min(1, Math.max(frequencyPressure, cooldownPressure) - gestureRelief));
  const desireModifier = Math.max(0.18, 1 - combined * 0.72);
  return { frequencyPressure, cooldownPressure, desireModifier };
}

export async function buildStickerState({ history = [], preference = null, scene = 'everyday', userText = '' } = {}) {
  const defaults = await stickerCatalogDefaults();
  const mode = MODES.has(preference?.mode) ? preference.mode : 'smart';
  const targetPercent = clamp(preference?.probability, 0, 100, 30);
  const targetFrequency = targetPercent / 100;
  const safeMode = preference?.safeMode !== false;
  const rollingWindowTurns = Math.round(clamp(defaults.rollingWindowTurns, 4, 30, 10));
  const minGapTurns = Math.round(clamp(defaults.minGapAssistantTurns, 0, 8, 2));
  const explicitGestureMinGapTurns = Math.round(clamp(defaults.explicitGestureMinGapAssistantTurns, 0, 4, 0));
  const recentAssetWindow = Math.round(clamp(defaults.recentAssetWindow, 1, 20, 8));
  const turns = assistantTurns(history);
  const priorWindow = turns.slice(-Math.max(0, rollingWindowTurns - 1));
  const effectiveWindowTurns = Math.min(rollingWindowTurns, priorWindow.length + 1);
  const usedStickerTurns = priorWindow.filter(turn => turn.hasSticker).length;
  const limitStickerTurns = targetFrequency > 0 ? Math.max(1, Math.ceil(targetFrequency * effectiveWindowTurns - 1e-9)) : 0;
  const remainingStickerTurns = Math.max(0, limitStickerTurns - usedStickerTurns);
  const turnsSinceSticker = turnsSinceLastSticker(turns);
  const explicitGesture = EXPLICIT_GESTURE_RE.test(String(userText || ''));
  const requiredGapTurns = explicitGesture ? explicitGestureMinGapTurns : minGapTurns;
  const gapSatisfied = turnsSinceSticker == null || turnsSinceSticker >= requiredGapTurns;
  const safeBlocked = safeMode && SERIOUS_SCENES.has(clean(scene, 80));

  // V2 separates legacy scheduling availability from real technical permission.
  // `available` keeps the old deterministic budget/cooldown contract for backwards
  // compatibility and tests. `hardAvailable` is what Rin Mind uses to decide whether
  // a psychologically meaningful sticker is technically possible at all.
  let hardAvailable = true;
  let available = true;
  let reason = 'available';
  let hardReason = 'available';
  if (mode === 'off') {
    hardAvailable = false;
    available = false;
    reason = hardReason = 'disabled_by_user';
  } else if (safeBlocked) {
    hardAvailable = false;
    available = false;
    reason = hardReason = 'safe_mode_serious_scene';
  } else if (mode === 'smart' && targetFrequency <= 0) {
    hardAvailable = false;
    available = false;
    reason = hardReason = 'frequency_zero';
  } else if (mode === 'smart' && remainingStickerTurns <= 0) {
    available = false;
    reason = 'rolling_budget_exhausted';
    hardReason = 'soft_frequency_pressure';
  } else if (mode === 'smart' && !gapSatisfied) {
    available = false;
    reason = explicitGesture ? 'explicit_gesture_gap' : 'cooldown';
    hardReason = explicitGesture ? 'soft_explicit_gesture_gap' : 'soft_cooldown_pressure';
  } else if (mode === 'always') {
    reason = hardReason = 'always_available';
  }

  const pressure = softPressure({
    mode,
    targetFrequency,
    usedStickerTurns,
    effectiveWindowTurns,
    turnsSinceSticker,
    requiredGapTurns,
    explicitGesture
  });
  const basePropensity = mode === 'always' ? 1 : targetFrequency;
  const propensity = hardAvailable
    ? clamp(basePropensity * pressure.desireModifier + (explicitGesture ? 0.18 : 0), 0, 1, basePropensity)
    : 0;

  const recentAssetIds = recentStickerSequence(turns, recentAssetWindow);
  const recentEmotions = recentEmotionSequence(turns, recentAssetWindow);
  return {
    schema: STICKER_STATE_SCHEMA,
    mode,
    available,
    hardAvailable,
    reason,
    hardReason,
    safeMode,
    safeBlocked,
    scene: clean(scene, 80) || 'everyday',
    explicitGesture,
    targetPercent,
    targetFrequency,
    propensity,
    desireModifier: pressure.desireModifier,
    frequencyPressure: pressure.frequencyPressure,
    cooldownPressure: pressure.cooldownPressure,
    rollingWindowTurns,
    effectiveWindowTurns,
    usedStickerTurns,
    limitStickerTurns: mode === 'always' ? null : limitStickerTurns,
    remainingStickerTurns: mode === 'always' ? null : remainingStickerTurns,
    turnsSinceSticker,
    requiredGapTurns: mode === 'always' ? 0 : requiredGapTurns,
    gapSatisfied,
    recentAssetIds,
    recentEmotions
  };
}
