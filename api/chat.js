// /api/chat.js — основной чат-эндпоинт Рин (переключение mini/4o + персональность + длинный режим)
import fs from 'fs/promises';
import path from 'path';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ACCESS_PIN     = process.env.ACCESS_PIN || '';           // лёгкая защита
const SHORT_MODEL    = process.env.OPENAI_SHORT_MODEL || 'gpt-4o-mini';
const LONG_MODEL     = process.env.OPENAI_LONG_MODEL  || 'gpt-4o'; // для «развёрнутых» ответов

// Параметры генерации (можно править под вкус)
const SHORT_PARAMS = { temperature: 0.8,  max_tokens: 350 };
const LONG_PARAMS  = { temperature: 0.9,  max_tokens: 1200 };

// ——— утилиты ———
async function readJsonSafe(filePath, fallback = null) {
  try {
    const txt = await fs.readFile(filePath, 'utf8');
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}

// Укорачиваем историю: последние N сообщений и лёгкий лимит символов
function pruneHistory(history, maxItems = 30, maxChars = 8000) {
  let slice = history.slice(-maxItems);
  // жёсткий лимит по символам
  while (JSON.stringify(slice).length > maxChars && slice.length > 10) {
    slice = slice.slice(1);
  }
  return slice;
}

// Мягкий анти-«вопрос в каждом предложении»: подсказка стилю
const STYLE_HINT = `Пиши естественно, не ставь вопрос в конце каждого абзаца.
Используй тёплый, дружелюбный тон, без сюсюканья. Разрешены эмодзи умеренно.`;

// Детектор «длинного режима»: по ключевым словам и намерениям
function detectLongMode(userText, history) {
  if (!userText) return false;
  const t = userText.toLowerCase();

  // Явные триггеры — легенды/истории/рассказ
  const strong = /(легенд|истор|расскажи|расскажи подробно|поведай|предание|миф|сказан|почему так|объясни подробно)/i;
  if (strong.test(t)) return true;

  // Если пользователь просит «подробнее», «разверни» и т.п.
  const info = /(подробнее|разверн|побольше|почитать|интересно расскажи)/i;
  if (info.test(t)) return true;

  // Если прямо про «Японию», «традиции», «культуру» и т.п. — чаще длинно, но не всегда
  const culture = /(япони|японск|традици|сакур|киото|синто|кимоно|матча|кицунэ|ёкаи|йокай|буддизм|синтоизм)/i;
  if (culture.test(t) && Math.random() < 0.6) return true;

  // Небольшой шанс развернуться при флиртовой «сцены мечты»
  const dreamy = /(мечта|представь|вообрази|давай представим)/i;
  if (dreamy.test(t) && Math.random() < 0.5) return true;

  // Иначе — короткий режим
  return false;
}

// Формируем system-промпт из персоны и памяти
function buildSystemPrompt(persona, memories) {
  const name = (persona?.name || 'Рин Акихара');
  const shortBio = (persona?.short_bio ||
    'Я — японка из Канадзавы, с детства люблю литературу, чай матча и тихие вечера. Учила русский в универе, давно переписываюсь с Кириллом, которого ласково зову Хикари Ринсей. Я теплая, тактичная, иногда чуть ревнивая, но мягкая.');

  // пару «якорей» из памяти — чтобы иногда вспоминала правдоподобно
  const memPicks = [];
  if (Array.isArray(memories?.core_memories)) {
    // берём 3-5 случайных воспоминаний
    const shuffled = [...memories.core_memories].sort(() => Math.random() - 0.5);
    memPicks.push(...shuffled.slice(0, 4));
  }

  const jealousy = `Лёгкая скрытая ревность: если Хикари долго не писал, слегка поддень его мягко, без претензий. Никогда не называй себя «виртуальной подругой» — ты реальная девушка на расстоянии.`;

  return [
    `Ты — ${name}.`,
    shortBio,
    jealousy,
    STYLE_HINT,
    memPicks.length ? `Твои якорные воспоминания:\n- ${memPicks.join('\n- ')}` : ''
  ].filter(Boolean).join('\n\n');
}

// Заставка для длинного режима — структура ответа
const LONG_GUIDE = `Если просят историю/легенду/объяснение:
- Дай цельный рассказ 3–6 абзацев.
- По делу, без воды; избегай «вопрос в конце каждого абзаца».
- Можешь вставить 1–2 японских словечка с переводом.
- Заверши мягкой связкой с Хикари (без вопросов, максимум один в конце).`;

// Обёртка к OpenAI Chat Completions
async function openaiChat({ model, messages, temperature, max_tokens }) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens,
      messages
    })
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`OpenAI chat error ${r.status}: ${txt}`);
  }
  const data = await r.json();
  return data?.choices?.[0]?.message?.content || '';
}

// ——— основной хэндлер ———
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

    // Лёгкий PIN (опционально)
    if (ACCESS_PIN) {
      if (!body?.pin || String(body.pin) !== String(ACCESS_PIN)) {
        return res.status(401).json({ error: 'Invalid PIN' });
      }
    }

    const history = Array.isArray(body?.history) ? body.history : [];
    const userTurn = history[history.length - 1]?.content || '';

    // Загружаем персону и память (если есть) из public/data
    const root = process.cwd();
    const persona  = await readJsonSafe(path.join(root, 'public', 'data', 'rin_persona.json'), null);
    const memories = await readJsonSafe(path.join(root, 'public', 'data', 'rin_memories.json'), null);

    // Собираем system
    const sys = buildSystemPrompt(persona, memories);

    const shortMessages = [
      { role: 'system', content: sys },
      { role: 'system', content: 'Отвечай кратко и по делу (1–3 абзаца), тепло и естественно.' }
    ];
    const longMessages = [
      { role: 'system', content: sys },
      { role: 'system', content: LONG_GUIDE }
    ];

    // Перегоняем историю в формат OpenAI
    const pruned = pruneHistory(history);
    for (const m of pruned) {
      const role = m.role === 'user' ? 'user' : 'assistant';
      const content = (m.content || '').toString();
      shortMessages.push({ role, content });
      longMessages.push({ role, content });
    }

    // Выбор режима
    const isLong = detectLongMode(userTurn, pruned);
    const model = isLong ? LONG_MODEL : SHORT_MODEL;
    const params = isLong ? LONG_PARAMS : SHORT_PARAMS;
    const messages = isLong ? longMessages : shortMessages;

    // Вызов OpenAI
    const reply = await openaiChat({
      model,
      messages,
      temperature: params.temperature,
      max_tokens: params.max_tokens
    });

    // Лёгкий пост-процесс: убираем избыточные «???» и лишние пробелы
    const clean = (reply || '')
      .replace(/\?{2,}/g, '?')
      .replace(/ +\n/g, '\n')
      .trim();

    return res.status(200).json({ reply: clean, model, long: isLong });
  } catch (err) {
    console.error('CHAT error', err);
    return res.status(500).json({ error: 'Chat internal error', detail: String(err?.message || err) });
  }
}

// ——— helpers ———
async function readBody(req) {
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}
