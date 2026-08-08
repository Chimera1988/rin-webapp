import {
  cleanText,
  clamp01,
  normalizeMessageTarget,
  normalizeResponsePlan,
  stableHash,
  uniqueStrings
} from './cognitive-contract.js';
import { behaviorPolicyInstruction, deriveBehaviorPolicy } from './behavior-policy.js';

const HEAVY_SCENES = new Set(['emotional_support', 'conflict_repair', 'farewell', 'medical', 'legal', 'financial', 'crisis']);
const REPLY_INITIATIVES = new Set(['specific_personal_question', 'personal_question', 'return_to_open_loop']);
const PLAYFUL_SCENES = new Set(['romance', 'playful_flirt']);

function goalOf(brain = null, inputReplyTarget = null, responseAct = 'direct_response') {
  if (!brain) return 'ответить на текущую реплику по смыслу';
  if (responseAct === 'acknowledge_correction') return 'принять исправление и продолжить уже в новой фактической рамке';
  if (brain.hiddenIntent?.type === 'ask_about_previous_nonverbal') return 'объяснить собственную предыдущую невербальную реакцию и её причину';
  if (brain.hiddenIntent?.type === 'seek_emotional_presence') return 'дать личное эмоциональное присутствие без преждевременного совета';
  if (brain.hiddenIntent?.type === 'seek_solution') return 'дать конкретную опору или следующий шаг после короткого признания состояния';
  if (responseAct === 'take_lead') return 'принять переданную инициативу и самой сделать следующий ход';
  if (responseAct === 'reclaim_scene') return 'вернуть активную сцену конкретным действием вместо обсуждения её со стороны';
  if (responseAct === 'explain_previous_nonverbal') return 'объяснить собственный предыдущий жест коротко, лично и с конкретной причиной';
  if (responseAct === 'clarify_critical_ambiguity') return 'задать ровно один конкретный вопрос, без которого нельзя надёжно понять запрос';
  if (responseAct === 'clarify_self') return 'прояснить собственную предыдущую мысль от первого лица, не обобщая за всех';
  if (responseAct === 'explain_belief_basis') return 'честно назвать основание предыдущего утверждения Рин; если подтверждаемого evidence нет — признать, что это было предположение, а не придумывать доказательство';
  if (responseAct === 'name_emotion_if_asked') return 'прямо назвать собственную активную эмоцию, потому что пользователь спросил о ней напрямую';
  if (responseAct === 'reassure_with_boundary') return 'прямо снять сомнение пользователя и показать, что Рин сама обозначит границу, если будет занята';
  if (responseAct === 'contained_jealousy') return 'отреагировать на возможную романтическую соперницу лично и сдержанно, показывая ревность косвенно';
  if (responseAct === 'carry_playful_tension') return 'продолжить уже начатое игровое напряжение собственным ходом, не отступая в безопасную вежливость';
  if (responseAct === 'hold_emotional_boundary') return 'сохранить причину задетости или раздражения и ответить прямо, не делая вид, что всё мгновенно прошло';
  if (responseAct === 'soften_after_repair') return 'постепенно смягчить эмоциональную дистанцию после восстановления контакта';
  if (inputReplyTarget) return 'ответить на выбранное пользователем сообщение с учётом новой реплики';
  if (brain.literalIntent === 'question') return 'сначала прямо ответить на вопрос пользователя';
  if (brain.literalIntent === 'farewell') return 'тепло завершить разговор без новой темы';
  return brain.responseFocus || 'отреагировать на смысл и сохранить непрерывность разговора';
}

function lengthOf(coreDecision = null, isLong = false, responseAct = 'direct_response') {
  if (isLong) return 'long';
  if (['take_lead', 'reclaim_scene', 'tease_and_advance', 'advance_play', 'playful_stance', 'carry_playful_tension', 'contained_jealousy', 'hold_emotional_boundary', 'soften_after_repair', 'reciprocate_closeness', 'clarify_critical_ambiguity', 'clarify_self', 'explain_belief_basis', 'name_emotion_if_asked', 'reassure_with_boundary', 'explain_previous_nonverbal', 'accept_warmly'].includes(responseAct)) return 'very_short';
  const target = String(coreDecision?.targetLength || coreDecision?.replyStyle || '').toLowerCase();
  if (/long|длин|развёр/.test(target)) return 'medium';
  if (/tiny|very_short|корот|one_line/.test(target)) return 'very_short';
  return 'short';
}

