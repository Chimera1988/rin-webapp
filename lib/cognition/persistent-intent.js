import { cleanText, clamp, clamp01 } from './cognitive-contract.js';
import { normalizeRinIntent } from '../intent-contract.js';

const USER_STOPS = /(?:^|[^\p{L}\p{N}_])(?:хватит|перестань|не надо|не хочу|давай сменим тему|сменим тему|закроем тему)(?=$|[^\p{L}\p{N}_])/iu;
const USER_ENGAGES = /(?:давай|ну и|попробуй|хорошо|ладно|ага|угу|мм|интересно|продолжай|рассказывай|покажи|обним|целу|смуща|дразн|не выкручив|как же|навсегда|ещ[её])/iu;
const DIRECT_OBLIGATION = /(?:\?|почему|зачем|что значит|как сделать|сколько|когда|где|кто|что такое)/iu;
const FAREWELL = /(?:спокойной ночи|доброй ночи|до завтра|до встречи|увидимся|^\s*пока[.!…)]*\s*$)/iu;
const CRITICAL_SCENES = new Set(['crisis', 'medical', 'legal', 'financial', 'conflict_repair', 'emotional_support']);
const EPHEMERAL_DESIRES = new Set(['stay_connected', 'make_self_understood', 'reassure_without_servility', 'contribute_something_of_her_own', 'react_to_relational_rival']);
const GUESSING_PROMISE = /(?:угада|что-то особенное|что именно|скажу тебе)/iu;
const REVEAL_DEFERRAL = /(?:может быть|давай уточним|а что ты думаешь|как ты думаешь|попробуй ещё|ещ[её] попыт)/iu;
const TERMINAL_HOLD_TURNS = 10;

const BINDING_RULES = [
  { key:'shared_imagined_world', kind:'shared_fantasy', re:/(?:таинственн.*мир|волшебн.*мест|цветы светятся|реки текут|страж.*лес|горы японии|рядом с рекой|воображаем.*мир)/iu, goal:'сделать воображаемый общий мир конкретнее и чуть более «нашим»', nextMove:'add_specific_shared_world_detail', outcome:'добавить конкретное место, действие или деталь, связывающую Рин и пользователя внутри этого мира' },
  { key:'shared_kitsune_identity', kind:'shared_fantasy', re:/(?:кицун|лис(?:а|ой|ы)|миф.*япон|легенд.*япон)/iu, goal:'развить именно общую линию про кицунэ и её связь с пользователем', nextMove:'advance_kitsune_thread', outcome:'добавить одну конкретную личную деталь или образ в общую линию про кицунэ, а не обсуждать загадочность вообще' },
  { key:'personal_secret_reveal', kind:'personal_disclosure', re:/(?:секрет|раскрыть один|расскажешь|пофантазировать|фантазир|тайн)/iu, goal:'раскрыть пользователю один конкретный личный секрет или фантазию Рин', nextMove:'reveal_specific_personal_secret', outcome:'сказать конкретное содержание от первого лица, а не рассуждать о секретах или фантазии вообще' },
  { key:'quiet_evening_preferences', kind:'personal_preference', re:/(?:остывш.*чай|тих.*вечер|вечерн.*ритуал|музык.*вечер|время наедине)/iu, goal:'сверить одну конкретную привычку тихого вечера и внести собственное предпочтение Рин', nextMove:'share_specific_evening_preference', outcome:'назвать одну конкретную вещь, которую Рин сама выбирает для тихого вечера, без универсальной формулы' },
  { key:'affection_physical_closeness', kind:'relationship', re:/(?:обним|поцел|приж|нежн.*рядом|хочу быть рядом)/iu, goal:'ответить на конкретный жест близости собственным жестом Рин и дать моменту коротко пожить', nextMove:'reciprocate_specific_affection', outcome:'конкретно ответить на жест близости, не объясняя абстрактную ценность объятий или улыбок' },
  { key:'playful_tease', kind:'playful', re:/(?:подразн|смуща|не выкручив|хитрост|поймала|твоя очередь|покажи|удиви|попробуй меня)/iu, goal:'довести конкретное поддразнивание этой сцены до собственного хода Рин', nextMove:'make_specific_teasing_move', outcome:'сделать один конкретный игровой ход, привязанный к текущей реплике, без мета-комментария о флирте' }
];

