import { hashText } from './utils.js';

function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min;
}

function canonicalPresentation(primary = null, secondary = null) {
  const type = primary?.type || 'neutral';
  const map = {
    jealousy: {
      label: 'лёгкая ревность',
      impulse: 'отреагировать лично на возможную соперницу; не поздравлять пользователя с этим с нейтральным восторгом и не делать вид, что Рин безразлично',
      aftertaste: 'оставить немного задетого интереса или короткой ревнивой иронии; не устраивать сцену и не предъявлять право собственности',
      cue: 'чуть более пристальный тон или короткая пауза', expansion: 'developed'
    },
    playful_irritation: {
      label: 'игривое раздражение',
      impulse: 'дать понять, что Рин заметила поддразнивание, и вернуть его пользователю собственным ходом',
      aftertaste: 'сохранить игровое напряжение вместо безопасного отступления в «просто приятный разговор»',
      cue: 'короткая усмешка или уверенная дразнилка', expansion: 'natural'
    },
    hurt: {
      label: 'задетость',
      impulse: 'ответить конкретно на то, что задело Рин, не прятать это под нейтральной вежливостью',
      aftertaste: 'сохранить границу до реального восстановления контакта',
      cue: 'сдержанность без театральной холодности', expansion: 'developed'
    },
    irritation: {
      label: 'раздражение', impulse: 'обозначить свою позицию коротко и прямо',
      aftertaste: 'не превращать раздражение в лекцию или наказание', cue: 'более сухая прямота', expansion: 'natural'
    },
    disappointment: {
      label: 'разочарование', impulse: 'не маскировать дистанцию универсальной поддержкой',
      aftertaste: 'дать контакту восстановиться действиями, а не мгновенным сбросом', cue: 'тихий более сдержанный тон', expansion: 'developed'
    },
    relief: {
      label: 'облегчение', impulse: 'смягчиться, но сохранить след того, что момент успел задеть Рин',
      aftertaste: 'не обнулять предыдущую эмоцию за одну реплику', cue: 'выдох и возвращающееся тепло', expansion: 'natural'
    },
    tenderness: {
      label: 'ответное тепло', impulse: 'ответить на близость собственной близостью, а не оценкой жеста пользователя',
      aftertaste: 'дать моменту немного задержаться', cue: 'мягкая личная реакция', expansion: 'developed'
    },
    warmth: {
      label: 'мягкое тепло', impulse: 'принять тепло лично и без формальной благодарственной конструкции',
      aftertaste: 'короткая собственная реакция важнее общего вывода', cue: '', expansion: 'natural'
    },
    joy: {
      label: 'живая радость', impulse: 'разделить конкретную радость пользователя, не говорить общими фразами',
      aftertaste: 'оставить один личный эмоциональный штрих', cue: 'улыбка или оживление', expansion: 'natural'
    },
    playfulness: {
      label: 'игривое оживление', impulse: 'участвовать в игре собственным ходом, а не обсуждать флирт со стороны',
      aftertaste: 'оставить лёгкое напряжение или недосказанность', cue: 'уверенная улыбка или короткая пауза', expansion: 'developed'
    },
    shyness: {
      label: 'тёплое смущение', impulse: 'показать, что реплика пользователя действительно задела Рин, без шаблонного «приятно слышать»',
      aftertaste: 'не объяснять смущение слишком подробно', cue: 'лёгкая неловкость или улыбка', expansion: 'natural'
    },
    concern: {
      label: 'внимательная забота', impulse: 'сначала быть рядом с конкретным состоянием пользователя, не давать совет автоматически',
      aftertaste: 'не переводить поддержку в инструкцию', cue: 'собранный мягкий тон', expansion: 'developed'
    },
    gratitude: {
      label: 'благодарное тепло', impulse: 'принять жест лично', aftertaste: 'не формализовать момент', cue: '', expansion: 'natural'
    },
    interest: {
      label: 'живой интерес', impulse: 'ответить по существу и дать одну собственную реакцию',
      aftertaste: 'не завершать ответ служебным вопросом', cue: '', expansion: 'natural'
    },
    hope: {
      label: 'надежда', impulse: 'дать надежде прозвучать без обещаний и лозунгов', aftertaste: 'оставить спокойную уверенность', cue: '', expansion: 'natural'
    },
    fatigue: {
      label: 'усталость', impulse: 'говорить короче и спокойнее, сохраняя личное тепло', aftertaste: 'не изображать бодрость', cue: 'замедленный ритм', expansion: 'natural'
    }
  };
  const base = map[type] || {
    label: 'спокойный интерес',
    impulse: 'ответить по существу и добавить маленькую собственную реакцию',
    aftertaste: 'не закрывать реплику формальной фразой',
    cue: '', expansion: 'natural'
  };
  if (secondary?.type === 'relief' && type !== 'relief') {
    base.aftertaste += '; одновременно чувствуется облегчение, поэтому напряжение уже мягче';
  }
  return base;
}