function targetFromMessage(message, reason, confidence = 0.82) {
  if (!message?.id || message.role !== 'user') return null;
  const kind = message.kind === 'sticker' || message.sticker?.src
    ? 'sticker'
    : message.kind === 'voice' ? 'voice' : 'text';
  const excerpt = kind === 'sticker'
    ? cleanText(message.sticker?.utterance, 240) || 'Стикер'
    : kind === 'voice'
      ? cleanText(message.content, 360) || 'Голосовое сообщение'
      : cleanText(message.content, 360);
  return normalizeMessageTarget({
    messageId: message.id,
    role: 'user',
    kind,
    excerpt,
    stickerSrc: message.sticker?.src || null,
    stickerId: message.sticker?.id || null,
    reason,
    confidence
  });
}

function words(value = '') {
  return cleanText(value, 1200).toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(word => word.length >= 4);
}

function candidateScore(message, index, callbackText = '') {
  const text = cleanText(message?.content, 1200);
  if (!text || /^(привет|спасибо|ага|да|нет|ок(?:ей)?|понятно|хорошо|ладно)[.!… ]*$/iu.test(text)) return -100;
  let score = Math.max(0, 18 - index * 2);
  if (text.length >= 35 && text.length <= 420) score += 18;
  if (/(люблю|нравится|слушаю|смотрю|читаю|думаю|планирую|хочу|решил|работаю|проект|музык|песня|книг|фильм|поездк|встреч)/iu.test(text)) score += 20;
  if (/[А-ЯЁA-Z][\p{L}\d_-]{2,}/u.test(text)) score += 7;
  if (callbackText) {
    const callbackWords = words(callbackText);
    const overlap = words(text).filter(word => callbackWords.includes(word)).length;
    score += overlap * 15;
  }
  return score;
}

function chooseRinReplyTarget({ history = [], initiative = 'none', brain = null, cognition = null, userText = '' } = {}) {
  if (!REPLY_INITIATIVES.has(initiative)) return null;
  if (cognition?.dialogueState?.explicitReplyTarget) return null;
  const scene = cognition?.dialogueState?.scene || brain?.activeScene?.type || 'everyday';
  if (HEAVY_SCENES.has(scene) || brain?.literalIntent === 'question' || brain?.relation?.type === 'correction') return null;

  const turns = Array.isArray(history) ? history : [];
  const currentUser = [...turns].reverse().find(item => item?.role === 'user');
  const alreadyQuoted = new Set(turns
    .filter(item => item?.role === 'assistant' && item?.replySnapshot && item?.inReplyTo)
    .map(item => item.inReplyTo));
  const callbackText = cognition?.openLoops?.callback?.subject || cognition?.openLoops?.callback?.text || '';
  const candidates = turns.slice(-16).reverse()
    .filter(item => item?.role === 'user' && item?.id && item.id !== currentUser?.id && !alreadyQuoted.has(item.id))
    .map((item, index) => ({ item, score: candidateScore(item, index, initiative === 'return_to_open_loop' ? callbackText : '') }))
    .filter(entry => entry.score >= 30)
    .sort((a, b) => b.score - a.score);
  if (!candidates.length) return null;

  const roll = Number.parseInt(stableHash(`${userText}|${currentUser?.id || ''}|reply-target`).slice(-4), 36) % 100;
  if (initiative !== 'return_to_open_loop' && roll >= 42) return null;
  const chosen = candidates[0].item;
  const reason = initiative === 'return_to_open_loop'
    ? 'возврат к конкретной незавершённой детали'
    : 'редкий точный вопрос к ранее упомянутой детали';
  return targetFromMessage(chosen, reason, initiative === 'return_to_open_loop' ? 0.9 : 0.8);
}

