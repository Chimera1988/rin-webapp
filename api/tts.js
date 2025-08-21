// /api/tts.js — озвучка коротких реплик Рин (ElevenLabs TTS, голос Rachel)
const ELEVEN_KEY   = process.env.ELEVENLABS_API_KEY;
const VOICE_ID_DEF = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Rachel
const MODEL_ID_DEF = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }
    if (!ELEVEN_KEY) {
      return res.status(500).json({ error: 'Missing ELEVENLABS_API_KEY' });
    }

    const { text, voice, model } = await safeJson(req);
    const cleanText = (typeof text === 'string' ? text : '').trim();
    if (!cleanText) return res.status(400).json({ error: 'Text is required' });

    // Ограничим длину — авто‑плей в браузере и экономия токенов
    const MAX_CHARS = 180;
    const ttsInput = cleanText.length > MAX_CHARS
      ? cleanText.slice(0, MAX_CHARS) + '…'
      : cleanText;

    const voiceId = (typeof voice === 'string' && voice.trim()) || VOICE_ID_DEF;
    const modelId = (typeof model === 'string' && model.trim()) || MODEL_ID_DEF;

    // ElevenLabs: POST /v1/text-to-speech/{voice_id}
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVEN_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        model_id: modelId,
        text: ttsInput,
        // Можно тонко настраивать голос через voice_settings, оставим дефолты
        // voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      })
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      return res.status(r.status).json({ error: 'ElevenLabs TTS failed', detail: errText });
    }

    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(buf);
  } catch (err) {
    console.error('TTS error', err);
    return res.status(500).json({ error: 'TTS internal error' });
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
