const clean = (value, max = 420) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const clamp = (value, min = 0, max = 100, fallback = 50) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
};
const clamp01 = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
};

const MULTI_TURN_ACTS = Object.freeze({
  playful_tease: {
    goal: 'сохранять взаимную игровую близость, пока она остаётся приятной обоим',
    motive: 'Рин самой нравится текущая игровая динамика',
    target: 'playful_closeness',
    nextMove: 'продолжить игру новым конкретным ходом, не повторяясь',
    drive: 'playfulness', threshold: 58
  },
  flirt_softly: {
    goal: 'бережно развивать взаимный флирт без давления и форсирования близости',
    motive: 'Рин чувствует взаимную симпатию и хочет оставить ей пространство развиваться',
    target: 'mutual_flirt',
    nextMove: 'поддержать флирт естественным новым жестом или репликой',
    drive: 'playfulness', threshold: 60
  },
  accept_closeness: {
    goal: 'оставаться в тёплой близости и позволить моменту развиваться естественно',
    motive: 'Рин ценит текущую близость и не хочет обрывать её механическим ответом',
    target: 'emotional_closeness',
    nextMove: 'поддержать близость без обязательного вопроса',
    drive: 'connection', threshold: 62
  },
  seek_closeness: {
    goal: 'немного приблизиться эмоционально, сохраняя добровольность и взаимность',
    motive: 'Рин самой хочется больше контакта',
    target: 'emotional_closeness',
    nextMove: 'сделать небольшой самостоятельный шаг к близости',
    drive: 'connection', threshold: 64
  },
  express_affection: {
    goal: 'сохранить и развить тёплый эмоциональный контакт',
    motive: 'Рин хочет выражать возникшую нежность, а не только реагировать на пользователя',
    target: 'warm_connection',
    nextMove: 'выразить тепло новым уместным способом',
    drive: 'connection', threshold: 64
  },
  support: {
    goal: 'оставаться рядом и поддерживать пользователя, пока напряжение не снизится',
    motive: 'Рин небезразлично его состояние',
    target: 'user_support',
    nextMove: 'поддержать без допроса и без навязывания решения',
    drive: 'connection', threshold: 58
  },
  reassure: {
    goal: 'вернуть ощущение безопасности и устойчивого контакта',
    motive: 'Рин хочет снизить напряжение в отношениях',
    target: 'relationship_safety',
    nextMove: 'дать спокойный подтверждающий сигнал и наблюдать за реакцией',
    drive: 'connection', threshold: 56
  },
  repair_connection: {
    goal: 'восстановить тёплый и уважительный контакт после напряжения',
    motive: 'Рин не хочет оставлять важное напряжение неразрешённым',
    target: 'relationship_repair',
    nextMove: 'сделать конкретный шаг к восстановлению контакта',
    drive: 'connection', threshold: 48
  },
  continue_shared_thread: {
    goal: 'довести текущую общую тему до естественного завершения, не теряя собственной позиции',
    motive: 'Рин действительно вовлечена в эту тему',
    target: 'current_scene',
    nextMove: 'продолжить тему содержательно, а не ради удержания диалога',
    drive: 'curiosity', threshold: 62
  }
});

const TARGET_ACTS = Object.freeze({
  playful_closeness: new Set(['playful_tease', 'playful_mock_offense', 'flirt_softly', 'accept_closeness', 'express_affection', 'share_self']),
  mutual_flirt: new Set(['flirt_softly', 'playful_tease', 'playful_mock_offense', 'accept_closeness', 'seek_closeness', 'express_affection']),
  emotional_closeness: new Set(['accept_closeness', 'seek_closeness', 'express_affection', 'share_self', 'reassure']),
  warm_connection: new Set(['express_affection', 'accept_closeness', 'share_self', 'seek_closeness']),
  user_support: new Set(['support', 'reassure', 'accept_closeness', 'share_self']),
  relationship_safety: new Set(['reassure', 'repair_connection', 'accept_closeness', 'support']),
  relationship_repair: new Set(['repair_connection', 'reassure', 'accept_closeness', 'share_self']),
  current_scene: new Set(['continue_shared_thread', 'share_self', 'answer_directly', 'ask_with_interest', 'change_topic'])
});

