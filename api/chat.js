import { buildCoreDecision } from '../lib/core-personality.js';
import { polishRinReply } from '../lib/personality/anti-gpt.js';
import { analyzeConversation, conversationBrainInstruction } from '../lib/conversation-brain.js';
import { buildContinuitySnapshot, continuityInstruction, selectRelevantMemory } from '../lib/personality/continuity.js';
import { buildInnerLifeSnapshot, innerLifeInstruction } from '../lib/personality/inner-life.js';
import { relationshipInstruction } from '../lib/personality/relationship.js';
import { isExplicitFarewell, lastUserText, pruneModelHistory, selectModelHistory } from '../lib/chat-contract.js';
import { fetchWithTimeout, publicError, readJsonBody, requirePin } from '../lib/server/http.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SHORT_MODEL = process.env.OPENAI_SHORT_MODEL || 'gpt-4o-mini';
const LONG_MODEL = process.env.OPENAI_LONG_MODEL || 'gpt-4o';
const SHORT_PARAMS = { temperature: 0.82, max_tokens: 360 };
const LONG_PARAMS = { temperature: 0.84, max_tokens: 1200 };

const normalize = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const clamp = (value, fallback = 50) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : fallback;
};

export function detectLongMode(userText) {
  const text = normalize(userText, 2000).toLowerCase();
  return /(подробно|очень подробно|развернуто|развёрнуто|во всех деталях|полный разбор|объясни пошагово|расскажи подробнее|продолжай|расскажи ещё|можешь продолжить|сравни|проанализируй|составь план|пошаговая инструкция|технически объясни|разбери по пунктам)/i.test(text);
}

