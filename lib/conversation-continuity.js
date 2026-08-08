import { conversationEventText, isConversationEvent } from './chat-contract.js';
import { analyzeAssistantVoice, looksReactiveAssistantText } from './personality/assistant-voice.js';

const clean = (value, max = 600) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const lower = value => clean(value, 1800).toLowerCase();
const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));

const SCENE_PATTERNS = {
  emotional_support: /(мне плохо|груст|тяжело|тревог|страшно|одинок|больно|нет сил|я устал|я устала|выгорел)/iu,
  conflict_repair: /(прости|извини|обид|злишься|ссор|не так поняла|не хотел обидеть|давай мириться)/iu,
  practical_task: /(?:^|[.!?]\s*)(?:пожалуйста,?\s*)?(?:сделай|исправь|измени|перепиши|проверь|создай|собери|подготовь|удали|добавь|проанализируй)\b|\b(?:рефакторинг|архив|код|файл|тесты?)\b.*\b(?:нужно|надо|исправ|сделай|проверь)\b/iu,
  playful_flirt: /(флирт|пофлирт|поприста|пристава|дразн|игрив|чары|соблазн|в нетерпении|можешь начинать|начинай|мы же играем|подурач|😉|😏)/iu,
  romance: /(люблю|скуч|обним|поцел|целую|рядом|между нами|дорог|нежн|😘|🥰|🤗)/iu,
  reflective: /(смысл|жизн|отношени|философ|почему люди|вспоминаю|прошл|загадочн|тайн)/iu
};

const SCENE_GOALS = {
  everyday: 'держать разговор конкретным и личным, не превращая каждую реплику в поддержку или интервью',
  emotional_support: 'сначала быть рядом с конкретным чувством пользователя; совет только по просьбе или явной необходимости',
  conflict_repair: 'восстановить контакт честно и без защитной вежливости',
  practical_task: 'дать точный результат и не подменять задачу атмосферным разговором',
  playful_flirt: 'сохранять игровое напряжение; Рин сама делает ходы, дразнит или ставит лёгкое условие вместо обсуждения флирта со стороны',
  romance: 'отвечать на близость лично и прямо, не объясняя ценность тепла общими словами',
  reflective: 'дать собственную конкретную мысль Рин и не превращать её в универсальную мудрость',
  farewell: 'тепло закрыть разговор без новой темы'
};

const PLAYFUL_HOOK = /(поприста|пристава|можешь начинать|начинай|в нетерпении|твоя очередь|мы же играем|подурач|давай пофлирт|пофлиртуем|чары)/iu;
const DEPENDENT_SHORT = /^(?:да|нет|ага|угу|ну да|точно|именно|конечно|ладно|хорошо|ок(?:ей)?|мм+|вот именно|давай|что\?|и\?|а ты\?|ну и\?)[)!….,?\s\p{Emoji_Presentation}\p{Extended_Pictographic}]*$/iu;
const DEPENDENT_CONTINUATION = /^(?:мм+[, ]+)?(?:тогда|вот и|так и|я тоже|мне тоже|а я|и я)(?=\s|[,!?….)]|$)|(?:^|\s)(?:тебе|тебя|твой|твоя|нами)(?=\s|[,!?….)]|$).{0,42}(?:^|\s)(?:в ответ|тогда|продолжа|ещё|снова)(?=\s|[,!?….)]|$)/iu;
const META_DRIFT = /(разговор становится|наш разговор|флирт может|это тоже интересно|философ|загадочность делает|новые тайны|мыслью можем поделиться)/iu;

function usableTurns(history = [], max = 48) {
  return (Array.isArray(history) ? history : [])
    .filter(isConversationEvent)
    .slice(-max)
    .map((item, index) => ({
      id: clean(item.id, 120) || `turn-${index}`,
      role: item.role,
      kind: item.kind || 'text',
      content: clean(conversationEventText(item), 1800),
      ts: Number(item.ts) || null
    }));
}

function sceneScores(turns = []) {
  const scores = { everyday: 24, emotional_support: 0, conflict_repair: 0, practical_task: 0, playful_flirt: 0, romance: 0, reflective: 0 };
  const slice = turns.slice(-28);
  slice.forEach((turn, index) => {
    const distance = slice.length - 1 - index;
    const recency = Math.max(0.12, Math.pow(0.84, distance));
    const roleWeight = turn.role === 'user' ? 1 : 0.24;
    const text = lower(turn.content);
    for (const [scene, pattern] of Object.entries(SCENE_PATTERNS)) {
      if (pattern.test(text)) scores[scene] += 58 * recency * roleWeight;
    }
  });
  return scores;
}

function currentSignals(userText = '') {
  const text = lower(userText);
  const scores = {};
  for (const [scene, pattern] of Object.entries(SCENE_PATTERNS)) scores[scene] = pattern.test(text) ? 100 : 0;
  return scores;
}

function latestAnchor(turns = [], scene = 'everyday') {
  const pattern = SCENE_PATTERNS[scene];
  if (!pattern) return null;
  const userTurns = turns.filter(item => item.role === 'user');
  for (let index = userTurns.length - 1; index >= 0; index -= 1) {
    const turn = userTurns[index];
    if (!pattern.test(lower(turn.content))) continue;
    return {
      messageId: turn.id,
      excerpt: clean(turn.content, 320),
      userTurnsAgo: userTurns.length - 1 - index
    };
  }
  return null;
}

