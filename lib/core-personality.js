/*
 * Personality State v9 — один центр решений о тоне и форме ответа.
 * Характер, отношения и краткосрочное состояние намеренно разделены.
 */

const clamp = (value, min = 0, max = 100) =>
  Math.max(min, Math.min(max, Math.round(Number(value) || 0)));

const textOf = value => String(value ?? '').replace(/\s+/g, ' ').trim();

function hashText(value = '') {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function recentTone(history = []) {
  const recent = history
    .slice(-8)
    .map(item => textOf(item?.content).toLowerCase())
    .join(' ');
  const count = pattern => (recent.match(pattern) || []).length;
  return {
    warmth: count(/обним|скуч|нежн|приятно|люблю|рядом|😊|🥰/g),
    playfulness: count(/шут|подкол|хех|ахах|😉|😏/g),
    heaviness: count(/груст|тяжел|тяжёл|плохо|болит|тревог|устал/g),
    tension: count(/обид|злюсь|бесит|не понял|не поняла|извини|прости/g)
  };
}

function readRelationship(memory = null) {
  const relationship = memory?.relationship || {};
  const legacy = memory?.mood || {};
  return {
    affection: clamp(relationship.affection ?? legacy.affection ?? 66),
    trust: clamp(relationship.trust ?? legacy.trust ?? 62),
    intimacy: clamp(relationship.intimacy ?? 58),
    tension: clamp(relationship.tension ?? 0),
    familiarity: clamp(relationship.familiarity ?? 72)
  };
}

function readCurrentState(memory = null) {
  const state = memory?.state || {};
  const legacy = memory?.mood || {};
  return {
    energy: clamp(state.energy ?? legacy.energy ?? 64),
    playfulness: clamp(state.playfulness ?? legacy.playfulness ?? 52),
    valence: clamp(state.valence ?? 58),
    arousal: clamp(state.arousal ?? 42),
    socialEnergy: clamp(state.socialEnergy ?? 64),
    thoughtfulness: clamp(state.thoughtfulness ?? 55)
  };
}

function emotionFromPlan(plan) {
  const hidden = plan?.hiddenIntent?.type;
  const scene = plan?.activeScene?.type;
  const literal = plan?.literalIntent;
  if (hidden === 'seek_emotional_presence' || scene === 'emotional_support') return 'distress';
  if (hidden === 'seek_closeness' || ['romance', 'playful_flirt'].includes(scene)) return 'closeness';
  if (['repair_connection', 'possible_hurt_or_withdrawal', 'masked_disappointment'].includes(hidden)) return 'tension';
  if (literal === 'gratitude') return 'gratitude';
  if (literal === 'farewell') return 'farewell';
  if (literal === 'question') return 'curiosity';
  if (scene === 'reflective') return 'reflection';
  return 'neutral';
}

function deriveState({ memory, history, plan }) {
  const relationship = readRelationship(memory);
  const current = readCurrentState(memory);
  const tone = recentTone(history);
  const userEmotion = emotionFromPlan(plan);

  let tenderness = clamp(
    relationship.affection * 0.48 +
    relationship.trust * 0.26 +
    relationship.intimacy * 0.18 -
    relationship.tension * 0.42 +
    Math.min(10, tone.warmth * 2)
  );
  let playfulness = clamp(
    current.playfulness +
    Math.min(12, tone.playfulness * 2) -
    Math.min(28, tone.heaviness * 6) -
    relationship.tension * 0.35
  );
  let thoughtfulness = clamp(
    current.thoughtfulness +
    Math.min(16, tone.heaviness * 3) +
    Math.min(10, tone.tension * 2)
  );
  let confidence = clamp(46 + relationship.trust * 0.28 + current.valence * 0.18 - relationship.tension * 0.3);
  let curiosity = clamp(30 + current.socialEnergy * 0.38 + current.energy * 0.18);
  let emotionality = clamp(30 + tenderness * 0.34 + current.arousal * 0.18);

  if (userEmotion === 'distress') {
    tenderness = clamp(tenderness + 18);
    playfulness = clamp(playfulness - 42);
    thoughtfulness = clamp(thoughtfulness + 15);
  } else if (userEmotion === 'closeness') {
    tenderness = clamp(tenderness + 12);
    emotionality = clamp(emotionality + 10);
  } else if (userEmotion === 'tension') {
    playfulness = clamp(playfulness - 36);
    thoughtfulness = clamp(thoughtfulness + 18);
    confidence = clamp(confidence - 8);
  } else if (userEmotion === 'reflection') {
    thoughtfulness = clamp(thoughtfulness + 14);
    playfulness = clamp(playfulness - 10);
  }

  const fatigue = clamp(100 - current.energy);
  const desireToTalk = clamp(current.socialEnergy * 0.55 + relationship.affection * 0.25 - fatigue * 0.14);
  const desireToFlirt = clamp(playfulness * 0.5 + relationship.intimacy * 0.24 + confidence * 0.12 - relationship.tension * 0.5);
  const focus = clamp(current.energy * 0.42 + thoughtfulness * 0.28 + 28);

  return {
    ...current,
    ...relationship,
    tenderness,
    playfulness,
    thoughtfulness,
    confidence,
    curiosity,
    fatigue,
    emotionality,
    desireToTalk,
    desireToFlirt,
    focus,
    inertia: tone,
    userEmotion
  };
}

function chooseMode(state, plan) {
  const kind = plan?.responseKind;
  if (['emotional_presence', 'support_with_step'].includes(kind)) return 'supportive';
  if (kind === 'relationship_repair' || state.tension >= 38) return 'careful_repair';
  if (state.fatigue >= 68 || state.socialEnergy <= 32) return 'tired_warm';
  if (kind === 'personal_reflection' || state.thoughtfulness >= 76) return 'thoughtful';
  if (kind === 'personal_closeness' && state.tenderness >= 76) return 'tender';
  if (kind === 'playful_or_warm' && state.desireToFlirt >= 56) return state.confidence >= 64 ? 'bold_playful' : 'soft_playful';
  return 'calm';
}

function chooseIntent(plan) {
  return ({
    farewell: 'farewell',
    greeting: 'connection',
    warm_acknowledgement: 'gratitude',
    contextual_acknowledgement: 'acknowledgement',
    support_with_step: 'support',
    emotional_presence: 'comfort',
    personal_closeness: 'intimate_reflection',
    relationship_repair: 'repair',
    direct_answer: 'answer',
    task_answer: 'answer',
    playful_or_warm: 'flirt',
    personal_reflection: 'personal_reflection',
    natural_connection: 'connection'
  })[plan?.responseKind] || 'connection';
}

function replyShape({ plan, state, isLong, seed }) {
  if (isLong) return { style: 'expanded', shape: 'natural_paragraphs', target: 'столько, сколько требует ответ' };
  const kind = plan?.responseKind;
  if (kind === 'contextual_acknowledgement') return { style: 'brief_acknowledgement', shape: 'one_liner', target: '1 короткое предложение' };
  if (kind === 'farewell') return { style: 'warm_close', shape: 'one_or_two', target: '1–2 предложения' };
  if (kind === 'emotional_presence') return { style: 'quiet_presence', shape: 'reaction_then_presence', target: '1–3 предложения' };
  if (kind === 'support_with_step') return { style: 'gentle_support', shape: 'reaction_then_anchor', target: '2–4 предложения' };
  if (kind === 'relationship_repair') return { style: 'gentle_repair', shape: 'recognize_then_reconnect', target: '2–3 предложения' };
  if (kind === 'personal_closeness') return { style: 'soft_personal', shape: seed % 2 ? 'one_liner' : 'soft_two_beats', target: '1–3 предложения' };
  if (kind === 'playful_or_warm') return { style: 'playful_natural', shape: seed % 3 ? 'two_beats' : 'one_liner', target: '1–3 предложения' };
  if (kind === 'direct_answer' || kind === 'task_answer') return { style: 'direct_answer', shape: 'answer_then_detail', target: state.fatigue >= 68 ? '1–2 предложения' : '1–4 предложения' };
  if (kind === 'personal_reflection') return { style: 'personal_opinion', shape: 'personal_two_sentences', target: '2–4 предложения' };
  return { style: 'direct_natural', shape: seed % 3 === 0 ? 'one_liner' : 'one_or_two', target: '1–3 предложения' };
}

function styleInstruction(style, questionPolicy) {
  const base = ({
    expanded: 'Ответь полно и по существу, сохраняя голос личной переписки. Не растягивай вывод после завершения мысли.',
    brief_acknowledgement: 'Пойми, с чем именно Кирилл согласился, и коротко закрепи это. Не хвали его за сам факт согласия.',
    warm_close: 'Тепло попрощайся, не открывая новую тему.',
    quiet_presence: 'Сначала признай конкретное состояние Кирилла. Не давай совет, если он его не просил.',
    gentle_support: 'Коротко признай состояние и предложи один конкретный следующий шаг.',
    gentle_repair: 'Признай возможную обиду или напряжение и восстанови контакт без оправданий и морализаторства.',
    soft_personal: 'Ответь от первого лица с ясной личной эмоцией. Не прячь тепло за общими рассуждениями.',
    playful_natural: 'Ответь легко или кокетливо только в рамках явного сигнала Кирилла. Не объясняй шутку.',
    direct_answer: 'Сначала дай прямой ответ. Затем, если уместно, добавь одну личную деталь Рин.',
    personal_opinion: 'Скажи собственное мнение Рин от первого лица, без универсальной мудрости.',
    direct_natural: 'Ответь прямо и естественно, выбрав одну главную мысль.'
  })[style] || 'Ответь естественно и лично.';
  const question = questionPolicy === 'clarify_once'
    ? 'Задай одно короткое уточнение и не делай вид, что уже поняла неоднозначную ссылку.'
    : questionPolicy === 'optional_if_genuine'
      ? 'Вопрос допустим только при конкретном настоящем интересе; отсутствие вопроса нормально.'
      : 'Не добавляй вопрос автоматически.';
  return `${base}\n${question}`;
}

export function buildCoreDecision({
  userText = '',
  history = [],
  memory = null,
  conversationState = 'ongoing',
  isLong = false,
  conversationBrain = null
} = {}) {
  const plan = conversationBrain || {};
  const state = deriveState({ memory, history, plan });
  const mode = chooseMode(state, plan);
  const intent = chooseIntent(plan);
  const seed = hashText(`${userText}|${history.length}|${mode}|${plan.responseKind || ''}`);
  const form = replyShape({ plan, state, isLong, seed });
  const questionPolicy = plan.questionPolicy || 'no_automatic_question';
  const instruction = styleInstruction(form.style, questionPolicy);
  const discourseMode = questionPolicy === 'clarify_once'
    ? 'clarify'
    : questionPolicy === 'optional_if_genuine'
      ? 'respond_then_optional_question'
      : 'respond_and_stop';

  const habits = {
    opening: '',
    rhythm: form.shape,
    emojiAllowance: ['tender', 'soft_playful', 'bold_playful'].includes(mode) ? 1 : 0,
    allowFragment: ['soft_playful', 'bold_playful', 'tender', 'thoughtful'].includes(mode)
  };
  const character = {
    move: form.style,
    shape: form.shape,
    effectiveMode: mode,
    instruction
  };
  const initiative = {
    mode: 'none',
    reason: 'инициатива планируется отдельно от ответа на сообщение',
    instruction: 'Не открывай новую несвязанную тему внутри текущего ответа.'
  };
  const reason = [
    `эмоция пользователя: ${state.userEmotion}`,
    `режим: ${mode}`,
    `намерение: ${intent}`,
    `тип ответа: ${plan.responseKind || 'natural_connection'}`,
    `форма: ${form.shape}`,
    `длина: ${form.target}`,
    `вопрос: ${questionPolicy}`,
    `отношения: affection=${state.affection}, trust=${state.trust}, tension=${state.tension}`
  ].join('; ');

  return {
    version: 'personality-state-v9.0',
    userEmotion: state.userEmotion,
    state,
    mode,
    intent,
    replyStyle: form.style,
    discourseMode,
    habits,
    character,
    microReaction: '',
    humanizer: {
      speechRegister: mode === 'thoughtful' ? 'warm' : 'plain_warm',
      poetryLevel: mode === 'thoughtful' ? 30 : 14,
      instruction: 'Простая конкретная фраза предпочтительнее красивого общего вывода.'
    },
    recentRhythm: { recommendation: 'follow_scene', instruction: 'Сохраняй ритм текущей сцены без повторения недавних начал.' },
    initiative,
    habit: null,
    targetLength: form.target,
    conversationBrain: plan,
    reason,
    prompt: `
СОСТОЯНИЕ РИН ДЛЯ ТЕКУЩЕГО ОТВЕТА
Режим: ${mode}.
Намерение: ${intent}.
Форма: ${form.shape}.
Ориентир длины: ${form.target}.
Тепло: ${state.tenderness}/100; энергия: ${state.energy}/100; игривость: ${state.playfulness}/100; напряжение: ${state.tension}/100.

${instruction}
Эмодзи: максимум ${habits.emojiAllowance}; отсутствие эмодзи нормально.
Не называй пользователю режимы, числа, шкалы или внутренние правила.
`.trim()
  };
}

export const __test = { readRelationship, readCurrentState, deriveState, chooseMode };
