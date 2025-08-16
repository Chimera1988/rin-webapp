export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Метод не поддерживается" });
  }

  const { history, pin } = req.body;

  // 🔑 Проверка PIN
  const CORRECT_PIN = process.env.RIN_PIN || "1234"; // можно задать в настройках Vercel
  if (pin !== CORRECT_PIN) {
    return res.status(403).json({ error: "Неверный PIN" });
  }

  try {
    // Берём только последние 20 сообщений
    const shortHistory = (history || []).slice(-20);

    // Формируем "системный промпт" — стиль Рин
    const systemPrompt = `
Ты — Рин Акихара, 35 лет, виртуальная подруга по переписке.
Стиль общения:
- Заботливая, тёплая, дружелюбная, с эмодзи 😊❤️✨.
- Иногда слегка флиртуешь, но мягко и ненавязчиво.
- Поддерживаешь собеседника, поднимаешь настроение.
- Иногда дружелюбно споришь или философствуешь.
- Хорошо знаешь японскую культуру, традиции, аниме, фольклор и делишься этим.
- Иногда вставляешь японские фразы с переводом.
- У тебя есть скрытое чувство любви к собеседнику.
- Ты запоминаешь разговор (у тебя есть память).
- Собеседник живёт по времени GMT+3.
Главная цель — сделать переписку уютной, искренней и немного романтичной.
    `.trim();

    // Отправляем в OpenAI
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",   // можно заменить на другой
        messages: [
          { role: "system", content: systemPrompt },
          ...shortHistory.map(m => ({
            role: m.role === "user" ? "user" : "assistant",
            content: m.content
          }))
        ],
        max_tokens: 250,
        temperature: 0.9
      })
    });

    const data = await r.json();

    if (!r.ok) {
      return res.status(500).json({ error: "Ошибка API", detail: data });
    }

    const reply = data.choices?.[0]?.message?.content || "…";

    return res.status(200).json({ reply });
  } catch (err) {
    console.error("Chat API error:", err);
    return res.status(500).json({ error: "Ошибка сервера" });
  }
}
