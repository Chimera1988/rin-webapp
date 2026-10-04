import { inspectLifeNovelty } from './life-texture.js';

const clean = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(Number(value) || 0)));

const QUESTION_BOUNDARY_RE = /(?:хватит|довольно|не надо|не нужно|перестань|не задавай|без|поменьше|меньше|давай без|оставь)\s+(?:этих\s+|столько\s+|пока\s+)?вопрос(?:ов|ы|ами)?|(?:вопрос(?:ов|ы|ами)?)\s+(?:хватит|довольно|не надо|не нужно|поменьше|меньше)|(?:не\s+расспрашивай|не\s+допрашивай|без\s+допроса)/iu;
const QUESTION_RESUME_RE = /(?:можешь\s+(?:снова\s+)?спрашивать|задавай\s+вопросы|спрашивай\s+(?:что\s+хочешь|дальше|меня)|можешь\s+задавать\s+вопросы)/iu;
const SPACE_RE = /(?:оставь\s+меня\s+на\s+время|хочу\s+побыть\s+один|мне\s+нужно\s+пространство|давай\s+помолчим|не\s+хочу\s+сейчас\s+говорить)/iu;
const KEEP_TALKING_RE = /(?:не\s+молчи|поговори\s+со\s+мной|продолжай\s+говорить|давай\s+пообщаемся)/iu;
const FRAME_CONFUSION_RE = /(?:не\s+понимаю|я\s+(?:тебя\s+)?не\s+понял|что\s+ты\s+(?:имеешь\s+в\s+виду|хочешь\s+сказать)|как\s+это\s+(?:понимать|понять)|в\s+смысле|как\s+(?:это|так)\s+(?:сделать|показать|доказать))/iu;
const FRAME_RELATIONAL_WORRY_RE = /(?:ты\s+(?:обиделась|злишься|сердишься)|я\s+что[-\s]?то\s+не\s+то\s+(?:сказал|сделал)|я\s+тебя\s+чем[-\s]?то\s+(?:обидел|задел)|ты\s+на\s+меня\s+обиделась)/iu;
const FRAME_REPAIR_RE = /(?:я\s+(?:правда|реально|серь[её]зно)\s+(?:тебя\s+)?не\s+понял|объясни\s+(?:нормально|пожалуйста|прямо)|прости|извини|не\s+хочу\s+тебя\s+обидеть|давай\s+разбер[её]мся)/iu;
const PLAYFUL_MARKER_RE = /(?:[😉😏😂🤣😅😁🙂]|\)\s*$|суд\s+присяжных|ваша\s+честь|допрос|обвинен|обвинён|виновен|приговор|ну[-\s]?ну|хитр(?:ый|ая|о)|поддразн|играю|шучу)/iu;
const PLAYFUL_ACTS = new Set(['playful_tease', 'playful_mock_offense', 'playful_mischief', 'flirt_challenge', 'flirt_softly', 'flirt_caught_you', 'flirt_secret_wink']);
const LITERAL_CORRECTION_RE = /^(?:нет(?:[, ]+|$)|точнее|не так|вообще-то|на самом деле|я\s+(?:имел\s+в\s+виду|спрашивал|говорил)\s+(?:про|о)|я\s+же\s+про|я\s+про(?:\s|$)|так\s+это\s+же\s+я\s+про|это\s+же\s+я\s+про|так\s+я\s+же\s+про)/iu;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

const MALE_SELF_FORMS = new Map(Object.entries({
  права: 'прав', готова: 'готов', уверена: 'уверен', согласна: 'согласен', устала: 'устал', рада: 'рад',
  занята: 'занят', свободна: 'свободен', виновата: 'виноват', обижена: 'обижен', смущена: 'смущён', сердита: 'сердит',
  решила: 'решил', сделала: 'сделал', сказала: 'сказал', подумала: 'подумал', захотела: 'захотел', смогла: 'смог',
  могла: 'мог', стала: 'стал', была: 'был', осталась: 'остался', пришла: 'пришёл', ушла: 'ушёл', поняла: 'понял',
  забыла: 'забыл', вспомнила: 'вспомнил', выбрала: 'выбрал', нашла: 'нашёл', начала: 'начал', пошла: 'пошёл',
  спросила: 'спросил', ответила: 'ответил', написала: 'написал', увидела: 'увидел', услышала: 'услышал',
  заметила: 'заметил', собралась: 'собрался', обещала: 'обещал'
}));

