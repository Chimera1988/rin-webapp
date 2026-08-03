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

function createEmptyMoodDelta() {
  return {
    affection: 0,
    energy: 0,
    playfulness: 0,
    trust: 0,
    reason: '',
    confidence: 0
  };
}

function createEmptyMemoryResult() {
  return {
    facts: [],
    events: [],
    moodDelta: createEmptyMoodDelta()
  };
}

function sanitizeMemoryResult(value) {
  const result = createEmptyMemoryResult();

  for (const item of safeArray(value?.facts, 5)) {
    const path = normalizeText(item?.path, 100);
    const memoryValue = normalizeText(
      item?.value,
      500
    );
    const confidence = Number(
      item?.confidence
    );

    if (
      !/^user\.[a-zA-Z0-9_.-]+$/.test(path)
    ) {
      continue;
    }

    if (!memoryValue) {
      continue;
    }

    result.facts.push({
      path,
      value: memoryValue,

      confidence:
        Number.isFinite(confidence)
          ? Math.max(
              0,
              Math.min(1, confidence)
            )
          : 0.7
    });
  }

  for (
    const item of safeArray(value?.events, 5)
  ) {
    const text = normalizeText(
      item?.text,
      500
    );

    if (!text) {
      continue;
    }

    result.events.push({
      text,

      type:
        normalizeText(item?.type, 30) ||
        'memory',

      tags: safeArray(item?.tags, 8)
        .map(tag =>
          normalizeText(tag, 40)
        )
        .filter(Boolean),

      importance: Math.max(
        1,
        Math.min(
          10,
          Number(item?.importance) || 5
        )
      )
    });
  }

  const moodDelta = value?.moodDelta;

  if (
    moodDelta &&
    typeof moodDelta === 'object'
  ) {
    const clampDelta = input => {
      const number = Number(input);

      if (!Number.isFinite(number)) {
        return 0;
      }

      return Math.max(
        -10,
        Math.min(
          10,
          Math.round(number)
        )
      );
    };

    const confidence = Number(
      moodDelta.confidence
    );

    result.moodDelta = {
      affection: clampDelta(
        moodDelta.affection
      ),

      energy: clampDelta(
        moodDelta.energy
      ),

      playfulness: clampDelta(
        moodDelta.playfulness
      ),

      trust: clampDelta(
        moodDelta.trust
      ),

      reason: normalizeText(
        moodDelta.reason,
        300
      ),

      confidence:
        Number.isFinite(confidence)
          ? Math.max(
              0,
              Math.min(1, confidence)
            )
          : 0
    };
  }

  return result;
}

async function extractMemory({
  userText,
  assistantText,
  existingMemory
}) {
  const systemPrompt = `
Ты — анализатор долговременной памяти AI-компаньона. Не отвечай пользователю; верни только JSON.

Сохраняй только явно сообщённые пользователем устойчивые факты (имя, место, работа, близкие, предпочтения, привычки, долгосрочные проекты) и значимые события, к которым позже уместно вернуться (встреча, поездка, решение, обещание, достижение, важный разговор).
Не сохраняй приветствия, прощания, обычные вопросы, шутки, команды приложению, предположения модели, сведения только из ответа ассистента, секреты/ключи/платёжные данные, точные адреса и лишние чувствительные данные.
Пути фактов начинаются только с user.; один факт — один короткий путь. Упоминание Рин Акихары по умолчанию относится к ассистенту, не к третьему лицу.

Всегда верни moodDelta. Оцени влияние прежде всего последней реплики пользователя: affection, energy, playfulness, trust — целые числа от -10 до 10; для нейтрального сообщения нули. Обычная забота или комплимент сами по себе не повышают energy. reason — кратко, confidence — 0..1. Не придумывай сильную реакцию без причины.

Формат:
{"facts":[{"path":"user.preference","value":"...","confidence":0.9}],"events":[{"text":"...","type":"plan","tags":["..."],"importance":7}],"moodDelta":{"affection":0,"energy":0,"playfulness":0,"trust":0,"reason":"","confidence":0}}
`.trim();

  const userPrompt = `
СУЩЕСТВУЮЩАЯ ПАМЯТЬ:
${JSON.stringify(
  existingMemory || {},
  null,
  0
).slice(0, 2800)}

НОВАЯ РЕПЛИКА ПОЛЬЗОВАТЕЛЯ:
${normalizeText(userText, 1400)}

ОТВЕТ АССИСТЕНТА:
${normalizeText(assistantText, 1200)}

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
        max_tokens: 360,

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
      `OpenAI memory error ${response.status}: ` +
      rawText.slice(0, 500)
    );
  }

  const data = JSON.parse(rawText);

  const content =
    data?.choices?.[0]?.message?.content ||
    '{}';

  let parsed;

  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = createEmptyMemoryResult();
  }

  return sanitizeMemoryResult(parsed);
}

export default async function handler(
  req,
  res
) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  if (!OPENAI_API_KEY) {
    return res.status(500).json({
      error:
        'OPENAI_API_KEY is not configured'
    });
  }

  const body = req.body || {};

  if (
    ACCESS_PIN &&
    String(body.pin || '') !==
      String(ACCESS_PIN)
  ) {
    return res.status(401).json({
      error: 'Unauthorized'
    });
  }

  const userText = normalizeText(
    body.userText,
    2000
  );

  const assistantText = normalizeText(
    body.assistantText,
    2000
  );

  if (!userText || !assistantText) {
    return res
      .status(200)
      .json(createEmptyMemoryResult());
  }

  try {
    const memory = await extractMemory({
      userText,
      assistantText,
      existingMemory:
        body.existingMemory || null
    });

    return res.status(200).json(memory);
  } catch (error) {
    console.error(
      'Memory extraction failed:',
      error
    );

    // Ошибка памяти не должна показываться
    // в основном чате.
    return res.status(200).json({
      ...createEmptyMemoryResult(),
      warning: 'memory_extraction_failed'
    });
  }
};