function explicitCurrentBinding(userText = '') {
  const text = cleanText(userText, 1800);
  for (const rule of BINDING_RULES) {
    if (!rule.re.test(text)) continue;
    return { key:rule.key, kind:rule.kind, subject:text.slice(0,320), anchor:text.slice(0,420), source:'current_turn', goal:rule.goal, nextMove:rule.nextMove, outcome:rule.outcome };
  }
  return null;
}

function followThroughBinding(dialogueState = null, userText = '', candidate = null, brain = null) {
  const direct = explicitCurrentBinding(userText);
  if (direct) return direct;
  const followThrough = brain?.relation?.type === 'initiative_handoff' || brain?.hiddenIntent?.type === 'invite_rin_initiative' || brain?.relation?.type === 'follow_up_on_rin_statement';
  const strongLocalContinuation = Number(candidate?.strength || 0) >= 80 && USER_ENGAGES.test(userText) && Boolean(dialogueState?.lastRinAction?.meaning);
  if (!followThrough && !strongLocalContinuation) return null;
  const context = cleanText([dialogueState?.lastRinAction?.meaning, userText].filter(Boolean).join(' | '), 1200);
  for (const rule of BINDING_RULES) {
    if (!rule.re.test(context)) continue;
    return { key:rule.key, kind:rule.kind, subject:context.slice(0,320), anchor:cleanText(dialogueState?.lastRinAction?.meaning || userText,420), source:'follow_through', goal:rule.goal, nextMove:rule.nextMove, outcome:rule.outcome };
  }
  const desire = cleanText(candidate?.desire,160);
  const move = cleanText(candidate?.move,160);
  if (/share_personal_view|introduce_personal_detail/iu.test(`${desire} ${move}`)) {
    return { key:`personal_view:${cleanText(dialogueState?.scene || 'everyday',60)}`, kind:'personal_view', subject:cleanText(userText || dialogueState?.topic || 'current scene',320), anchor:cleanText(userText,420), source:'current_turn', goal:'внести одну конкретную личную позицию Рин по текущему предмету разговора', nextMove:'share_bound_personal_view', outcome:'сказать одну конкретную позицию от первого лица, связанную с текущим предметом, без универсальной мудрости' };
  }
  return null;
}

function intentFamily(intent = null) {
  const value = cleanText([intent?.semanticKey, intent?.target, intent?.goal, intent?.sceneBinding?.key].filter(Boolean).join('|'), 900);
  if (/(?:playful|tease|игров|поддразн|shared_playful_scene)/iu.test(value)) return 'playful';
  if (/(?:kitsune|кицун|shared_imagined_world|personal_secret_reveal|fantasy|мир|секрет)/iu.test(value)) return 'shared_fantasy';
  if (/(?:affection|обним|целу|closeness)/iu.test(value)) return 'affection';
  if (/(?:repair|boundary|relationship_state)/iu.test(value)) return 'relationship_repair';
  return cleanText(intent?.sceneBinding?.key || intent?.target || intent?.semanticKey || intent?.goal, 220).toLowerCase();
}

function terminalize(intent, status, turn, reason, extra = {}) {
  return normalizeRinIntent({ ...intent, ...extra, status, updatedAtTurn:turn, terminalAtTurn:turn, cooldownUntilTurn:turn + TERMINAL_HOLD_TURNS, completionReason:reason });
}

