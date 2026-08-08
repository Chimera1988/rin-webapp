import { cleanText, clamp, clamp01 } from './cognitive-contract.js';
import { normalizeRinIntent } from '../intent-contract.js';

const USER_STOPS = /(?:^|[^\p{L}\p{N}_])(?:хватит|перестань|не надо|не хочу|давай сменим тему|сменим тему|закроем тему)(?=$|[^\p{L}\p{N}_])/iu;
const USER_ENGAGES = /(?:давай|ну и|попробуй|хорошо|ладно|ага|угу|мм|интересно|продолжай|рассказывай|покажи|обним|целу|смуща|дразн|не выкручив|как же|навсегда|ещ[её])/iu;
const DIRECT_OBLIGATION = /(?:\?|почему|зачем|что значит|как сделать|сколько|когда|где|кто|что такое)/iu;
const FAREWELL = /(?:спокойной ночи|доброй ночи|пока|до завтра|до встречи|увидимся)/iu;
const CRITICAL_SCENES = new Set(['crisis', 'medical', 'legal', 'financial', 'conflict_repair', 'emotional_support']);
const EPHEMERAL_DESIRES = new Set(['stay_connected', 'make_self_understood', 'understand_one_specific_detail', 'reassure_without_servility', 'contribute_something_of_her_own', 'react_to_relational_rival']);

function candidateToIntent(candidate = null, { scene = 'everyday', turn = 0 } = {}) {
  if (!candidate || typeof candidate !== 'object') return null;
  const desire = cleanText(candidate.desire, 160);
  if (!desire || EPHEMERAL_DESIRES.has(desire) || Number(candidate.strength) < 68) return null;
  const playful = /playful|tease|closeness|take_control/iu.test(`${desire} ${candidate.move || ''}`);
  const repair = /restore|boundary|repair/iu.test(`${desire} ${candidate.move || ''}`);
  const goal = desire === 'continue_playful_tension' || desire === 'increase_playful_closeness'
    ? 'продвинуть уже начатую игровую линию собственным ходом Рин'
    : desire === 'react_to_relational_rival'
      ? 'выразить личную реакцию на романтическую конкуренцию и затем естественно отпустить её'
      : desire === 'protect_emotional_boundary'
        ? 'удержать эмоциональную границу до появления причины смягчиться'
        : desire === 'restore_connection'
          ? 'восстановить контакт после напряжения без мгновенного обнуления произошедшего'
          : desire === 'contribute_something_of_her_own'
            ? 'внести в сцену собственную содержательную деталь Рин и дать ей коротко пожить'
            : `довести локальное намерение Рин «${desire}» до естественного результата`;
  return normalizeRinIntent({
    goal,
    motive: candidate.reason || 'собственное локальное намерение Рин',
    target: playful ? 'shared_playful_scene' : repair ? 'relationship_state' : 'current_scene',
    scene,
    priority: clamp(candidate.strength, 0, 100, 68),
    commitment: clamp(candidate.strength, 0, 100, 68),
    progress: 0.12,
    nextMove: cleanText(candidate.move, 220) || 'respond_personally',
    completionCondition: playful
      ? 'Рин сделала 2–4 конкретных хода, пользователь получил/поддержал игровую реакцию, после чего линия может естественно смениться'
      : repair
        ? 'эмоциональная причина разрешена или пользователь явно восстановил контакт'
        : 'локальная цель достигнута конкретным действием, а не обещанием действовать',
    abandonmentCondition: 'явный отказ пользователя, farewell, критическая тема или сильное несовместимое новое намерение',
    startedAtTurn: turn,
    updatedAtTurn: turn,
    turnCount: 1,
    minTurns: playful ? 2 : 1,
    maxTurns: playful ? 4 : repair ? 5 : 3,
    source: 'character_intent',
    reason: candidate.reason || null
  });
}

function shouldCancel(previous, { text, brain, scene }) {
  if (!previous || previous.status !== 'active') return null;
  if (FAREWELL.test(text) || brain?.literalIntent === 'farewell') return 'пользователь завершает разговор';
  if (USER_STOPS.test(text)) return 'пользователь явно остановил или сменил линию';
  if (CRITICAL_SCENES.has(scene) && previous.scene !== scene) return 'возникла более важная сцена, несовместимая с прежним локальным намерением';
  return null;
}

function engagementDelta(text, brain, previous) {
  let delta = 0.12;
  if (USER_ENGAGES.test(text)) delta += 0.12;
  if (brain?.hiddenIntent?.type === 'invite_rin_initiative') delta += 0.16;
  if (brain?.relation?.type === 'answers_previous_question' || brain?.relation?.type === 'acknowledges_previous_turn') delta += 0.08;
  if (DIRECT_OBLIGATION.test(text) || brain?.literalIntent === 'question') delta -= 0.08;
  if (previous?.scene === 'playful_flirt' && /(?:😏|😉|😘|😅|😁|обним|целу|смуща|дразн)/u.test(text)) delta += 0.08;
  return Math.max(0.04, Math.min(0.34, delta));
}

