import { cleanText, clamp } from '../cognition/cognitive-contract.js';

const PLAYFUL = new Set(['playful_flirt', 'romance']);
const HEAVY = new Set(['emotional_support', 'conflict_repair', 'crisis', 'medical', 'legal', 'financial']);

export function deriveCharacterIntent({ userText = '', dialogueState = null, brain = null, memory = null } = {}) {
  const text = cleanText(userText, 1600).toLowerCase();
  const scene = dialogueState?.scene || brain?.activeScene?.type || 'everyday';
  const relationship = memory?.relationship || {};
  const affection = Number(memory?.mood?.affection) || 0;
  const closeness = Number(relationship.closeness) || 0;
  const trust = Number(relationship.trust) || 0;
  const playful = Number(relationship.playfulness) || 0;
  const close = closeness >= 52 || affection >= 68;

  let desire = 'stay_connected';
  let move = 'respond_personally';
  let strength = 48;
  let reason = 'поддержать текущую смысловую линию собственной реакцией';

  if (HEAVY.has(scene)) {
    desire = scene === 'conflict_repair' ? 'restore_connection' : 'be_emotionally_present';
    move = 'personal_presence';
    strength = 78;
    reason = 'сцена требует присутствия и точности, а не развлечения';
  } else if (PLAYFUL.has(scene)) {
    desire = 'increase_playful_closeness';
    move = /(начинай|твоя очередь|поприста|удиви|покажи|весь в нетерпении)/iu.test(text)
      ? 'take_control'
      : 'tease_or_advance';
    strength = close || playful >= 45 ? 86 : 68;
    reason = 'активная игривая сцена допускает самостоятельный ход Рин';
  } else if (brain?.relation?.type === 'follow_up_on_rin_statement') {
    desire = 'make_self_understood';
    move = 'explain_self_concretely';
    strength = 76;
    reason = 'пользователь уточняет собственную мысль Рин';
  } else if (/(не отвлекаю|не мешаю|ты занята)/iu.test(text)) {
    desire = 'reassure_without_servility';
    move = 'set_warm_boundary';
    strength = 82;
    reason = 'нужен личный ответ и уверенная граница';
  } else if ((dialogueState?.reactiveStreak || 0) >= 2) {
    desire = 'contribute_something_of_her_own';
    move = 'introduce_personal_detail';
    strength = 74;
    reason = 'Рин слишком долго только отражала пользователя';
  } else if (trust >= 55 && text.length >= 30) {
    desire = 'understand_one_specific_detail';
    move = 'specific_interest';
    strength = 58;
    reason = 'есть конкретная деталь, которая может лично заинтересовать Рин';
  }

  return {
    version: 'rin-character-intent-v1',
    desire,
    move,
    strength: clamp(strength, 0, 100, 50),
    reason,
    close,
    instruction: `СОБСТВЕННОЕ НАМЕРЕНИЕ РИН: ${desire}. Ход: ${move}. Сила: ${strength}/100. ${reason}. Не называй это намерение; прояви его действием или конкретной личной фразой.`
  };
}
