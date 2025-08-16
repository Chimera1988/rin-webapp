export default async function handler(req, res) {
  try {
    // Пример: бесплатное API scoresapi или rapidapi (можно заменить)
    // Здесь пока заглушка с фиктивным результатом
    const fakeData = {
      lastMatch: "Металлург Новокузнецк обыграл «Сокол» со счётом 4:2 🏒",
      nextMatch: "Следующий матч завтра против «Югра»."
    };

    return res.status(200).json(fakeData);
  } catch (err) {
    console.error("Hockey API error:", err);
    return res.status(500).json({ error: "Ошибка получения хоккейных данных" });
  }
}
