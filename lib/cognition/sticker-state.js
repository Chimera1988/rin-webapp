import { stickerCatalogDefaults } from './sticker-catalog.js';

export const STICKER_STATE_SCHEMA = 'rin-sticker-state-v1';
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

  let available = true;
  let reason = 'available';
  if (mode === 'off') {
    available = false;
    reason = 'disabled_by_user';
  } else if (safeBlocked) {
    available = false;
    reason = 'safe_mode_serious_scene';
  } else if (mode === 'smart' && targetFrequency <= 0) {
    available = false;
    reason = 'frequency_zero';
  } else if (mode === 'smart' && remainingStickerTurns <= 0) {
    available = false;
    reason = 'rolling_budget_exhausted';
  } else if (mode === 'smart' && !gapSatisfied) {
    available = false;
    reason = explicitGesture ? 'explicit_gesture_gap' : 'cooldown';
  } else if (mode === 'always') {
    reason = 'always_available';
  }

  const recentAssetIds = recentStickerSequence(turns, recentAssetWindow);
  const recentEmotions = recentEmotionSequence(turns, recentAssetWindow);
  return {
    schema: STICKER_STATE_SCHEMA,
    mode,
    available,
    reason,
    safeMode,
    safeBlocked,
    scene: clean(scene, 80) || 'everyday',
    explicitGesture,
    targetPercent,
    targetFrequency,
    rollingWindowTurns,
    effectiveWindowTurns,
    usedStickerTurns,
    limitStickerTurns: mode === 'always' ? null : limitStickerTurns,
    remainingStickerTurns: mode === 'always' ? null : remainingStickerTurns,
    turnsSinceSticker,
    requiredGapTurns: mode === 'always' ? 0 : requiredGapTurns,
    recentAssetIds,
    recentEmotions
  };
}
