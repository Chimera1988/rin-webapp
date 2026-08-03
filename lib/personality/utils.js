import { isTextTurn } from '../chat-contract.js';

export const clamp = (value, min = 0, max = 100) =>
  Math.max(min, Math.min(max, Math.round(Number(value) || 0)));

export const textOf = value => String(value || '').trim();

export function hashText(value = '') {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function pickStable(items = [], seed = '') {
  if (!items.length) return null;
  return items[hashText(seed) % items.length];
}

export function assistantTurns(history = []) {
  return history.filter(item => item?.role === 'assistant' && isTextTurn(item));
}

export function recentText(history = [], limit = 8) {
  return history.filter(isTextTurn).slice(-limit).map(item => textOf(item?.content)).join('\n');
}

export function averageRecentLength(history = [], limit = 4) {
  const turns = assistantTurns(history).slice(-limit);
  if (!turns.length) return 0;
  return Math.round(turns.reduce((sum, item) => sum + textOf(item.content).length, 0) / turns.length);
}

export function countRecentQuestions(history = [], limit = 4) {
  return assistantTurns(history)
    .slice(-limit)
    .filter(item => /\?\s*$/.test(textOf(item.content))).length;
}