function candidateToIntent(candidate = null, { scene='everyday', turn=0, dialogueState=null, userText='', brain=null } = {}) {
  if (!candidate || typeof candidate !== 'object') return null;
  const desire = cleanText(candidate.desire,160);
  if (!desire) return null;
  if (brain?.literalIntent === 'farewell' || brain?.literalIntent === 'gratitude' || brain?.literalIntent === 'short_confirmation') return null;
  const directBinding = explicitCurrentBinding(userText);
  const binding = directBinding || followThroughBinding(dialogueState, userText, candidate, brain);
  const explicitHandoff = brain?.hiddenIntent?.type === 'invite_rin_initiative' || brain?.relation?.type === 'initiative_handoff';
  const bindingCreatesGoal = Boolean(directBinding && ['playful','personal_disclosure','shared_fantasy','relationship'].includes(directBinding.kind));
  if (!bindingCreatesGoal && (EPHEMERAL_DESIRES.has(desire) || Number(candidate.strength) < 68)) return null;
  const repair = /restore|boundary|repair/iu.test(`${desire} ${candidate.move || ''}`);
  // A persistent goal must have a concrete current-turn reason. Emotional momentum alone
  // may influence tone, but cannot create a new goal after an old one was closed.
  if (!binding && !explicitHandoff && !repair) return null;
  const playful = /playful|tease|closeness|take_control/iu.test(`${desire} ${candidate.move || ''}`);
  const fallbackGoal = repair
    ? desire === 'restore_connection' ? 'восстановить контакт после напряжения без мгновенного обнуления произошедшего' : 'удержать эмоциональную границу до появления причины смягчиться'
    : explicitHandoff ? 'выполнить переданный пользователем самостоятельный ход Рин прямо сейчас' : `довести локальное намерение Рин «${desire}» до естественного результата`;
  const target = binding?.key || (repair ? 'relationship_state' : 'current_scene');
  const idSeed = { goal:binding?.goal || fallbackGoal, target, scene, startedAtTurn:turn };
  return normalizeRinIntent({
    ...idSeed,
    goal: binding?.goal || fallbackGoal,
    motive: candidate.reason || 'собственное локальное намерение Рин',
    target,
    sceneBinding: binding ? { key:binding.key, kind:binding.kind, subject:binding.subject, anchor:binding.anchor, source:binding.source } : null,
    priority: clamp(candidate.strength,0,100,68), commitment:clamp(candidate.strength,0,100,68), progress:.08,
    nextMove: binding?.nextMove || cleanText(candidate.move,220) || 'respond_personally',
    progressState:'started', expectedOutcome:binding?.outcome || 'выполнить локальную цель конкретной репликой',
    semanticKey:`${desire}|${target}|${scene}`,
    completionCondition:binding ? `target «${binding.key}» получил ожидаемый результат: ${binding.outcome}` : repair ? 'эмоциональная причина разрешена или контакт явно восстановлен' : 'обещанный самостоятельный ход реально выполнен',
    abandonmentCondition:'явный отказ пользователя, farewell, критическая тема или содержательная смена сцены',
    minTurns: playful ? 2 : 1, maxTurns: playful ? 4 : repair ? 5 : 3,
    turnCount:1, source:bindingCreatesGoal?'explicit_scene_binding':'character_intent', reason:candidate.reason || (bindingCreatesGoal?'явный конкретный target текущего хода':null)
  });
}

function shouldCancel(previous, { text, brain, scene, dialogueState }) {
  if (!previous || previous.status !== 'active') return null;
  if (FAREWELL.test(text) || brain?.literalIntent === 'farewell' || scene === 'farewell') return 'разговор завершён';
  if (USER_STOPS.test(text)) return 'пользователь явно остановил или сменил линию';
  if (CRITICAL_SCENES.has(scene) && previous.scene !== scene) return 'возникла более важная сцена';
  const clearSceneShift = dialogueState?.topicDrift === false && previous.scene !== scene && cleanText(text,1800).length >= 42;
  if (clearSceneShift) return 'произошла содержательная смена сцены';
  return null;
}

function engagementDelta(text, brain, previous) {
  let delta=.08;
  if (USER_ENGAGES.test(text)) delta+=.10;
  if (brain?.hiddenIntent?.type === 'invite_rin_initiative') delta+=.12;
  if (brain?.relation?.type === 'answers_previous_question' || brain?.relation?.type === 'acknowledges_previous_turn') delta+=.06;
  if (DIRECT_OBLIGATION.test(text) || brain?.literalIntent === 'question') delta-=.05;
  if (previous?.scene === 'playful_flirt' && /(?:😏|😉|😘|😅|😁|обним|целу|смуща|дразн)/u.test(text)) delta+=.06;
  return Math.max(.02,Math.min(.24,delta));
}

function guessingGameState(previous, dialogueState, text) {
  const context=[previous?.goal, previous?.sceneBinding?.anchor, dialogueState?.lastRinAction?.meaning].filter(Boolean).join(' ');
  const activeGame=GUESSING_PROMISE.test(context) || /guessing_reveal/iu.test(previous?.semanticKey || '');
  if (!activeGame || !text) return null;
  return { goal:'завершить обещанную игру и самой раскрыть пользователю то самое «что-то особенное»', nextMove:'reveal_promised_special_thing', progressState:'guess_received', expectedOutcome:'Рин прямо раскрывает, что именно обещала сказать; не просит ещё объяснять догадку', completionCondition:'в ответе Рин явно прозвучало обещанное личное содержание', semanticKey:'guessing_reveal|shared_playful_scene', minTurns:1, maxTurns:Math.max(2,Number(previous?.maxTurns)||3) };
}

