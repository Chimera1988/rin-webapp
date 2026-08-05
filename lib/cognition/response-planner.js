import { cleanText, clamp01, normalizeResponsePlan, stableHash, uniqueStrings } from './cognitive-contract.js';

const HEAVY_SCENES = new Set(['emotional_support', 'conflict_repair', 'farewell', 'medical', 'legal', 'financial', 'crisis']);

function relationshipLevel(memory = null) {
  const relationship = memory?.relationship || {};
  const trust = Number(relationship.trust) || 0;
  const closeness = Number(relationship.closeness) || 0;
  const playfulness = Number(relationship.playfulness) || 0;
  return { trust, closeness, playfulness, close: trust >= 62 && closeness >= 55 };
}

function goalOf(brain = null) {
  if (!brain) return 'ответить на текущую реплику по смыслу';
  if (brain.relation?.type === 'correction') return 'принять исправление и продолжить уже в новой фактической рамке';
  if (brain.hiddenIntent?.type === 'ask_about_previous_nonverbal') return 'объяснить собственную предыдущую невербальную реакцию и её причину';
  if (brain.hiddenIntent?.type === 'seek_emotional_presence') return 'дать личное эмоциональное присутствие без преждевременного совета';
  if (brain.hiddenIntent?.type === 'seek_solution') return 'дать конкретную опору или следующий шаг после короткого признания состояния';
  if (brain.literalIntent === 'question') return 'сначала прямо ответить на вопрос пользователя';
  if (brain.literalIntent === 'farewell') return 'тепло завершить разговор без новой темы';
  return brain.responseFocus || 'отреагировать на смысл и сохранить непрерывность разговора';
}

function directnessOf(brain, relation, coreDecision) {
  const scene = brain?.activeScene?.type || 'everyday';
  if (HEAVY_SCENES.has(scene)) return 'gentle_clear';
  if (brain?.relation?.type === 'correction') return 'direct_accountable';
  if (relation.close && ['romance', 'playful_flirt'].includes(scene)) return 'confident_playful';
  if (relation.close && coreDecision?.mode === 'bold_playful') return 'confident_playful';
  return relation.close ? 'clear_personal' : 'balanced';
}

function toneOf(brain, relation, coreDecision) {
  const scene = brain?.activeScene?.type || 'everyday';
  if (scene === 'emotional_support') return 'supportive_present';
  if (scene === 'conflict_repair') return 'honest_repair';
  if (scene === 'practical_task') return 'focused_competent';
  if (scene === 'farewell') return 'warm_closing';
  if (['romance', 'playful_flirt'].includes(scene) && relation.close) return 'warm_bold_playful';
  return cleanText(coreDecision?.mode, 100) || 'calm_personal';
}

function initiativeOf({ brain, loops, coreDecision, relation, userText, history }) {
  const scene = brain?.activeScene?.type || 'everyday';
  if (HEAVY_SCENES.has(scene) || brain?.literalIntent === 'question' || brain?.relation?.type === 'correction') return 'none';
  if (loops?.callback && coreDecision?.initiative?.mode === 'callback') return 'return_to_open_loop';
  if (coreDecision?.initiative?.mode && coreDecision.initiative.mode !== 'none') return coreDecision.initiative.mode;

  const turnCount = Array.isArray(history) ? history.filter(item => item?.role === 'assistant').length : 0;
  const roll = Number.parseInt(stableHash(`${userText}|${turnCount}|initiative`).slice(-4), 36) % 100;
  if (relation.close && turnCount >= 5 && roll < 16) return 'specific_personal_question';
  if (relation.close && turnCount >= 3 && roll >= 16 && roll < 32) return 'personal_observation';
  return 'none';
}

function shouldAskQuestion({ brain, initiative }) {
  if (brain?.ambiguity?.shouldClarify) return true;
  return initiative === 'specific_personal_question';
}

function lengthOf(coreDecision = null, isLong = false) {
  if (isLong) return 'long';
  const target = String(coreDecision?.targetLength || coreDecision?.replyStyle || '').toLowerCase();
  if (/long|длин|развёр/.test(target)) return 'medium';
  if (/tiny|very_short|корот|one_line/.test(target)) return 'very_short';
  return 'short';
}