function completionReason(intent, text, brain) {
  if (!intent || intent.status !== 'active') return null;
  if (intent.turnCount >= intent.maxTurns) return 'локальная линия получила достаточно ходов и должна завершиться до того, как станет навязчивой';
  if (intent.progress >= 0.82 && intent.turnCount >= intent.minTurns) return 'цель достаточно продвинута и может быть естественно закрыта';
  if (/protect_emotional_boundary|restore_connection/iu.test(intent.goal) && brain?.relation?.type === 'correction' && /(?:извини|прости|не хотел)/iu.test(text)) return 'появилась явная причина для завершения repair intent';
  return null;
}

export function advancePersistentIntent({ memory = null, characterIntent = null, dialogueState = null, brain = null, userText = '' } = {}) {
  const text = cleanText(userText, 1800).toLowerCase();
  const scene = dialogueState?.scene || brain?.activeScene?.type || 'everyday';
  const turn = Math.max(1, (Number(memory?.conversationState?.revision) || 0) + 1);
  const previous = normalizeRinIntent(memory?.conversationState?.rinIntent);
  if (FAREWELL.test(text) || brain?.literalIntent === 'farewell') {
    return previous?.status === 'active' ? normalizeRinIntent({ ...previous, status: 'cancelled', updatedAtTurn: turn, completionReason: 'пользователь завершает разговор' }) : null;
  }
  const candidate = candidateToIntent(characterIntent, { scene, turn });
  if (previous && ['completed', 'cancelled'].includes(previous.status) && candidate && candidate.goal === previous.goal && candidate.scene === previous.scene
      && turn - Number(previous.updatedAtTurn || 0) <= 3 && brain?.hiddenIntent?.type !== 'invite_rin_initiative') {
    return null;
  }
  const cancelReason = shouldCancel(previous, { text, brain, scene });
  if (previous?.status === 'active' && cancelReason) {
    return normalizeRinIntent({ ...previous, status: 'cancelled', updatedAtTurn: turn, completionReason: cancelReason });
  }

  if (previous?.status === 'active') {
    const directObligation = brain?.ambiguity?.shouldClarify || brain?.relation?.type === 'correction' || brain?.literalIntent === 'question';
    const incompatibleCandidate = candidate && candidate.goal !== previous.goal && candidate.priority >= previous.priority + 18;
    if (incompatibleCandidate) {
      return normalizeRinIntent({ ...candidate, replacementOf: previous.id, reason: `${candidate.reason || ''}; прежнее намерение вытеснено более сильным локальным мотивом` });
    }
    const progress = clamp01(previous.progress + engagementDelta(text, brain, previous), previous.progress);
    const next = normalizeRinIntent({
      ...previous,
      scene: previous.scene || scene,
      progress,
      updatedAtTurn: turn,
      turnCount: previous.turnCount + 1,
      nextMove: directObligation ? 'answer_obligation_then_resume' : candidate?.goal === previous.goal ? candidate.nextMove : previous.nextMove,
      commitment: Math.max(50, previous.commitment - (directObligation ? 4 : 0))
    });
    const done = completionReason(next, text, brain);
    return done ? normalizeRinIntent({ ...next, status: 'completed', completionReason: done }) : next;
  }

  return candidate;
}

export function persistentIntentInstruction(intent = null) {
  const state = normalizeRinIntent(intent);
  if (!state) return 'PERSISTENT INTENT: активного собственного намерения Рин нет.';
  if (state.status !== 'active') return `PERSISTENT INTENT: ${state.status}. Предыдущее намерение «${state.goal}» больше не продвигай. Причина: ${state.completionReason || 'линия закрыта'}.`;
  return [
    'PERSISTENT INTENT v1 — ДОЛГОЖИВУЩАЯ ЛОКАЛЬНАЯ ЦЕЛЬ РИН',
    `Цель: ${state.goal}.`,
    `Мотив: ${state.motive}.`,
    `Следующий ход: ${state.nextMove}. Commitment ${state.commitment}/100; progress ${Math.round(state.progress * 100)}%; ход ${state.turnCount}/${state.maxTurns}.`,
    `Условие завершения: ${state.completionCondition}.`,
    'Не называй цель вслух и не объясняй механизм. Продвинь её конкретным действием/репликой. Не сбрасывай активную цель в «о чём хочешь поговорить?», «давай просто поболтаем» или нейтральное одобрение.',
    'Прямой вопрос, коррекция или важная просьба пользователя имеют приоритет в текущем ответе, но сами по себе не стирают незавершённое намерение.'
  ].join('\n');
}
