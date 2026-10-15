import { requireSession } from '../lib/server/session.js';
import { applySecurityLimit, auditRejectedSession } from '../lib/server/security-gate.js';
import { contentKey } from '../lib/chat-contract.js';
import { fetchWithTimeout, readJsonBody, requireMethod } from '../lib/server/http.js';

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
    schemaVersion: 5,
    facts: [],
    events: [],
    sharedMoments: [],
    sharedSymbols: [],
    factRetractions: []
  };
}

// Keep birthday ownership grounded in the user's words and their immediate context.
// Never treat a birthday attributed to Rin as the user's birthday.
export function birthdayOwnership(userText = '', recentHistory = []) {
  const text = clean(userText, 500).toLowerCase().replace(/ё/g, 'е');
  if (!/(?:день\s+рождени|октября|ноября|декабря|января|февраля|марта|апреля|мая|июня|июля|августа|сентября)/u.test(text)) return 'none';
  if (/(?:мой\s+день\s+рождени|у\s+меня\s+(?:день\s+рождени|.*(?:будет|скоро))|день\s+рождени\s+у\s+меня)/u.test(text)) return 'user';
  if (/(?:твой\s+день\s+рождени|у\s+тебя\s+день\s+рождени|день\s+рождени\s+рин|день\s+рождени\s+китсуне)/u.test(text)) return 'rin';
  const recent = list(recentHistory, 10).filter(x => x && (x.role === 'user' || x.role === 'assistant') && clean(x.content));
  const latestUserTurn = recent.findLastIndex(x => x.role === 'user' && clean(x.content) === clean(userText));
  // Jobs are processed after Rin has replied, so the supplied history can
  // include that later assistant reply. Do not mistake it for the question.
  const earlier = latestUserTurn >= 0 ? recent.slice(0, latestUserTurn) : recent.filter(x => clean(x.content) !== clean(userText));
  const lastAssistant = [...earlier].reverse().find(x => x.role === 'assistant');
  const lastUser = [...earlier].reverse().find(x => x.role === 'user');
  const prompt = clean(lastAssistant?.content, 350).toLowerCase().replace(/ё/g, 'е');
  const previous = clean(lastUser?.content, 350).toLowerCase().replace(/ё/g, 'е');
  if (/когда\s+именно|когда\s+(?:у\s+тебя|твой)\s+день\s+рождени/u.test(prompt)
      && /у\s+меня\s+тоже\s+(?:будет|скоро)|мой\s+день\s+рождени/u.test(previous)) return 'user';
  if (/(?:когда\s+у\s+тебя\s+день\s+рождени|когда\s+твой\s+день\s+рождени)/u.test(previous)
      || /(?:я\s+не\s+помню|не\s+хочу\s+выдумывать)/u.test(prompt) && /(?:когда\s+у\s+тебя|когда\s+твой)/u.test(previous)) return 'rin';
  return 'unknown';
}

export function groundBirthdayFacts(result, { userText = '', recentHistory = [] } = {}) {
  const owner = birthdayOwnership(userText, recentHistory);
  // A path like user.favoritePersonBirthday says whose *favorite person* has
  // a birthday; it is not a way of recording Rin's or the user's date.
  result.facts = result.facts.filter(item => {
    if (!/(?:birth|birthday|рождени)/iu.test(item.path)) return true;
    return owner === 'user' && item.path === 'user.birthday';
  });
  const forgetBirthday = /(?:забудь|удали|убери|не\s+сохраняй|не\s+запоминай).{0,90}(?:день\s+рождени|дату\s+рождени|birthday)/iu.test(userText);
  result.factRetractions = result.factRetractions.filter(item =>
    !/(?:birth|birthday|рождени)/iu.test(item.path)
    || (forgetBirthday && item.path === 'user.birthday'));
  if (forgetBirthday) {
    result.facts = result.facts.filter(item => item.path !== 'user.birthday');
    return result;
  }
  // Exact self-dated statements are sufficient evidence even if the extraction
  // model omits them. Never infer a date from the assistant or a vague 'soon'.
  if (owner === 'user') {
    const normalized = clean(userText, 500).toLowerCase().replace(/ё/g, 'е');
    const month = '(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)';
    const matches = [...normalized.matchAll(new RegExp('(?:^|\\s)([0-3]?\\d)(?:-?(?:ое|го|е|й))?\\s+' + month + '(?=$|[^а-я])', 'gu'))];
    if (matches.length === 1 && Number(matches[0][1]) >= 1 && Number(matches[0][1]) <= 31) {
      const value = `${Number(matches[0][1])} ${matches[0][2]}`;
      result.facts = result.facts.filter(item => item.path !== 'user.birthday');
      result.facts.push({ path: 'user.birthday', value, confidence: 0.99 });
    }
  }
  return result;
}

