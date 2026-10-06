const clean = (value, max = 600) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const clamp = (value, min = 0, max = 100, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
};
const uniq = (items = [], max = 12, maxLen = 120) => [...new Set((Array.isArray(items) ? items : [])
  .map(item => clean(item, maxLen))
  .filter(Boolean))].slice(0, max);

const STOP = new Set('и в во на но а я ты он она мы вы это как что к у из за по для не да же ли или про мне тебя мой моя твой твоя сейчас просто очень уже еще её его наш наша ваш ваша'.split(' '));
function stem(token = '') {
  const value = String(token).toLowerCase().replace(/ё/g, 'е');
  if (value.length < 6) return value;
  return value.replace(/(?:иями|ями|ами|ого|его|ому|ему|иях|ах|ях|ой|ей|ую|юю|ов|ев|ом|ем|ам|ям|ы|и|а|я|у|ю|е)$/u, '');
}
function tokens(value = '') {
  return clean(value, 6000).toLowerCase().match(/[а-яёa-z0-9]{3,}/giu)
    ?.filter(item => !STOP.has(item))
    .map(stem)
    .filter(item => item.length >= 3) || [];
}
function overlap(a = '', b = '') {
  const left = new Set(tokens(a));
  let score = 0;
  for (const token of tokens(b)) if (left.has(token)) score += token.length > 6 ? 2 : 1;
  return score;
}
function normalizeId(value = '') {
  const id = clean(value, 80).toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return id || null;
}

export function normalizeSharedSymbol(input = {}) {
  if (!input || typeof input !== 'object') return null;
  const id = normalizeId(input.id || input.key || input.label);
  const label = clean(input.label || input.name || id, 80);
  const meaning = clean(input.meaning || input.description, 520);
  if (!id || !label || !meaning) return null;
  return {
    id,
    label,
    scope: clean(input.scope, 40) || 'relationship_private',
    privacy: clean(input.privacy, 40) || 'private',
    origin: clean(input.origin, 320) || 'shared_history',
    meaning,
    aliases: uniq(input.aliases, 8, 80),
    associations: uniq(input.associations, 12, 120),
    fitMotifs: uniq(input.fitMotifs || input.fit_motifs, 10, 60),
    fitEmotions: uniq(input.fitEmotions || input.fit_emotions, 10, 60),
    fitMomentum: uniq(input.fitMomentum || input.fit_momentum, 6, 40),
    manifestations: uniq(input.manifestations, 8, 240),
    avoid: uniq(input.avoid, 8, 240),
    salience: clamp(input.salience ?? input.importance * 10, 0, 100, 55),
    minCloseness: clamp(input.minCloseness ?? input.min_closeness, 0, 100, 45),
    updatedAt: Number.isFinite(Number(input.updatedAt ?? input.ts)) ? Number(input.updatedAt ?? input.ts) : 0
  };
}

function mergeSymbol(base, overlay) {
  if (!base) return overlay;
  if (!overlay) return base;
  return normalizeSharedSymbol({
    ...base,
    ...overlay,
    id: base.id,
    label: overlay.label || base.label,
    origin: overlay.origin || base.origin,
    meaning: overlay.meaning || base.meaning,
    aliases: uniq([...(base.aliases || []), ...(overlay.aliases || [])], 8, 80),
    associations: uniq([...(base.associations || []), ...(overlay.associations || [])], 12, 120),
    fitMotifs: uniq([...(base.fitMotifs || []), ...(overlay.fitMotifs || [])], 10, 60),
    fitEmotions: uniq([...(base.fitEmotions || []), ...(overlay.fitEmotions || [])], 10, 60),
    fitMomentum: uniq([...(base.fitMomentum || []), ...(overlay.fitMomentum || [])], 6, 40),
    manifestations: uniq([...(base.manifestations || []), ...(overlay.manifestations || [])], 8, 240),
    avoid: uniq([...(base.avoid || []), ...(overlay.avoid || [])], 8, 240),
    salience: Math.max(base.salience || 0, overlay.salience || 0),
    minCloseness: overlay.minCloseness ?? base.minCloseness,
    updatedAt: Math.max(base.updatedAt || 0, overlay.updatedAt || 0)
  });
}

export function collectSharedSymbols({ profile = null, memory = null } = {}) {
  const canonical = Array.isArray(profile?.prompt_profile?.relationship?.shared_symbols)
    ? profile.prompt_profile.relationship.shared_symbols
    : [];
  const remembered = Array.isArray(memory?.relationship?.sharedSymbols)
    ? memory.relationship.sharedSymbols
    : [];
  const map = new Map();
  for (const raw of canonical) {
    const symbol = normalizeSharedSymbol(raw);
    if (symbol) map.set(symbol.id, symbol);
  }
  for (const raw of remembered) {
    const symbol = normalizeSharedSymbol(raw);
    if (!symbol) continue;
    map.set(symbol.id, mergeSymbol(map.get(symbol.id), symbol));
  }
  return [...map.values()].filter(item => item.scope === 'relationship_private' || item.privacy === 'private').slice(0, 12);
}