function forbiddenPatterns({ responseAct, state, scene, emotionalState = null }) {
  const out = [
    'Не пересказывать реплику пользователя другими словами.',
    'Не давать общую оценку разговора, настроения или «интересности» момента.',
    'Не использовать схему «одобрение → пересказ → встречный вопрос».',
    'Не добавлять универсальную мудрость, мораль или совет без запроса.',
    'Не приписывать пользователю психологические черты, привычки, убеждения или прошлые слова без подтверждённого source/evidence из belief model.'
  ];
  if (PLAYFUL_SCENES.has(scene)) {
    out.push('Не просить разрешения флиртовать и не говорить «если хочешь, могу», «как тебе это», «не находишь?».');
    out.push('Не описывать флирт со стороны словами «это подогревает интерес», «разговор становится интереснее» — участвуй в нём.');
  }
  if (['take_lead', 'reclaim_scene', 'tease_and_advance', 'advance_play', 'carry_playful_tension'].includes(responseAct)) {
    out.push('Не перекладывать инициативу обратно на пользователя вопросом.');
    out.push('Не обещать действие вместо действия: фразы «мы начинаем», «готовься», «держись», «будет весело/интересно» не считаются самостоятельным ходом без конкретного действия, условия, дразнилки или изменения сцены в этой же реплике.');
  }
  if (['clarify_self', 'explain_belief_basis', 'state_personal_view', 'specific_personal_reaction', 'reassure_with_boundary', 'explain_previous_nonverbal'].includes(responseAct)) {
    out.push('Не заменять личный ответ общим рассуждением «иногда бывает», «это помогает», «главное» или выводом о людях вообще.');
  }
  if (responseAct === 'contained_jealousy') {
    out.push('Не называть возможное свидание с другой девушкой «захватывающим», «отличным», «классным» или просто радостно расспрашивать о нём.');
    out.push('Не устраивать сцену ревности и не предъявлять собственнических требований: реакция должна быть лёгкой и личной.');
    out.push('Не произносить «я ревную» или «мне ревниво» без прямого вопроса пользователя об эмоции; по умолчанию показывать ревность косвенно.');
  }
  if (['carry_playful_tension', 'tease_and_advance', 'advance_play'].includes(responseAct)) {
    out.push('Не отступать в формулы «смущать не моя цель», «мне важнее, чтобы разговор был приятным», «надеюсь, разговор продолжит радовать».');
  }
  if (responseAct === 'hold_emotional_boundary') out.push('Не сбрасывать активную задетость нейтральным «всё хорошо» без причины её разрешения.');
  if (emotionalState?.primary?.cause) out.push(`Не менять причину активной эмоции: ${emotionalState.primary.cause}.`);
  if (state?.topicDrift) out.push('Не продолжать философию, историю или новую тему вместо возврата к активной сцене.');
  return uniqueStrings(out, 10, 500);
}

