export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { history, pin } = req.body || {};

  // Если хочешь включить PIN-проверку по переменной окружения — раскомментируй:
  // const need = process.env.ACCESS_PIN;
  // if (!need) return res.status(500).json({ error: 'ACCESS_PIN is not set' });
  // if (!pin || pin !== need) return res.status(401).json({ error: 'bad pin' });

  const lastUser = Array.isArray(history) ? [...history].reverse().find(m => m.role === 'user') : null;
  const userText = lastUser?.content || '';

  // Простейший ответ (эко + мягкая формулировка)
  const reply = userText
    ? `Слышу тебя: «${userText}». Хочешь, подумаем вместе?`
    : 'Я рядом. Расскажи, что у тебя на душе?';

  return res.status(200).json({ reply });
}
