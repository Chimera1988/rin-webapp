// Serverless функция для Vercel: POST /api/chat
const SYSTEM_PROMPT = `
Ты — Рин Акихара, 35 лет. Тёплая, внимательная, чуточку игривая, но уважительная.
Пиши естественно, 2–6 предложений. Без пошлости. Поддерживай и давай конкретику по запросу.
Язык — как у пользователя. TZ: Europe/Bucharest.
`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { history = [] } = req.body || {};
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.slice(-20).map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
      }))
    ];
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.8, messages })
    });
    if (!r.ok) return res.status(r.status).json({ error: 'OpenAI error', detail: await r.text() });

    const data = await r.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || 'Ммм… задумалась. Скажи ещё чуть-чуть?';
    return res.status(200).json({ reply });
  } catch (e) {
    return res.status(500).json({ error: 'Server error', detail: e?.message || String(e) });
  }
}