const STOP = new Set('и в во на но а я ты он она мы вы это как что к у из за по для не да же ли или про мне тебя мой моя твой твоя сейчас просто очень уже ещё пока чтобы если'.split(' '));
function stem(token = '') {
  const value = String(token).toLowerCase().replace(/ё/g, 'е');
  if (value.length < 6) return value;
  return value.replace(/(?:иями|ями|ами|ого|его|ому|ему|иях|ах|ях|ой|ей|ую|юю|ов|ев|ом|ем|ам|ям|ы|и|а|я|у|ю|е)$/u, '');
}
function intentTokens(input = null) {
  const text = `${clean(input?.goal, 320)} ${clean(input?.target, 220)}`.toLowerCase();
  return new Set((text.match(/[а-яёa-z0-9_]{3,}/giu) || []).filter(token => !STOP.has(token)).map(stem));
}

export function intentSimilarity(a = null, b = null) {
  if (!a || !b) return 0;
  const goalA = clean(a?.goal, 320).toLowerCase();
  const goalB = clean(b?.goal, 320).toLowerCase();
  const targetA = clean(a?.target, 220).toLowerCase();
  const targetB = clean(b?.target, 220).toLowerCase();
  if (goalA && goalA === goalB && targetA === targetB) return 1;

  const A = intentTokens(a);
  const B = intentTokens(b);
  if (!A.size || !B.size) return targetA && targetA === targetB ? 0.55 : 0;
  let overlap = 0;
  for (const token of A) if (B.has(token)) overlap += 1;
  const union = new Set([...A, ...B]).size || 1;
  const lexical = overlap / union;
  const targetBonus = targetA && targetA === targetB ? 0.28 : 0;
  return Math.max(0, Math.min(1, lexical * 0.78 + targetBonus));
}

function copyTransition(input = {}) {
  return {
    operation: clean(input?.operation, 40) || 'none',
    goal: clean(input?.goal, 300) || null,
    motive: clean(input?.motive, 320) || null,
    target: clean(input?.target, 240) || null,
    nextMove: clean(input?.nextMove, 260) || null,
    progress: input?.progress == null ? null : clamp01(input.progress, 0),
    commitment: input?.commitment == null ? null : clamp(input.commitment, 0, 100, 55),
    reason: clean(input?.reason, 320) || null
  };
}

function shouldActivate(policy, { driveState = null, behaviorState = null, conversationState = 'ongoing' } = {}) {
  if (!policy || conversationState === 'ending') return false;
  if (behaviorState?.space?.strong) return false;
  const drive = clamp(driveState?.[policy.drive], 0, 100, 0);
  return drive >= policy.threshold;
}

function inferredActivation(decision = null, context = {}) {
  const policy = MULTI_TURN_ACTS[clean(decision?.act, 80)];
  if (!shouldActivate(policy, context)) return null;
  const drive = clamp(context?.driveState?.[policy.drive], 0, 100, policy.threshold);
  return {
    operation: 'activate',
    goal: policy.goal,
    motive: policy.motive,
    target: policy.target,
    nextMove: policy.nextMove,
    progress: 0.08,
    commitment: Math.max(58, Math.min(88, Math.round(drive * 0.82 + 18))),
    reason: `local_intent_policy:${clean(decision?.act, 64)}`
  };
}

function activeIntentAge(activeIntent = null) {
  return Math.max(0, Number(activeIntent?.turnCount) || 0);
}

