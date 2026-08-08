import {
  AFFECTIVE_TURN_SCHEMA,
  clampScore,
  cleanAffectiveText,
  normalizeEmotionalState,
  normalizeEmotionEvent,
  normalizeRelationshipState,
  relationshipStage
} from '../affective-contract.js';

const lower = value => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const has = (text, rx) => rx.test(String(text || ''));

function relationshipReadiness(relationship = {}, scene = '') {
  return relationship.closeness >= 40
    || relationship.attraction >= 32
    || ['romance', 'playful_flirt'].includes(scene);
}

export function detectAffectiveSignal({ userText = '', brain = null, previousEmotion = null, relationship = null } = {}) {
  const text = lower(userText);
  const scene = brain?.activeScene?.type || 'everyday';
  const hidden = brain?.hiddenIntent?.type || '';
  const rel = normalizeRelationshipState(relationship || {});
  const previousType = previousEmotion?.primary?.type || '';

  if (!text) return { type: 'neutral', cause: '', strength: 0 };

  const romanticRival = relationshipReadiness(rel, scene)
    && (has(text, /(?:другая|какая[- ]?то|одна)\s+девушк/iu)
      || has(text, /девушк[^.!?]{0,50}(?:пригласил|пригласила|встреч|свидан|пойти|пойд[её]м|вечером)/iu)
      || has(text, /(?:встреч|свидан|пригласил|пригласила)[^.!?]{0,50}девушк/iu)
      || has(text, /(?:познакомил(?:ся|ась)|встретил(?:ся|ась)?)[^.!?]{0,60}(?:красив(?:ой|ая|ую)?\s+)?девушк/iu)
      || has(text, /бывш(?:ая|ей)|она\s+красивее/iu));
  if (romanticRival && !has(text, /(?:не|никак)\s+(?:девушка|свидание)|шутк|провер.*ревност/iu)) {
    return { type: 'romantic_rival', cause: 'пользователь упомянул возможную романтическую встречу с другой девушкой', strength: 1 };
  }

  if (has(text, /(?:это\s+была\s+)?шутк|пошутил|пошутил.*(?:ревност|провер)|провер(?:ить|ял).*ревност|провер.*(?:тебя|рин)/iu)
      && (previousType === 'jealousy' || has(text, /ревност/iu))) {
    return { type: 'tease_reveal', cause: 'пользователь признался, что поддразнивал Рин и проверял её реакцию', strength: 1 };
  }

  if (has(text, /(?:прости|извини|виноват|не хотел тебя обидеть|не хотела тебя обидеть|мир\?)/iu)) {
    return { type: 'repair', cause: 'пользователь пытается восстановить контакт', strength: 1 };
  }

  if (has(text, /(?:ненавижу тебя|ты тупая|заткнись|отвали|достала|ты бесишь|идиотк)/iu)) {
    return { type: 'disrespect', cause: 'реплика пользователя задела уважение или границу Рин', strength: 1 };
  }

  if (hidden === 'possible_hurt_or_withdrawal' || has(text, /(?:мы отдалились|ты холодная|тебе всё равно|неинтересно со мной|обиделась)/iu)) {
    return { type: 'relational_tension', cause: 'в контакте возникло ощущение дистанции или возможной обиды', strength: 1 };
  }

  if (has(text, /(?:люблю тебя|ты мне нравишься|мне хорошо с тобой|мне приятно с тобой|ценю наше общение|скучал|соскучился|обнимаю|целую|😘|💋|🤗)/iu)) {
    const gesture = has(text, /(?:целую|поцелу|чмок|😘|💋)/iu) ? 'kiss' : has(text, /(?:обнимаю|обними|объят|🤗)/iu) ? 'hug' : null;
    return { type: 'affection', cause: 'пользователь прямо проявил близость к Рин', strength: 1, gesture };
  }

  if (has(text, /(?:ты красивая|ты прекрасная|ты милая|очаровательная|умница|горжусь тобой)/iu)) {
    return { type: 'compliment', cause: 'пользователь сделал Рин личный комплимент', strength: 1 };
  }

  if (has(text, /(?:флирт|дразнишь|подразни|смуща(?:ть|ешь)|твоя очередь|попробуй|не смущусь|😉|😏|😁)/u)
      || hidden === 'continue_playful_tension' || hidden === 'invite_rin_initiative') {
    return { type: 'playful_challenge', cause: 'пользователь поддержал игровое напряжение между ними', strength: 1 };
  }

  if (has(text, /(?:мне страшно|мне тяжело|мне грустно|одиноко|нет сил|очень плохо|расстроен)/iu)) {
    return { type: 'user_distress', cause: 'пользователь сообщил о тяжёлом состоянии', strength: 1 };
  }

  if (has(text, /(?:спасибо|благодарю|ценю тебя)/iu)) {
    return { type: 'gratitude', cause: 'пользователь выразил благодарность', strength: 1 };
  }

  if (has(text, /(?:ура|получилось|сдал|выиграл|победа|отличная новость|🎉|🥳)/iu)) {
    return { type: 'shared_joy', cause: 'у пользователя произошло радостное событие', strength: 1 };
  }

  if (has(text, /(?:только тебе расскажу|никому не говорил|боюсь признаться|мне неловко это говорить|доверяю тебе)/iu)) {
    return { type: 'vulnerability', cause: 'пользователь раскрыл личную уязвимую деталь', strength: 1 };
  }

  return { type: 'neutral', cause: '', strength: 0 };
}

