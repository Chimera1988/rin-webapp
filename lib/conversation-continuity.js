import { conversationEventText, isConversationEvent, isExplicitFarewell } from './chat-contract.js';
import { detectInitiativeHandoff } from './cognition/initiative-handoff.js';

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


const PLAYFUL_HOOK = /(поприста|пристава|можешь начинать|начинай|в нетерпении|твоя очередь|мы же играем|подурач|давай пофлирт|пофлиртуем|чары)/iu;
const DEPENDENT_SHORT = /^(?:да|нет|ага|угу|ну да|точно|именно|конечно|ладно|хорошо|ок(?:ей)?|мм+|вот именно|давай|что\?|и\?|а ты\?|ну и\?)[)!….,?\s\p{Emoji_Presentation}\p{Extended_Pictographic}]*$/iu;
const DEPENDENT_CONTINUATION = /^(?:мм+[, ]+)?(?:тогда|вот и|так и|я тоже|мне тоже|а я|и я)(?=\s|[,!?….)]|$)|(?:^|\s)(?:тебе|тебя|твой|твоя|нами)(?=\s|[,!?….)]|$).{0,42}(?:^|\s)(?:в ответ|тогда|продолжа|ещё|снова)(?=\s|[,!?….)]|$)/iu;
const META_DRIFT = /(разговор становится|наш разговор|флирт может|это тоже интересно|философ|загадочность делает|новые тайны|мыслью можем поделиться)/iu;
const REACTIVE_ASSISTANT = /(?:это (?:очень )?(?:интересно|важно|приятно|здорово)|мне приятно|рада,? что|если хочешь|можем|как тебе это\?|наш разговор|разговор становится)/iu;

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
    const reactive = REACTIVE_ASSISTANT.test(text) || (/\?\s*$/u.test(text) && text.length > 90);
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
      return META_DRIFT.test(item.content);
    }).length
  };
}

function strongest(scores = {}) {
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0] || ['everyday', 0];
}

export function resolveConversationContinuity({ history = [], userText = '', rawScene = null, conversationState = 'ongoing' } = {}) {
  let turns = usableTurns(history);
  // A completed farewell is a hard session boundary. Old scene weights/hooks cannot
  // leak into a later session and resurrect a previous goal. The current farewell
  // itself is not treated as a prior boundary.
  const scanLimit = conversationState === 'ending' ? Math.max(0, turns.length - 1) : turns.length;
  let priorFarewellIndex = -1;
  for (let index = 0; index < scanLimit; index += 1) {
    if (turns[index]?.role === 'user' && isExplicitFarewell(turns[index]?.content)) priorFarewellIndex = index;
  }
  if (priorFarewellIndex >= 0) turns = turns.slice(priorFarewellIndex + 1);
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
    const previousAssistant = [...turns].reverse().find(item => item.role === 'assistant')?.content || '';
    const initiativeHandoff = detectInitiativeHandoff(text, {
      scene: historyScene !== 'everyday' ? historyScene : nonEverydayScene,
      previousAssistant,
      recentText: turns.slice(-10).map(item => item.content).join(' ')
    });
    const shortDependent = text.length <= 38 || DEPENDENT_SHORT.test(text);
    const dependentContinuation = shortDependent || DEPENDENT_CONTINUATION.test(text) || initiativeHandoff.active;
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
