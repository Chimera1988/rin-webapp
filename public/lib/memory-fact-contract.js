// Shared validation for existing fact storage/extraction. Never traverse prototypes.
const SECRET_PATH = /(?:password|passwd|api[_-]?key|secret|token|credential|access[_-]?pin|private[_-]?key)/iu;
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
export function factPathParts(value, { userOnly = false } = {}) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 240) return [];
  const parts = text.split('.');
  if (parts.length < 2 || parts.length > 10 || !['user', 'self', 'world'].includes(parts[0])) return [];
  if (userOnly && parts[0] !== 'user') return [];
  if (parts.some(part => !/^[a-zA-Z0-9_-]+$/u.test(part) || RESERVED.has(part) || SECRET_PATH.test(part))) return [];
  return parts;
}
