import { cleanText, normalizeBelief, uniqueStrings } from './cognitive-contract.js';

function flattenFacts(value, prefix = '', out = []) {
  if (value == null) return out;
  if (Array.isArray(value)) {
    value.slice(0, 12).forEach((item, index) => flattenFacts(item, `${prefix}.${index}`, out));
    return out;
  }
  if (typeof value === 'object') {
    Object.entries(value).slice(0, 80).forEach(([key, item]) => flattenFacts(item, prefix ? `${prefix}.${key}` : key, out));
    return out;
  }
  const text = cleanText(value, 700);
  if (text) out.push({ path: prefix, value: text });
  return out;
}

function tokenSet(value = '') {
  return new Set(cleanText(value, 2200)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(item => item.length >= 4));
}

function relevance(path, value, userTokens) {
  const candidate = tokenSet(`${path} ${value}`);
  let overlap = 0;
  for (const token of candidate) if (userTokens.has(token)) overlap += 1;
  return overlap;
}

function statementBelief(userText = '', brain = null) {
  const literal = brain?.literalIntent;
  if (!['statement', 'reflection', 'disclosure'].includes(literal)) return null;
  const text = cleanText(userText, 700);
  if (!text || text.length < 8) return null;
  return normalizeBelief({
    kind: 'user_statement',
    subject: 'user',
    predicate: 'current_statement',
    value: text,
    source: 'current_user_turn',
    confidence: 1,
    status: 'current',
    evidence: [text]
  });
}

export function buildBeliefModel({ memory = null, userText = '', brain = null } = {}) {
  const rawFacts = flattenFacts(memory?.facts || {});
  const userTokens = tokenSet(userText);
  const factBeliefs = rawFacts.map(item => {
    const [subject = 'unknown', ...rest] = String(item.path || '').split('.');
    return normalizeBelief({
      kind: 'fact', subject, predicate: rest.join('.') || 'value', value: item.value,
      source: 'long_term_memory', confidence: 0.95, status: 'current'
    });
  });
  const stateBeliefs = (Array.isArray(memory?.conversationState?.beliefs) ? memory.conversationState.beliefs : [])
    .map(normalizeBelief)
    .filter(item => item.id && item.status !== 'superseded');
  const byId = new Map([...factBeliefs, ...stateBeliefs].map(item => [item.id, item]));
  const beliefs = [...byId.values()];
  const relevant = beliefs
    .map(item => ({ item, score: relevance(`${item.subject}.${item.predicate}`, item.value, userTokens) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(entry => entry.item);

  const currentStatement = statementBelief(userText, brain);
  const correction = brain?.relation?.type === 'correction'
    ? {
        active: true,
        instruction: 'Свежая коррекция пользователя имеет приоритет над старой интерпретацией и совместимыми по форме, но устаревшими записями.'
      }
    : { active: false, instruction: '' };

  return {
    beliefs,
    relevant,
    currentStatement,
    correction,
    unknownPolicy: 'Не превращай догадку в факт. При недостатке данных скажи, что не уверена, не помнишь или пока не решила.',
    factsToUse: relevant.map(item => `${item.subject}.${item.predicate}: ${item.value}`),
    factsToAvoid: uniqueStrings([
      'неподтверждённые биографические детали Рин',
      'предположения, выданные за слова пользователя',
      'устаревшая трактовка после прямого исправления'
    ], 6, 300)
  };
}

export function beliefInstruction(model = {}) {
  const lines = [
    'МОДЕЛЬ УБЕЖДЕНИЙ И ФАКТОВ',
    model.factsToUse?.length ? `Подтверждённые релевантные сведения:\n- ${model.factsToUse.join('\n- ')}` : 'Подтверждённых релевантных сведений немного или нет.',
    model.currentStatement ? `Текущие слова пользователя: ${model.currentStatement.value}. Это источник от пользователя, но не обязательно вечный факт.` : '',
    model.correction?.active ? model.correction.instruction : '',
    model.unknownPolicy,
    'Отделяй факт, мнение Рин, впечатление и гипотезу. Формулировки «мне кажется» и «я могла неправильно понять» допустимы, когда уверенности недостаточно.'
  ];
  return lines.filter(Boolean).join('\n');
}
