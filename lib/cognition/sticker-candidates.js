import { stickerCatalogItems } from './sticker-catalog.js';

const clean = (value, max = 1200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const lower = value => clean(value, 2400).toLowerCase().replace(/ё/gu, 'е');

function tokens(value = '') {
  return new Set(lower(value)
    .split(/[^\p{L}\p{N}_-]+/u)
    .map(token => token.replace(/[_-]+/gu, ''))
    .filter(token => token.length >= 4));
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

// Candidate retrieval is not the personality decision. It only decides which
// examples Rin Mind sees first. Separate the immediate beat from the long-lived
// scene so a romantic backdrop cannot drown out curiosity, humor or reflection.
function reactionSignals({ userText = '', state = null, brain = null, affectiveTurn = null } = {}) {
  const familyScores = new Map();
  const idScores = new Map();
  const add = (family, score) => familyScores.set(family, Math.max(score, familyScores.get(family) || 0));
  const exact = (id, score) => idScores.set(id, Math.max(score, idScores.get(id) || 0));

  function observe(value, strength, source = 'rin') {
    const cue = lower(value);
    if (!cue) return;
    const weight = Math.max(1, strength);
    const user = source === 'user';
    const mark = (family, fraction = 1) => add(family, Math.round(weight * fraction));

    // A broad sense of warmth or romance does not imply a kiss or an embrace.
    // Those gestures need their own immediate signal or Rin Mind's decision.
    if (/(?:love|romance|affection|tender|warmth|seek_?closeness|близ|люб(?!опыт)|неж|скуч)/u.test(cue)) {
      mark('tender');
      mark('love', 0.65);
    }
    if (/(?:kiss|целу|поцелу|😘|💋)/u.test(cue)) { mark('kiss'); mark('tender', 0.32); }
    if (/(?:hug|обним|объя|🤗)/u.test(cue)) { mark('hug'); mark('care', 0.22); }
    if (/(?:flirt|флирт|заигрыв|соблазн)/u.test(cue)) { mark('flirt'); mark('playful', 0.40); }
    if (/(?:playful|tease|mischief|playfulness|игрив|дразн|шут|озор|смешн|хаха|ахах|😁|😜)/u.test(cue)) {
      mark('playful');
    }
    if (/(?:curios|intrigu|interest|surpris|wonder|интерес|любопыт|интриг|удив|неожидан|ничего себе|(?:^|[^\p{L}])ого(?=$|[^\p{L}]))/u.test(cue)) {
      mark('curiosity');
      mark('thoughtful', 0.22);
      if (/(?:surpris|удив|неожидан|ничего себе|(?:^|[^\p{L}])ого(?=$|[^\p{L}]))/u.test(cue)) exact('curious_surprised', weight * 0.34);
    }
    if (/(?:thought|reflect|pensive|contemplat|задум|размыш|обдум|хм+|мнение)/u.test(cue)) {
      mark('thoughtful');
      mark('curiosity', 0.24);
    }
    if (/(?:listen|attention|внимател|слушаю|расскажи подробнее)/u.test(cue)) mark('curiosity', 0.85);
    if (/(?:joy|delight|happy|celebrat|радост|(?:^|[^\p{L}])ура(?=$|[^\p{L}])|побед|получилось|восторг)/u.test(cue)) mark('joy');
    if (/(?:gratitude|grateful|благодар|спасибо)/u.test(cue)) mark('gratitude');
    if (/(?:support|care|comfort|reassur|distress|тяжело|тревог|поддерж|плохо)/u.test(cue)) mark('care');
    if (/(?:shy|shyness|blush|смущ|красне)/u.test(cue)) { mark('tender'); mark('playful', 0.30); }
    if (/(?:jealous|ревност)/u.test(cue)) mark('jealousy');
    if (/(?:hurt|irritat|angry|disrespect|обид|злост|раздраж|расстро)/u.test(cue)) {
      // The user's distress calls for a response, not an automatic claim that
      // Rin herself is hurt or irritated.
      mark(user ? 'care' : 'hurt');
    }
    if (/(?:boundary|refus|несоглас|границ|откаж|не хочу)/u.test(cue)) {
      if (!user) mark('boundary');
    }
    if (/(?:repair|apolog|sorry|прости|извини)/u.test(cue)) mark('apology');
    if (/(?:relief|облегчен|фух|отлегло)/u.test(cue)) mark('relief');
    if (/(?:agree|agreement|approval|соглас|ладно|(?:^|[^\p{L}])угу(?=$|[^\p{L}])|(?:^|[^\p{L}])ага(?=$|[^\p{L}]))/u.test(cue)) mark('agreement');
    if (/(?:greet|hello|привет|доброе утро|добрый вечер)/u.test(cue)) mark('presence');
    if (/(?:farewell|goodnight|(?:^|[^\p{L}])пока(?=$|[^\p{L}])|до завтра|спокойной ночи)/u.test(cue)) {
      mark('presence');
      if (!user || strength >= 25) exact('goodnight_tender', weight * 0.50);
    }
    if (/(?:presence|quiet|calm|тишин|тихо|спокойно|умиротвор)/u.test(cue)) mark('presence');
    if (/(?:sleep|drows|fatigue|tired|сонн|зевн|устал|спать|не выспал)/u.test(cue)) {
      mark(user ? 'care' : 'sleepy');
    }
  }

  const primary = affectiveTurn?.emotionalState?.primary?.type
    || state?.emotion?.primary?.type || state?.emotion?.type || '';
  const secondary = affectiveTurn?.emotionalState?.secondary?.type
    || state?.emotion?.secondary?.type || '';
  // Foreground signals are deliberately stronger than background intent/scene.
  observe(userText, 36, 'user');
  observe(primary, 30);
  observe(secondary, 15);
  observe(brain?.literalIntent || '', 15);
  observe(brain?.hiddenIntent?.type || '', 7);
  observe(brain?.activeScene?.type || state?.scene?.type || '', 4);

  const innerLife = state?.innerLife || {};
  const sleepPhase = lower(innerLife.sleepPhase || '');
  if (['drowsy', 'winding_down', 'interrupted_sleep', 'waking'].includes(sleepPhase)) {
    add('sleepy', 24);
  }
  const energy = Number(innerLife.energy);
  if (innerLife.energy != null && Number.isFinite(energy) && energy >= 0 && energy <= 25) add('sleepy', 19);

  // Ordinary facial reactions must remain legitimate candidates even in an
  // affectionate scene; this is a floor, not a quota or an instruction to send.
  add('presence', 7);
  if (familyScores.size <= 2) {
    add('thoughtful', 4);
    add('playful', 3);
    add('tender', 3);
  }
  return { familyScores, idScores };
}

export function buildStickerCandidates({ userText = '', state = null, brain = null, affectiveTurn = null, limit = 12 } = {}) {
  const catalog = stickerCatalogItems();
  const recentIds = (Array.isArray(state?.stickerState?.recentAssetIds) ? state.stickerState.recentAssetIds : []).map(lower);
  const recent = new Set(recentIds);
  const recentFamilies = (Array.isArray(state?.stickerState?.recentFamilies) ? state.stickerState.recentFamilies : []).map(lower);
  const lastId = recentIds[0] || '';
  const lastFamily = recentFamilies[0] || '';
  const explicitGesture = Boolean(state?.stickerState?.explicitGesture);
  const signals = reactionSignals({ userText, state, brain, affectiveTurn });
  const currentTokens = tokens(userText);

  const scored = (Array.isArray(catalog) ? catalog : []).map((sticker, index) => {
    const text = descriptor(sticker);
    const id = lower(sticker?.id);
    const family = lower(sticker?.family);
    let score = (signals.familyScores.get(family) || 0) + (signals.idScores.get(id) || 0);
    // Lexical evidence breaks near ties; it must never outrank the emotional
    // family classification or the penalty for an immediate identical asset.
    let lexical = 0;
    for (const token of currentTokens) {
      if (text.includes(token)) lexical += 1;
      if (lexical >= 4) break;
    }
    score += lexical;

    if (id && id === lastId) score -= explicitGesture ? 18 : 100;
    else if (recent.has(id)) score -= 7;
    if (family && family === lastFamily) score -= explicitGesture ? 2 : 6;
    else if (recentFamilies.includes(family)) score -= 2;
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
