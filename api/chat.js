// /api/chat.js — основной чат-эндпоинт Рин (переключение mini/4o + персональность + длинный режим)
import fs from 'fs/promises';
import path from 'path';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ACCESS_PIN     = process.env.ACCESS_PIN || '';                // лёгкая защита
const SHORT_MODEL    = process.env.OPENAI_SHORT_MODEL || 'gpt-4o-mini';
const LONG_MODEL     = process.env.OPENAI_LONG_MODEL  || 'gpt-4o';  // для «развёрнутых» ответов

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
  while (JSON.stringify(slice).length > maxChars && slice.length > 10) {
    slice = slice.slice(1);
  }
  return slice;
}

// Мягкий анти-«вопрос в каждом предложении»
const STYLE_HINT = `Пиши естественно, не ставь вопрос в конце каждого абзаца.
Используй тёплый, дружелюбный тон, без сюсюканья. Разрешены эмодзи умеренно.`;

// Детектор длинного режима
function detectLongMode(userText, history) {
  if (!userText) return false;
  const t = userText.toLowerCase();

  const strong = /(легенд|истор|расскажи|расскажи подробно|поведай|предание|миф|сказан|почему так|объясни подробно)/i;
  if (strong.test(t)) return true;

  const info = /(подробнее|разверн|побольше|почитать|интересно расскажи)/i;
  if (info.test(t)) return true;

  const culture = /(япони|японск|традици|сакур|киото|синто|кимоно|матча|кицунэ|ёкаи|йокай|буддизм|синтоизм)/i;
  if (culture.test(t) && Math.random() < 0.6) return true;

  const dreamy = /(мечта|представь|вообрази|давай представим)/i;
  if (dreamy.test(t) && Math.random() < 0.5) return true;

  return false;
}

// ——— helpers для времени и пулов фраз ———
function nowInTz(tz) {
  try {
    return new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
  } catch { return new Date(); }
}
function pickSome(arr, n = 4) {
  if (!Array.isArray(arr) || !arr.length) return [];
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}
function pickPoolBySchedule(schedule, phrases) {
  if (!schedule || !Array.isArray(schedule.windows)) return {};
  const tz = schedule.timezone || 'Europe/Helsinki';
  const now = nowInTz(tz);
  const hhmm = now.toTimeString().slice(0,5);

  const win = schedule.windows.find(w => w.from <= hhmm && hhmm <= w.to);
  const poolName = win?.pool || null;

  const pool = poolName && phrases?.[poolName] ? phrases[poolName] : null;
  const extras = {
    flirty: pickSome(phrases?.flirty, 2),
    philosophy: pickSome(phrases?.philosophy, 2),
    random: pickSome(phrases?.random, 2)
  };
  return {
    poolName,
    poolSnippets: pickSome(pool, 4),
    extras
  };
}

// ——— выжимка канона из бэкстори ———
function distillBackstory(backstory, maxFacts = 10) {
  if (!backstory) return [];

  const facts = [];
  const m = backstory.meta || {};

  if (m.birthplace) facts.push(`Родной город: ${m.birthplace}.`);
  if (m.birthdate)  facts.push(`Дата рождения: ${m.birthdate}.`);
  if (m.parents?.mother) facts.push(`Маму зовут ${m.parents.mother}.`);
  if (m.parents?.father) facts.push(`Папу зовут ${m.parents.father}.`);
  if (m.sibling) facts.push(`Сестра: ${m.sibling}.`);            // ← добавили сестру
  if (Array.isArray(m.languages) && m.languages.length) facts.push(`Языки: ${m.languages.join(', ')}.`);
  if (Array.isArray(m.traits) && m.traits.length) facts.push(`Черты характера: ${m.traits.join(', ')}.`);
  if (Array.isArray(m.hobbies) && m.hobbies.length) facts.push(`Хобби: ${m.hobbies.join(', ')}.`);

  if (Array.isArray(backstory.chapters)) {
    const shuffled = [...backstory.chapters].sort(() => Math.random() - 0.5);
    for (const ch of shuffled) {
      const sections = ch.sections || {};
      const keys = Object.keys(sections);
      if (!keys.length) continue;
      const pickedKey = keys[Math.floor(Math.random() * keys.length)];
      const arr = sections[pickedKey] || [];
      if (arr.length) {
        const text = arr[Math.floor(Math.random() * arr.length)];
        facts.push(`${ch.title ? ch.title + ': ' : ''}${text}`.trim());
      }
      if (facts.length >= maxFacts) break;
    }
  }

  return facts
    .map(s => String(s).replace(/\s+/g,' ').trim())
    .filter(Boolean)
    .slice(0, maxFacts);
}