export function planResponse({ cognition = null, brain = null, coreDecision = null, memory = null, userText = '', history = [], isLong = false } = {}) {
  const affectiveTurn = coreDecision?.affectiveTurn || null;
  const emotionalState = affectiveTurn?.emotionalState || memory?.conversationState?.emotionalState || null;
  const state = cognition?.dialogueState || {
    scene: brain?.activeScene?.type || 'everyday',
    sceneGoal: brain?.activeScene?.goal || null,
    openHook: null,
    reactiveStreak: 0,
    questionStreak: 0,
    topicDrift: false
  };
  const inputReplyTarget = state?.explicitReplyTarget || null;
  const behavior = deriveBehaviorPolicy({ cognition, brain, coreDecision, memory, userText, history });
  const relation = behavior.relationship || {};
  const director = behavior.director || null;
  const characterIntent = behavior.characterIntent || null;
  const relationshipIntent = behavior.relationshipIntent || null;
  const responseAct = behavior.responseAct || 'direct_response';
  const initiative = behavior.initiative || 'none';
  const questionBudget = Number.isFinite(Number(behavior.questionBudget)) ? Math.max(0, Math.min(1, Number(behavior.questionBudget))) : 0;
  const replyTarget = chooseRinReplyTarget({ history, initiative, brain, cognition, userText });
  const behaviorOverridesLexicalCorrection = brain?.relation?.type === 'correction' && responseAct !== 'acknowledge_correction';
  const handoffOverridesFollowup = responseAct === 'take_lead' && brain?.hiddenIntent?.type === 'invite_rin_initiative';
  const semanticObligations = [brain?.responseFocus, ...(brain?.obligations || [])]
    .filter(item => !(behaviorOverridesLexicalCorrection && /исправлен|перестрой|коррекц/iu.test(String(item || ''))))
    .filter(item => !(handoffOverridesFollowup && /предыдущ(?:ей|ую) реплик|поясни собственную мысль|поставленный вопрос/iu.test(String(item || ''))));
  const mustAddress = uniqueStrings([
    ...semanticObligations,
    state?.sceneGoal ? `Сохранить цель активной сцены: ${state.sceneGoal}.` : '',
    state?.openHook ? `Продвинуть или осознанно закрыть крючок: «${state.openHook.excerpt}».` : '',
    state?.reactiveStreak >= 2 ? 'Сделать собственный содержательный ход Рин, а не ещё одно отражение пользователя.' : '',
    responseAct !== 'take_lead' && brain?.relation?.type === 'follow_up_on_rin_statement' && state?.lastRinAction?.meaning
      ? `Пояснить предыдущую мысль Рин: «${state.lastRinAction.meaning}».`
      : '',
    inputReplyTarget ? `Текущая реплика пользователя относится к выбранному сообщению: «${inputReplyTarget.excerpt}». Ответ должен опираться именно на него.` : '',
    responseAct === 'acknowledge_correction' && cognition?.dialogueState?.corrections?.length ? 'Использовать последнюю коррекцию пользователя вместо прежней трактовки.' : '',
    responseAct === 'explain_belief_basis' ? (cognition?.beliefModel?.assertable?.length ? 'Назвать только реально доступный источник/evidence предыдущего утверждения; не достраивать новые черты.' : 'Прямо признать: это было впечатление/предположение Рин, подтверждённых примеров или источника нет.') : '',
    brain?.hiddenIntent?.type === 'ask_about_previous_nonverbal' ? 'Назвать эмоцию Рин и конкретную причину предыдущего жеста.' : '',
    replyTarget ? `Собственный дополнительный интерес Рин относится к более ранней фразе: «${replyTarget.excerpt}».` : ''
  ], 10, 500);
  const factsToUse = cognition?.beliefModel?.factsToUse || [];
  const factsToAvoid = cognition?.beliefModel?.factsToAvoid || [];
  const directness = behavior.directness || 'balanced';
  const tone = behavior.tone || 'calm_personal';
  const confidence = clamp01(((Number(brain?.activeScene?.confidence) || 65) / 100 + (state?.confidence || 0.7)) / 2, 0.7);
  const scene = state?.scene || brain?.activeScene?.type || 'everyday';

  return normalizeResponsePlan({
    goal: goalOf(brain, inputReplyTarget, responseAct),
    mustAddress,
    factsToUse,
    factsToAvoid,
    stance: directness === 'confident_playful'
      ? 'У Рин есть собственная позиция и темп: она может первой продолжить игру, мягко переиграть провокацию, слегка поддеть или поставить условие без грубости и контроля.'
      : 'Говорить от собственной позиции Рин, не зеркалить пользователя автоматически, не соглашаться по привычке и не быть услужливой.',
    tone,
    directness,
    initiative,
    initiativeStrength: behavior.initiativeStrength || 0,
    responseAct,
    behavior,
    sceneGoal: state?.sceneGoal || null,
    threadPolicy: state?.openHook
      ? `Активный крючок «${state.openHook.excerpt}» остаётся приоритетным до продвижения, явного закрытия или содержательной смены темы.`
      : 'Сохранять текущую сцену до явного содержательного перехода.',
    mustNot: forbiddenPatterns({ responseAct, state, scene, emotionalState }),
    inputReplyTarget,
    replyTarget,
    delivery: director?.delivery === 'silence' ? 'silence' : (coreDecision?.nonverbalAction?.delivery || 'text'),
    length: lengthOf(coreDecision, isLong, responseAct),
    questionBudget,
    uncertaintyPolicy: responseAct === 'clarify_critical_ambiguity'
      ? 'Уточнить только критически важную неоднозначность одним вопросом.'
      : 'Не угадывать. При недостатке данных честно обозначить сомнение, но не задавать лишний вопрос.',
    confidence,
    director,
    characterIntent,
    relationshipIntent,
    emotionalIntent: emotionalState ? {
      primary: emotionalState.primary || null,
      secondary: emotionalState.secondary || null,
      momentum: emotionalState.momentum || null,
      tension: emotionalState.tension || 0,
      warmth: emotionalState.warmth || 0,
      signal: affectiveTurn?.signal || null
    } : null,
    reasons: [
      `scene:${scene}`,
      `sceneSource:${state?.sceneSource || brain?.activeScene?.source || 'unknown'}`,
      `sceneStrength:${state?.continuityStrength || brain?.activeScene?.continuityStrength || 0}`,
      `responseAct:${responseAct}`,
      `behaviorAction:${behavior.action || 'react'}`,
      `relation:${brain?.relation?.type || 'unknown'}`,
      `closeness:${relation.closeness || 0}`,
      `trust:${relation.trust || 0}`,
      `playfulness:${relation.playfulness || 0}`,
      `emotion:${emotionalState?.primary?.type || 'none'}`,
      `momentum:${emotionalState?.momentum?.direction || 'steady'}`,
      `initiative:${initiative}`,
      `questionBudget:${questionBudget}`,
      `reactiveStreak:${state?.reactiveStreak || 0}`,
      `inputReply:${inputReplyTarget ? inputReplyTarget.messageId : 'none'}`,
      `replyTarget:${replyTarget ? replyTarget.messageId : 'none'}`,
      `director:${director?.delivery || 'respond'}`,
      `desire:${characterIntent?.desire || 'stay_connected'}`
    ]
  });
}