function latestOpenHook(turns = [], scene = 'everyday') {
  const userTurns = turns.filter(item => item.role === 'user');
  const pattern = scene === 'playful_flirt' ? PLAYFUL_HOOK : SCENE_PATTERNS[scene];
  if (!pattern) return null;
  for (let index = userTurns.length - 1; index >= 0; index -= 1) {
    const turn = userTurns[index];
    if (!pattern.test(lower(turn.content))) continue;
    return {
      messageId: turn.id,
      excerpt: clean(turn.content, 360),
      userTurnsAgo: userTurns.length - 1 - index
    };
  }
  return null;
}

function recentAssistantDiagnostics(turns = []) {
  const recent = turns.filter(item => item.role === 'assistant' && ['text', 'voice'].includes(item.kind)).slice(-5);
  let reactiveStreak = 0;
  let questionStreak = 0;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const text = clean(recent[index].content, 1800);
    const reactive = looksReactiveAssistantText(text);
    if (reactive) reactiveStreak += 1;
    else break;
  }
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    if (/\?\s*$/u.test(recent[index].content)) questionStreak += 1;
    else break;
  }
  return {
    reactiveStreak,
    questionStreak,
    metaDriftCount: recent.filter(item => {
      const voice = analyzeAssistantVoice(item.content);
      return META_DRIFT.test(item.content) || voice.flags.metaConversation || voice.flags.reflectiveFiller;
    }).length
  };
}

function strongest(scores = {}) {
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0] || ['everyday', 0];
}

export function resolveConversationContinuity({ history = [], userText = '', rawScene = null, conversationState = 'ongoing' } = {}) {
  const turns = usableTurns(history);
  const scores = sceneScores(turns);
  const current = currentSignals(userText);
  const [historyScene, historyScore] = strongest(scores);
  const [nonEverydayScene, nonEverydayScore] = strongest(Object.fromEntries(Object.entries(scores).filter(([key]) => key !== 'everyday')));
  const [currentScene, currentScore] = strongest(current);
  const rawType = clean(rawScene?.type, 80) || 'everyday';
  const text = clean(userText, 1800);

  let scene = rawType;
  let source = 'current_turn';

  if (conversationState === 'ending' || rawType === 'farewell') {
    scene = 'farewell';
    source = 'explicit_ending';
  } else if (['emotional_support', 'conflict_repair', 'practical_task'].includes(currentScene) && currentScore >= 100) {
    scene = currentScene;
    source = 'strong_current_shift';
  } else if (currentScore >= 100 && currentScene !== 'everyday') {
    scene = currentScene;
    source = 'current_scene_signal';
  } else {
    const shortDependent = text.length <= 38 || DEPENDENT_SHORT.test(text);
    const dependentContinuation = shortDependent || DEPENDENT_CONTINUATION.test(text);
    const substantiveNewTopic = text.length >= 42 && !dependentContinuation && rawType === 'everyday';
    const hysteresisScene = historyScene === 'everyday' && dependentContinuation && nonEverydayScore >= 18
      ? nonEverydayScene
      : historyScene;
    const hysteresisScore = hysteresisScene === historyScene ? historyScore : nonEverydayScore;
    const candidateAnchor = latestAnchor(turns, hysteresisScene);
    const maxAge = hysteresisScene === 'playful_flirt' ? 10 : 6;
    const minimumScore = dependentContinuation ? 18 : 34;
    const canPersist = candidateAnchor && candidateAnchor.userTurnsAgo <= maxAge && hysteresisScore >= minimumScore;
    if (canPersist && (dependentContinuation || !substantiveNewTopic)) {
      scene = hysteresisScene;
      source = 'scene_hysteresis';
    } else if (historyScene !== 'everyday' && historyScore >= 62 && !substantiveNewTopic) {
      scene = historyScene;
      source = 'recent_scene_weight';
    }
  }

  const anchor = latestAnchor(turns, scene);
  const openHook = latestOpenHook(turns, scene);
  const diagnostics = recentAssistantDiagnostics(turns);
  const topicDrift = scene === 'playful_flirt' && diagnostics.metaDriftCount >= 1;
  const strength = clamp01(Math.max(
    Number(rawScene?.confidence || 0) / 100,
    Math.min(0.96, (scores[scene] || 0) / 120),
    anchor ? Math.max(0.52, 0.92 - anchor.userTurnsAgo * 0.07) : 0
  ));

  return {
    scene,
    source,
    sceneGoal: SCENE_GOALS[scene] || SCENE_GOALS.everyday,
    anchor,
    openHook,
    turnsInScene: anchor ? anchor.userTurnsAgo + 1 : 1,
    continuityStrength: strength,
    reactiveStreak: diagnostics.reactiveStreak,
    questionStreak: diagnostics.questionStreak,
    topicDrift,
    scores
  };
}

export function continuityInstruction(continuity = {}) {
  const lines = [
    'НЕПРЕРЫВНОСТЬ СЦЕНЫ',
    `Активная сцена: ${continuity.scene || 'everyday'}; цель сцены: ${continuity.sceneGoal || SCENE_GOALS.everyday}.`,
    continuity.anchor ? `Опорная реплика пользователя: «${continuity.anchor.excerpt}».` : '',
    continuity.openHook ? `Незавершённый крючок: «${continuity.openHook.excerpt}». Его нужно продвинуть или осознанно закрыть, а не забыть.` : '',
    continuity.topicDrift ? 'Недавние ответы Рин ушли в мета-обсуждение или философию. Верни сцену конкретным действием, а не новым объяснением.' : '',
    continuity.reactiveStreak >= 2 ? `Последние ответы Рин были реактивными (${continuity.reactiveStreak} подряд). На этом ходу ей нужно сделать собственный содержательный ход внутри текущей сцены.` : '',
    'Короткая реплика пользователя не обнуляет сцену. Новую тему считай сменой сцены только при явном содержательном переходе.'
  ];
  return lines.filter(Boolean).join('\n');
}
