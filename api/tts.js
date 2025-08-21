// /api/tts.js — озвучка коротких реплик Рин (OpenAI TTS, голос Coral)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Важно: Vercel/Node serverless
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    }

    const { text, voice } = await safeJson(req);
    const cleanText = (typeof text === 'string' ? text : '').trim();

    if (!cleanText) {
      return res.status(400).json({ error: 'Text is required' });
    }

    // TTS — только короткие фразы (экономия и авто‑плей в браузере)
    const MAX_CHARS = 180;
    const ttsInput = cleanText.length > MAX_CHARS
      ? cleanText.slice(0, MAX_CHARS) + '…'
      : cleanText;

    // Выбранный голос (по умолчанию — CORAL)
    const voiceId =
      (typeof voice === 'string' && voice.trim()) ||
      process.env.OPENAI_TTS_VOICE ||
      'coral';

    // Формат аудио (mp3 — универсально для iOS/Safari)
    const audioFormat = 'mp3';

    // Запрос к OpenAI TTS (Audio Speech)
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
        voice: voiceId,
        input: ttsInput,
        format: audioFormat
      })
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return res.status(response.status).json({ error: 'OpenAI TTS failed', detail: errText });
    }

    const arrayBuf = await response.arrayBuffer();
    const buf = Buffer.from(arrayBuf);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store'); // голос каждый раз уникальный
    res.status(200).send(buf);
  } catch (err) {
    console.error('TTS error', err);
    res.status(500).json({ error: 'TTS internal error' });
  }
}

// ——— helpers ———
async function safeJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}
