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

const BINDING_RULES = [
  { key:'shared_imagined_world', kind:'shared_fantasy', re:/(?:таинственн.*мир|волшебн.*мест|цветы светятся|реки текут|страж.*лес|горы японии|рядом с рекой|экран телефон)/iu, goal:'сделать воображаемый общий мир конкретнее и чуть более «нашим»', nextMove:'add_specific_shared_world_detail', outcome:'добавить конкретное место, действие или деталь, связывающую Рин и пользователя внутри этого мира' },
  { key:'shared_kitsune_identity', kind:'shared_fantasy', re:/(?:кицун|лис(?:а|ой|ы)|япони|миф|легенд)/iu, goal:'развить именно общую линию про кицунэ и её связь с пользователем', nextMove:'advance_kitsune_thread', outcome:'добавить одну конкретную личную деталь или образ в общую линию про кицунэ, а не обсуждать загадочность вообще' },
  { key:'personal_secret_reveal', kind:'personal_disclosure', re:/(?:секрет|раскрыть один|расскажешь|пофантазировать|фантазир|тайн)/iu, goal:'раскрыть пользователю один конкретный личный секрет или фантазию Рин', nextMove:'reveal_specific_personal_secret', outcome:'сказать конкретное содержание от первого лица, а не рассуждать о секретах или фантазии вообще' },
  { key:'quiet_evening_preferences', kind:'personal_preference', re:/(?:остывш.*чай|тих.*вечер|книг|музык|время наедине|уютн)/iu, goal:'сверить одну конкретную общую привычку тихого вечера и внести собственное предпочтение Рин', nextMove:'share_specific_evening_preference', outcome:'назвать одну конкретную вещь, которую Рин сама выбирает для тихого вечера, без универсальной формулы' },
  { key:'affection_physical_closeness', kind:'relationship', re:/(?:обним|поцел|улыбк|нежн|рядом|согрева)/iu, goal:'ответить на конкретный жест близости собственным жестом Рин и дать моменту коротко пожить', nextMove:'reciprocate_specific_affection', outcome:'конкретно ответить на жест близости, не объясняя абстрактную ценность объятий или улыбок' },
  { key:'playful_tease', kind:'playful', re:/(?:подразн|смуща|не выкручив|хитрост|очарован|поймала|твоя очередь|покажи|удиви)/iu, goal:'довести конкретное поддразнивание этой сцены до собственного хода Рин', nextMove:'make_specific_teasing_move', outcome:'сделать один конкретный игровой ход, привязанный к текущей реплике или крючку, без мета-комментария о флирте' }
];

function bindingContext(dialogueState = null, userText = '') {
  return cleanText([
    userText,
    dialogueState?.openHook?.excerpt,
    dialogueState?.sceneAnchor?.excerpt,
    dialogueState?.lastRinAction?.meaning,
    dialogueState?.topic,
    dialogueState?.sceneGoal
  ].filter(Boolean).join(' | '), 2400);
}

function deriveSceneBinding(dialogueState = null, userText = '', candidate = null) {
  const context = bindingContext(dialogueState, userText);
  for (const rule of BINDING_RULES) {
    if (!rule.re.test(context)) continue;
    const anchor = cleanText(dialogueState?.openHook?.excerpt || dialogueState?.sceneAnchor?.excerpt || dialogueState?.lastRinAction?.meaning || userText, 420);
    return { key:rule.key, kind:rule.kind, subject:cleanText(context,320), anchor, source:dialogueState?.openHook ? 'open_hook' : dialogueState?.sceneAnchor ? 'scene_anchor' : dialogueState?.lastRinAction ? 'last_rin_action' : 'current_turn', goal:rule.goal, nextMove:rule.nextMove, outcome:rule.outcome };
  }
  const desire = cleanText(candidate?.desire,160);
  const move = cleanText(candidate?.move,160);
  if (/share_personal_view|introduce_personal_detail/iu.test(`${desire} ${move}`)) {
    const anchor = cleanText(dialogueState?.openHook?.excerpt || dialogueState?.sceneAnchor?.excerpt || userText, 420);
    return { key:`personal_view:${cleanText(dialogueState?.scene || 'everyday',60)}`, kind:'personal_view', subject:anchor || 'current scene', anchor, source:anchor ? 'scene_context' : 'candidate', goal:'внести одну конкретную личную позицию Рин по текущему предмету разговора', nextMove:'share_bound_personal_view', outcome:'сказать одну конкретную позицию от первого лица, связанную с текущим предметом, без универсальной мудрости' };
  }
  return null;
}