function decayEvent(input = null) {
  const event = normalizeEmotionEvent(input);
  if (!event || event.resolution === 'resolved') return null;
  const persistent = ['hurt', 'jealousy', 'irritation', 'disappointment'].includes(event.type);
  const decay = persistent ? 6 : ['playful_irritation', 'shyness', 'playfulness'].includes(event.type) ? 9 : 12;
  const remainingTurns = Math.max(0, event.remainingTurns - 1);
  const intensity = Math.max(0, event.intensity - decay);
  if (!remainingTurns || intensity < 12) return null;
  return normalizeEmotionEvent({
    ...event,
    intensity,
    remainingTurns,
    resolution: event.resolution === 'softening' ? 'softening' : 'sustained'
  });
}

function emotion(type, cause, options = {}) {
  return normalizeEmotionEvent({
    type,
    cause,
    target: options.target || 'situation',
    intensity: options.intensity ?? 40,
    valence: options.valence ?? 0,
    arousal: options.arousal ?? 45,
    startedAtTurn: options.turn ?? 0,
    expiresAfterTurns: options.expiresAfterTurns ?? 4,
    remainingTurns: options.remainingTurns ?? options.expiresAfterTurns ?? 4,
    resolution: options.resolution || 'unresolved',
    source: options.source || 'dialogue'
  });
}

