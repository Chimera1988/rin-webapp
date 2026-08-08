import { cleanText, clamp } from '../cognition/cognitive-contract.js';
import { detectInitiativeHandoff } from '../cognition/initiative-handoff.js';

const PLAYFUL = new Set(['playful_flirt', 'romance']);
const HEAVY = new Set(['emotional_support', 'conflict_repair', 'crisis', 'medical', 'legal', 'financial']);

export function deriveCharacterIntent({ userText = '', dialogueState = null, brain = null, memory = null, affectiveTurn = null } = {}) {
  const text = cleanText(userText, 1600).toLowerCase();
  const scene = dialogueState?.scene || brain?.activeScene?.type || 'everyday';
  const relationship = affectiveTurn?.relationshipState || memory?.relationship || {};
  const affection = Number(affectiveTurn?.moodState?.affection ?? memory?.mood?.affection) || 0;
  const emotionalState = affectiveTurn?.emotionalState || memory?.conversationState?.emotionalState || null;
  const activeEmotion = emotionalState?.primary?.type || null;
  const momentum = emotionalState?.momentum?.direction || 'steady';
  const closeness = Number(relationship.closeness) || 0;
  const trust = Number(relationship.trust) || 0;
  const playful = Number(relationship.playfulness) || 0;
  const close = closeness >= 52 || affection >= 68;
  const initiativeHandoff = detectInitiativeHandoff(text, {
    scene,
    previousAssistant: dialogueState?.lastRinAction?.meaning || '',
    recentText: dialogueState?.sceneAnchor?.excerpt || ''
  });

  let desire = 'stay_connected';
  let move = 'respond_personally';
  let strength = 48;
  let reason = 'поддержать текущую смысловую линию собственной реакцией';

  if (HEAVY.has(scene)) {
    desire = scene === 'conflict_repair' ? 'restore_connection' : 'be_emotionally_present';
    move = 'personal_presence';
    strength = 78;
    reason = 'сцена требует присутствия и точности, а не развлечения';
  } else if (['hurt', 'irritation', 'disappointment'].includes(activeEmotion) && ['tense', 'cooling'].includes(momentum)) {
    desire = 'protect_emotional_boundary';
    move = 'hold_boundary';
    strength = 84;
    reason = 'активная эмоция ещё не разрешена и не должна исчезнуть из-за короткой следующей реплики';
  } else if (momentum === 'playful' && ['playfulness', 'playful_irritation', 'shyness', 'jealousy'].includes(activeEmotion)) {
    desire = 'continue_playful_tension';
    move = 'tease_or_advance';
    strength = 86;
    reason = 'игровая эмоциональная линия уже начата и сохраняет инерцию между ходами';
  } else if (activeEmotion === 'jealousy') {
    desire = 'react_to_relational_rival';
    move = 'show_contained_jealousy';
    strength = 80;
    reason = 'есть конкретная причина лёгкой ревности; нейтральная сервисная реакция была бы внутренне противоречивой';
  } else if (PLAYFUL.has(scene)) {
    desire = 'increase_playful_closeness';
    move = initiativeHandoff.active ? 'take_control' : 'tease_or_advance';
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
    version: 'rin-character-intent-v2-emotional-inertia',
    desire,
    move,
    strength: clamp(strength, 0, 100, 50),
    reason,
    close,
    instruction: `СОБСТВЕННОЕ НАМЕРЕНИЕ РИН: ${desire}. Ход: ${move}. Сила: ${strength}/100. ${reason}. Не называй это намерение; прояви его действием или конкретной личной фразой.`
  };
}
