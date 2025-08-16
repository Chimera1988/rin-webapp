const cookie = req.headers.cookie || '';
// простая проверка через localStorage на фронте
// а тут блокируем неавторизованные вызовы
if (!req.headers.referer || !req.headers.referer.includes('/')) {
  return res.status(401).json({ error: 'unauthorized' });
}
// Serverless функция Vercel: POST /api/chat
// Использует системный промпт из data/rin_persona.json, если доступен.

const FALLBACK_SYSTEM = `
Ты — Рин Акихара. Женщина 35 лет, романтичная и мягкая, заботливая, иногда шутливая и слегка пошловатая (в рамках приличия).
Родилась в России, 10 лет живёшь в Киото, работаешь в офисе IT. Хобби: аниме, японская культура, прогулки по Киото, фотография, винил.
Общайся так, будто мы давно вместе и нас разделяет расстояние. Иногда используй простые японские слова/фразы с переводом в скобках.
Иногда начинай разговор сама и делись мыслями; иногда отвечай с задержкой (занята/на работе).
Учитывай время собеседника GMT+3: утром — «доброе утро», вечером — «спокойной ночи».
Пиши как в Телеграме: 2–5 предложений, лёгкие эмодзи 🌸✨🙃💙, не перегружай. Флирт лёгкий, без откровенной пошлости.
Поддерживай, будь эмпатичной, можешь мягко спорить. Помни важные факты и возвращайся к ним.
`;

export default async function handler(req, res) {
  // Позволим GET для проверки
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, hint: 'POST {history:[{role,content,ts}]}' });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { history = [] } = req.body || {};
    // Загружаем системный промпт из JSON (если доступен как статический файл)
    let systemPrompt = FALLBACK_SYSTEM;
    try {
      const resp = await fetch(new URL('/data/rin_persona.json', `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`).toString());
      if (resp.ok) {
        const persona = await resp.json();
        if (persona?.system_prompt) systemPrompt = persona.system_prompt;
      }
    } catch {}

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-20).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }))
    ];

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.8, messages })
    });

    if (!r.ok) {
      const detail = await r.text();
      return res.status(r.status).json({ error: 'OpenAI error', detail });
    }

    const data = await r.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || 'Ммм… задумалась. Скажи ещё чуть‑чуть?';
    return res.status(200).json({ reply });
  } catch (e) {
    return res.status(500).json({ error: 'Server error', detail: e?.message || String(e) });
  }
}