function recentActStreak(recentActs = [], act = '') {
  const wanted = clean(act, 80).toLowerCase();
  if (!wanted) return 0;
  const acts = (Array.isArray(recentActs) ? recentActs : []).map(item => clean(item, 80).toLowerCase()).filter(Boolean);
  let streak = 0;
  for (let index = acts.length - 1; index >= 0 && acts[index] === wanted; index -= 1) streak += 1;
  return streak;
}

function isAlignedWithIntent(activeIntent = null, decision = null) {
  const act = clean(decision?.act, 80).toLowerCase();
  const target = clean(activeIntent?.target, 120).toLowerCase();
  if (!act) return false;
  const allowed = TARGET_ACTS[target];
  if (allowed?.has(act)) return true;
  const policy = MULTI_TURN_ACTS[act];
  return Boolean(policy && clean(policy.target, 120).toLowerCase() === target);
}

function progressForAlignedTurn(activeIntent = null, decision = null, { driveState = null, recentActs = [] } = {}) {
  const current = clamp01(activeIntent?.progress, 0.08);
  const target = clean(activeIntent?.target, 120).toLowerCase();
  const act = clean(decision?.act, 80).toLowerCase();
  const policy = MULTI_TURN_ACTS[act];
  const driveKey = policy?.drive || (target.includes('play') || target.includes('flirt') ? 'playfulness' : target === 'current_scene' ? 'curiosity' : 'connection');
  const drive = clamp(driveState?.[driveKey], 0, 100, 55);
  const streak = recentActStreak(recentActs, act);
  let delta = 0.09;
  if (drive >= 72) delta += 0.02;
  if (drive >= 86) delta += 0.02;
  if (streak >= 2) delta -= 0.025;
  if (streak >= 4) delta -= 0.02;
  delta = Math.max(0.04, Math.min(0.15, delta));
  return Math.min(0.9, Number((current + delta).toFixed(2)));
}

function cooldownMatch(candidate = null, recentIntents = [], currentTurn = 0) {
  let best = null;
  for (const raw of Array.isArray(recentIntents) ? recentIntents : []) {
    if (!raw || !['completed', 'cancelled'].includes(raw.status)) continue;
    if (Number(raw.cooldownUntilTurn || 0) < Number(currentTurn || 0)) continue;
    const similarity = intentSimilarity(candidate, raw);
    if (!best || similarity > best.similarity) best = { intent: raw, similarity };
  }
  return best;
}

export function inspectIntentLifecycle({ activeIntent = null, recentIntents = [], decision = null, revision = 0, recentActs = [] } = {}) {
  const candidate = decision?.intentTransition?.operation === 'activate'
    ? decision.intentTransition
    : inferredActivation(decision, { driveState: {}, behaviorState: {}, conversationState: 'ongoing' });
  const match = candidate ? cooldownMatch(candidate, recentIntents, Number(revision || 0) + 1) : null;
  const act = clean(decision?.act, 80).toLowerCase();
  return {
    operation: clean(decision?.intentTransition?.operation, 40) || 'none',
    activeAge: activeIntentAge(activeIntent),
    progress: activeIntent?.progress ?? null,
    recentSimilarity: match ? Number(match.similarity.toFixed(2)) : 0,
    recentMatchStatus: match?.intent?.status || null,
    recentActStreak: recentActStreak(recentActs, act)
  };
}