export function finalizePersistentIntentAfterReply(intentInput=null, reply='', turnOverride=null) {
  const intent=normalizeRinIntent(intentInput);
  if (!intent || intent.status !== 'active') return intent;
  const text=cleanText(reply,3000);
  if (!text) return intent;
  let fulfilled=false; let evidence=null;
  if (intent.nextMove === 'reveal_promised_special_thing') {
    const personalReveal=/(?:(?:^|\s)я\s+(?:хотела|хочу|имела|собиралась)|(?:^|\s)мне\s+(?:нравится|хочется|важно|дорого)|(?:^|\s)это\s+(?:то,?\s+)?что\s+я)/iu.test(text);
    fulfilled=personalReveal && !REVEAL_DEFERRAL.test(text) && !/\?/.test(text);
    if (fulfilled) evidence='ответ содержит прямое личное раскрытие обещанного содержания';
  } else if (['introduce_personal_detail','share_bound_personal_view','share_specific_evening_preference'].includes(intent.nextMove)) {
    fulfilled=/(?:(?:^|\s)(?:я|мне|мой|моя|моё))/iu.test(text) && !/\?$/.test(text.trim());
    if (fulfilled) evidence='Рин внесла собственную конкретную деталь по предмету сцены';
  } else if (intent.nextMove === 'reveal_specific_personal_secret') {
    fulfilled=/(?:(?:^|\s)я\s|(?:^|\s)мне\s|иногда\s+я|я\s+(?:люблю|представляю|фантазир|мечтаю))/iu.test(text) && !/(?:секреты всегда|вообще|люди|каждый)/iu.test(text);
    if (fulfilled) evidence='Рин раскрыла конкретное личное содержание';
  } else if (intent.nextMove === 'add_specific_shared_world_detail') {
    fulfilled=/(?:мы|вместе|нас|тебя|тебе|рядом|там|место|река|горы|лес|дом|тропа|ноч|огн|чай|кицун)/iu.test(text) && text.length>=28;
    if (fulfilled) evidence='Рин добавила конкретную деталь в общий воображаемый мир';
  } else if (intent.nextMove === 'advance_kitsune_thread') {
    fulfilled=/(?:кицун|лис|хвост|облик|хитрост|защит|тайн|япон)/iu.test(text) && text.length>=22;
    if (fulfilled) evidence='Рин продвинула конкретную линию про кицунэ';
  } else if (intent.nextMove === 'reciprocate_specific_affection') {
    fulfilled=/(?:обним|целу|приж|рядом|улыб|держу|нежн)/iu.test(text);
    if (fulfilled) evidence='Рин ответила конкретным жестом близости';
  } else if (intent.nextMove === 'make_specific_teasing_move') {
    fulfilled=intent.turnCount>=intent.minTurns && /(?:ну-ну|поймала|не выкручив|тогда|попробуй|посмотрим|смущ|дразн|хитр|не всё сразу|моя очередь|твоя очередь)/iu.test(text) && !/(?:флирт|игровая линия|наш разговор)/iu.test(text);
    if (fulfilled) evidence='Рин сделала конкретный игровой ход внутри сцены';
  } else if (/take_control|perform_handoff|respond_personally/iu.test(intent.nextMove)) {
    fulfilled=text.length>=12 && !/(?:готовься|сейчас начнём|будет интересно|если хочешь)/iu.test(text);
    if (fulfilled) evidence='Рин реально выполнила обещанный самостоятельный ход';
  }
  if (!fulfilled) return intent;
  const turn=Math.max(Number(turnOverride)||0, intent.updatedAtTurn, intent.startedAtTurn);
  return terminalize(intent,'completed',turn,evidence,{progress:1,progressState:'fulfilled',completionEvidence:evidence});
}

