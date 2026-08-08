import { cleanText } from './cognitive-contract.js';

const QUESTION = /\?|^(?:кто|что|где|когда|почему|зачем|как|какой|какая|какие|сколько|можно|ты|тебе|у тебя)\b/iu;
const VULNERABLE = /(плохо|груст|страш|боюсь|одинок|обид|тяжел|тяжёл|не справля|ненавиж|устал|больно|помоги)/iu;
const FAREWELL = /(пока|до завтра|спокойной ночи|до встречи|увидимся)/iu;
const CORRECTION = /^(нет[, ]|не так|я имел в виду|точнее|вообще-то|на самом деле)/iu;
const ACK = /^(?:ага|угу|мм+|мгм|понятно|ясно|ок(?:ей)?|ладно|хорошо|точно|согласен|согласна|верно|ну да|да)[.!… )]*$/iu;
const REACTION_ONLY = /^(?:[\p{Emoji_Presentation}\p{Extended_Pictographic}\s.!…)+]+)$/u;
const CLOSURE = /^(?:спасибо|благодарю|принято|договорились|вот именно|ну вот)[.!… )]*$/iu;

function lastVisibleAssistant(history = []) {
  return [...(Array.isArray(history) ? history : [])].reverse().find(item => item?.role === 'assistant' && ['text','voice','sticker'].includes(item?.kind || 'text')) || null;
}

function silenceEligibility({ userText, brain, dialogueState, explicitReplyTarget, history, characterIntent, persistentIntent, emotionalState }) {
  const text = cleanText(userText, 1000);
  const last = lastVisibleAssistant(history);
  const scene = dialogueState?.scene || brain?.activeScene?.type || 'everyday';
  const benignAcknowledgement = brain?.hiddenIntent?.type === 'acknowledge_previous_proposal' || brain?.relation?.type === 'acknowledges_previous_turn';
  const noObligation = (!(brain?.obligations || []).length || benignAcknowledgement) && !brain?.ambiguity?.shouldClarify;
  const lastAsked = Boolean(last && /\?\s*$/.test(String(last.content || '')));
  const activeHook = Boolean(dialogueState?.openHook && (dialogueState?.continuityStrength || 0) >= 0.72);
  const directNeed = QUESTION.test(text) || VULNERABLE.test(text) || FAREWELL.test(text) || CORRECTION.test(text) || explicitReplyTarget;
  const meaningfulNewInfo = text.length > 32 && !ACK.test(text) && !CLOSURE.test(text) && !REACTION_ONLY.test(text);
  const candidate = ACK.test(text) || CLOSURE.test(text) || REACTION_ONLY.test(text);

  if (directNeed || lastAsked || activeHook || meaningfulNewInfo || !noObligation) return { allowed: false, reason: 'есть смысловое обязательство ответить' };
  const emotionalMomentum = emotionalState?.momentum?.direction || 'steady';
  const activeEmotion = emotionalState?.primary?.type || 'neutral';
  if (['emotional_support','conflict_repair','romance','playful_flirt'].includes(scene) && (characterIntent?.strength >= 65 || emotionalMomentum === 'playful' || (activeEmotion !== 'neutral' && Number(emotionalState?.primary?.intensity || 0) >= 30))) {
    return { allowed: false, reason: 'активная эмоциональная сцена требует собственного хода Рин' };
  }
  if (persistentIntent?.status === 'active' && Number(persistentIntent?.commitment) >= 55) {
    return { allowed: false, reason: 'есть активное собственное намерение Рин, которое ещё не завершено' };
  }
  if (characterIntent?.strength >= 72 && ['hold_boundary', 'tease_or_advance', 'show_contained_jealousy'].includes(characterIntent?.move)) {
    return { allowed: false, reason: 'активная эмоциональная инерция требует продолжения, а не случайного silence' };
  }
  if (!candidate) return { allowed: false, reason: 'реплика содержит самостоятельное содержание' };
  return { allowed: true, reason: REACTION_ONLY.test(text) ? 'самодостаточная реакция без вопроса и нового содержания' : 'микросцена естественно завершена подтверждением' };
}

export function directConversation({ userText = '', brain = null, dialogueState = null, history = [], explicitReplyTarget = null, characterIntent = null, persistentIntent = null, relationshipIntent = null, emotionalState = null } = {}) {
  const silence = silenceEligibility({ userText, brain, dialogueState, explicitReplyTarget, history, characterIntent, persistentIntent, emotionalState });
  const scene = dialogueState?.scene || brain?.activeScene?.type || 'everyday';
  const phase = dialogueState?.topicDrift ? 'reclaim'
    : (dialogueState?.turnsInScene || 1) <= 2 ? 'opening'
      : (dialogueState?.turnsInScene || 1) >= 7 ? 'developed' : 'building';
  const forceAgency = !silence.allowed && ((dialogueState?.reactiveStreak || 0) >= 2 || characterIntent?.move === 'take_control' || (persistentIntent?.status === 'active' && Number(persistentIntent?.commitment) >= 60));
  return {
    version: 'rin-conversation-director-v3-persistent-intent',
    scene,
    phase,
    delivery: silence.allowed ? 'silence' : 'respond',
    silenceReason: silence.allowed ? silence.reason : null,
    forceAgency,
    objective: silence.allowed
      ? 'не добавлять пустую реплику и позволить микросцене завершиться'
      : forceAgency ? 'сделать собственный ход Рин' : 'продвинуть текущую сцену без ассистентского заполнителя',
    rhythm: silence.allowed ? 'intentional_pause' : phase === 'developed' ? 'change_rhythm' : 'continue',
    instruction: silence.allowed
      ? `РЕЖИССУРА: осознанное молчание. Причина: ${silence.reason}. Не генерируй текст, стикер или вопрос. Это не случайность и не наказание.`
      : `РЕЖИССУРА: фаза ${phase}; цель — ${forceAgency ? 'Рин делает собственный ход' : 'продвинуть сцену'}. Не заполняй ход общим одобрением.`
  };
}
