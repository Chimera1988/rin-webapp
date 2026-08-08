import { isTextTurn } from '../chat-contract.js';
import { textOf } from './utils.js';
import { retrieveMemory } from '../cognition/memory-retrieval.js';

const normalizeText = value => textOf(value).replace(/\s+/g, ' ').trim();

/** @deprecated vNext compatibility shim. Memory retrieval is owned by cognition/memory-retrieval.js. */
export function selectRelevantMemory(memory, userText = '', history = [], limits = {}) {
  return retrieveMemory({ memory, userText, history, limits });
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