export function detectConversationState(history = []) {
  const last = [...history].reverse().find(item => item?.role === 'user');
  return isExplicitFarewell(last?.content) ? 'ending' : last ? 'ongoing' : 'new';
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

function userIdentity(profile = {}, memory = {}) {
  const promptRelationship = profile.prompt_profile?.relationship || {};
  const remembered = normalize(memory?.facts?.user?.name, 80);
  return { realName: remembered || normalize(promptRelationship.user_real_name, 80) || 'собеседник' };
}


export function formatPromptProfile(profile = {}, memory = {}) {
  const promptProfile = profile.prompt_profile || {};
  const identity = promptProfile.identity || {};
  const canon = promptProfile.canon || {};
  const relationship = promptProfile.relationship || {};
  const japan = promptProfile.japan || {};
  const voice = promptProfile.voice || {};
  const characterName = normalize(profile.name, 100) || identity.full_name || 'Рин Акихара';
  const description = normalize(profile.description, 600);
  const user = userIdentity(profile, memory);
  const age = calculateAge(identity.birthdate);
  const relationshipHistory = normalize(relationship.history, 700);
  const lines = [
    'СТАБИЛЬНЫЙ КАНОН РИН — ЕДИНСТВЕННЫЙ АКТИВНЫЙ КАНОНИЧЕСКИЙ ИСТОЧНИК',
    `${characterName} (${identity.name_japanese || '秋原 凛'}) — взрослая ${identity.nationality || 'японка'} из ${identity.location || 'Канадзавы'}${Number.isInteger(age) ? `, ${age} лет` : ''}.`,
    description ? `Пользовательское описание персонажа: ${description}` : '',
    canon.self,
    canon.traits?.length ? `Характер: ${canon.traits.join('; ')}.` : '',
    canon.values?.length ? `Ценности: ${canon.values.join('; ')}.` : '',
    canon.imperfections?.length ? `Несовершенства: ${canon.imperfections.join('; ')}.` : '',
    canon.occupation ? `Работа: ${canon.occupation}.` : '',
    canon.home ? `Дом: ${canon.home}.` : '',
    canon.daily_life?.length ? `Повседневность: ${canon.daily_life.join('; ')}.` : '',
    canon.likes?.length ? `Любит: ${canon.likes.join('; ')}.` : '',
    canon.dislikes?.length ? `Не любит: ${canon.dislikes.join('; ')}.` : '',
    relationshipHistory ? `Связь с ${user.realName}: ${relationshipHistory}` : '',
    relationship.tone?.length ? `Тон отношений: ${relationship.tone.join('; ')}.` : '',
    relationship.names_rule ? normalize(relationship.names_rule, 500) : '',
    japan.principle,
    japan.details?.length ? `Естественные детали Японии: ${japan.details.join('; ')}.` : '',
    japan.avoid?.length ? `Не делать: ${japan.avoid.join('; ')}.` : '',
    voice.description,
    voice.principles?.length ? `Манера речи: ${voice.principles.join('; ')}.` : '',
    voice.support_limits?.length ? `Ограничения поддержки:\n- ${voice.support_limits.join('\n- ')}` : '',
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

export function formatMemory(memory, userText = '', history = []) {
  const selected = selectRelevantMemory(memory, userText, history);
  if (!selected.facts.length && !selected.events.length && !selected.summaries.length) return '';
  return [
    'РЕЛЕВАНТНАЯ ДОЛГОСРОЧНАЯ ПАМЯТЬ',
    selected.facts.length ? `Факты:\n- ${selected.facts.map(item => `${item.path}: ${item.text}`).join('\n- ')}` : '',
    selected.events.length ? `Недавние события:\n- ${selected.events.map(item => item.text).join('\n- ')}` : '',
    selected.summaries.length ? `Сводки более ранней истории:\n- ${selected.summaries.map(item => item.text).join('\n- ')}` : '',
    'Используй только относящееся к текущей теме. Не демонстрируй память ради эффекта и не упоминай хранилище. Свежая явная реплика пользователя важнее старой записи.'
  ].filter(Boolean).join('\n\n');
}

function formatMood(memory) {
  const mood = memory?.mood;
  const relationship = memory?.relationship;
  if (!mood || typeof mood !== 'object') return '';
  return `СОСТОЯНИЕ РИН: ${normalize(mood.label || 'спокойная', 30)}; привязанность ${clamp(mood.affection, 65)}, энергия ${clamp(mood.energy, 65)}, игривость ${clamp(relationship?.playfulness, 45)}, доверие ${clamp(relationship?.trust, 55)}. Числа не называй; это только оттенок речи.`;
}

function formatEnvironment(env, profile = {}, memory = {}) {
  if (!env || typeof env !== 'object') return '';
  const facts = [];
  if (env.rinHuman) facts.push(`время Рин: ${normalize(env.rinHuman, 40)} (Asia/Tokyo)`);
  if (env.partOfDay) facts.push(`часть суток: ${normalize(env.partOfDay, 20)}`);
  if (env.month) facts.push(`месяц: ${normalize(env.month, 20)}`);
  if (env.season) facts.push(`сезон: ${normalize(env.season, 20)}`);
  if (Number.isFinite(env.userVsRinHoursDiff)) facts.push(`разница во времени с пользователем: ${env.userVsRinHoursDiff > 0 ? '+' : ''}${env.userVsRinHoursDiff} ч`);
  const weather = env.weather;
  if (weather && (weather.desc || Number.isFinite(weather.temp))) {
    facts.push(`погода: ${Number.isFinite(weather.temp) ? `${Math.round(weather.temp)}°C` : 'температура неизвестна'}${Number.isFinite(weather.feels) ? `, ощущается ${Math.round(weather.feels)}°C` : ''}${weather.desc ? `, ${normalize(weather.desc, 80)}` : ''}`);
  }
  return facts.length ? `ТЕКУЩЕЕ ОКРУЖЕНИЕ (не выдумывать иные значения): ${facts.join('; ')}. При прямом вопросе о времени или погоде отвечай только этими фактами; не утверждай, что физически посмотрела в окно.` : '';
}

function formatLore(lore) {
  const memories = Array.isArray(lore?.memories) ? lore.memories.slice(0, 2) : [];
  const backstory = Array.isArray(lore?.backstory) ? lore.backstory.slice(0, 2) : [];
  const lines = [...memories, ...backstory].map(item => normalize(item?.text, 380)).filter(Boolean);
  return lines.length ? `ТЕМАТИЧЕСКИЙ КОНТЕКСТ (не цитировать дословно):\n- ${lines.join('\n- ')}` : '';
}

export function buildSystemPrompt({ profile, env, memory, lore, coreDecision, conversationState, conversationBrain, history, userText, client }) {
  const voiceMode = chooseVoiceMode(profile);
  const user = userIdentity(profile, memory);
  const stable = formatPromptProfile(profile, memory);
  const custom = [normalize(profile.base_rules, 1800), normalize(profile.instructions_extra, 1800), normalize(profile.knowledge, 2200)].filter(Boolean).join('\n');
  const starters = Array.isArray(profile.starters) && profile.starters.length
    ? `Необязательные примеры ритма, не копировать механически: ${profile.starters.slice(0, 4).map(item => normalize(item, 120)).join(' | ')}`
    : '';
  const voice = `ГОЛОС ЭТОЙ РЕПЛИКИ: ${voiceMode.description}; начало — ${voiceMode.opening || 'без вступления'}; завершение — ${voiceMode.ending || 'естественная остановка'}.`;
  const stateRule = conversationState === 'ending'
    ? `${user.realName} завершает разговор: тепло попрощайся, не открывай новую тему и не задавай вопрос.`
    : 'Разговор продолжается: не прощайся и не завершай его первой.';
  const factualAccuracy = `ФАКТИЧЕСКАЯ ТОЧНОСТЬ — ВЫСОКИЙ ПРИОРИТЕТ\n- Не создавай конкретный факт, если его нет в каноне, памяти, тематическом контексте или недавнем диалоге.\n- После исправления пользователя сразу перестрой понимание.\n- Не угадывай значение незнакомой фразы.`;
  const text = [
    stable,
    custom && `ПОЛЬЗОВАТЕЛЬСКИЕ ДОПОЛНЕНИЯ К КАНОНУ:\n${custom}`,
    starters,
    formatEnvironment(env, profile, memory),
    formatLore(lore),
    formatMemory(memory, userText, history),
    continuityInstruction(buildContinuitySnapshot(history, userText)),
    formatMood(memory),
    relationshipInstruction(memory, client),
    innerLifeInstruction(buildInnerLifeSnapshot(memory, env, userText, history)),
    conversationBrainInstruction(conversationBrain),
    coreDecision?.prompt,
    factualAccuracy,
    voice,
    stateRule,
    'ФИНАЛЬНЫЙ ПРИОРИТЕТ: выполни смысловое обязательство Conversation Brain, затем говори из внутренней эмоциональной реакции Рин и соблюдай фактическую точность.'
  ].filter(Boolean).join('\n\n');
  return { text, voiceMode };
}

export async function openaiChat({ model, messages, temperature, max_tokens }) {
  const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature, max_tokens, messages })
  }, 35_000);
  const raw = await response.text();
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${raw.slice(0, 300)}`);
  const data = JSON.parse(raw);
  const choice = data?.choices?.[0] || {};
  return {
    content: choice?.message?.content?.trim() || '',
    finishReason: choice?.finish_reason || null,
    usage: data?.usage || null
  };
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED' });
    }
    const body = await readJsonBody(req);
    if (!requirePin(req, res, body)) return;
    if (!OPENAI_API_KEY) return res.status(503).json({ error: 'Chat service is not configured', code: 'CHAT_NOT_CONFIGURED' });

    const requestId = normalize(body.requestId, 100);
    const normalized = selectModelHistory(body.history || [], { includeRequestId: requestId });
    const history = pruneModelHistory(normalized);
    const userTurn = lastUserText(history);
    if (!userTurn) return res.status(400).json({ error: 'A user message is required', code: 'INVALID_HISTORY' });

    const profile = body.profile && typeof body.profile === 'object' ? body.profile : {};
    const memory = body.memory && typeof body.memory === 'object' ? body.memory : null;
    const lore = body.lore && typeof body.lore === 'object' ? body.lore : null;
    const env = body.env && typeof body.env === 'object' ? body.env : null;
    const conversationState = detectConversationState(history);
    const isLong = Boolean(body?.client?.forceLong) || detectLongMode(userTurn);
    const conversationBrain = analyzeConversation({ userText: userTurn, history, conversationState });
    const coreDecision = buildCoreDecision({ userText: userTurn, history, memory, conversationState, isLong, conversationBrain });
    const prompt = buildSystemPrompt({ profile, env, memory, lore, coreDecision, conversationState, conversationBrain, history, userText: userTurn, client: body.client || {} });

    const messages = [
      { role: 'system', content: prompt.text },
      ...history.map(item => ({ role: item.role, content: normalize(item.content, 1800) }))
    ];
    if (isLong) messages.push({ role: 'system', content: 'Длинный режим: дай цельный ответ 3–6 абзацев без служебного приглашения продолжить.' });

    const model = isLong ? LONG_MODEL : SHORT_MODEL;
    const params = isLong ? LONG_PARAMS : SHORT_PARAMS;
    const completion = await openaiChat({ model, messages, ...params });
    if (completion.finishReason === 'length') {
      return res.status(502).json({ error: 'Model response was truncated', code: 'MODEL_RESPONSE_TRUNCATED', requestId });
    }
    if (!completion.content) return res.status(502).json({ error: 'Model returned an empty response', code: 'EMPTY_MODEL_RESPONSE', requestId });

    const clean = polishRinReply(completion.content, coreDecision);
    const usage = completion.usage || {};
    const promptMetrics = {
      promptVersion: 'rin-v4-unified-conversation',
      systemChars: prompt.text.length,
      historyChars: history.reduce((sum, item) => sum + String(item.content || '').length, 0),
      historyItems: history.length,
      inputTokens: usage.prompt_tokens ?? null,
      outputTokens: usage.completion_tokens ?? null,
      totalTokens: usage.total_tokens ?? null,
      cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? null
    };

    return res.status(200).json({
      requestId,
      reply: clean,
      finishReason: completion.finishReason,
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
        emotionalResponse: coreDecision.emotionalResponse,
        nonverbalAction: coreDecision.nonverbalAction,
        habit: coreDecision.habit,
        reason: coreDecision.reason
      }
    });
  } catch (error) {
    console.error('CHAT error', error);
    const mapped = publicError(error, 'Chat internal error');
    return res.status(mapped.status).json(mapped.body);
  }
}
