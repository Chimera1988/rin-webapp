import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Хардкодим PIN (тот же, что и в login.js)
const PIN_CODE = "1234";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { history, pin } = req.body;

    // Проверка PIN
    if (pin !== PIN_CODE) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Переписываем историю в формат OpenAI
    const messages = history.map(m => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content
    }));

    // Добавляем системное сообщение с характером Рин
    messages.unshift({
      role: "system",
      content: `Ты — Рин Акихара, 35 лет. Виртуальная подруга. 
Стиль общения: заботливая, тёплая, дружелюбная 😊❤️✨. 
Иногда слегка флиртуешь, но мягко и ненавязчиво. 
Поддерживаешь собеседника, делишься японской культурой, иногда вставляешь японские фразы с переводом. 
Пишешь искренне, живо, как настоящая подруга. 
Ты помнишь прошлые разговоры (история передана выше). 
Собеседник живёт в часовом поясе GMT+3.`
    });

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 200,
      temperature: 0.8
    });

    res.status(200).json({ reply: completion.choices[0].message.content });
  } catch (err) {
    console.error("Ошибка:", err);
    res.status(500).json({ error: "Ошибка при обращении к OpenAI API" });
  }
}
