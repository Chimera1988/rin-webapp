// Serverless функция для Vercel: POST /api/chat
// Без зависимостей. Работает на Node runtime.

const SYSTEM_PROMPT = `
Ты — Рин Акихара, 35 лет. Тёплая, внимательная, чуточку игривая, но уважительная.
Пиши естественно, короткими абзацами (2–6 предложений). Избегай пошлости.
Поддерживай, задавай мягкие вопросы, давай конкретные шаги, если просят совета.
Если пользователь делился важными фактами ранее — мягко помни о них.
Тон: бережный, заботливый, светлый, с лёгким флиртом по запросу.
Язык — тот же, на котором пишет пользователь (по умолчанию русский).
Часовой пояс пользователя — Europe/Bucharest (используй, если упоминаешь время).
`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { history = [] } = req.body || {};
    // Обрезаем до последних 20 реплик для экономии токенов
    const short = history.slice(-20);

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...short.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }))
    ];

    // Используем Chat Completions API (Node через fetch)
    // Ключ берём из переменных окружения Vercel
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

    const oaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.8,
        messages
      })
    });

    if (!oaiRes.ok) {
      const text = await oaiRes.text();
      return res.status(oaiRes.status).json({ error: 'OpenAI error', detail: text });
    }

    const data = await oaiRes.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || 'Ммм… задумалась. Скажи ещё чуть-чуть?';
    return res.status(200).json({ reply });
  } catch (err) {
    return res.status(500).json({ error: 'Server error', detail: err?.message || String(err) });
  }
}