function preserveCase(source, replacement) {
  if (!source) return replacement;
  if (source === source.toUpperCase()) return replacement.toUpperCase();
  if (source[0] === source[0].toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

/**
 * The product contract knows the user as male. A single feminine first-person
 * inflection in casual typing is therefore treated as a likely typo rather than
 * as a profile rewrite. Only a short punctuation-free span after "я" is touched;
 * quoted/third-person clauses are left alone.
 */
export function normalizeMaleUserSelfReference(value = '') {
  let out = String(value || '');
  const forms = [...MALE_SELF_FORMS.keys()].sort((a, b) => b.length - a.length).join('|');
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])(я)([^.!?,;:\\n]{0,42}?\\s)(${forms})(?=$|[^\\p{L}\\p{N}_])`, 'gimu');
  out = out.replace(pattern, (match, prefix, pronoun, bridge, form) => {
    // Do not rewrite a clearly introduced third-person subject inside the span.
    if (/\b(?:она|рин|девушка|женщина|мама|сестра|подруга|коллега)\b/iu.test(bridge)) return match;
    const replacement = MALE_SELF_FORMS.get(String(form).toLowerCase());
    if (!replacement) return match;
    return `${prefix}${pronoun}${bridge}${preserveCase(form, replacement)}`;
  });
  return out;
}

function actionNoveltySnapshot(recentActs = []) {
  const acts = (Array.isArray(recentActs) ? recentActs : [])
    .map(item => clean(item, 80).toLowerCase())
    .filter(Boolean)
    .slice(-8);
  const lastAct = acts.at(-1) || null;
  let streak = 0;
  if (lastAct) {
    for (let index = acts.length - 1; index >= 0 && acts[index] === lastAct; index -= 1) streak += 1;
  }
  const appearances = lastAct ? acts.filter(item => item === lastAct).length : 0;
  const pressure = clamp(Math.max(0, streak - 1) * 24 + Math.max(0, appearances - 3) * 8, 0, 100);
  return { recentActs: acts.slice(-6), repeatedAct: lastAct, streak, appearances, pressure };
}

function responseRhythmSnapshot(recentDepths = [], recentShapes = []) {
  const depths = (Array.isArray(recentDepths) ? recentDepths : [])
    .map(item => clean(item, 20).toLowerCase())
    .filter(item => ['micro', 'short', 'normal', 'extended'].includes(item))
    .slice(-8);
  const shapes = (Array.isArray(recentShapes) ? recentShapes : [])
    .map(item => clean(item, 20).toLowerCase())
    .filter(item => ['single', 'split'].includes(item))
    .slice(-8);
  const lastDepth = depths.at(-1) || null;
  let depthStreak = 0;
  if (lastDepth) {
    for (let index = depths.length - 1; index >= 0 && depths[index] === lastDepth; index -= 1) depthStreak += 1;
  }
  const shortCount = depths.filter(item => item === 'short').length;
  const normalCount = depths.filter(item => item === 'normal').length;
  const microCount = depths.filter(item => item === 'micro').length;
  const extendedCount = depths.filter(item => item === 'extended').length;
  let singleStreak = 0;
  for (let index = shapes.length - 1; index >= 0 && shapes[index] === 'single'; index -= 1) singleStreak += 1;
  const shortLockPressure = clamp(Math.max(0, depthStreak - 2) * 18 + Math.max(0, shortCount - 5) * 12, 0, 100);
  const singleLockPressure = clamp(Math.max(0, singleStreak - 3) * 16, 0, 100);
  return {
    recentDepths: depths,
    recentShapes: shapes,
    lastDepth,
    depthStreak,
    shortCount,
    normalCount,
    microCount,
    extendedCount,
    singleStreak,
    shortLockPressure,
    singleLockPressure,
    guidance: shortLockPressure >= 45
      ? 'Недавние ходы слишком долго были short. Не выбирай short по инерции: простой эмоциональный жест может быть micro, а содержательный ответ/self-reveal — normal. Это не квота и не требование искусственно удлинять.'
      : singleLockPressure >= 45
        ? 'Недавний ритм почти весь single. Если текущая реакция естественно имеет два самостоятельных такта, split допустим и желателен; не дроби одну мысль искусственно.'
        : 'Ритм ответа не требует коррекции; выбирай глубину и форму по текущему beat.'
  };
}

export function inspectMotifNovelty(recentMotifs = []) {
  const motifs = (Array.isArray(recentMotifs) ? recentMotifs : [])
    .map(item => clean(item, 80).toLowerCase())
    .filter(Boolean)
    .slice(-8);
  const lastMotif = motifs.at(-1) || null;
  let streak = 0;
  if (lastMotif) {
    for (let index = motifs.length - 1; index >= 0 && motifs[index] === lastMotif; index -= 1) streak += 1;
  }
  const appearances = lastMotif ? motifs.filter(item => item === lastMotif).length : 0;
  const pressure = clamp(Math.max(0, streak - 1) * 26 + Math.max(0, appearances - 3) * 10, 0, 100);
  return { recentMotifs: motifs.slice(-7), repeatedMotif: lastMotif, streak, appearances, pressure };
}

function noveltySnapshot(recentActs = [], recentMotifs = []) {
  const action = actionNoveltySnapshot(recentActs);
  const motif = inspectMotifNovelty(recentMotifs);
  // Once semantic motifs exist, they are the primary anti-loop signal. Repeating
  // the same act code is acceptable if its semantic function keeps changing.
  const pressure = motif.recentMotifs.length ? motif.pressure : action.pressure;
  return {
    ...action,
    actionPressure: action.pressure,
    motifPressure: motif.pressure,
    recentMotifs: motif.recentMotifs,
    repeatedMotif: motif.repeatedMotif,
    motifStreak: motif.streak,
    motifAppearances: motif.appearances,
    pressure,
    guidance: pressure >= 70
      ? 'Смысловой мотив сцены повторяется. Не ломай удачную сцену, но развей тот же intent через другой motif, конкретный образ, самораскрытие, мягкость или новый beat.'
      : pressure >= 40
        ? 'Не ломать удачную сцену; при возможности разнообразь смысловой motif, а не просто формулировку.'
        : 'Смысловая вариативность сцены не требует вмешательства.'
  };
}

function frameEvidenceSnapshot(userText = '', recentActs = [], brain = null) {
  const text = clean(userText, 1600);
  const acts = (Array.isArray(recentActs) ? recentActs : []).map(item => clean(item, 80).toLowerCase()).filter(Boolean);
  const lastAct = acts.at(-1) || null;
  const playfulContext = Boolean(lastAct && PLAYFUL_ACTS.has(lastAct));
  const confusionCue = FRAME_CONFUSION_RE.test(text);
  const relationalWorryCue = FRAME_RELATIONAL_WORRY_RE.test(text);
  const repairCue = FRAME_REPAIR_RE.test(text);
  const playfulMarker = PLAYFUL_MARKER_RE.test(text);
  const hidden = clean(brain?.hiddenIntent?.type, 100).toLowerCase();
  const brainConcern = ['possible_hurt_or_withdrawal', 'masked_disappointment', 'repair_connection'].includes(hidden);
  return {
    playfulContext,
    lastAct,
    confusionCue,
    relationalWorryCue,
    repairCue,
    playfulMarker,
    brainConcern,
    guidance: 'Это только локальные признаки, не готовый диагноз. frameAlignment должен определяться по полному смыслу текущей реплики: продолжение общей шутки/roleplay и игровые маркеры могут означать aligned даже при словах «не понимаю».'
  };
}

function literalCorrectionSnapshot(userText = '', brain = null) {
  const text = clean(userText, 1600);
  const relationCorrection = brain?.relation?.type === 'correction';
  const explicitCue = LITERAL_CORRECTION_RE.test(text);
  const explicit = relationCorrection || explicitCue;
  return {
    explicit,
    relationCorrection,
    explicitCue,
    guidance: explicit
      ? 'Пользователь исправляет буквальное понимание/референт. Сначала принять исправленный смысл; playful frame может сохраниться, но нельзя изображать саму коррекцию как смену позиции пользователя.'
      : 'Явной буквальной коррекции не обнаружено.'
  };
}

function emojiSnapshot(userText = '', history = []) {
  const userEmojis = [...new Set((String(userText || '').match(EMOJI_RE) || []))].slice(0, 4);
  const recentRinEmojis = [];
  for (const message of (Array.isArray(history) ? history : []).filter(item => item?.role === 'assistant').slice(-6)) {
    recentRinEmojis.push(...(String(message?.content || '').match(EMOJI_RE) || []));
  }
  const recent = recentRinEmojis.slice(-8);
  const repeated = recent.length ? Math.max(...[...new Set(recent)].map(emoji => recent.filter(item => item === emoji).length)) : 0;
  const pressure = clamp(recent.length * 10 + Math.max(0, repeated - 1) * 18, 0, 100);
  return {
    userEmojis,
    recentRinEmojis: recent,
    mirrorRisk: userEmojis.length > 0,
    pressure,
    guidance: userEmojis.length
      ? 'Не копировать эмодзи текущей реплики автоматически. По умолчанию ответ без эмодзи; если нужен невербальный жест и доступен стикер, стикер предпочтительнее.'
      : pressure >= 50
        ? 'Недавних эмодзи Рин уже достаточно: предпочесть текст или подходящий стикер.'
        : 'Эмодзи всё равно остаётся редкой микроинтонацией, не пунктуацией.'
  };
}

function isAssistantQuestionTurn(messages = []) {
  return messages.some(message => /\?/u.test(String(message?.content || '')));
}

function assistantTurns(history = []) {
  const turns = [];
  const byKey = new Map();
  for (const message of Array.isArray(history) ? history : []) {
    if (message?.role !== 'assistant') continue;
    const key = clean(message.turnId || message.requestId || message.id, 140) || `assistant-${turns.length}`;
    let turn = byKey.get(key);
    if (!turn) {
      turn = { key, messages: [] };
      byKey.set(key, turn);
      turns.push(turn);
    }
    turn.messages.push(message);
  }
  return turns;
}

function recentBoundary(history = [], currentUserText = '') {
  const events = [];
  for (const message of Array.isArray(history) ? history : []) {
    if (message?.role !== 'user' || !message?.content) continue;
    const text = clean(message.content, 1200);
    if (QUESTION_BOUNDARY_RE.test(text)) events.push({ type: 'question_stop', id: message.id || null });
    if (QUESTION_RESUME_RE.test(text)) events.push({ type: 'question_resume', id: message.id || null });
    if (SPACE_RE.test(text)) events.push({ type: 'space', id: message.id || null });
    if (KEEP_TALKING_RE.test(text)) events.push({ type: 'contact', id: message.id || null });
  }
  const current = clean(currentUserText, 1200);
  if (current) {
    if (QUESTION_BOUNDARY_RE.test(current)) events.push({ type: 'question_stop', id: '__current__' });
    if (QUESTION_RESUME_RE.test(current)) events.push({ type: 'question_resume', id: '__current__' });
    if (SPACE_RE.test(current)) events.push({ type: 'space', id: '__current__' });
    if (KEEP_TALKING_RE.test(current)) events.push({ type: 'contact', id: '__current__' });
  }
  return events.at(-1) || null;
}

function questionFatigue(history = []) {
  const turns = assistantTurns(history).slice(-7);
  if (!turns.length) return { score: 0, streak: 0, recentQuestionTurns: 0, sampleTurns: 0 };
  const flags = turns.map(turn => isAssistantQuestionTurn(turn.messages));
  let streak = 0;
  for (let index = flags.length - 1; index >= 0 && flags[index]; index -= 1) streak += 1;
  const recentQuestionTurns = flags.filter(Boolean).length;
  const ratio = recentQuestionTurns / turns.length;
  const score = clamp(ratio * 58 + streak * 14, 0, 100);
  return { score, streak, recentQuestionTurns, sampleTurns: turns.length };
}

function turnsSinceBoundary(history = [], boundaryType = 'question_stop') {
  const list = Array.isArray(history) ? history : [];
  let markerIndex = -1;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    if (message?.role !== 'user') continue;
    const text = String(message?.content || '');
    const matches = boundaryType === 'question_stop' ? QUESTION_BOUNDARY_RE.test(text) : SPACE_RE.test(text);
    if (matches) { markerIndex = index; break; }
  }
  if (markerIndex < 0) return null;
  const seen = new Set();
  for (let index = markerIndex + 1; index < list.length; index += 1) {
    const message = list[index];
    if (message?.role !== 'assistant') continue;
    seen.add(clean(message.turnId || message.requestId || message.id, 140) || `idx-${index}`);
  }
  return seen.size;
}

export function buildBehaviorState({ userText = '', history = [], brain = null, recentActs = [], recentMotifs = [], recentLifeBeats = [], recentResponseDepths = [], recentMessageShapes = [] } = {}) {
  const text = clean(userText, 1600);
  const modelUserText = normalizeMaleUserSelfReference(text);
  const fatigue = questionFatigue(history);
  const latestBoundary = recentBoundary(history, text);
  const currentQuestionBoundary = QUESTION_BOUNDARY_RE.test(text);
  const currentResume = QUESTION_RESUME_RE.test(text);
  const currentSpace = SPACE_RE.test(text);
  const currentContact = KEEP_TALKING_RE.test(text);
  const frameEvidence = frameEvidenceSnapshot(text, recentActs, brain);
  const literalCorrection = literalCorrectionSnapshot(text, brain);
  const emoji = emojiSnapshot(text, history);

  const sinceQuestionStop = turnsSinceBoundary(history, 'question_stop');
  const sinceSpace = turnsSinceBoundary(history, 'space');
  const inheritedQuestionBoundary = !currentResume
    && latestBoundary?.type === 'question_stop'
    && sinceQuestionStop != null
    && sinceQuestionStop <= 4;
  const inheritedSpace = !currentContact
    && latestBoundary?.type === 'space'
    && sinceSpace != null
    && sinceSpace <= 2;

  const boundaryPressure = currentQuestionBoundary
    ? 100
    : inheritedQuestionBoundary
      ? clamp(88 - (sinceQuestionStop || 0) * 18, 28, 88)
      : 0;
  const questionRestraint = currentResume ? 0 : clamp(Math.max(fatigue.score, boundaryPressure));
  const noQuestionStrong = currentQuestionBoundary || boundaryPressure >= 72;
  const spacePressure = currentSpace
    ? 100
    : inheritedSpace
      ? clamp(80 - (sinceSpace || 0) * 28, 20, 80)
      : 0;

  return {
    schema: 'rin-behavior-state-v5',
    explicitBoundary: {
      noQuestions: currentQuestionBoundary,
      resumeQuestions: currentResume,
      wantsSpace: currentSpace,
      wantsContact: currentContact
    },
    question: {
      fatigue: fatigue.score,
      recentQuestionTurns: fatigue.recentQuestionTurns,
      sampleTurns: fatigue.sampleTurns,
      streak: fatigue.streak,
      boundaryPressure,
      restraint: questionRestraint,
      strongNoQuestion: noQuestionStrong,
      guidance: noQuestionStrong
        ? 'Не инициировать сбор новой информации. Можно реагировать, шутить, делиться или завершить ход без вопроса.'
        : questionRestraint >= 55
          ? 'Снизить частоту вопросов; вопрос только при реальном личном интересе и хорошем якоре.'
          : 'Вопрос допустим только если он естественно следует из интереса Рин, а не ради поддержания диалога.'
    },
    space: {
      pressure: spacePressure,
      strong: spacePressure >= 72,
      guidance: spacePressure >= 72
        ? 'Уважить запрос на пространство: короткий ненавязчивый ответ или осознанная пауза предпочтительнее продолжения темы.'
        : 'Обычный уровень контакта.'
    },
    userGender: {
      known: 'male',
      likelyInflectionTypo: modelUserText !== text,
      modelUserText,
      guidance: modelUserText !== text
        ? 'В текущей реплике есть вероятная женская форма-опечатка. Не переопределять известный мужской род пользователя.'
        : 'Устойчиво использовать мужской род пользователя.'
    },
    novelty: noveltySnapshot(recentActs, recentMotifs),
    lifeNovelty: inspectLifeNovelty(recentLifeBeats),
    responseRhythm: responseRhythmSnapshot(recentResponseDepths, recentMessageShapes),
    frameEvidence,
    literalCorrection,
    emoji,
    relationSignal: clean(brain?.relation?.type, 100) || null,
    hiddenIntent: clean(brain?.hiddenIntent?.type, 100) || null
  };
}

export const behaviorPatterns = Object.freeze({
  QUESTION_BOUNDARY_RE,
  QUESTION_RESUME_RE,
  SPACE_RE,
  KEEP_TALKING_RE,
  FRAME_CONFUSION_RE,
  FRAME_RELATIONAL_WORRY_RE,
  FRAME_REPAIR_RE,
  PLAYFUL_MARKER_RE,
  LITERAL_CORRECTION_RE
});