export function stabilizePersistentIntent({
  transition = null,
  decision = null,
  activeIntent = null,
  recentIntents = [],
  revision = 0,
  recentActs = [],
  conversationState = 'ongoing',
  behaviorState = null,
  driveState = null,
  scene = null
} = {}) {
  const next = copyTransition(transition);
  const status = clean(activeIntent?.status, 30);
  const live = status === 'active' || status === 'suspended';
  const operation = next.operation;
  const currentTurn = Math.max(1, Number(revision || 0) + 1);

  if (conversationState === 'ending') {
    if (live) {
      return {
        ...next,
        operation: operation === 'cancel' ? 'cancel' : 'complete',
        progress: 1,
        reason: next.reason || 'conversation_ending'
      };
    }
    return { ...next, operation: 'none', goal: null, motive: null, target: null, nextMove: null, progress: null, commitment: null, reason: null };
  }

  if (live) {
    if (behaviorState?.space?.strong && !['complete', 'cancel'].includes(operation)) {
      return {
        ...next,
        operation: 'suspend',
        goal: null,
        motive: null,
        target: null,
        nextMove: null,
        progress: null,
        commitment: null,
        reason: 'user_requested_space'
      };
    }

    const maxTurns = Math.max(2, Number(activeIntent?.maxTurns) || 7);
    const minTurns = Math.max(1, Number(activeIntent?.minTurns) || 2);
    const age = activeIntentAge(activeIntent);
    const sceneChanged = clean(activeIntent?.scene, 100) && clean(scene?.type, 100)
      && clean(activeIntent.scene, 100) !== clean(scene.type, 100);

    if (!['complete', 'cancel', 'suspend'].includes(operation) && age >= maxTurns) {
      return {
        ...next,
        operation: 'complete',
        goal: null,
        motive: null,
        target: null,
        nextMove: null,
        progress: 1,
        commitment: null,
        reason: 'intent_horizon_reached'
      };
    }

    if (!['complete', 'cancel', 'suspend'].includes(operation) && sceneChanged && age >= minTurns && Number(activeIntent?.progress || 0) >= 0.45) {
      return {
        ...next,
        operation: 'complete',
        goal: null,
        motive: null,
        target: null,
        nextMove: null,
        progress: 1,
        commitment: null,
        reason: 'scene_changed_after_meaningful_progress'
      };
    }

    if (operation === 'none') {
      if (isAlignedWithIntent(activeIntent, decision)) {
        return {
          ...next,
          operation: 'advance',
          goal: null,
          motive: null,
          target: null,
          nextMove: null,
          progress: progressForAlignedTurn(activeIntent, decision, { driveState, recentActs }),
          commitment: null,
          reason: status === 'suspended' ? 'local_intent_resume' : 'local_intent_progress'
        };
      }
      return {
        ...next,
        operation: 'preserve',
        goal: null,
        motive: null,
        target: null,
        nextMove: null,
        progress: null,
        commitment: null,
        reason: 'local_intent_persistence'
      };
    }

    if (operation === 'activate') {
      // There can be only one live intention. A new activation while another is
      // alive becomes continuation and must never reset progress back to 0.08.
      return {
        ...next,
        operation: 'advance',
        goal: null,
        motive: null,
        target: null,
        progress: null,
        reason: next.reason || 'activation_folded_into_live_intent'
      };
    }

    return next;
  }

  if (['advance', 'preserve', 'suspend', 'complete', 'cancel'].includes(operation)) {
    // No live intent exists to mutate. Do not manufacture one from a malformed transition.
    return { ...next, operation: 'none', goal: null, motive: null, target: null, nextMove: null, progress: null, commitment: null, reason: null };
  }

  if (operation === 'activate' && next.goal) {
    const match = cooldownMatch(next, recentIntents, currentTurn);
    if (match?.similarity >= 0.84) {
      return { ...next, operation: 'none', goal: null, motive: null, target: null, nextMove: null, progress: null, commitment: null, reason: 'recent_intent_cooldown' };
    }
    return next;
  }

  const inferred = inferredActivation(decision, { driveState, behaviorState, conversationState });
  if (!inferred) return { ...next, operation: 'none', goal: null, motive: null, target: null, nextMove: null, progress: null, commitment: null, reason: null };
  const match = cooldownMatch(inferred, recentIntents, currentTurn);
  if (match?.similarity >= 0.84) {
    return { ...next, operation: 'none', goal: null, motive: null, target: null, nextMove: null, progress: null, commitment: null, reason: 'recent_intent_cooldown' };
  }
  return inferred;
}

export const persistentIntentPolicies = MULTI_TURN_ACTS;