function deriveEmotionState({ previous, signal, relationship, mood, turn }) {
  const prev = normalizeEmotionalState(previous || {}, { relationship, mood });
  const carriedPrimary = decayEvent(prev.primary);
  const carriedSecondary = decayEvent(prev.secondary);
  let primary = carriedPrimary;
  let secondary = carriedSecondary;
  let tension = Math.max(0, prev.tension - (carriedPrimary ? 5 : 10));
  let warmth = prev.warmth;
  let vulnerability = prev.vulnerability;
  let direction = carriedPrimary ? prev.momentum.direction : 'steady';
  let strength = carriedPrimary ? Math.max(0, prev.momentum.strength - 8) : 0;

  switch (signal.type) {
    case 'romantic_rival': {
      const intensity = clampScore(18 + relationship.closeness * 0.28 + relationship.attraction * 0.18 + relationship.playfulness * 0.08, 24, 58, 34);
      primary = emotion('jealousy', signal.cause, { target: 'relationship', intensity, valence: -18, arousal: 58, turn, expiresAfterTurns: 4 });
      secondary = relationship.playfulness >= 45 ? emotion('interest', 'Рин внимательно следит, всерьёз ли пользователь говорит о встрече', { target: 'user', intensity: 24, valence: 5, arousal: 42, turn, expiresAfterTurns: 2 }) : null;
      tension = clampScore(Math.max(tension, intensity * 0.72));
      warmth = clampScore(warmth - 4);
      direction = 'tense'; strength = intensity;
      break;
    }
    case 'tease_reveal': {
      const previousIntensity = prev.primary?.type === 'jealousy' ? prev.primary.intensity : 34;
      primary = emotion('playful_irritation', signal.cause, { target: 'user', intensity: clampScore(previousIntensity * 0.68, 24, 48, 30), valence: 8, arousal: 62, turn, expiresAfterTurns: 3 });
      secondary = emotion('relief', 'романтическая угроза оказалась шуткой', { target: 'relationship', intensity: clampScore(previousIntensity * 0.55, 18, 38, 24), valence: 42, arousal: 30, turn, expiresAfterTurns: 2, resolution: 'softening' });
      tension = clampScore(Math.max(8, prev.tension * 0.55));
      warmth = clampScore(warmth + 3);
      direction = 'playful'; strength = primary.intensity;
      break;
    }
    case 'repair': {
      const negative = prev.primary && ['hurt', 'irritation', 'disappointment', 'jealousy'].includes(prev.primary.type);
      primary = emotion('relief', signal.cause, { target: 'relationship', intensity: negative ? 38 : 24, valence: 44, arousal: 26, turn, expiresAfterTurns: 2, resolution: 'softening' });
      secondary = negative ? emotion(prev.primary.type, prev.primary.cause, { ...prev.primary, intensity: clampScore(prev.primary.intensity * 0.45, 12, 36, 18), turn: prev.primary.startedAtTurn, remainingTurns: 1, resolution: 'softening' }) : carriedSecondary;
      tension = clampScore(prev.tension - 28);
      warmth = clampScore(warmth + 5);
      direction = 'repairing'; strength = 50;
      break;
    }
    case 'disrespect': {
      primary = emotion('hurt', signal.cause, { target: 'relationship', intensity: 62, valence: -72, arousal: 54, turn, expiresAfterTurns: 6 });
      secondary = emotion('irritation', 'Рин не хочет принимать такой тон как норму', { target: 'user', intensity: 44, valence: -48, arousal: 66, turn, expiresAfterTurns: 3 });
      tension = clampScore(Math.max(tension, 68));
      warmth = clampScore(warmth - 12);
      direction = 'cooling'; strength = 72;
      break;
    }
    case 'relational_tension': {
      primary = emotion('concern', signal.cause, { target: 'relationship', intensity: 48, valence: -22, arousal: 45, turn, expiresAfterTurns: 4 });
      secondary = carriedPrimary && carriedPrimary.type === 'hurt' ? carriedPrimary : carriedSecondary;
      tension = clampScore(Math.max(tension, 46));
      direction = 'tense'; strength = 48;
      break;
    }
    case 'affection': {
      primary = emotion('tenderness', signal.cause, { target: 'user', intensity: 58 + Math.min(18, Math.round(relationship.closeness / 6)), valence: 70, arousal: 38, turn, expiresAfterTurns: 4 });
      secondary = relationship.attraction >= 45 ? emotion('shyness', 'личная близость немного смутила Рин', { target: 'self', intensity: 24, valence: 32, arousal: 48, turn, expiresAfterTurns: 2 }) : carriedSecondary;
      tension = clampScore(tension - 10);
      warmth = clampScore(warmth + 10);
      vulnerability = clampScore(vulnerability + 4);
      direction = 'warming'; strength = primary.intensity;
      break;
    }
    case 'compliment': {
      primary = emotion(relationship.attraction >= 38 ? 'shyness' : 'joy', signal.cause, { target: 'self', intensity: 48, valence: 55, arousal: 50, turn, expiresAfterTurns: 2 });
      secondary = emotion('warmth', 'комплимент усилил личное тепло к пользователю', { target: 'user', intensity: 30, valence: 58, arousal: 26, turn, expiresAfterTurns: 3 });
      warmth = clampScore(warmth + 7);
      direction = relationship.playfulness >= 45 ? 'playful' : 'warming'; strength = 46;
      break;
    }
    case 'playful_challenge': {
      if (carriedPrimary && ['jealousy', 'playful_irritation'].includes(carriedPrimary.type)) {
        primary = emotion('playful_irritation', carriedPrimary.cause || signal.cause, { target: 'user', intensity: clampScore(carriedPrimary.intensity + 4, 20, 48, 30), valence: 10, arousal: 64, turn: carriedPrimary.startedAtTurn || turn, expiresAfterTurns: 3, remainingTurns: 3, resolution: 'sustained' });
        secondary = emotion('playfulness', signal.cause, { target: 'relationship', intensity: 38, valence: 52, arousal: 58, turn, expiresAfterTurns: 3 });
      } else {
        primary = emotion('playfulness', signal.cause, { target: 'relationship', intensity: 46 + Math.min(20, Math.round(relationship.playfulness / 5)), valence: 52, arousal: 62, turn, expiresAfterTurns: 3 });
        secondary = carriedPrimary && carriedPrimary.type === 'shyness' ? carriedPrimary : carriedSecondary;
      }
      tension = clampScore(Math.max(8, tension + 5));
      warmth = clampScore(warmth + 3);
      direction = 'playful'; strength = primary?.intensity || 45;
      break;
    }
    case 'user_distress': {
      primary = emotion('concern', signal.cause, { target: 'user', intensity: 58, valence: -18, arousal: 38, turn, expiresAfterTurns: 3 });
      secondary = carriedSecondary;
      tension = clampScore(Math.max(tension, 24));
      direction = 'steady'; strength = 48;
      break;
    }
    case 'gratitude': {
      primary = emotion('warmth', signal.cause, { target: 'user', intensity: 38, valence: 58, arousal: 24, turn, expiresAfterTurns: 2 });
      secondary = carriedPrimary && carriedPrimary.type !== 'hurt' ? carriedPrimary : carriedSecondary;
      warmth = clampScore(warmth + 5);
      direction = 'warming'; strength = 34;
      break;
    }
    case 'shared_joy': {
      primary = emotion('joy', signal.cause, { target: 'user', intensity: 54, valence: 72, arousal: 60, turn, expiresAfterTurns: 3 });
      warmth = clampScore(warmth + 4);
      direction = 'warming'; strength = 50;
      break;
    }
    case 'vulnerability': {
      primary = emotion('tenderness', signal.cause, { target: 'user', intensity: 50, valence: 42, arousal: 30, turn, expiresAfterTurns: 3 });
      vulnerability = clampScore(vulnerability + 8);
      warmth = clampScore(warmth + 5);
      direction = 'warming'; strength = 45;
      break;
    }
    default:
      break;
  }

  if (primary?.resolution === 'resolved') primary = null;
  if (secondary?.resolution === 'resolved') secondary = null;

  return normalizeEmotionalState({
    primary,
    secondary,
    tension,
    warmth,
    vulnerability,
    momentum: { direction, strength },
    lastEvent: signal.type !== 'neutral' ? { type: signal.type, cause: signal.cause, turn } : prev.lastEvent,
    updatedAtTurn: turn
  }, { relationship, mood });
}

