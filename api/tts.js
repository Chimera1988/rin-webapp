export default async function handler(req, res) {
  // CORS, чтобы можно было тестировать прямо из браузера
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const API_KEY = process.env.OPENAI_API_KEY;
  const MODEL   = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
  const VOICE   = process.env.OPENAI_TTS_VOICE || 'lumen';

  if (!API_KEY) {
    return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
  }

  // Забираем текст из GET ?text=... или из POST {text:"..."}
  let text = '';
  try {
    if (req.method === 'GET') {
      text = (req.query?.text || '').toString();
    } else if (req.method === 'POST') {
      // На Vercel body может быть строкой
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      text = (body.text || '').toString();
    } else {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }
  } catch (e) {
    return res.status(400).json({ error: 'Bad JSON in request body' });
  }

  if (!text.trim()) {
    return res.status(400).json({ error: 'No text provided' });
  }

  try {
    // Запрос в OpenAI TTS
    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,          // gpt-4o-mini-tts
        voice: VOICE,          // lumen
        input: text,
        format: 'mp3'
      })
    });

    if (!r.ok) {
      const errTxt = await r.text();
      return res.status(r.status).json({
        error: 'OpenAI TTS request failed',
        detail: errTxt
      });
    }

    // Стримим mp3 в ответ
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    // r.body — ReadableStream; на Node в Vercel можно проксировать через pipe
    r.body.pipe(res);
  } catch (e) {
    res.status(500).json({ error: 'TTS proxy error', detail: String(e) });
  }
}
