import { stickerCatalogItems } from './sticker-catalog.js';

const clean = (value, max = 1200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const lower = value => clean(value, 2400).toLowerCase().replace(/ё/gu, 'е');

function tokens(value = '') {
  return new Set(lower(value)
    .split(/[^\p{L}\p{N}_-]+/u)
    .map(token => token.replace(/[_-]+/gu, ''))
    .filter(token => token.length >= 4));
}

function targetHints({ userText = '', state = null, brain = null, affectiveTurn = null } = {}) {
  const primary = lower(
    affectiveTurn?.emotionalState?.primary?.type
      || state?.emotion?.primary?.type
      || state?.emotion?.type
      || ''
  );
  const secondary = lower(
    affectiveTurn?.emotionalState?.secondary?.type
      || state?.emotion?.secondary?.type
      || ''
  );
  const scene = lower(brain?.activeScene?.type || state?.scene?.type || 'everyday');
  const hidden = lower(brain?.hiddenIntent?.type || '');
  const literal = lower(brain?.literalIntent || '');
  const cue = lower([userText, primary, secondary, scene, hidden, literal].join(' '));

  const hints = new Set();
  const add = (...values) => values.filter(Boolean).forEach(value => hints.add(value));

  if (/(affection|tender|warmth|romance|seekcloseness|близ|люб|неж|скуч)/u.test(cue)) add('tender', 'kiss', 'hug', 'affection', 'close');
  if (/(kiss|целу|😘|💋)/u.test(cue)) add('kiss', 'tender');
  if (/(hug|обним|🤗)/u.test(cue)) add('hug', 'care', 'tender');
  if (/(gratitude|спасибо|благодар)/u.test(cue)) add('gratitude', 'touched');
  if (/(care|distress|support|груст|тяжел|плохо|устал|тревог|поддерж)/u.test(cue)) add('care', 'comfort', 'reassure', 'listening');
  if (/(playful|flirt|tease|challenge|игрив|флирт|дразн|😏|😉)/u.test(cue)) add('playful', 'tease', 'flirt', 'smirk', 'wink');
  if (/(shy|shyness|смущ|красне)/u.test(cue)) add('blush', 'shy', 'tender');
  if (/(jealous|ревност)/u.test(cue)) add('jealous', 'irritation', 'playful');
  if (/(hurt|irritation|disrespect|обид|зл|раздраж)/u.test(cue)) add('hurt', 'irritation', 'angry', 'upset');
  if (/(repair|apology|прости|извини)/u.test(cue)) add('apology', 'relief', 'tender');
  if (/(joy|ура|получилось|побед|радост)/u.test(cue)) add('joy', 'celebrate', 'proud');
  if (/(greeting|привет|доброе утро|добрый вечер)/u.test(cue)) add('greeting', 'wave', 'smile');
  if (/(farewell|спокойной ночи|пока|до завтра)/u.test(cue)) add('goodnight', 'farewell', 'kiss');
  if (/(agreement|ага|угу|соглас|ладно)/u.test(cue)) add('agreement', 'approval', 'smile');

  // Everyday messenger fallback: offer neutral warm/playful gestures without making them mandatory.
  if (!hints.size && scene === 'everyday') add('smile', 'tender', 'playful', 'agreement');
  return { hints, cue };
}

function descriptor(sticker = {}) {
  return lower([
    sticker.id,
    sticker.family,
    sticker.emotion,
    sticker.meaning,
    sticker.useWhen
  ].join(' '));
}

export function buildStickerCandidates({ userText = '', state = null, brain = null, affectiveTurn = null, limit = 12 } = {}) {
  const catalog = stickerCatalogItems();
  const recent = new Set((Array.isArray(state?.stickerState?.recentAssetIds) ? state.stickerState.recentAssetIds : []).map(lower));
  const { hints, cue } = targetHints({ userText, state, brain, affectiveTurn });
  const cueTokens = tokens(cue);

  const scored = (Array.isArray(catalog) ? catalog : []).map((sticker, index) => {
    const text = descriptor(sticker);
    let score = 0;
    for (const hint of hints) {
      if (text.includes(hint)) score += 9;
    }
    for (const token of cueTokens) {
      if (text.includes(token)) score += 2;
    }
    if (recent.has(lower(sticker?.id))) score -= 3;
    if (/soft|smile|warm|tender/u.test(lower(sticker?.id)) && !hints.size) score += 1;
    return { sticker, score, index };
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const max = Math.max(4, Math.min(16, Number(limit) || 12));
  return scored.slice(0, max).map(({ sticker, score }) => ({
    id: clean(sticker?.id, 80),
    family: clean(sticker?.family, 60),
    emotion: clean(sticker?.emotion, 80),
    meaning: clean(sticker?.meaning, 220),
    useWhen: clean(sticker?.useWhen, 320),
    score
  })).filter(item => item.id);
}

export function stickerCandidateGuide(candidates = []) {
  return (Array.isArray(candidates) ? candidates : []).slice(0, 16).map(item =>
    `${item.id} — ${item.meaning || item.emotion || item.family}${item.useWhen ? `; ${item.useWhen}` : ''}`
  ).join('\n');
}
