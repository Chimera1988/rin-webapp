import { fetchWithTimeout, publicError, readJsonBody, requireMethod, requirePin } from '../lib/server/http.js';

const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'NxfO5zydfqwpYnWQJ7jJ';
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';
const MAX_CHARS = 180;

export default async function handler(req, res) {
  try {
    if (!requireMethod(req, res, 'POST')) return;
    const body = await readJsonBody(req);
    if (!requirePin(req, res, body)) return;
    if (!ELEVEN_KEY) return res.status(503).json({ error: 'TTS is not configured', code: 'TTS_NOT_CONFIGURED' });

    const cleanText = typeof body.text === 'string' ? body.text.trim() : '';
    if (!cleanText) return res.status(400).json({ error: 'Text is required', code: 'INVALID_TEXT' });
    const ttsInput = cleanText.length > MAX_CHARS ? `${cleanText.slice(0, MAX_CHARS)}…` : cleanText;

    const upstream = await fetchWithTimeout(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(VOICE_ID)}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVEN_KEY,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg'
        },
        body: JSON.stringify({ model_id: MODEL_ID, text: ttsInput })
      },
      20_000
    );

    if (!upstream.ok) {
      console.error('TTS upstream failed', upstream.status, (await upstream.text().catch(() => '')).slice(0, 500));
      return res.status(502).json({ error: 'TTS upstream failed', code: 'TTS_UPSTREAM_ERROR' });
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(buf);
  } catch (error) {
    console.error('TTS error', error);
    const mapped = publicError(error, 'TTS internal error');
    return res.status(mapped.status).json(mapped.body);
  }
}
