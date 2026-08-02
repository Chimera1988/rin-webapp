const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ACCESS_PIN = process.env.ACCESS_PIN || '';

// Анализ памяти остаётся на gpt-4o-mini; endpoint ничего не сохраняет.
export const MEMORY_MODEL = process.env.OPENAI_MEMORY_MODEL || process.env.OPENAI_SHORT_MODEL || 'gpt-4o-mini';

const clean = (value, max = 1000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const list = (value, max) => Array.isArray(value) ? value.slice(0, max) : [];

function emptyResult() {
  return {
    facts: [],
    events: [],
    threads: [],
    relationshipDelta: { affection: 0, trust: 0, intimacy: 0, tension: 0, confidence: 0, reason: '' },
    stateDelta: { playfulness: 0, valence: 0, arousal: 0, confidence: 0, reason: '' },
    moodDelta: { affection: 0, trust: 0, energy: 0, playfulness: 0, confidence: 0, reason: '' }
  };
}

function delta(value, max = 8) {
  return Math.round(clamp(value, -max, max));
}

export function sanitizeMemoryResult(value) {
  const result = emptyResult();
  for (const item of list(value?.facts, 5)) {
    const path = clean(item?.path, 100);
    const factValue = clean(item?.value, 500);
    const confidence = clamp(item?.confidence ?? 0.7, 0, 1);
    if (!/^user(\.[a-zA-Z0-9_-]+)+$/.test(path) || !factValue || confidence < 0.6) continue;
    result.facts.push({ path, value: factValue, confidence, importance: clamp(item?.importance ?? 6, 1, 10) });
  }
  for (const item of list(value?.events, 5)) {
    const text = clean(item?.text, 600);
    if (!text) continue;
    result.events.push({
      text,
      type: clean(item?.type || 'memory', 30),
      tags: list(item?.tags, 8).map(tag => clean(tag, 40)).filter(Boolean),
      importance: clamp(item?.importance ?? 5, 1, 10),
      confidence: clamp(item?.confidence ?? 0.8, 0, 1)
    });
  }
  for (const item of list(value?.threads, 3)) {
    const title = clean(item?.title, 120);
    if (!title) continue;
    result.threads.push({
      title,
      summary: clean(item?.summary || title, 500),
      status: item?.status === 'closed' ? 'closed' : 'open',
      dueAt: Number(item?.dueAt) || null,
      importance: clamp(item?.importance ?? 6, 1, 10)
    });
  }
  const relation = value?.relationshipDelta || {};
  const current = value?.stateDelta || {};
  const relationConfidence = clamp(relation.confidence ?? 0, 0, 1);
  const stateConfidence = clamp(current.confidence ?? relationConfidence, 0, 1);
  result.relationshipDelta = {
    affection: delta(relation.affection, 6), trust: delta(relation.trust, 6),
    intimacy: delta(relation.intimacy, 4), tension: delta(relation.tension, 8),
    confidence: relationConfidence, reason: clean(relation.reason, 240)
  };
  result.stateDelta = {
    playfulness: delta(current.playfulness, 6), valence: delta(current.valence, 6),
    arousal: delta(current.arousal, 6), confidence: stateConfidence, reason: clean(current.reason, 240)
  };
  // Совместимость со старым клиентом. energy всегда 0: пользовательская реплика не меняет запас сил Рин.
  result.moodDelta = {
    affection: result.relationshipDelta.affection,
    trust: result.relationshipDelta.trust,
    energy: 0,
    playfulness: result.stateDelta.playfulness,
    confidence: Math.max(relationConfidence, stateConfidence),
    reason: result.relationshipDelta.reason || result.stateDelta.reason
  };
  return result;
}

async function extractMemory({ userText, assistantText, existingMemory }) {
  const system = `
Ты — безмолвный анализатор локальной памяти персонального компаньона. Верни только JSON.

Сохраняй только явно сообщённое пользователем:
- устойчивые факты о пользователе в paths user.*;
- важные события и планы, о которых уместно спросить позже;
- незавершённые темы и обещания.

Не сохраняй приветствия, обычные вопросы, догадки, сведения только из ответа Рин,
пароли, PIN, ключи, платёжные данные, точный адрес и избыточно чувствительные детали.
Упоминание Рин относится к собеседнице, а не к третьему лицу пользователя.

Разделяй отношения и текущее состояние:
- relationshipDelta: медленные affection, trust, intimacy и tension;
- stateDelta: быстрые playfulness, valence и arousal.
Нейтральная реплика даёт нули. Комплимент может повысить тепло, но не физическую энергию.
Обида повышает tension; после извинения tension уменьшается постепенно, не мгновенно до нуля.
Изменения — целые числа в указанных диапазонах, confidence от 0 до 1.

Формат:
{
  "facts":[{"path":"user.project","value":"...","confidence":0.9,"importance":7}],
  "events":[{"text":"...","type":"plan","tags":["..."],"importance":8,"confidence":0.9}],
  "threads":[{"title":"...","summary":"...","status":"open","dueAt":null,"importance":7}],
  "relationshipDelta":{"affection":0,"trust":0,"intimacy":0,"tension":0,"confidence":0.8,"reason":"..."},
  "stateDelta":{"playfulness":0,"valence":0,"arousal":0,"confidence":0.8,"reason":"..."}
}
`.trim();
  const user = `
РЕЛЕВАНТНАЯ СУЩЕСТВУЮЩАЯ ПАМЯТЬ:
${JSON.stringify(existingMemory || {}).slice(0, 3000)}

РЕПЛИКА ПОЛЬЗОВАТЕЛЯ:
${clean(userText, 2000)}

ОТВЕТ РИН (только для понимания контекста, не источник фактов):
${clean(assistantText, 2000)}
`.trim();
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: MEMORY_MODEL,
      temperature: 0.1,
      max_tokens: 650,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
    })
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`OpenAI memory ${response.status}: ${raw.slice(0, 400)}`);
  const content = JSON.parse(raw)?.choices?.[0]?.message?.content || '{}';
  try { return sanitizeMemoryResult(JSON.parse(content)); } catch { return emptyResult(); }
}

async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' });
  const body = await parseBody(req);
  if (ACCESS_PIN && String(body.pin || '') !== String(ACCESS_PIN)) return res.status(401).json({ error: 'Unauthorized' });
  const userText = clean(body.userText, 2000);
  const assistantText = clean(body.assistantText, 2000);
  if (!userText || !assistantText) return res.status(200).json(emptyResult());
  try {
    return res.status(200).json(await extractMemory({ userText, assistantText, existingMemory: body.existingMemory || null }));
  } catch (error) {
    console.error('Memory extraction failed:', error);
    return res.status(200).json({ ...emptyResult(), warning: 'memory_extraction_failed' });
  }
}