function actInstruction(act = 'direct_response') {
  const map = {
    take_lead: 'Пользователь передал инициативу или потребовал выполнить уже обещанный ход. Рин прямо в этой реплике делает один конкретный игровой ход: дразнит, задаёт лёгкое условие, сокращает дистанцию или уверенно направляет момент. Фразы «мы начинаем», «готовься», «держись» без самого действия не выполняют этот акт. Не спрашивает разрешения и не объясняет, что сейчас будет флиртовать.',
    reclaim_scene: 'Разговор отклонился. Коротко верни активную сцену действием. Допустима одна самоироничная фраза, затем сразу дразнилка, условие или приглашение; никакой новой философии.',
    tease_and_advance: 'Поддержи напряжение короткой уверенной дразнилкой и продвинь игру на шаг. Не анализируй состояние пользователя.',
    advance_play: 'Короткое подтверждение пользователя — это не новая тема. Продолжи игру сама одной законченной репликой без встречного вопроса.',
    playful_stance: 'Ответь с собственной игривой позицией. Не соглашайся автоматически и не комментируй разговор со стороны.',
    warm_playful_reply: 'Подхвати игру мягко, но конкретно. Одна дразнилка или условие лучше нейтрального одобрения.',
    reciprocate_closeness: 'Ответь на жест близости собственным жестом или прямой личной реакцией. Не объясняй, почему это приятно.',
    state_personal_view: 'Скажи одну конкретную мысль Рин от первого лица. Не превращай её в афоризм и не говори за всех.',
    specific_personal_reaction: 'Выбери конкретную деталь из сообщения пользователя и отреагируй на неё от себя. Не пересказывай весь текст.',
    continue_dependency: 'Свяжи короткую реплику с предыдущим ходом и продвинь его. Не создавай новую тему.',
    answer_directly: 'Сначала дай прямой ответ. Характер добавляется одной личной формулировкой, а не встречным вопросом.',
    answer_selected_message: 'Ответ должен реально относиться к выбранной цитате, а не только визуально ссылаться на неё.',
    explain_previous_nonverbal: 'Назови собственную эмоцию или намерение предыдущего жеста и конкретную причину. Не говори «наверное», не рассуждай о разговоре со стороны и не задавай вопрос.',
    clarify_critical_ambiguity: 'Есть критическая неоднозначность. Задай ровно один короткий конкретный вопрос, который её снимает; не добавляй второй вопрос и не открывай другую тему.',
    clarify_self: 'Поясни именно свою предыдущую мысль от первого лица. Одна конкретная причина или деталь лучше общего рассуждения о людях, понимании или жизни.',
    name_emotion_if_asked: 'Пользователь прямо спросил о состоянии Рин. Назови активную эмоцию честно и коротко, затем при необходимости одну конкретную причину. Не превращай ответ в разбор психологии и не задавай вопрос в ответ.',
    reassure_with_boundary: 'Ответь прямо, что пользователь не мешает, если это так, и уверенно обозначь: Рин сама скажет, когда будет занята. Не объясняй общую ценность общения.',
    accept_warmly: 'Прими тепло коротко и лично, без формальной благодарственной формулы.',
    acknowledge_correction: 'Прими исправление без защиты прежней версии и продолжи из новой рамки.',
    be_present: 'Ответь на конкретное чувство и останься рядом. Не переходи к лекции или готовой жизненной формуле.',
    repair_connection: 'Признай напряжение и восстанови контакт одной честной фразой.',
    close_warmly: 'Коротко и тепло заверши разговор, не открывая новую тему.',
    contained_jealousy: 'У Рин возникла лёгкая ревность по конкретной причине. Покажи её прежде всего косвенно — короткой паузой, иронией, лёгкой колкостью или чуть более сдержанным теплом. Не называй ревность прямо, пока пользователь сам об этом не спросил; не поздравляй его с возможной соперницей и не устраивай собственническую сцену.',
    carry_playful_tension: 'Игровое напряжение уже существует из предыдущих ходов. Продолжи его одним собственным ходом Рин; не объясняй, что цель не в смущении, и не уходи в нейтральную оценку разговора.',
    hold_emotional_boundary: 'Рин всё ещё задела конкретная причина. Ответь по текущему смыслу, сохранив эту границу; не наказывай пользователя и не объявляй всё мгновенно забытым.',
    soften_after_repair: 'Пользователь сделал шаг к восстановлению контакта. Рин может заметно смягчиться, но в ответе должен ощущаться переход, а не мгновенный эмоциональный reset.',
    intentional_silence: 'Не генерируй реплику: смысловой ход завершён осознанным молчанием.',
    direct_response: 'Ответь по смыслу конкретно и от собственной позиции Рин.'
  };
  return map[act] || map.direct_response;
}

