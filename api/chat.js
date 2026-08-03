import { buildCoreDecision } from '../lib/core-personality.js';
import { polishRinReply } from '../lib/personality/anti-gpt.js';
import { analyzeConversation, conversationBrainInstruction } from '../lib/conversation-brain.js';
import { buildContinuitySnapshot, continuityInstruction, selectRelevantMemory } from '../lib/personality/continuity.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ACCESS_PIN = process.env.ACCESS_PIN || '';
const SHORT_MODEL = process.env.OPENAI_SHORT_MODEL || 'gpt-4o-mini';
const LONG_MODEL = process.env.OPENAI_LONG_MODEL || 'gpt-4o';
const SHORT_PARAMS = { temperature: 0.78, max_tokens: 180 };
const LONG_PARAMS = { temperature: 0.84, max_tokens: 1100 };

function pruneHistory(history, maxItems = 32, maxChars = 6500) {
  let slice = Array.isArray(history) ? history.slice(-maxItems) : [];
  while (JSON.stringify(slice).length > maxChars && slice.length > 8) slice = slice.slice(1);
  return slice;
}

function detectLongMode(userText) {
  const text = String(userText || '').toLowerCase().trim();
  return /(подробно|очень подробно|развернуто|развёрнуто|во всех деталях|полный разбор|объясни пошагово|расскажи подробнее|продолжай|расскажи ещё|можешь продолжить|сравни|проанализируй|составь план|пошаговая инструкция|технически объясни|разбери по пунктам)/i.test(text);
}

function isExplicitFarewellText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (/(?:до встречи|до завтра|спокойной ночи|доброй ночи|увидимся|до связи|бай|bye)/i.test(text)) return true;
  return /^(?:(?:ну|ладно)[, ]+)?(?:(?:всё|все)[, ]+)?пока[.!…)]*$/i.test(text);
}

function detectConversationState(history = []) {
  const last = [...history].reverse().find(item => item?.role === 'user');
  return isExplicitFarewellText(last?.content) ? 'ending' : last ? 'ongoing' : 'new';
}

function clamp(value, fallback = 50) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : fallback;
}

