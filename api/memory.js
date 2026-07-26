const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ACCESS_PIN = process.env.ACCESS_PIN || '';

const MEMORY_MODEL =
  process.env.OPENAI_MEMORY_MODEL ||
  process.env.OPENAI_SHORT_MODEL ||
  'gpt-4o-mini';

function normalizeText(value, maxLength = 1000) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function safeArray(value, maxLength = 10) {
  return Array.isArray(value)
    ? value.slice(0, maxLength)
    : [];
}

function sanitizeMemoryResult(value) {
  const result = {
    facts: [],
    events: []
  };

  for (const item of safeArray(value?.facts, 5)) {
    const path = normalizeText(item?.path, 100);
    const memoryValue = normalizeText(item?.value, 500);
    const confidence = Number(item?.confidence);

    if (!/^user\.[a-zA-Z0-9_.-]+$/.test(path)) {
      continue;
    }

    if (!memoryValue) {
      continue;
    }

    result.facts.push({
      path,
      value: memoryValue,
      confidence: Number.isFinite(confidence)
        ? Math.max(0, Math.min(1, confidence))
        : 0.7
    });
  }

  for (const item of safeArray(value?.events, 5)) {
    const text = normalizeText(item?.text, 500);

    if (!text) {
      continue;
    }

    result.events.push({
      text,
      type: normalizeText(item?.type, 30) || 'memory',
      tags: safeArray(item?.tags, 8)
        .map(tag => normalizeText(tag, 40))
        .filter(Boolean),
      importance: Math.max(
        1,
        Math.min(10, Number(item?.importance) || 5)
      )
    });
  }

  return result;
}

async function extractMemory({
  userText,
  assistantText,
  existingMemory
}) {
  const systemPrompt = `
Ты — отдельный анализатор долгосрочной памяти AI-компаньона.

Твоя задача — определить, содержится ли в диалоге информация,
которую будет полезно помнить в будущих разговорах.

Ты не отвечаешь пользователю.
Ты возвращаешь только JSON.

СОХРАНЯЙ КАК УСТОЙЧИВЫЕ ФАКТЫ:
- имя и предпочитаемое обращение;
- возраст или день рождения, если пользователь сообщил это явно;
- место жительства;
- профессия или постоянная работа;
- близкие родственники и важные отношения;
- устойчивые предпочтения;
- долгосрочные проекты;
- регулярные привычки;
- значимые личные обстоятельства.

СОХРАНЯЙ КАК СОБЫТИЯ:
- назначенная встреча;
- собеседование;
- поездка;
- важное решение;
- обещание;
- значимое достижение;
- эмоционально важный разговор;
- событие, о котором позже уместно спросить.

НЕ СОХРАНЯЙ:
- приветствия и прощания;
- обычные вопросы;
- команды приложению;
- случайные шутки;
- каждое настроение;
- предположения модели;
- сведения, сказанные только ассистентом;
- секреты, пароли, PIN-коды, API-ключи;
- банковские или платёжные данные;
- точные адреса;
- медицинские и интимные сведения без явной долгосрочной необходимости.

ВАЖНО:
- сохраняй только то, что явно сообщил пользователь;
- не превращай выводы или догадки в факты;
- не записывай биографию Рин как факт о пользователе;
- пути устойчивых фактов должны начинаться только с "user.";
- один факт — один короткий путь;
- если сохранять нечего, верни пустые массивы.

Формат ответа:

{
  "facts": [
    {
      "path": "user.project",
      "value": "Разрабатывает веб-приложение с AI-компаньоном Рин",
      "confidence": 0.95
    }
  ],
  "events": [
    {
      "text": "Хикари завтра идёт на собеседование.",
      "type": "plan",
      "tags": ["работа", "собеседование"],
      "importance": 8
    }
  ]
}
`.trim();

  const userPrompt = `
СУЩЕСТВУЮЩАЯ ПАМЯТЬ:
${JSON.stringify(existingMemory || {}, null, 2).slice(0, 5000)}

НОВАЯ РЕПЛИКА ПОЛЬЗОВАТЕЛЯ:
${normalizeText(userText, 2000)}

ОТВЕТ АССИСТЕНТА:
${normalizeText(assistantText, 2000)}

Проанализируй диалог и верни только JSON.
`.trim();

  const response = await fetch(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },

      body: JSON.stringify({
        model: MEMORY_MODEL,
        temperature: 0.1,
        max_tokens: 500,

        response_format: {
          type: 'json_object'
        },

        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: userPrompt
          }
        ]
      })
    }
  );

  const rawText = await response.text();

  if (!response.ok) {
    throw new Error(
      `OpenAI memory error ${response.status}: ${rawText.slice(0, 500)}`
    );
  }

  const data = JSON.parse(rawText);

  const content =
    data?.choices?.[0]?.message?.content || '{}';

  let parsed;

  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {
      facts: [],
      events: []
    };
  }

  return sanitizeMemoryResult(parsed);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  if (!OPENAI_API_KEY) {
    return res.status(500).json({
      error: 'OPENAI_API_KEY is not configured'
    });
  }

  const body = req.body || {};

  if (
    ACCESS_PIN &&
    String(body.pin || '') !== String(ACCESS_PIN)
  ) {
    return res.status(401).json({
      error: 'Unauthorized'
    });
  }

  const userText = normalizeText(body.userText, 2000);
  const assistantText = normalizeText(
    body.assistantText,
    2000
  );

  if (!userText || !assistantText) {
    return res.status(200).json({
      facts: [],
      events: []
    });
  }

  try {
    const memory = await extractMemory({
      userText,
      assistantText,
      existingMemory: body.existingMemory || null
    });

    return res.status(200).json(memory);
  } catch (error) {
    console.error('Memory extraction failed:', error);

    // Ошибка памяти не должна показываться в основном чате.
    return res.status(200).json({
      facts: [],
      events: [],
      warning: 'memory_extraction_failed'
    });
  }
};