export function sanitizeMemoryResult(value, context = {}) {
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

  for (const item of list(value?.sharedSymbols, 2)) {
    const rawId = clean(item?.id || item?.label, 80).toLowerCase();
    const id = rawId.replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    const label = clean(item?.label || item?.name || id, 80);
    const meaning = clean(item?.meaning || item?.description, 700);
    if (!id || !label || !meaning) continue;
    const strings = (input, max, len) => list(input, max).map(entry => clean(entry, len)).filter(Boolean);
    result.sharedSymbols.push({
      id,
      label,
      scope: 'relationship_private',
      privacy: 'private',
      origin: clean(item?.origin, 400) || 'shared_history',
      meaning,
      aliases: strings(item?.aliases, 8, 80),
      associations: strings(item?.associations, 12, 140),
      manifestations: strings(item?.manifestations, 8, 240),
      avoid: strings(item?.avoid, 8, 240),
      salience: clamp(item?.salience, 0, 100, 60),
      minCloseness: clamp(item?.minCloseness, 0, 100, 45),
      importance: clamp(item?.importance, 1, 10, 7)
    });
  }
  for (const item of list(value?.factRetractions, 5)) {
    const path = clean(item?.path, 100);
    if (/^user\.[a-zA-Z0-9_.-]+$/.test(path)) result.factRetractions.push({ path });
  }
  return groundBirthdayFacts(result, context);
}

async function extractMemory({ userText, assistantText, existingMemory, recentHistory }) {
  const systemPrompt = `
Ты — анализатор долговременной памяти AI-компаньона. Не отвечай пользователю; верни только JSON.

Сохраняй только явно сообщённые пользователем устойчивые факты и значимые события. Не сохраняй приветствия, прощания, обычные вопросы, команды приложению, предположения модели, секреты, платёжные данные, точные адреса и сведения только из ответа ассистента. Пути фактов начинаются только с user.

Эмоциональное состояние и отношения здесь не анализируй: они обновляются отдельным единым детерминированным контуром на клиенте.

Conversational open loops и active intent здесь не анализируй и не возвращай: ими владеет ConversationState/Cognitive Kernel. sharedMoments должны быть редкими и значимыми.

sharedSymbols — ещё более редкий слой приватной символики отношений: повторяющийся образ, прозвище, метафора или маленький ритуал, который приобрёл устойчивое значение именно между пользователем и Рин. Не создавай sharedSymbol из одноразовой шутки. Возвращай его только при первом явном закреплении или когда существующий символ получил действительно новую устойчивую грань. Используй стабильный id латиницей; scope=relationship_private. Символ не является новой базовой личностью Рин и не должен превращаться в режим.

Если пользователь прямо исправляет ранее сохранённый факт о себе, верни старый путь в factRetractions и новую версию в facts. Не выводи factRetractions для догадок ассистента, которых не было в facts.

Дни рождения: дата самого пользователя хранится исключительно в user.birthday, и только при подтверждённом контексте, что речь о нём; дата Рин НЕ является фактом user. Не создавай user.favoritePersonBirthday из рассказа о дне рождения пользователя или Рин. Если пользователь сообщает лишь дату после вопроса, учитывай непосредственно предшествующую переписку. Нельзя выводить совершённый подарок из обещания приготовить сюрприз.

Формат:
{"facts":[{"path":"user.preference","value":"...","confidence":0.9}],"events":[{"text":"...","type":"plan","tags":["..."],"importance":7}],"sharedMoments":[],"sharedSymbols":[{"id":"private_symbol","label":"...","origin":"...","meaning":"...","aliases":[],"associations":[],"manifestations":[],"avoid":[],"salience":65,"minCloseness":45,"importance":8}]}
`.trim();

  const userPrompt = `
СУЩЕСТВУЮЩАЯ ПАМЯТЬ:
${JSON.stringify(existingMemory || {}).slice(0, 3600)}

НЕДАВНЯЯ ПЕРЕПИСКА ДЛЯ УСТАНОВЛЕНИЯ ВЛАДЕЛЬЦА ФАКТА (не считать сообщения ассистента независимыми доказательствами):
${JSON.stringify(list(recentHistory, 8)).slice(0, 2000)}

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
  try { return sanitizeMemoryResult(JSON.parse(content), { userText, recentHistory }); } catch { return createEmptyMemoryResult(); }
}

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'POST')) return;
  const body = await readJsonBody(req);
  if (!await applySecurityLimit(req, res, 'api')) return;
  if (!await requireSession(req, res)) { auditRejectedSession('memory'); return; }
  if (!OPENAI_API_KEY) return res.status(503).json({ error: 'Memory service is not configured', code: 'MEMORY_NOT_CONFIGURED' });

  const userText = clean(body.userText, 2000);
  const assistantText = clean(body.assistantText, 2000);
  if (!userText || !assistantText) return res.status(200).json(createEmptyMemoryResult());

  if (!await applySecurityLimit(req, res, 'memory')) return;
  try {
    const recentHistory = list(body.recentHistory, 10).filter(item => ['user','assistant'].includes(item?.role))
      .map(item => ({ role: item.role, content: clean(item.content, 350) }));
    const memory = await extractMemory({ userText, assistantText, existingMemory: body.existingMemory || null, recentHistory });
    return res.status(200).json(memory);
  } catch (error) {
    console.error('Memory extraction failed', error);
    return res.status(200).json({ ...createEmptyMemoryResult(), warning: 'memory_extraction_failed' });
  }
}