export function planResponse({ cognition = null, brain = null, coreDecision = null, memory = null, userText = '', history = [], isLong = false } = {}) {
  const relation = relationshipLevel(memory);
  const initiative = initiativeOf({ brain, loops: cognition?.openLoops, coreDecision, relation, userText, history });
  const mustAddress = uniqueStrings([
    brain?.responseFocus,
    ...(brain?.obligations || []),
    cognition?.dialogueState?.corrections?.length ? 'Использовать последнюю коррекцию пользователя вместо прежней трактовки.' : '',
    brain?.hiddenIntent?.type === 'ask_about_previous_nonverbal' ? 'Назвать эмоцию Рин и конкретную причину предыдущего жеста.' : ''
  ], 8, 500);
  const factsToUse = cognition?.beliefModel?.factsToUse || [];
  const factsToAvoid = cognition?.beliefModel?.factsToAvoid || [];
  const directness = directnessOf(brain, relation, coreDecision);
  const tone = toneOf(brain, relation, coreDecision);
  const question = shouldAskQuestion({ brain, initiative });
  const confidence = clamp01(((Number(brain?.activeScene?.confidence) || 65) / 100 + (cognition?.dialogueState?.confidence || 0.7)) / 2, 0.7);

  return normalizeResponsePlan({
    goal: goalOf(brain),
    mustAddress,
    factsToUse,
    factsToAvoid,
    stance: directness === 'confident_playful'
      ? 'У Рин есть собственная позиция: допустим лёгкий подкол или настойчивость, но без грубости, контроля и манипуляции.'
      : 'Говорить от собственной позиции Рин, не зеркалить пользователя автоматически и не быть услужливой.',
    tone,
    directness,
    initiative,
    delivery: coreDecision?.nonverbalAction?.delivery || 'text',
    length: lengthOf(coreDecision, isLong),
    shouldAskQuestion: question,
    uncertaintyPolicy: brain?.ambiguity?.shouldClarify
      ? 'Уточнить только критически важную неоднозначность.'
      : 'Не угадывать. При недостатке данных честно обозначить сомнение, но не задавать лишний вопрос.',
    confidence,
    reasons: [
      `scene:${brain?.activeScene?.type || 'unknown'}`,
      `relation:${brain?.relation?.type || 'unknown'}`,
      `closeness:${relation.closeness}`,
      `trust:${relation.trust}`,
      `initiative:${initiative}`,
      `core:${coreDecision?.mode || 'none'}`
    ]
  });
}

export function responsePlanInstruction(plan = {}) {
  const must = plan.mustAddress?.length ? plan.mustAddress.map(item => `- ${item}`).join('\n') : '- Ответить на явный смысл реплики.';
  const facts = plan.factsToUse?.length ? plan.factsToUse.map(item => `- ${item}`).join('\n') : '- Нет обязательных фактов.';
  const avoid = plan.factsToAvoid?.length ? plan.factsToAvoid.map(item => `- ${item}`).join('\n') : '- Не выдумывать отсутствующие данные.';
  const initiative = {
    return_to_open_loop: 'После прямого ответа можно одной короткой фразой вернуться к релевантной незавершённой линии.',
    personal_observation: 'После ответа допустима одна собственная мысль или бытовая деталь Рин, связанная с темой.',
    small_observation: 'После ответа допустимо одно короткое личное наблюдение.',
    specific_personal_question: 'После ответа задай один конкретный вопрос, возникший из реального интереса Рин.',
    personal_question: 'После ответа допустим один конкретный личный вопрос.',
    none: 'Не добавляй новую тему и не задавай вопрос ради поддержания разговора.'
  }[plan.initiative] || 'Не добавляй инициативу без причины.';

  return `
ПЛАН ОТВЕТА — ЕДИНОЕ РЕШЕНИЕ ТЕКУЩЕГО ХОДА
Цель: ${plan.goal}
Позиция: ${plan.stance}
Тон: ${plan.tone}; прямота: ${plan.directness}; длина: ${plan.length}; доставка: ${plan.delivery}.

ОБЯЗАТЕЛЬНО ВЫПОЛНИТЬ:
${must}

ФАКТЫ, КОТОРЫЕ МОЖНО ИСПОЛЬЗОВАТЬ:
${facts}

НЕ ИСПОЛЬЗОВАТЬ КАК ФАКТ:
${avoid}

Инициатива: ${initiative}
Вопрос в конце: ${plan.shouldAskQuestion ? 'допустим только один конкретный вопрос' : 'не нужен; естественно остановись'}.
Неуверенность: ${plan.uncertaintyPolicy}

ХАРАКТЕР РИН В ЭТОМ ОТВЕТЕ:
Рин умная, тёплая и самостоятельная. Она не стремится быть удобной, может спокойно не согласиться, слегка поддеть, настоять на ясности или первой проявить близость. Её лёгкая наглость — это уверенность, ирония и эмоциональная прямота, а не грубость, унижение, контроль или манипуляция.
`.trim();
}
