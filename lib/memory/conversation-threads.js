import { contentKey, isTextTurn } from '../chat-contract.js';
const THREAD_PATTERNS = [
  { type: 'project', re: /\b(?:проект|сайт|приложен|код|разработ|додел|законч|заверш)\w*/i },
  { type: 'translation', re: /\b(?:перевод|редактир|текст|абзац|документ)\w*/i },
  { type: 'work', re: /\b(?:работа|рабоч|задач|дедлайн)\w*/i },
  { type: 'plan', re: /\b(?:планир|собираюсь|хочу потом|вечером буду|завтра буду)\b/i },
  { type: 'media', re: /\b(?:книг|фильм|сериал|музык|песн)\w*/i }
];

function textOf(m) { return String(m?.content || '').trim(); }

function summarize(text, max = 140) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}…`;
}

export function collectConversationThreads(history = []) {
  const threads = [];
  history.forEach((m, index) => {
    if (m?.role !== 'user' || !isTextTurn(m)) return;
    const text = textOf(m);
    if (!text || text.length < 12) return;
    for (const pattern of THREAD_PATTERNS) {
      if (!pattern.re.test(text)) continue;
      const later = history.slice(index + 1).map(textOf).join(' ');
      const resolved = /(?:закончил|готово|получилось|сделал|завершил|сдал|доделал)/i.test(later);
      const assistantTurnsSince = history.slice(index + 1).filter(x => x?.role === 'assistant' && isTextTurn(x)).length;
      threads.push({
        id: `thread-${contentKey(`${pattern.type}:${text}`)}`,
        type: pattern.type,
        summary: summarize(text),
        sourceIndex: index,
        assistantTurnsSince,
        resolved
      });
      break;
    }
  });

  const deduped = [];
  const seen = new Set();
  for (const thread of threads.reverse()) {
    if (seen.has(thread.type)) continue;
    seen.add(thread.type);
    deduped.push(thread);
  }
  return deduped.reverse();
}

export function chooseThreadCallback(history = []) {
  const candidates = collectConversationThreads(history)
    .filter(t => !t.resolved && t.assistantTurnsSince >= 5 && t.assistantTurnsSince <= 18);
  if (!candidates.length) return null;
  const thread = candidates[candidates.length - 1];
  const recent = history.slice(-6).map(textOf).join(' ').toLowerCase();
  const key = thread.type === 'translation' ? 'перевод' : thread.type === 'project' ? 'проект' : thread.type;
  if (recent.includes(key)) return null;
  return thread;
}
