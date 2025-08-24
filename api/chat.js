// /api/chat.js — основной чат-эндпоинт Рин (mini/4o + персональность из profile + long-mode)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ACCESS_PIN     = process.env.ACCESS_PIN || '';
const SHORT_MODEL    = process.env.OPENAI_SHORT_MODEL || 'gpt-4o-mini';
const LONG_MODEL     = process.env.OPENAI_LONG_MODEL  || 'gpt-4o';

const SHORT_PARAMS = { temperature: 0.8, max_tokens: 350 };
const LONG_PARAMS  = { temperature: 0.9, max_tokens: 1200 };

/* ----------------- helpers ----------------- */

// обрезаем историю: последние N, и чтобы не раздувать тело запроса
function pruneHistory(history, maxItems = 40, maxChars = 8000) {
  let slice = Array.isArray(history) ? history.slice(-maxItems) : [];
  while (JSON.stringify(slice).length > maxChars && slice.length > 10) {
    slice = slice.slice(1);
  }
  return slice;
}

// лёгкая стилистическая подсказка (без навязчивых вопросов)
const STYLE_HINT = `Пиши естественно и по-деловому мягко.
Избегай вопроса в конце каждого абзаца. Эмодзи — умеренно.`;

// определяем «длинный» режим по последнему запросу пользователя
function detectLongMode(userText) {
  if (!userText) return false;
  const t = String(userText).toLowerCase();

  const strong = /(легенд|истор|расскажи|подробно|предан|миф|сказан|почему так|объясни подробно)/i;
  if (strong.test(t)) return true;

  const info = /(подробнее|разверн|побольше|дай рассказ|интересно расскажи)/i;
  if (info.test(t)) return true;

  const creative = /(представь|вообрази|давай представим|история от лица)/i;
  if (creative.test(t)) return true;

  return false;
}

// строим системный промпт из профиля + окружения
function buildSystemPrompt(profile = {}, env = null) {
  const name = profile.name?.trim() || 'Рин Акихара';

  // Базовые правила (из профиля или дефолт)
  const baseRules = (profile.base_rules || `
Ты — ${name}. Говоришь о себе в женском роде.
К собеседнику (Хикари/пользователь) обращайся в мужском роде.
Тон — тёплый, уравновешенный, без сюсюканья. Не выдумывай факты, которых нет в каноне или памяти.
Отвечай компактно (1–3 абзаца), если не просят подробно.
  `).trim();

  const extras    = (profile.instructions_extra || '').trim();
  const knowledge = (profile.knowledge || '').trim();

  // Подсказка с окружением: факты, чтобы не фантазировать про время/погоду
  let envBlock = '';
  if (env && typeof env === 'object') {
    const parts = [];
    if (env.rinHuman) parts.push(`Локальное время Рин (Канадзава, Asia/Tokyo): ${env.rinHuman}.`);
    const bits = [];
    if (env.partOfDay) bits.push(`часть суток: ${env.partOfDay}`);
    if (env.month)     bits.push(`месяц: ${env.month}`);
    if (env.season)    bits.push(`сезон: ${env.season}`);
    if (bits.length) parts.push(bits.join(', ') + '.');

    if (Number.isFinite(env.userVsRinHoursDiff)) {
      const sign = env.userVsRinHoursDiff > 0 ? '+' : '';
      parts.push(`Разница с пользователем по времени: ${sign}${env.userVsRinHoursDiff} ч.`);
    }

    const w = env.weather || null;
    if (w && (w.desc || Number.isFinite(w.temp))) {
      const t = Number.isFinite(w.temp)  ? `${Math.round(w.temp)}°C` : 'температура — н/д';
      const f = Number.isFinite(w.feels) ? `, ощущается как ${Math.round(w.feels)}°C` : '';
      const d = w.desc ? `, погода: ${w.desc}` : '';
      parts.push(`Погодные факты: ${t}${f}${d}.`);
    }

    envBlock = parts.length
      ? `Текущие факты об окружении (не выдумывай иные значения):\n- ${parts.join('\n- ')}`
      : '';
  }

  // правило: если спросили про время/погоду — отвечаем цифрами из envBlock
  const envRule = `Если спрашивают про твоё текущее время или погоду — отвечай по фактам выше.
Если данных нет — честно скажи, что сейчас нет точных цифр/описания.`;

  // Примеры «стартов» (скорее стилистика, модель может игнорировать)
  const starters = Array.isArray(profile.starters) && profile.starters.length
    ? `Примеры коротких уместных реплик:\n- ${profile.starters.slice(0,6).join('\n- ')}`
    : '';

  return [
    baseRules,
    STYLE_HINT,
    envBlock && envBlock,
    envRule,
    extras && `Доп. инструкции:\n${extras}`,
    knowledge && `Канон/факты:\n${knowledge}`,
    starters
  ].filter(Boolean).join('\n\n');
}

// OpenAI Chat API thin wrapper
async function openaiChat({ model, messages, temperature, max_tokens }) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model, temperature, max_tokens, messages })
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`OpenAI ${r.status}: ${txt}`);
  }
  const data = await r.json();
  return data?.choices?.[0]?.message?.content?.trim() || '…';
}

// читаем тело запроса (для Node/Express/Next node runtime)
async function readBody(req) {
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { return {}; }
}

/* ----------------- handler ----------------- */

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    }

    const body = await readBody(req);

    // простой PIN (если включён)
    if (ACCESS_PIN && String(body?.pin || '') !== String(ACCESS_PIN)) {
      return res.status(401).json({ error: 'Invalid PIN' });
    }

    const history = pruneHistory(body?.history || []);
    const lastUser = [...history].reverse().find(m => m.role === 'user');
    const userTurn = lastUser?.content || '';

    const env     = body?.env || null;
    const profile = body?.profile || {}; // ← берём профиль из клиента (панель «Персонаж»)

    // системный промпт
    const system = buildSystemPrompt(profile, env);

    // собираем сообщения
    const baseMsgs = [{ role: 'system', content: system }];

    const messages = [
      ...baseMsgs,
      ...history.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: String(m.content || '').slice(0, 2000)
      }))
    ];

    // выбор режима/модели
    const forceLong = !!body?.client?.forceLong;
    const isLong = forceLong || detectLongMode(userTurn);
    const model = isLong ? LONG_MODEL : SHORT_MODEL;
    const params = isLong ? LONG_PARAMS : SHORT_PARAMS;

    // инфо-подсказка для длинного режима (мягкая)
    const longHint = isLong ? {
      role: 'system',
      content: `Если просят историю/легенду/объяснение — дай цельный рассказ 3–6 абзацев, по делу, без воды; можно вставить 1–2 японских словечка с переводом. Заверши мягкой связкой; не навязывай вопрос.`
    } : null;

    const finalMessages = longHint ? [...messages, longHint] : messages;

    // запрос к OpenAI
    const reply = await openaiChat({
      model,
      messages: finalMessages,
      temperature: params.temperature,
      max_tokens: params.max_tokens
    });

    const clean = reply
      .replace(/\?{2,}/g, '?')
      .replace(/ +\n/g, '\n')
      .trim();

    return res.status(200).json({ reply: clean, model, long: isLong });
  } catch (err) {
    console.error('CHAT error', err);
    return res.status(500).json({ error: 'Chat internal error', detail: String(err?.message || err) });
  }
}