export function advancePersistentIntent({ memory=null, characterIntent=null, dialogueState=null, brain=null, userText='' }={}) {
  const text=cleanText(userText,1800).toLowerCase();
  const scene=dialogueState?.scene || brain?.activeScene?.type || 'everyday';
  const turn=Math.max(1,(Number(memory?.conversationState?.revision)||0)+1);
  const previous=normalizeRinIntent(memory?.conversationState?.rinIntent);
  const farewell=FAREWELL.test(text) || brain?.literalIntent==='farewell' || scene==='farewell';
  if (farewell) return previous?.status==='active' ? terminalize(previous,'cancelled',turn,'разговор завершён') : previous;

  const candidate=candidateToIntent(characterIntent,{scene,turn,dialogueState,userText,brain});

  if (previous && ['completed','cancelled'].includes(previous.status)) {
    const holdUntil = Math.max(Number(previous.cooldownUntilTurn)||0, (Number(previous.terminalAtTurn)||Number(previous.updatedAtTurn)||turn) + TERMINAL_HOLD_TURNS);
    if (!candidate) return turn <= holdUntil ? normalizeRinIntent({...previous,cooldownUntilTurn:holdUntil}) : null;
    const sameBinding=Boolean(candidate.sceneBinding?.key && previous.sceneBinding?.key && candidate.sceneBinding.key===previous.sceneBinding.key);
    const sameFamily=intentFamily(candidate) && intentFamily(candidate)===intentFamily(previous);
    const sameGoal=candidate.semanticKey===previous.semanticKey || sameBinding || sameFamily || candidate.goal===previous.goal;
    if (sameGoal && turn <= holdUntil) return normalizeRinIntent({...previous,cooldownUntilTurn:holdUntil});
    return candidate;
  }

  const cancelReason=shouldCancel(previous,{text,brain,scene,dialogueState});
  if (previous?.status==='active' && cancelReason) return terminalize(previous,'cancelled',turn,cancelReason);

  if (previous?.status==='active') {
    const guessing=guessingGameState(previous,dialogueState,text);
    if (guessing) return normalizeRinIntent({ ...previous, ...guessing, updatedAtTurn:turn, turnCount:previous.turnCount+1, commitment:Math.max(75,previous.commitment), progress:Math.max(.62,previous.progress) });

    const explicitNewBinding=explicitCurrentBinding(userText);
    const incompatibleCandidate=candidate && candidate.scene !== previous.scene && candidate.priority >= previous.priority + 20 && explicitNewBinding;
    if (incompatibleCandidate) return normalizeRinIntent({ ...candidate, replacementOf:previous.id, rootId:candidate.id, reason:`${candidate.reason||''}; прежняя цель вытеснена явной новой сценой` });

    const directObligation=brain?.ambiguity?.shouldClarify || brain?.relation?.type==='correction' || brain?.literalIntent==='question';
    const progress=clamp01(previous.progress+engagementDelta(text,brain,previous),previous.progress);
    const next=normalizeRinIntent({ ...previous, progress, updatedAtTurn:turn, turnCount:previous.turnCount+1, nextMove:directObligation?'answer_obligation_then_resume':previous.nextMove, commitment:Math.max(50,previous.commitment-(directObligation?4:0)) });
    if (next.turnCount > next.maxTurns) return terminalize(next,'cancelled',turn,'локальная цель истекла без подтверждённого выполнения');
    return next;
  }

  return candidate;
}

export function persistentIntentInstruction(intent=null) {
  const state=normalizeRinIntent(intent);
  if (!state) return 'PERSISTENT INTENT: активного собственного намерения Рин нет.';
  if (state.status!=='active') return `PERSISTENT INTENT: ${state.status}. Намерение «${state.goal}» закрыто и до нового явного основания не возрождается. Причина: ${state.completionReason||'линия закрыта'}.`;
  return [
    'PERSISTENT INTENT v4 — ЕДИНСТВЕННЫЙ LIFECYCLE ЛОКАЛЬНОЙ ЦЕЛИ РИН',
    `Цель: ${state.goal}. Мотив: ${state.motive}.`,
    state.sceneBinding?.key ? `Привязка: ${state.sceneBinding.kind||'context'} / ${state.sceneBinding.key}; опора: «${state.sceneBinding.anchor||state.sceneBinding.subject||state.target}».` : '',
    `Следующий ход: ${state.nextMove}; progress ${Math.round(state.progress*100)}%; ход ${state.turnCount}/${state.maxTurns}. Ожидаемый результат: ${state.expectedOutcome||'конкретное продвижение'}.`,
    `Условие завершения: ${state.completionCondition}.`,
    'Текущая цель не перепривязывается к случайному слову новой реплики. Новая тема либо временно прерывает ход, либо явно завершает/вытесняет старую цель.',
    'Не называй цель вслух. Продвинь её действием. Прямой вопрос пользователя можно сначала закрыть, но не стирай цель без terminal condition.'
  ].filter(Boolean).join('\n');
}