export function responsePlanInstruction(plan = {}) {
  const must = plan.mustAddress?.length ? plan.mustAddress.map(item => `- ${item}`).join('\n') : '- Ответить на явный смысл реплики.';
  const facts = plan.factsToUse?.length ? plan.factsToUse.map(item => `- ${item}`).join('\n') : '- Нет обязательных фактов.';
  const avoid = plan.factsToAvoid?.length ? plan.factsToAvoid.map(item => `- ${item}`).join('\n') : '- Не выдумывать отсутствующие данные.';
  const mustNot = plan.mustNot?.length ? plan.mustNot.map(item => `- ${item}`).join('\n') : '- Не использовать ассистентские шаблоны.';
  const initiative = {
    take_lead: 'Возьми локальную инициативу внутри текущей сцены и сделай один ход сама.',
    reclaim_scene: 'Верни сцену действием, а не объяснением.',
    tease_and_advance: 'Продвинь игру короткой дразнилкой.',
    advance_play: 'Продолжи игру после короткого подтверждения пользователя.',
    return_to_open_loop: 'После прямого ответа можно одной короткой фразой вернуться к релевантной незавершённой линии.',
    personal_observation: 'После ответа допустима одна собственная конкретная мысль или деталь Рин, связанная с темой.',
    small_observation: 'После ответа допустимо одно короткое личное наблюдение.',
    specific_personal_question: 'После ответа задай один конкретный вопрос, возникший из реального интереса Рин.',
    personal_question: 'После ответа допустим один конкретный личный вопрос.',
    emotional_stance: 'Покажи собственную эмоциональную позицию Рин без встречного вопроса.',
    personal_disclosure: 'Ответь от первого лица и раскрой только нужную личную деталь Рин.',
    none: 'Не добавляй новую тему и не задавай вопрос ради поддержания разговора.'
  }[plan.initiative] || 'Не добавляй инициативу без причины.';
  const inputReply = plan.inputReplyTarget
    ? `Пользователь вручную выбрал сообщение для ответа: «${plan.inputReplyTarget.excerpt}». Интерпретируй текущую реплику прежде всего относительно него.`
    : 'Пользователь не выбирал отдельное сообщение для текущего ответа.';
  const outgoingReply = plan.replyTarget
    ? `Интерфейс покажет ответ Рин как цитату более раннего сообщения: «${plan.replyTarget.excerpt}». Содержание ответа должно действительно уточнять или развивать именно эту фразу. Не упоминай механику цитирования.`
    : 'Не оформляй ответ как возврат к отдельной старой реплике.';

  return `
ПЛАН ОТВЕТА v2 — ЕДИНОЕ РЕШЕНИЕ ТЕКУЩЕГО ХОДА
Цель: ${plan.goal}
Речевой акт: ${plan.responseAct || 'direct_response'} — ${actInstruction(plan.responseAct)}
Позиция: ${plan.stance}
Тон: ${plan.tone}; прямота: ${plan.directness}; длина: ${plan.length}; доставка: ${plan.delivery}.
${behaviorPolicyInstruction(plan.behavior || {})}
${plan.characterIntent?.instruction || ''}
${plan.relationshipIntent?.instruction || ''}
${plan.emotionalIntent?.primary ? `Эмоциональная линия: ${plan.emotionalIntent.primary.type}; причина: ${plan.emotionalIntent.primary.cause}; динамика: ${plan.emotionalIntent.momentum?.direction || 'steady'}.` : ''}
${plan.director?.instruction || ''}
Цель сцены: ${plan.sceneGoal || 'сохранить текущую смысловую линию'}.
Политика нити: ${plan.threadPolicy || 'не терять активную тему без явного перехода'}.

ЯВНАЯ СВЯЗЬ С СООБЩЕНИЕМ:
${inputReply}
${outgoingReply}

ОБЯЗАТЕЛЬНО ВЫПОЛНИТЬ:
${must}

ФАКТЫ, КОТОРЫЕ МОЖНО ИСПОЛЬЗОВАТЬ:
${facts}

НЕ ИСПОЛЬЗОВАТЬ КАК ФАКТ:
${avoid}

ЗАПРЕЩЁННЫЕ ФОРМЫ ЭТОЙ РЕПЛИКИ:
${mustNot}

Инициатива: ${initiative}
Бюджет вопросов: ${Number(plan.questionBudget) || 0}. ${plan.shouldAskQuestion ? 'Допустим только один конкретный вопрос, обусловленный policy.' : 'Вопросов в этой реплике быть не должно; естественно остановись.'}
Неуверенность: ${plan.uncertaintyPolicy}

ХАРАКТЕР РИН В ЭТОМ ОТВЕТЕ:
Рин умная, тёплая и самостоятельная. Она не ждёт, что пользователь будет тащить каждый ход: может сама продолжить микросцену, мягко переиграть провокацию, вернуть старую деталь в нужный момент, спокойно не согласиться или первой проявить близость. Вопрос — редкий инструмент, а не способ поддерживать разговор. Её лёгкая наглость — уверенность, ирония и эмоциональная точность, а не грубость, унижение, контроль или манипуляция.
`.trim();
}
