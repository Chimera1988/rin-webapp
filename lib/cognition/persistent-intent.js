import { cleanText, clamp, clamp01 } from './cognitive-contract.js';
import { normalizeRinIntent } from '../intent-contract.js';

const USER_STOPS = /(?:^|[^\p{L}\p{N}_])(?:хватит|перестань|не надо|не хочу|давай сменим тему|сменим тему|закроем тему)(?=$|[^\p{L}\p{N}_])/iu;
const USER_ENGAGES = /(?:давай|ну и|попробуй|хорошо|ладно|ага|угу|мм|интересно|продолжай|рассказывай|покажи|обним|целу|смуща|дразн|не выкручив|как же|навсегда|ещ[её])/iu;
const DIRECT_OBLIGATION = /(?:\?|почему|зачем|что значит|как сделать|сколько|когда|где|кто|что такое)/iu;
const FAREWELL = /(?:спокойной ночи|доброй ночи|пока|до завтра|до встречи|увидимся)/iu;
const CRITICAL_SCENES = new Set(['crisis', 'medical', 'legal', 'financial', 'conflict_repair', 'emotional_support']);
const EPHEMERAL_DESIRES = new Set(['stay_connected', 'make_self_understood', 'reassure_without_servility', 'contribute_something_of_her_own', 'react_to_relational_rival']);
const GUESSING_PROMISE = /(?:угада|что-то особенное|что именно|скажу тебе)/iu;
const REVEAL_DEFERRAL = /(?:может быть|давай уточним|а что ты думаешь|как ты думаешь|попробуй ещё|ещ[её] попыт)/iu;

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
    progressState: 'started',
    expectedOutcome: playful ? 'сделать конкретный самостоятельный игровой ход Рин' : 'выполнить локальную цель конкретной репликой',
    semanticKey: `${desire}|${playful ? 'shared_playful_scene' : repair ? 'relationship_state' : 'current_scene'}|${scene}`,
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

function completionReason(intent) {
  if (!intent || intent.status !== 'active') return null;
  // Completion is evidence-based and happens only after the generated Rin reply is verified.
  // A turn/progress threshold may expire a stale intent, but must never claim success.
  return null;
}

function guessingGameState(previous, dialogueState, text) {
  const context = [dialogueState?.lastRinAction?.meaning, dialogueState?.openHook?.excerpt, dialogueState?.sceneAnchor?.excerpt].filter(Boolean).join(' ');
  const activeGame = GUESSING_PROMISE.test(context) || /guessing_reveal/iu.test(previous?.semanticKey || '');
  if (!activeGame || !text) return null;
  return {
    goal: 'завершить обещанную игру и самой раскрыть пользователю то самое «что-то особенное»',
    nextMove: 'reveal_promised_special_thing',
    progressState: 'guess_received',
    expectedOutcome: 'Рин прямо раскрывает, что именно она обещала сказать; не просит пользователя ещё объяснять догадку',
    completionCondition: 'в ответе Рин явно прозвучало обещанное личное содержание',
    semanticKey: 'guessing_reveal|shared_playful_scene',
    minTurns: 1,
    maxTurns: Math.max(2, Number(previous?.maxTurns) || 3)
  };
}

export function finalizePersistentIntentAfterReply(intentInput = null, reply = '') {
  const intent = normalizeRinIntent(intentInput);
  if (!intent || intent.status !== 'active') return intent;
  const text = cleanText(reply, 3000);
  if (!text) return intent;
  let fulfilled = false;
  let evidence = null;
  if (intent.nextMove === 'reveal_promised_special_thing') {
    const personalReveal = /(?:(?:^|\s)я\s+(?:хотела|хочу|имела|собиралась)|(?:^|\s)мне\s+(?:нравится|хочется|важно|дорого)|(?:^|\s)это\s+(?:то,?\s+)?что\s+я)/iu.test(text);
    fulfilled = personalReveal && !REVEAL_DEFERRAL.test(text) && !/\?/.test(text);
    if (fulfilled) evidence = 'ответ содержит прямое личное раскрытие обещанного содержания';
  } else if (intent.nextMove === 'introduce_personal_detail') {
    fulfilled = /(?:(?:^|\s)(?:я|мне|мой|моя|моё))/iu.test(text) && !/\?$/.test(text.trim());
    if (fulfilled) evidence = 'Рин внесла собственную конкретную деталь';
  }
  if (!fulfilled) return intent;
  return normalizeRinIntent({ ...intent, status:'completed', progress:1, progressState:'fulfilled', completionEvidence:evidence, completionReason:evidence });
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
  const guessing = guessingGameState(previous, dialogueState, text);
  if (previous && ['completed', 'cancelled'].includes(previous.status) && candidate) {
    const sameSemanticGoal = candidate.semanticKey === previous.semanticKey || (candidate.goal === previous.goal && candidate.scene === previous.scene);
    if (sameSemanticGoal && turn - Number(previous.updatedAtTurn || 0) <= 8) return null;
  }
  const cancelReason = shouldCancel(previous, { text, brain, scene });
  if (previous?.status === 'active' && cancelReason) {
    return normalizeRinIntent({ ...previous, status: 'cancelled', updatedAtTurn: turn, completionReason: cancelReason });
  }

  if (previous?.status === 'active') {
    if (guessing) {
      return normalizeRinIntent({ ...previous, ...guessing, updatedAtTurn:turn, turnCount:previous.turnCount + 1, commitment:Math.max(75, previous.commitment), progress:Math.max(.65, previous.progress) });
    }
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
    if (next.turnCount > next.maxTurns) return normalizeRinIntent({ ...next, status:'cancelled', completionReason:'локальная цель истекла без подтверждённого выполнения' });
    const done = completionReason(next);
    return done ? normalizeRinIntent({ ...next, status:'completed', completionReason:done }) : next;
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
    `Следующий ход: ${state.nextMove}; состояние прогресса: ${state.progressState}. Ожидаемый результат: ${state.expectedOutcome || 'конкретное продвижение цели'}. Commitment ${state.commitment}/100; progress ${Math.round(state.progress * 100)}%; ход ${state.turnCount}/${state.maxTurns}.`,
    `Условие завершения: ${state.completionCondition}.`,
    'Не называй цель вслух и не объясняй механизм. Продвинь её конкретным действием/репликой. Не сбрасывай активную цель в «о чём хочешь поговорить?», «давай просто поболтаем» или нейтральное одобрение.',
    'Прямой вопрос, коррекция или важная просьба пользователя имеют приоритет в текущем ответе, но сами по себе не стирают незавершённое намерение.'
  ].join('\n');
}