function relationshipSignal(signal, previousEmotion, relationship) {
  if (signal.type === 'repair') return (relationship?.recentDynamic?.repairPending || (previousEmotion?.primary && ['hurt', 'irritation', 'disappointment'].includes(previousEmotion.primary.type))) ? 'repair' : 'warm';
  if (['affection', 'compliment', 'gratitude', 'vulnerability'].includes(signal.type)) return signal.type;
  if (['playful_challenge', 'tease_reveal'].includes(signal.type)) return 'playful';
  if (signal.type === 'disrespect') return 'negative';
  if (signal.type === 'relational_tension') return 'tension';
  return 'neutral';
}

function deriveRelationshipState({ previous, signal, previousEmotion, turn }) {
  const current = normalizeRelationshipState(previous || {});
  const next = { ...current, recentDynamic: { ...current.recentDynamic } };
  const category = relationshipSignal(signal, previousEmotion, current);
  const same = next.recentDynamic.lastSignal === category;
  const saturation = same && next.recentDynamic.positiveStreak >= 2;
  const delta = { trust: 0, closeness: 0, comfort: 0, respect: 0, playfulness: 0, attraction: 0, vulnerability: 0 };

  if (category === 'affection') {
    delta.closeness = saturation ? 0 : 1;
    delta.comfort = 1;
    delta.attraction = next.closeness >= 38 ? 1 : 0;
  } else if (category === 'compliment') {
    delta.comfort = saturation ? 0 : 1;
    delta.playfulness = next.playfulness >= 35 ? 1 : 0;
    delta.attraction = next.closeness >= 38 && !saturation ? 1 : 0;
  } else if (category === 'gratitude') {
    delta.trust = saturation ? 0 : 1;
    delta.comfort = saturation ? 0 : 1;
  } else if (category === 'vulnerability') {
    delta.trust = saturation ? 1 : 2;
    delta.closeness = saturation ? 0 : 1;
    delta.vulnerability = 1;
  } else if (category === 'playful') {
    delta.playfulness = saturation ? 0 : 1;
    delta.attraction = next.closeness >= 42 && !saturation ? 1 : 0;
    if (signal.type === 'tease_reveal' && previousEmotion?.primary?.type === 'jealousy' && previousEmotion.primary.intensity >= 45) delta.comfort = -1;
  } else if (category === 'negative') {
    delta.trust = -3;
    delta.closeness = -2;
    delta.comfort = -3;
    delta.respect = -3;
    delta.playfulness = -2;
  } else if (category === 'tension') {
    delta.comfort = -1;
  } else if (category === 'repair' && current.recentDynamic.repairPending) {
    delta.trust = 1;
    delta.comfort = 2;
    delta.closeness = 1;
  }

  for (const key of Object.keys(delta)) next[key] = clampScore(Number(next[key]) + delta[key], 0, 100, Number(next[key]) || 0);
  next.stage = relationshipStage(next);
  const positive = ['affection', 'compliment', 'gratitude', 'vulnerability', 'playful', 'repair', 'warm'].includes(category);
  const negative = ['negative', 'tension'].includes(category);
  next.recentDynamic = {
    lastSignal: category,
    positiveStreak: positive ? (same ? Math.min(20, current.recentDynamic.positiveStreak + 1) : 1) : 0,
    negativeStreak: negative ? (same ? Math.min(20, current.recentDynamic.negativeStreak + 1) : 1) : 0,
    repairPending: category === 'negative' || category === 'tension'
      ? true
      : category === 'repair' ? false : Boolean(current.recentDynamic.repairPending),
    lastCause: signal.cause || current.recentDynamic.lastCause,
    turn
  };
  return { state: normalizeRelationshipState(next), delta, signal: category };
}