function aliasMatch(symbol, text = '') {
  const haystack = clean(text, 6000).toLowerCase().replace(/ё/g, 'е');
  if (!haystack) return false;
  const aliases = [symbol.label, ...(symbol.aliases || [])]
    .map(item => clean(item, 80).toLowerCase().replace(/ё/g, 'е'))
    .filter(item => item.length >= 3);
  return aliases.some(alias => haystack.includes(alias));
}

function recentDialogueText(history = [], limit = 6) {
  return (Array.isArray(history) ? history : [])
    .filter(item => ['user', 'assistant'].includes(item?.role) && item?.content)
    .slice(-limit)
    .map(item => clean(item.content, 700))
    .join(' ');
}

function repetitionFor(symbolId, recent = []) {
  const rows = (Array.isArray(recent) ? recent : []).filter(item => clean(item?.id, 80) === symbolId);
  let streak = 0;
  const list = Array.isArray(recent) ? recent : [];
  for (let index = list.length - 1; index >= 0 && clean(list[index]?.id, 80) === symbolId; index -= 1) streak += 1;
  const count = rows.length;
  return {
    count,
    streak,
    pressure: clamp(count * 18 + Math.max(0, streak - 1) * 22, 0, 100)
  };
}

export function inspectSharedSymbols({
  profile = null,
  memory = null,
  userText = '',
  history = [],
  brain = null,
  affectiveTurn = null,
  dialogueState = null,
  activeIntent = null
} = {}) {
  const symbols = collectSharedSymbols({ profile, memory });
  const relationship = affectiveTurn?.relationshipState || memory?.relationship || {};
  const emotion = clean(affectiveTurn?.emotionalState?.primary?.type, 60).toLowerCase();
  const momentum = clean(affectiveTurn?.emotionalState?.momentum?.direction, 40).toLowerCase();
  const recentMotifs = (Array.isArray(dialogueState?.recentMotifs) ? dialogueState.recentMotifs : []).slice(-4).map(item => clean(item, 60).toLowerCase());
  const recentUses = (Array.isArray(dialogueState?.recentSharedSymbols) ? dialogueState.recentSharedSymbols : []).slice(-8);
  const recentText = recentDialogueText(history, 6);
  const sceneText = [
    userText,
    brain?.activeScene?.type,
    brain?.activeScene?.topic,
    brain?.hiddenIntent?.type,
    activeIntent?.goal,
    activeIntent?.target,
    emotion,
    momentum,
    ...recentMotifs
  ].filter(Boolean).join(' ');

  const closeness = clamp(relationship?.closeness, 0, 100, 42);
  const playfulness = clamp(relationship?.playfulness, 0, 100, 45);
  const attraction = clamp(relationship?.attraction, 0, 100, 34);

  const candidates = [];
  for (const symbol of symbols) {
    if (closeness < symbol.minCloseness) continue;
    const directRecall = aliasMatch(symbol, userText);
    const recentRecall = !directRecall && aliasMatch(symbol, recentText);
    const repetition = repetitionFor(symbol.id, recentUses);
    const semanticText = [symbol.meaning, ...(symbol.associations || [])].join(' ');
    const semanticOverlap = overlap(sceneText, semanticText);
    const motifFit = recentMotifs.filter(item => symbol.fitMotifs.includes(item)).length;
    const emotionFit = Boolean(emotion && symbol.fitEmotions.includes(emotion));
    const momentumFit = Boolean(momentum && symbol.fitMomentum.includes(momentum));

    let activation = Math.round(symbol.salience * 0.2);
    if (closeness >= symbol.minCloseness) activation += 8;
    if (playfulness >= 55) activation += Math.min(10, Math.round((playfulness - 45) / 3));
    if (attraction >= 50) activation += 4;
    activation += Math.min(18, semanticOverlap * 3);
    activation += Math.min(20, motifFit * 10);
    if (emotionFit) activation += 14;
    if (momentumFit) activation += 10;
    if (directRecall) activation += 38;
    else if (recentRecall) activation += 8;

    // Repetition suppresses self-initiated callbacks. Direct user invocation remains available,
    // but still does not force the symbol to become the whole scene.
    const repetitionPenalty = directRecall ? Math.round(repetition.pressure * 0.2) : Math.round(repetition.pressure * 0.65);
    activation = clamp(activation - repetitionPenalty, 0, 100);

    if (activation < 40 && !directRecall) continue;
    candidates.push({
      id: symbol.id,
      label: symbol.label,
      meaning: symbol.meaning,
      origin: symbol.origin,
      activation,
      directRecall,
      recentRecall,
      repetitionPressure: repetition.pressure,
      manifestations: symbol.manifestations.slice(0, 5),
      avoid: symbol.avoid.slice(0, 5)
    });
  }

  candidates.sort((a, b) => b.activation - a.activation);
  return {
    schema: 'rin-shared-symbols-v1',
    candidates: candidates.slice(0, 2),
    recentUses,
    guidance: candidates.length
      ? 'Это приватные ассоциации отношений, а не режимы и не триггеры. Даже высокая activation означает только доступность образа: Рин может не использовать его. Самостоятельный callback уместен лишь как естественный следующий ход текущей сцены; repetitionPressure снижает явные повторы.'
      : 'Сейчас ни один приватный символ отношений не достаточно релевантен для самостоятельного callback.'
  };
}