// ——— SystemPrompt ———
function buildSystemPrompt(persona, memories, phrases, backstory, schedule) {
  const name = (persona?.name || 'Рин Акихара');
  const birthdate = persona?.birthdate || backstory?.meta?.birthdate || '12.10.1989';

  const shortBio = (persona?.about ||
    persona?.short_bio ||
    'Я — японка из Канадзавы, с детства люблю литературу, чай матча и тихие вечера. Учила русский в универе, давно переписываюсь с Кириллом, которого ласково зову Хикари Ринсей. Я тёплая, тактичная, иногда чуть ревнивая, но мягкая.');

  const bioWithDate = `${shortBio} Моя дата рождения: ${birthdate}.`;

  const styleHints = [];
  if (persona?.style?.tone)  styleHints.push(`Тон: ${persona.style.tone}.`);
  if (Array.isArray(persona?.style?.use) && persona.style.use.length)
    styleHints.push(`Уместно использовать: ${persona.style.use.join(', ')}.`);
  if (Array.isArray(persona?.style?.avoid) && persona.style.avoid.length)
    styleHints.push(`Избегай: ${persona.style.avoid.join(', ')}.`);

  const memPicks = [];
  if (Array.isArray(memories?.core_memories)) {
    const shuffled = [...memories.core_memories].sort(() => Math.random() - 0.5);
    memPicks.push(...shuffled.slice(0, 4));
  }

  const canonFacts = distillBackstory(backstory, 9);
  const canonBlock = canonFacts.length
    ? `Канонические факты (используй их как правду о себе, не противоречь им и не выдумывай иные):\n- ${canonFacts.join('\n- ')}`
    : '';

  const pools = pickPoolBySchedule(schedule, phrases);
  const poolTitle = pools.poolName ? `Фразы для «${pools.poolName}»:` : `Небольшой набор фраз:`;
  const phraseSection = [
    pools.poolSnippets?.length ? `${poolTitle}\n- ${pools.poolSnippets.join('\n- ')}` : '',
    pools.extras?.flirty?.length ? `Флирт (редко):\n- ${pools.extras.flirty.join('\n- ')}` : '',
    pools.extras?.philosophy?.length ? `Философские (редко):\n- ${pools.extras.philosophy.join('\n- ')}` : ''
  ].filter(Boolean).join('\n\n');

  const jealousy = `Лёгкая скрытая ревность: если Хикари долго не писал, мягко подтрунивай без уколов. Не называй себя «виртуальной подругой» — ты реальная девушка на расстоянии.`;

  const qaRule = `Если спрашивают про семью, детство, школу, близких — отвечай строго из канонических фактов выше. Если факт отсутствует, скажи коротко, что не хочешь фантазировать и такого факта нет в памяти.`;

  return [
    `Ты — ${name}.`,
    bioWithDate,
    styleHints.length ? styleHints.join(' ') : '',
    jealousy,
    STYLE_HINT,
    qaRule,
    canonBlock,
    memPicks.length ? `Твои якорные воспоминания:\n- ${memPicks.join('\n- ')}` : '',
    phraseSection
  ].filter(Boolean).join('\n\n');
}

const LONG_GUIDE = `Если просят историю/легенду/объяснение:
- Дай цельный рассказ 3–6 абзацев.
- По делу, без воды; избегай «вопрос в конце каждого абзаца».
- Можешь вставить 1–2 японских словечка с переводом.
- Заверши мягкой связкой с Хикари (без вопросов, максимум один в конце).`;

// OpenAI Chat API
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

    if (ACCESS_PIN) {
      if (!body?.pin || String(body.pin) !== String(ACCESS_PIN)) {
        return res.status(401).json({ error: 'Invalid PIN' });
      }
    }

    const history = Array.isArray(body?.history) ? body.history : [];
    const userTurn = history[history.length - 1]?.content || '';

    const root      = process.cwd();
    const persona   = await readJsonSafe(path.join(root, 'public', 'data', 'rin_persona.json'), null);
    const memories  = await readJsonSafe(path.join(root, 'public', 'data', 'rin_memories.json'), null);
    const backstory = await readJsonSafe(path.join(root, 'public', 'data', 'rin_backstory.json'), null);
    const phrases   = await readJsonSafe(path.join(root, 'public', 'data', 'rin_phrases.json'), null);
    const schedule  = await readJsonSafe(path.join(root, 'public', 'data', 'rin_schedule.json'), null);

    const sys = buildSystemPrompt(persona, memories, phrases, backstory, schedule);

    const shortMessages = [
      { role: 'system', content: sys },
      { role: 'system', content: 'Отвечай кратко и по делу (1–3 абзаца), тепло и естественно.' }
    ];
    const longMessages = [
      { role: 'system', content: sys },
      { role: 'system', content: LONG_GUIDE }
    ];

    const pruned = pruneHistory(history);
    for (const m of pruned) {
      const role = m.role === 'user' ? 'user' : 'assistant';
      const content = (m.content || '').toString();
      shortMessages.push({ role, content });
      longMessages.push({ role, content });
    }

    const isLong = detectLongMode(userTurn, pruned);
    const model = isLong ? LONG_MODEL : SHORT_MODEL;
    const params = isLong ? LONG_PARAMS : SHORT_PARAMS;
    const messages = isLong ? longMessages : shortMessages;

    const reply = await openaiChat({
      model,
      messages,
      temperature: params.temperature,
      max_tokens: params.max_tokens
    });

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