function candidateToIntent(candidate = null, { scene = 'everyday', turn = 0, dialogueState = null, userText = '' } = {}) {
  if (!candidate || typeof candidate !== 'object') return null;
  const desire = cleanText(candidate.desire, 160);
  if (!desire || EPHEMERAL_DESIRES.has(desire) || Number(candidate.strength) < 68) return null;
  const playful = /playful|tease|closeness|take_control/iu.test(`${desire} ${candidate.move || ''}`);
  const repair = /restore|boundary|repair/iu.test(`${desire} ${candidate.move || ''}`);
  const binding = deriveSceneBinding(dialogueState, userText, candidate);
  const fallbackGoal = desire === 'continue_playful_tension' || desire === 'increase_playful_closeness'
    ? 'продвинуть текущую игровую линию конкретным собственным ходом Рин'
    : desire === 'react_to_relational_rival'
      ? 'выразить личную реакцию на романтическую конкуренцию и затем естественно отпустить её'
      : desire === 'protect_emotional_boundary'
        ? 'удержать эмоциональную границу до появления причины смягчиться'
        : desire === 'restore_connection'
          ? 'восстановить контакт после напряжения без мгновенного обнуления произошедшего'
          : `довести локальное намерение Рин «${desire}» до естественного результата`;
  const goal = binding?.goal || fallbackGoal;
  return normalizeRinIntent({
    goal,
    motive: candidate.reason || 'собственное локальное намерение Рин',
    target: binding?.key || (playful ? 'shared_playful_scene' : repair ? 'relationship_state' : 'current_scene'),
    sceneBinding: binding ? { key:binding.key, kind:binding.kind, subject:binding.subject, anchor:binding.anchor, source:binding.source } : null,
    scene,
    priority: clamp(candidate.strength, 0, 100, 68),
    commitment: clamp(candidate.strength, 0, 100, 68),
    progress: 0.12,
    nextMove: binding?.nextMove || cleanText(candidate.move, 220) || 'respond_personally',
    progressState: 'started',
    expectedOutcome: binding?.outcome || (playful ? 'сделать конкретный самостоятельный игровой ход Рин' : 'выполнить локальную цель конкретной репликой'),
    semanticKey: `${desire}|${binding?.key || (playful ? 'shared_playful_scene' : repair ? 'relationship_state' : 'current_scene')}|${scene}`,
    completionCondition: binding
      ? `конкретный target «${binding.key}» получил ожидаемый результат: ${binding.outcome}`
      : playful
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


function intentFamily(intent = null) {
  const value = cleanText([intent?.semanticKey, intent?.target, intent?.goal, intent?.sceneBinding?.key].filter(Boolean).join('|'), 900);
  if (/(?:playful|tease|игров|поддразн|shared_playful_scene)/iu.test(value)) return 'playful';
  if (/(?:kitsune|кицун|shared_imagined_world|personal_secret_reveal|fantasy|мир|секрет)/iu.test(value)) return 'shared_fantasy';
  if (/(?:affection|обним|целу|closeness)/iu.test(value)) return 'affection';
  if (/(?:repair|boundary|relationship_state)/iu.test(value)) return 'relationship_repair';
  return cleanText(intent?.sceneBinding?.key || intent?.target || intent?.semanticKey || intent?.goal, 220).toLowerCase();
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
  } else if (intent.nextMove === 'introduce_personal_detail' || intent.nextMove === 'share_bound_personal_view' || intent.nextMove === 'share_specific_evening_preference') {
    fulfilled = /(?:(?:^|\s)(?:я|мне|мой|моя|моё))/iu.test(text) && !/\?$/.test(text.trim());
    if (fulfilled) evidence = 'Рин внесла собственную конкретную деталь по предмету сцены';
  } else if (intent.nextMove === 'reveal_specific_personal_secret') {
    fulfilled = /(?:(?:^|\s)я\s|(?:^|\s)мне\s|иногда\s+я|я\s+(?:люблю|представляю|фантазир|мечтаю))/iu.test(text) && !/(?:секреты всегда|вообще|люди|каждый)/iu.test(text);
    if (fulfilled) evidence = 'Рин раскрыла конкретное личное содержание, привязанное к секрету/фантазии';
  } else if (intent.nextMove === 'add_specific_shared_world_detail') {
    fulfilled = /(?:мы|вместе|нас|тебя|тебе|рядом|там|место|река|горы|лес|дом|тропа|ноч|огн|чай|кицун)/iu.test(text) && text.length >= 28;
    if (fulfilled) evidence = 'Рин добавила конкретную деталь в общий воображаемый мир';
  } else if (intent.nextMove === 'advance_kitsune_thread') {
    fulfilled = /(?:кицун|лис|хвост|облик|хитрост|защит|тайн|япон)/iu.test(text) && text.length >= 22;
    if (fulfilled) evidence = 'Рин продвинула конкретную линию про кицунэ';
  } else if (intent.nextMove === 'reciprocate_specific_affection') {
    fulfilled = /(?:обним|целу|приж|рядом|улыб|держу|нежн)/iu.test(text);
    if (fulfilled) evidence = 'Рин ответила конкретным жестом близости';
  } else if (intent.nextMove === 'make_specific_teasing_move') {
    fulfilled = intent.turnCount >= intent.minTurns && /(?:ну-ну|поймала|не выкручив|тогда|попробуй|посмотрим|смущ|дразн|хитр|не всё сразу|моя очередь|твоя очередь)/iu.test(text) && !/(?:флирт|игровая линия|наш разговор)/iu.test(text);
    if (fulfilled) evidence = 'Рин сделала конкретный игровой ход внутри сцены';
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
  const candidate = candidateToIntent(characterIntent, { scene, turn, dialogueState, userText });
  const currentBinding = deriveSceneBinding(dialogueState, userText, characterIntent);
  const guessing = guessingGameState(previous, dialogueState, text);
  if (previous && ['completed', 'cancelled'].includes(previous.status) && candidate) {
    const sameBinding = candidate.sceneBinding?.key && previous.sceneBinding?.key && candidate.sceneBinding.key === previous.sceneBinding.key;
    const sameFamily = intentFamily(candidate) && intentFamily(candidate) === intentFamily(previous);
    const sameSemanticGoal = candidate.semanticKey === previous.semanticKey || sameBinding || sameFamily || (candidate.goal === previous.goal && candidate.scene === previous.scene);
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
    const bindingShift = currentBinding?.key && currentBinding.key !== previous.sceneBinding?.key;
    if (bindingShift && !CRITICAL_SCENES.has(scene)) {
      return normalizeRinIntent({
        ...previous,
        id: previous.id,
        goal: currentBinding.goal,
        target: currentBinding.key,
        sceneBinding: { key:currentBinding.key, kind:currentBinding.kind, subject:currentBinding.subject, anchor:currentBinding.anchor, source:currentBinding.source },
        semanticKey: `${cleanText(characterIntent?.desire,120) || 'scene_continuation'}|${currentBinding.key}|${scene}`,
        nextMove: currentBinding.nextMove,
        expectedOutcome: currentBinding.outcome,
        completionCondition: `конкретный target «${currentBinding.key}» получил ожидаемый результат: ${currentBinding.outcome}`,
        progressState: 'rebound_to_specific_scene_target',
        progress: Math.min(.65, Math.max(.12, previous.progress + .04)),
        updatedAtTurn:turn,
        startedAtTurn:turn,
        turnCount:1,
        replacementOf:previous.id,
        completionEvidence:null,
        completionReason:null,
        reason:`локальная цель перепривязана к новому конкретному предмету сцены: ${currentBinding.key}`
      });
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
    state.sceneBinding?.key ? `Привязка к сцене: ${state.sceneBinding.kind || 'context'} / ${state.sceneBinding.key}; предмет: ${state.sceneBinding.subject || state.target}${state.sceneBinding.anchor ? `; опора: «${state.sceneBinding.anchor}»` : ''}.` : '',
    `Следующий ход: ${state.nextMove}; состояние прогресса: ${state.progressState}. Ожидаемый результат: ${state.expectedOutcome || 'конкретное продвижение цели'}. Commitment ${state.commitment}/100; progress ${Math.round(state.progress * 100)}%; ход ${state.turnCount}/${state.maxTurns}.`,
    `Условие завершения: ${state.completionCondition}.`,
    'Не подменяй конкретный предмет сцены общей «игровой линией». Если есть привязка к сцене, следующий ход обязан использовать её предмет или опору.',
    'Не называй цель вслух и не объясняй механизм. Продвинь её конкретным действием/репликой. Не сбрасывай активную цель в «о чём хочешь поговорить?», «давай просто поболтаем» или нейтральное одобрение.',
    'Прямой вопрос, коррекция или важная просьба пользователя имеют приоритет в текущем ответе, но сами по себе не стирают незавершённое намерение.'
  ].join('\n');
}
