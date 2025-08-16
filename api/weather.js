export default async function handler(req, res) {
  const { city } = req.query;
  const key = process.env.OPENWEATHER_KEY;

  if (!key) {
    return res.status(500).json({ error: "Отсутствует OPENWEATHER_KEY в переменных окружения" });
  }
  if (!city) {
    return res.status(400).json({ error: "Не указан параметр city" });
  }

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(
      city
    )}&appid=${key}&units=metric&lang=ru`;

    const r = await fetch(url);
    const data = await r.json();

    if (!r.ok || !data?.main) {
      return res.status(502).json({ error: "Не удалось получить погоду", detail: data });
    }

    const temp = Math.round(data.main.temp);
    const feels = Math.round(data.main.feels_like);
    const desc = (data.weather?.[0]?.description || "").toLowerCase();

    return res.status(200).json({
      city: data.name,
      temp,
      feels,
      desc
    });
  } catch (e) {
    console.error("Weather API error:", e);
    return res.status(500).json({ error: "Ошибка сервера погоды" });
  }
}