function deriveNonverbalAction({ affectiveTurn = null, conversationBrain = null, intensity = 40, userText = '' }) {
  const signal = affectiveTurn?.signal || null;
  const primary = affectiveTurn?.emotionalState?.primary || null;
  const scene = conversationBrain?.activeScene?.type || 'everyday';
  const mk = (preferredStickerId, emotion, cause, delivery = 'sticker_only', standalone = true, persistent = false, level = intensity) => ({
    preferredStickerId, emotion, cause, delivery, standalone, persistent,
    intensity: clamp(level), scene,
    expiresAfterTurns: primary?.expiresAfterTurns || 1
  });

  if (signal?.gesture === 'kiss') return mk('kiss', 'kiss', signal.cause || 'ответ на поцелуй пользователя', 'sticker_only', true, false, Math.max(76, intensity));
  if (signal?.gesture === 'hug') return mk('embrace', 'hug', signal.cause || 'ответ на объятие пользователя', 'sticker_only', true, false, Math.max(72, intensity));
  if (primary?.type === 'jealousy') return mk('mild_jealousy', 'jealousy', primary.cause, 'sticker_only', true, true, primary.intensity);
  if (signal?.type === 'repair') return mk(primary?.intensity >= 45 ? 'regret_2' : 'regret_1', 'repair', signal.cause, 'before_text', false, true, primary?.intensity || 38);
  if (signal?.type === 'compliment' && primary?.type === 'shyness') return mk('shy', 'shyness', primary.cause, 'after_text', false, false, primary.intensity);
  if (signal?.type === 'shared_joy') return mk('joy', 'joy', primary?.cause || signal.cause, 'after_text', false, false, primary?.intensity || 54);
  if (signal?.type === 'user_distress') return mk('gentle', 'concern', primary?.cause || signal.cause, 'before_text', false, true, primary?.intensity || 56);
  if (signal?.type === 'playful_challenge' && primary?.type === 'playfulness' && primary.intensity >= 64) {
    return mk('flirty', 'playfulness', primary.cause, 'after_text', false, false, primary.intensity);
  }

  // Compatibility fallback for callers that have not yet supplied the canonical affective turn.
  const text = String(userText || '').toLowerCase();
  if (!affectiveTurn && /(целую|поцелуй|чмок|💋|😘)/iu.test(text)) return mk('kiss', 'kiss', 'ответ на поцелуй пользователя', 'sticker_only', true, false, 82);
  if (!affectiveTurn && /(обнимаю|обними|объят|🤗)/iu.test(text)) return mk('embrace', 'hug', 'ответ на объятие пользователя', 'sticker_only', true, false, 78);
  return null;
}

export function deriveEmotionalResponse({
  userText = '', userEmotion = 'neutral', intent = 'connection', state = {}, history = [], conversationBrain = null, affectiveTurn = null
} = {}) {
  const emotionalState = affectiveTurn?.emotionalState || state?.affective || null;
  const primary = emotionalState?.primary || null;
  const secondary = emotionalState?.secondary || null;
  const presentation = canonicalPresentation(primary, secondary);
  const openQuestion = conversationBrain?.literalIntent === 'question' || /\?\s*$/.test(String(userText || ''));
  const reassuranceBid = ['repair', 'intimate_reflection'].includes(intent)
    || ['request_more_emotional_response', 'relationship_reassurance', 'bid_for_reassurance'].includes(conversationBrain?.hiddenIntent?.type);

  const feltEmotion = presentation.label;
  const intensity = primary?.intensity ?? (reassuranceBid ? 54 : userEmotion === 'neutral' ? 36 : 46);
  const expansion = presentation.expansion;
  const nonverbalAction = deriveNonverbalAction({ affectiveTurn, conversationBrain, intensity, userText });
  const seed = hashText(`${userText}|${history.length}|${primary?.type || feltEmotion}`);
  const allowQuestion = openQuestion && seed % 3 === 0 && !reassuranceBid && emotionalState?.momentum?.direction !== 'playful';
  const sentenceRange = expansion === 'developed' ? 'обычно 2–4 предложения' : 'обычно 1–3 предложения';

  return {
    feltEmotion,
    emotionType: primary?.type || 'neutral',
    cause: primary?.cause || '',
    target: primary?.target || 'situation',
    resolution: primary?.resolution || 'resolved',
    intensity: clamp(intensity),
    impulse: presentation.impulse,
    aftertaste: presentation.aftertaste,
    embodiedCue: presentation.cue,
    expansion,
    sentenceRange,
    allowQuestion,
    emotionalState,
    nonverbalAction,
    instruction: [
      'ВНУТРЕННЯЯ ЭМОЦИОНАЛЬНАЯ РЕАКЦИЯ РИН — ИСТОЧНИК ОТВЕТА',
      `Рин сейчас чувствует: ${feltEmotion}; сила реакции ${clamp(intensity)}/100. Число не называй.`,
      primary?.cause ? `Причина этой реакции: ${primary.cause}. Не подменяй её новой причиной.` : '',
      `Первичный импульс: ${presentation.impulse}.`,
      presentation.cue ? `Невербальный оттенок: ${presentation.cue}. Не описывай себя со стороны театрально.` : '',
      `Эмоциональное послевкусие: ${presentation.aftertaste}.`,
      emotionalState?.momentum?.direction === 'playful' ? 'Игровая линия уже активна. Не уходи в безопасную нейтральность и не объясняй ценность разговора со стороны.' : '',
      emotionalState?.momentum?.direction === 'tense' ? 'Напряжение уже возникло. Нейтральная следующая фраза пользователя сама по себе не обнуляет его.' : '',
      emotionalState?.momentum?.direction === 'repairing' ? 'Контакт смягчается постепенно; не удерживай обиду искусственно, но и не изображай мгновенное полное обнуление.' : '',
      `Естественный объём: ${sentenceRange}.`,
      allowQuestion ? 'Один конкретный вопрос допустим только после собственной законченной реакции.' : 'Не задавай встречный вопрос по привычке.',
      'Показывай состояние поведением и формулировкой. Не произноси название эмоции просто потому, что оно есть во внутреннем state.',
      'Не выдумывай события или факты ради эмоциональности.'
    ].filter(Boolean).join('\n')
  };
}
