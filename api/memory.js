import { contentKey } from '../lib/chat-contract.js';
import { fetchWithTimeout, readJsonBody, requireMethod, requirePin } from '../lib/server/http.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MEMORY_MODEL = process.env.OPENAI_MEMORY_MODEL || process.env.OPENAI_SHORT_MODEL || 'gpt-4o-mini';

const clean = (value, max = 1000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const list = (value, max = 10) => Array.isArray(value) ? value.slice(0, max) : [];
const clamp = (value, min, max, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
};
const confidence = value => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
};

export function createEmptyMemoryResult() {
  return {
    schemaVersion: 4,
    facts: [],
    events: [],
    sharedMoments: [],
    factRetractions: []
  };
}

export function sanitizeMemoryResult(value) {
  const result = createEmptyMemoryResult();

  for (const item of list(value?.facts, 5)) {
    const path = clean(item?.path, 100);
    const memoryValue = clean(item?.value, 500);
    if (/^user\.[a-zA-Z0-9_.-]+$/.test(path) && memoryValue) {
      result.facts.push({ path, value: memoryValue, confidence: confidence(item?.confidence) || 0.7 });
    }
  }

  for (const item of list(value?.events, 5)) {
    const text = clean(item?.text, 500);
    if (!text) continue;
    result.events.push({
      id: clean(item?.id, 100) || contentKey(`event:${text}`),
      key: contentKey(`event:${text}`),
      text,
      type: clean(item?.type, 30) || 'memory',
      tags: list(item?.tags, 8).map(tag => clean(tag, 40)).filter(Boolean),
      importance: clamp(item?.importance, 1, 10, 5)
    });
  }

  for (const item of list(value?.sharedMoments, 3)) {
    const text = clean(item?.text, 500);
    if (!text) continue;
    result.sharedMoments.push({
      id: clean(item?.id, 100) || contentKey(`moment:${text}`),
      key: contentKey(`moment:${text}`),
      text,
      importance: clamp(item?.importance, 1, 10, 6)
    });
  }
  for (const item of list(value?.factRetractions, 5)) {
    const path = clean(item?.path, 100);
    if (/^user\.[a-zA-Z0-9_.-]+$/.test(path)) result.factRetractions.push({ path });
  }
  return result;
}

async function extractMemory({ userText, assistantText, existingMemory }) {
  const systemPrompt = `
Ты — анализатор долговременной памяти AI-компаньона. Не отвечай пользователю; верни только JSON.

Сохраняй только явно сообщённые пользователем устойчивые факты и значимые события. Не сохраняй приветствия, прощания, обычные вопросы, команды приложению, предположения модели, секреты, платёжные данные, точные адреса и сведения только из ответа ассистента. Пути фактов начинаются только с user.

Эмоциональное состояние и отношения здесь не анализируй: они обновляются отдельным единым детерминированным контуром на клиенте.

Conversational open loops и active intent здесь не анализируй и не возвращай: ими владеет ConversationState/Cognitive Kernel. sharedMoments должны быть редкими и значимыми.

Если пользователь прямо исправляет ранее сохранённый факт о себе, верни старый путь в factRetractions и новую версию в facts. Не выводи factRetractions для догадок ассистента, которых не было в facts.

Формат:
{"facts":[{"path":"user.preference","value":"...","confidence":0.9}],"events":[{"text":"...","type":"plan","tags":["..."],"importance":7}],"sharedMoments":[]}
`.trim();

  const userPrompt = `
СУЩЕСТВУЮЩАЯ ПАМЯТЬ:
${JSON.stringify(existingMemory || {}).slice(0, 3600)}

НОВАЯ РЕПЛИКА ПОЛЬЗОВАТЕЛЯ:
${clean(userText, 1600)}

ОТВЕТ АССИСТЕНТА:
${clean(assistantText, 1400)}

Верни только JSON.
`.trim();

  const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: MEMORY_MODEL,
      temperature: 0.1,
      max_tokens: 420,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })
  }, 20_000);

  const rawText = await response.text();
  if (!response.ok) throw new Error(`OpenAI memory ${response.status}: ${rawText.slice(0, 300)}`);
  const data = JSON.parse(rawText);
  const content = data?.choices?.[0]?.message?.content || '{}';
  try { return sanitizeMemoryResult(JSON.parse(content)); } catch { return createEmptyMemoryResult(); }
}

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'POST')) return;
  const body = await readJsonBody(req);
  if (!requirePin(req, res, body)) return;
  if (!OPENAI_API_KEY) return res.status(503).json({ error: 'Memory service is not configured', code: 'MEMORY_NOT_CONFIGURED' });

  const userText = clean(body.userText, 2000);
  const assistantText = clean(body.assistantText, 2000);
  if (!userText || !assistantText) return res.status(200).json(createEmptyMemoryResult());

  try {
    const memory = await extractMemory({ userText, assistantText, existingMemory: body.existingMemory || null });
    return res.status(200).json(memory);
  } catch (error) {
    console.error('Memory extraction failed', error);
    return res.status(200).json({ ...createEmptyMemoryResult(), warning: 'memory_extraction_failed' });
  }
}
