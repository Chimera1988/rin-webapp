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

ОЦЕНИ ИЗМЕНЕНИЕ НАСТРОЕНИЯ РИН:

Определи, как последняя реплика пользователя должна повлиять
на эмоциональное состояние Рин.

Верни объект moodDelta.

Каждое числовое поле изменения должно быть целым числом
от -10 до 10.

affection:
Насколько Рин становится теплее или холоднее
по отношению к пользователю.

energy:
Насколько Рин становится более энергичной
или более спокойной и уставшей.

playfulness:
Насколько Рин хочется шутить, флиртовать
и общаться игриво.

trust:
Насколько возрастает или уменьшается
доверие Рин к пользователю.

reason:
Коротко объясни причину изменения настроения.

confidence:
Число от 0 до 1, показывающее уверенность
в эмоциональной оценке.

Для нейтрального сообщения или обычного вопроса
верни нулевые изменения.

Не придумывай сильную эмоциональную реакцию
без явной причины.

Изменение настроения должно зависеть
в первую очередь от сообщения пользователя,
а не от ответа ассистента.

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
- если сохранять нечего, верни пустые массивы;
- объект moodDelta возвращай всегда;
- если эмоционального влияния нет, верни нулевые значения.

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
      "tags": [
        "работа",
        "собеседование"
      ],
      "importance": 8
    }
  ],
  "moodDelta": {
    "affection": 2,
    "energy": 1,
    "playfulness": 3,
    "trust": 2,
    "reason": "Пользователь тепло общался с Рин.",
    "confidence": 0.92
  }
}
`.trim();

  const userPrompt = `
СУЩЕСТВУЮЩАЯ ПАМЯТЬ:
${JSON.stringify(
  existingMemory || {},
  null,
  2
).slice(0, 5000)}

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

module.exports = async function handler(
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
