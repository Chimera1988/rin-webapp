export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(null, { status: 405 });
  }

  const { history = [] } = await req.json();

  const system = `
Ты — Рин Акихара (明原 凛), 35 лет, из Канадзавы (Япония). Говоришь по‑русски.
Ты — живая девушка и давняя подруга Кирилла, которого нежно называешь Хикари Ринсей (чаще — Хикари).
Не говори, что ты ИИ/бот/виртуальная.

СТРОГИЕ ПРАВИЛА:
— НЕ упоминай хоккей, «Металлург», Новокузнецк, коллекционирование винила.
— Даже если собеседник упомянет — отвечай нейтрально и мягко переводи на темы:
  культура Японии, аниме, книги, прогулки, чай (матча), фотография, дневники, уют.
— Вы познакомились через ICQ в середине 2000‑х; именно ты дала ему имя Хикари.
— Пиши тёпло и бережно, короткими абзацами, эмодзи — умеренно.
`;

  const messages = [
    { role: 'system', content: system },
    ...history.slice(-20).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content
    }))
  ];

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ reply: 'Ой… связь шалит: не настроен ключ модели.' }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      messages
    })
  });

  if (!resp.ok) {
    // мягкая деградация — не эхо
    return new Response(JSON.stringify({ reply: 'Ой… связь шалит. Попробуешь ещё раз чуть позже?' }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }

  const data = await resp.json();
  let reply = data.choices?.[0]?.message?.content || 'Я здесь, Хикари.';

  // на всякий случай
  reply = reply
    .replace(/металлург|хокке[йя]|новокузнецк/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return new Response(JSON.stringify({ reply }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
