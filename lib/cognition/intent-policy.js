const clean = (value, max = 420) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const clamp = (value, min = 0, max = 100, fallback = 50) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
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

function copyTransition(input = {}) {
  return {
    operation: clean(input?.operation, 40) || 'none',
    goal: clean(input?.goal, 300) || null,
    motive: clean(input?.motive, 320) || null,
    target: clean(input?.target, 240) || null,
    nextMove: clean(input?.nextMove, 260) || null,
    progress: input?.progress == null ? null : Math.max(0, Math.min(1, Number(input.progress) || 0)),
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

export function stabilizePersistentIntent({
  transition = null,
  decision = null,
  activeIntent = null,
  conversationState = 'ongoing',
  behaviorState = null,
  driveState = null,
  scene = null
} = {}) {
  const next = copyTransition(transition);
  const status = clean(activeIntent?.status, 30);
  const live = status === 'active' || status === 'suspended';
  const terminal = status === 'completed' || status === 'cancelled';
  const operation = next.operation;

  if (conversationState === 'ending') {
    if (live) {
      return {
        ...next,
        operation: operation === 'cancel' ? 'cancel' : 'complete',
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

    const maxTurns = Math.max(2, Number(activeIntent?.maxTurns) || 6);
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
      // alive becomes continuation unless the model explicitly completes/cancels first.
      return {
        ...next,
        operation: 'advance',
        goal: null,
        motive: null,
        target: null,
        reason: next.reason || 'activation_folded_into_live_intent'
      };
    }

    return next;
  }

  if (terminal && operation === 'activate') {
    const oldGoal = clean(activeIntent?.goal, 300).toLowerCase();
    const newGoal = clean(next.goal, 300).toLowerCase();
    if (oldGoal && newGoal && oldGoal === newGoal && Number(activeIntent?.cooldownUntilTurn || 0) > Number(activeIntent?.updatedAtTurn || 0)) {
      return { ...next, operation: 'none', goal: null, motive: null, target: null, nextMove: null, progress: null, commitment: null, reason: null };
    }
  }

  if (['advance', 'preserve', 'suspend', 'complete', 'cancel'].includes(operation)) {
    // No live intent exists to mutate. Do not manufacture one from a malformed transition.
    return { ...next, operation: 'none', goal: null, motive: null, target: null, nextMove: null, progress: null, commitment: null, reason: null };
  }

  if (operation === 'activate' && next.goal) return next;

  const inferred = inferredActivation(decision, { driveState, behaviorState, conversationState });
  return inferred || { ...next, operation: 'none', goal: null, motive: null, target: null, nextMove: null, progress: null, commitment: null, reason: null };
}

export const persistentIntentPolicies = MULTI_TURN_ACTS;
