import { isTextTurn } from '../chat-contract.js';
import { textOf } from './utils.js';

const normalizeText = value => textOf(value).replace(/\s+/g, ' ').trim();

const STOP = new Set('и в во на но а я ты он она мы вы это как что к у из за по для не да же ли или про мне тебя тебя мой моя твой твоя'.split(' '));

function tokens(value = '') {
  return normalizeText(value).toLowerCase().match(/[а-яёa-z0-9]{3,}/giu)?.filter(x => !STOP.has(x)) || [];
}

function overlapScore(a, b) {
  const left = new Set(tokens(a));
  if (!left.size) return 0;
  let score = 0;
  for (const word of tokens(b)) if (left.has(word)) score += word.length > 6 ? 2 : 1;
  return score;
}

export function selectRelevantMemory(memory, userText = '', history = [], limits = {}) {
  if (!memory || typeof memory !== 'object') return { facts: [], events: [], summaries: [] };
  const context = [userText, ...history.filter(isTextTurn).slice(-6).map(x => x?.content || '')].join(' ');
  const maxFacts = limits.maxFacts || 8;
  const maxEvents = limits.maxEvents || 5;
  const facts = [];

  function walk(value, path = '') {
    if (value == null) return;
    if (typeof value !== 'object' || Array.isArray(value)) {
      const text = normalizeText(typeof value === 'object' ? JSON.stringify(value) : value).slice(0, 260);
      if (!path || !text) return;
      const score = overlapScore(context, `${path} ${text}`) + (/^(user\.(name|identity|relationship|preferences?))/i.test(path) ? 1 : 0);
      facts.push({ path, text, score });
      return;
    }
    for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key);
  }
  walk(memory.facts || {});

  const selectedFacts = facts
    .sort((a, b) => b.score - a.score)
    .filter((item, index) => item.score > 0 || index < 2)
    .slice(0, maxFacts);

  const events = (Array.isArray(memory.recentEvents) ? memory.recentEvents : [])
    .map((item, index, all) => ({
      text: normalizeText(item?.text || '').slice(0, 340),
      importance: Number(item?.importance) || 5,
      recency: index / Math.max(1, all.length - 1),
      score: overlapScore(context, item?.text || '')
    }))
    .filter(item => item.text)
    .sort((a, b) => (b.score * 3 + b.importance + b.recency * 2) - (a.score * 3 + a.importance + a.recency * 2))
    .filter((item, index) => item.score > 0 || item.importance >= 8 || index < 1)
    .slice(0, maxEvents);

  const summaries = (Array.isArray(memory.summaries) ? memory.summaries : [])
    .map((item, index, all) => ({
      text: normalizeText(item?.text || '').slice(0, 900),
      score: overlapScore(context, item?.text || ''),
      recency: index / Math.max(1, all.length - 1)
    }))
    .filter(item => item.text)
    .sort((a, b) => (b.score * 3 + b.recency) - (a.score * 3 + a.recency))
    .filter((item, index) => item.score > 0 || index < 1)
    .slice(0, limits.maxSummaries || 2);

  return { facts: selectedFacts, events, summaries };
}

export function buildContinuitySnapshot(history = [], userText = '') {
  const recent = history.filter(isTextTurn).slice(-10);
  const assistant = recent.filter(x => x?.role === 'assistant').map(x => normalizeText(x.content)).filter(Boolean);
  const user = recent.filter(x => x?.role === 'user').map(x => normalizeText(x.content)).filter(Boolean);
  const lastAssistant = assistant.at(-1) || '';
  const lastUser = user.at(-1) || userText;

  const commitments = assistant
    .filter(text => /(?:^|[\s,.!?…])(?:я (?:думаю|хочу|не хочу|люблю|не люблю|помню|решила|выберу|расскажу)|мне (?:нравится|не нравится|важно))(?:$|[\s,.!?…])/i.test(text))
    .slice(-3);

  const unresolved = user
    .filter(text => /(?:^|[\s,.!?…])(?:потом|завтра|вечером|когда|ещ[её] не|планирую|собираюсь|жду|доделаю|проверю)(?:$|[\s,.!?…])/i.test(text))
    .slice(-2);

  return {
    lastAssistant: lastAssistant.slice(0, 260),
    lastUser: lastUser.slice(0, 260),
    commitments,
    unresolved
  };
}

export function continuityInstruction(snapshot) {
  if (!snapshot) return '';
  const lines = [
    'НЕПРЕРЫВНОСТЬ ЛИЧНОСТИ',
    snapshot.commitments?.length ? `Недавние собственные позиции Рин:\n- ${snapshot.commitments.join('\n- ')}` : '',
    snapshot.unresolved?.length ? `Незавершённые линии пользователя:\n- ${snapshot.unresolved.join('\n- ')}` : '',
    'Сохраняй уже выраженные предпочтения и позиции, пока разговор явно их не изменил. Не повторяй их дословно и не возвращай незавершённую тему без естественного повода.',
    'Рин может иметь мнение, колебаться, менять решение после новой информации и мягко не соглашаться. Она не обязана соглашаться, хвалить или помогать в каждой реплике.'
  ];
  return lines.filter(Boolean).join('\n\n');
}