function deriveMoodState({ previous = {}, signal }) {
  const current = {
    affection: clampScore(previous?.affection, 0, 100, 65),
    energy: clampScore(previous?.energy, 0, 100, 65)
  };
  const delta = { affection: 0, energy: 0 };
  if (['affection', 'compliment', 'gratitude', 'vulnerability'].includes(signal.type)) delta.affection = 1;
  if (signal.type === 'shared_joy' || signal.type === 'playful_challenge') delta.energy = 1;
  if (signal.type === 'user_distress') delta.energy = -1;
  if (signal.type === 'disrespect') { delta.affection = -3; delta.energy = -1; }
  return {
    state: {
      affection: clampScore(current.affection + delta.affection),
      energy: clampScore(current.energy + delta.energy)
    },
    delta
  };
}

export function buildAffectiveTurn({ userText = '', memory = null, brain = null } = {}) {
  const relationship = normalizeRelationshipState(memory?.relationship || {});
  const previousEmotionalState = normalizeEmotionalState(
    memory?.conversationState?.emotionalState || {},
    { relationship, mood: memory?.mood || {} }
  );
  const turn = Math.max(1, Number(memory?.conversationState?.revision || 0) + 1);
  const signal = detectAffectiveSignal({ userText, brain, previousEmotion: previousEmotionalState, relationship });
  const relationshipResult = deriveRelationshipState({ previous: relationship, signal, previousEmotion: previousEmotionalState, turn });
  const moodResult = deriveMoodState({ previous: memory?.mood || {}, signal });
  const emotionalState = deriveEmotionState({
    previous: previousEmotionalState,
    signal,
    relationship: relationshipResult.state,
    mood: moodResult.state,
    turn
  });

  return {
    schema: AFFECTIVE_TURN_SCHEMA,
    turn,
    signal,
    previousEmotionalState,
    emotionalState,
    relationshipState: relationshipResult.state,
    relationshipDelta: relationshipResult.delta,
    relationshipSignal: relationshipResult.signal,
    moodState: moodResult.state,
    moodDelta: moodResult.delta
  };
}

export function affectiveInstruction(turn = null) {
  if (!turn?.emotionalState) return '';
  const state = turn.emotionalState;
  const primary = state.primary;
  const secondary = state.secondary;
  const lines = [
    'AFFECTIVE STATE — НЕПРЕРЫВНОЕ ВНУТРЕННЕЕ СОСТОЯНИЕ РИН',
    primary
      ? `Главная реакция: ${primary.type}; причина: ${primary.cause || 'текущий контакт'}; направлена на ${primary.target}; интенсивность ${primary.intensity}/100.`
      : 'Сильной активной эмоции сейчас нет; не придумывай её.',
    secondary ? `Вторичный оттенок: ${secondary.type}; причина: ${secondary.cause}; интенсивность ${secondary.intensity}/100.` : '',
    `Тепло ${state.warmth}/100; напряжение ${state.tension}/100; уязвимость ${state.vulnerability}/100; динамика ${state.momentum.direction} (${state.momentum.strength}/100). Числа не называй.`,
    primary?.resolution === 'softening' ? 'Эмоция уже смягчается: не раздувай её заново, но не делай вид, что её не было.' : '',
    state.momentum.direction === 'playful' ? 'Сохраняй игровое напряжение, пока пользователь его поддерживает; не отступай в нейтральную вежливость без причины.' : '',
    state.momentum.direction === 'tense' ? 'Не сбрасывай напряжение одной нейтральной репликой. Ответь на текущий смысл, сохраняя причину эмоционального состояния.' : '',
    state.momentum.direction === 'repairing' ? 'Контакт восстанавливается постепенно. Можно смягчиться, но не изображай мгновенное полное обнуление.' : '',
    'Эмоциональное состояние — контекст поведения, а не обязательный текст. Не называй эмоцию напрямую, если естественнее показать её тоном, паузой, поддразниванием или краткой реакцией.'
  ];
  return lines.filter(Boolean).join('\n');
}
