import { cleanText, cognitiveId, normalizeOpenLoop } from './cognitive-contract.js';

const FUTURE_PATTERN = /(завтра|потом|позже|после этого|на неделе|вечером|утром|покажу|расскажу|напишу|сообщу|проверю|отправлю|решу|закончу|вернусь)/iu;
const WAITING_PATTERN = /(жду|ожидаю|должны ответить|когда ответят|результат|решение|подтверждение|письмо|предложение|доставка)/iu;
const RESOLVED_PATTERN = /(уже сделал|уже закончил|отправил|готово|решилось|получил ответ|ответили|состоялось|отменил)/iu;

function rememberedLoops(memory = null) {
  return (Array.isArray(memory?.openLoops) ? memory.openLoops : [])
    .map(item => normalizeOpenLoop({
      id: item?.id,
      type: item?.type || 'memory',
      subject: item?.text || item?.content || item?.subject,
      status: item?.status || 'active',
      waitingFor: item?.waitingFor,
      importance: Number(item?.importance) <= 10 ? Number(item.importance) * 10 : item?.importance,
      confidence: item?.confidence ?? 0.9,
      createdAt: item?.createdAt,
      updatedAt: item?.updatedAt,
      source: 'long_term_memory'
    }))
    .filter(item => item.subject && !['resolved', 'cancelled', 'stale'].includes(item.status));
}

function derivedLoops(history = [], now = Date.now()) {
  const turns = (Array.isArray(history) ? history : []).slice(-14);
  const out = [];
  for (const turn of turns) {
    if (turn?.role !== 'user') continue;
    const text = cleanText(turn.content, 500);
    if (!text || RESOLVED_PATTERN.test(text)) continue;
    if (!FUTURE_PATTERN.test(text) && !WAITING_PATTERN.test(text)) continue;
    out.push(normalizeOpenLoop({
      id: cognitiveId('loop', text),
      type: WAITING_PATTERN.test(text) ? 'awaited_update' : 'plan',
      subject: text,
      status: WAITING_PATTERN.test(text) ? 'waiting_for_user' : 'active',
      waitingFor: 'user_update',
      importance: WAITING_PATTERN.test(text) ? 72 : 58,
      confidence: 0.72,
      createdAt: Number(turn.ts) || now,
      updatedAt: Number(turn.ts) || now,
      source: 'recent_dialogue'
    }));
  }
  return out;
}

function mergeLoops(...groups) {
  const byId = new Map();
  for (const item of groups.flat()) {
    const normalized = normalizeOpenLoop(item);
    if (!normalized.subject) continue;
    const previous = byId.get(normalized.id);
    if (!previous || normalized.importance > previous.importance) byId.set(normalized.id, normalized);
  }
  return [...byId.values()]
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 10);
}

function callbackAllowed(brain = null) {
  if (!brain) return true;
  if (['question', 'request_advice', 'request_content', 'farewell'].includes(brain.literalIntent)) return false;
  if (['emotional_support', 'conflict_repair', 'practical_task', 'farewell'].includes(brain.activeScene?.type)) return false;
  if ((brain.obligations || []).length >= 3) return false;
  return true;
}

export function buildOpenLoops({ memory = null, history = [], brain = null } = {}) {
  const remembered = rememberedLoops(memory);
  const derived = derivedLoops(history);
  const active = mergeLoops(remembered, derived);
  const callback = callbackAllowed(brain)
    ? active.find(item => item.importance >= 60 && item.confidence >= 0.7) || null
    : null;
  return { active, callback };
}

export function openLoopsInstruction(state = {}) {
  const active = Array.isArray(state.active) ? state.active.slice(0, 5) : [];
  const lines = [
    'НЕЗАВЕРШЁННЫЕ ЛИНИИ',
    active.length ? `Активные линии:\n- ${active.map(item => `${item.subject} [${item.status}]`).join('\n- ')}` : 'Активных значимых линий нет.',
    state.callback
      ? `Естественный кандидат для редкого возврата: ${state.callback.subject}. Возвращайся к нему только после ответа на текущую реплику и только если это не выглядит как проверка или контроль.`
      : 'Не возвращай старую тему без естественной связи.',
    'Не перечисляй линии и не говори, что они сохранены. Завершённую или исправленную тему не поднимай заново.'
  ];
  return lines.join('\n');
}