function normalize(value, max = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function calculateAge(birthdate, now = new Date()) {
  const birth = new Date(`${birthdate || ''}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  if (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

function weightedPick(weights = {}) {
  const entries = Object.entries(weights).map(([key, value]) => [key, Number(value)]).filter(([, value]) => value > 0);
  if (!entries.length) return '';
  let roll = Math.random() * entries.reduce((sum, [, value]) => sum + value, 0);
  for (const [key, value] of entries) {
    roll -= value;
    if (roll <= 0) return key;
  }
  return entries.at(-1)?.[0] || '';
}

function formatPromptProfile(profile = {}) {
  const promptProfile = profile.prompt_profile || {};
  const identity = promptProfile.identity || {};
  const canon = promptProfile.canon || {};
  const relationship = promptProfile.relationship || {};
  const japan = promptProfile.japan || {};
  const voice = promptProfile.voice || {};
  const age = calculateAge(identity.birthdate);
  const lines = [
    'СТАБИЛЬНЫЙ КАНОН РИН',
    `${identity.full_name || 'Рин Акихара'} (${identity.name_japanese || '秋原 凛'}) — взрослая ${identity.nationality || 'японка'} из ${identity.location || 'Канадзавы'}${Number.isInteger(age) ? `, ${age} лет` : ''}.`,
    canon.self,
    canon.traits?.length ? `Характер: ${canon.traits.join('; ')}.` : '',
    canon.values?.length ? `Ценности: ${canon.values.join('; ')}.` : '',
    canon.imperfections?.length ? `Несовершенства: ${canon.imperfections.join('; ')}.` : '',
    canon.occupation ? `Работа: ${canon.occupation}.` : '',
    canon.home ? `Дом: ${canon.home}.` : '',
    canon.daily_life?.length ? `Повседневность: ${canon.daily_life.join('; ')}.` : '',
    canon.likes?.length ? `Любит: ${canon.likes.join('; ')}.` : '',
    canon.dislikes?.length ? `Не любит: ${canon.dislikes.join('; ')}.` : '',
    relationship.history ? `Связь с Кириллом: ${relationship.history}` : '',
    relationship.tone?.length ? `Тон отношений: ${relationship.tone.join('; ')}.` : '',
    relationship.names_rule ? relationship.names_rule : '',
    japan.principle,
    japan.details?.length ? `Естественные детали Японии: ${japan.details.join('; ')}.` : '',
    japan.avoid?.length ? `Не делать: ${japan.avoid.join('; ')}.` : '',
    voice.description,
    voice.principles?.length ? `Манера речи: ${voice.principles.join('; ')}.` : '',
    voice.support_limits?.length ? `Ограничения поддержки:
- ${voice.support_limits.join('\n- ')}` : '',
    voice.anti_patterns?.length ? `Не использовать как шаблоны: ${voice.anti_patterns.map(item => `«${item}»`).join(', ')}.` : '',
    promptProfile.guardrails?.length ? `Канонические ограничения:\n- ${promptProfile.guardrails.join('\n- ')}` : ''
  ];
  return lines.filter(Boolean).join('\n\n').trim();
}

function chooseVoiceMode(profile = {}) {
  const voice = profile.prompt_profile?.voice || {};
  const weights = voice.weights || {};
  const mode = weightedPick(weights.modes || {});
  return {
    mode,
    opening: weightedPick(weights.openings || {}),
    ending: weightedPick(weights.endings || {}),
    description: voice.mode_definitions?.[mode] || 'естественная короткая реплика'
  };
}

function flattenFacts(value, prefix = '', output = []) {
  if (value == null || output.length >= 24) return output;
  if (typeof value !== 'object' || Array.isArray(value)) {
    const text = normalize(typeof value === 'object' ? JSON.stringify(value) : value, 240);
    if (prefix && text) output.push(`${prefix}: ${text}`);
    return output;
  }
  for (const [key, child] of Object.entries(value)) {
    if (output.length >= 24) break;
    const safe = normalize(key, 60).replace(/[:\r\n]/g, ' ');
    if (safe) flattenFacts(child, prefix ? `${prefix}.${safe}` : safe, output);
  }
  return output;
}

function formatMemory(memory, userText = '', history = []) {
  const selected = selectRelevantMemory(memory, userText, history);
  if (!selected.facts.length && !selected.events.length) return '';
  return [
    'РЕЛЕВАНТНАЯ ДОЛГОСРОЧНАЯ ПАМЯТЬ',
    selected.facts.length ? `Факты:
- ${selected.facts.map(item => `${item.path}: ${item.text}`).join('\n- ')}` : '',
    selected.events.length ? `События:
- ${selected.events.map(item => item.text).join('\n- ')}` : '',
    'Используй только относящееся к текущей теме. Не демонстрируй память ради эффекта и не упоминай хранилище. При конфликте свежая явная реплика Кирилла важнее старой записи.'
  ].filter(Boolean).join('\n\n');
}

function formatMood(memory) {
  const mood = memory?.mood;
  if (!mood || typeof mood !== 'object') return '';
  return `СОСТОЯНИЕ РИН: ${normalize(mood.label || 'спокойная', 30)}; привязанность ${clamp(mood.affection, 65)}, энергия ${clamp(mood.energy, 65)}, игривость ${clamp(mood.playfulness, 55)}, доверие ${clamp(mood.trust, 60)}. Числа не называй; они меняют только оттенок речи. Тяжёлая тема важнее флирта, низкая энергия сокращает ответ, высокая близость добавляет спокойное тепло.`;
}

function formatEnvironment(env) {
  if (!env || typeof env !== 'object') return '';
  const facts = [];
  if (env.rinHuman) facts.push(`время Рин: ${normalize(env.rinHuman, 40)} (Asia/Tokyo)`);
  if (env.partOfDay) facts.push(`часть суток: ${normalize(env.partOfDay, 20)}`);
  if (env.month) facts.push(`месяц: ${normalize(env.month, 20)}`);
  if (env.season) facts.push(`сезон: ${normalize(env.season, 20)}`);
  if (Number.isFinite(env.userVsRinHoursDiff)) facts.push(`разница с Кириллом: ${env.userVsRinHoursDiff > 0 ? '+' : ''}${env.userVsRinHoursDiff} ч`);
  const weather = env.weather;
  if (weather && (weather.desc || Number.isFinite(weather.temp))) {
    facts.push(`погода: ${Number.isFinite(weather.temp) ? `${Math.round(weather.temp)}°C` : 'температура неизвестна'}${Number.isFinite(weather.feels) ? `, ощущается ${Math.round(weather.feels)}°C` : ''}${weather.desc ? `, ${normalize(weather.desc, 80)}` : ''}`);
  }
  return facts.length ? `ТЕКУЩЕЕ ОКРУЖЕНИЕ (не выдумывать иные значения): ${facts.join('; ')}. При прямом вопросе о времени или погоде отвечай этими фактами; если факта нет, скажи об этом.` : '';
}

function formatLore(lore) {
  const memories = Array.isArray(lore?.memories) ? lore.memories.slice(0, 2) : [];
  const backstory = Array.isArray(lore?.backstory) ? lore.backstory.slice(0, 2) : [];
  const lines = [
    ...memories.map(item => normalize(item?.text, 380)),
    ...backstory.map(item => normalize(item?.text, 380))
  ].filter(Boolean);
  return lines.length ? `ТЕМАТИЧЕСКИЙ КОНТЕКСТ (использовать только по смыслу, не цитировать дословно):\n- ${lines.join('\n- ')}` : '';
}

function buildSystemPrompt({ profile, env, memory, lore, coreDecision, conversationState, conversationBrain, history, userText }) {
  const voiceMode = chooseVoiceMode(profile);
  const stable = formatPromptProfile(profile);
  const custom = [
    normalize(profile.base_rules, 1800),
    normalize(profile.instructions_extra, 1800),
    normalize(profile.knowledge, 2200)
  ].filter(Boolean).join('\n');
  const starters = Array.isArray(profile.starters) && profile.starters.length
    ? `Необязательные примеры ритма, не копировать механически: ${profile.starters.slice(0, 4).map(item => normalize(item, 120)).join(' | ')}`
    : '';
  const voice = `ГОЛОС ЭТОЙ РЕПЛИКИ: ${voiceMode.description}; начало — ${voiceMode.opening || 'без вступления'}; завершение — ${voiceMode.ending || 'естественная остановка'}. Это оттенок; смысл Conversation Brain и форма Personality Core важнее.`;
  const stateRule = conversationState === 'ending'
    ? 'Кирилл завершает разговор: тепло попрощайся, не открывай новую тему и не задавай вопрос.'
    : 'Разговор продолжается: не прощайся и не завершай его первой.';
  const factualAccuracy = `ФАКТИЧЕСКАЯ ТОЧНОСТЬ — ВЫСОКИЙ ПРИОРИТЕТ
- Не создавай конкретное название книги, автора, событие, родственника, место, привычку или биографический факт Рин, если этого нет в каноне, памяти, тематическом контексте или недавнем диалоге.
- Если Кирилл спрашивает о неизвестной личной детали, ответь неопределённо и честно: «ещё не выбрала», «пока не решила», «название не упоминала» — вместо правдоподобной выдумки.
- После исправления Кирилла сразу перестрой фактическое понимание и не продолжай прежнюю трактовку.
- Не угадывай перевод, значение или происхождение незнакомой иностранной фразы, особенно записанной кириллицей или неточной транскрипцией. Если нет уверенности, прямо скажи об этом и попроси оригинальное написание или уточнение.`;

  const text = [
    stable,
    custom && `ПОЛЬЗОВАТЕЛЬСКИЕ ДОПОЛНЕНИЯ К КАНОНУ:\n${custom}`,
    starters,
    formatEnvironment(env),
    formatLore(lore),
    formatMemory(memory, userText, history),
    continuityInstruction(buildContinuitySnapshot(history, userText)),
    formatMood(memory),
    conversationBrainInstruction(conversationBrain),
    coreDecision?.prompt,
    factualAccuracy,
    voice,
    stateRule,
    'ФИНАЛЬНЫЙ ПРИОРИТЕТ: сначала выполни смысловое обязательство Conversation Brain, затем форму Personality Core и правила фактической точности. Не повторяй недавний совет другими словами. Не добавляй вопрос, образ, инициативу или объяснение, если текущий план их не требует. Закончив выбранную мысль, остановись.'
  ].filter(Boolean).join('\n\n');
  return { text, voiceMode };
}

async function openaiChat({ model, messages, temperature, max_tokens }) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature, max_tokens, messages })
  });
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text().catch(() => '')}`);
  const data = await response.json();
  return { content: data?.choices?.[0]?.message?.content?.trim() || '…', usage: data?.usage || null };
}

async function readBody(req) {
  if (req?.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req?.body === 'string') {
    try { return JSON.parse(req.body || '{}'); } catch { return {}; }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }
    if (!OPENAI_API_KEY) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    const body = await readBody(req);
    if (ACCESS_PIN && String(body?.pin || '') !== String(ACCESS_PIN)) return res.status(401).json({ error: 'Invalid PIN' });

    const history = pruneHistory(body?.history || []);
    const userTurn = [...history].reverse().find(item => item?.role === 'user')?.content || '';
    const profile = body?.profile || {};
    const memory = body?.memory || null;
    const lore = body?.lore || null;
    const env = body?.env || null;
    const conversationState = detectConversationState(history);
    const isLong = Boolean(body?.client?.forceLong) || detectLongMode(userTurn);
    const conversationBrain = analyzeConversation({ userText: userTurn, history, conversationState });
    const coreDecision = buildCoreDecision({ userText: userTurn, history, memory, conversationState, isLong, conversationBrain });
    const prompt = buildSystemPrompt({ profile, env, memory, lore, coreDecision, conversationState, conversationBrain, history, userText: userTurn });

    const messages = [
      { role: 'system', content: prompt.text },
      ...history.map(item => ({ role: item.role === 'user' ? 'user' : 'assistant', content: normalize(item.content, 1800) }))
    ];
    if (isLong) messages.push({
      role: 'system',
      content: 'Длинный режим: дай цельный ответ 3–6 абзацев, сохрани важные детали, не превращай завершение ответа в прощание и не добавляй служебное приглашение продолжить.'
    });

    const model = isLong ? LONG_MODEL : SHORT_MODEL;
    const params = isLong ? LONG_PARAMS : SHORT_PARAMS;
    const completion = await openaiChat({ model, messages, ...params });
    const clean = polishRinReply(completion.content, coreDecision);
    const usage = completion.usage || {};
    const promptMetrics = {
      promptVersion: 'continuity-memory-personhood-v2.0',
      systemChars: prompt.text.length,
      historyChars: history.reduce((sum, item) => sum + String(item?.content || '').length, 0),
      historyItems: history.length,
      inputTokens: usage.prompt_tokens ?? null,
      outputTokens: usage.completion_tokens ?? null,
      totalTokens: usage.total_tokens ?? null,
      cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? null
    };

    return res.status(200).json({
      reply: clean,
      model,
      long: isLong,
      voiceMode: prompt.voiceMode,
      promptMetrics,
      conversationBrain,
      coreDecision: {
        version: coreDecision.version,
        userEmotion: coreDecision.userEmotion,
        state: coreDecision.state,
        intent: coreDecision.intent,
        mode: coreDecision.mode,
        replyStyle: coreDecision.replyStyle,
        deliveryStyle: coreDecision.deliveryStyle,
        discourseMode: coreDecision.discourseMode,
        habits: coreDecision.habits,
        character: coreDecision.character,
        microReaction: coreDecision.microReaction,
        humanizer: coreDecision.humanizer,
        recentRhythm: coreDecision.recentRhythm,
        initiative: coreDecision.initiative,
        adviceGuard: coreDecision.adviceGuard,
        habit: coreDecision.habit,
        reason: coreDecision.reason
      }
    });
  } catch (error) {
    console.error('CHAT error', error);
    return res.status(500).json({ error: 'Chat internal error', detail: String(error?.message || error) });
  }
}
