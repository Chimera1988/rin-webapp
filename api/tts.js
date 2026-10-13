import { requireSession } from '../lib/server/session.js';
import { applySecurityLimit, auditRejectedSession } from '../lib/server/security-gate.js';
import { fetchWithTimeout, publicError, readJsonBody, requireMethod } from '../lib/server/http.js';
import { preserveRinAudio } from '../lib/archive/media.js';
import { validArchiveId } from '../lib/archive/core.js';

// Voice and model are deployment configuration, not source-code constants.
// The server must not silently fall back to a different voice or model.
export function readTtsConfig(env = process.env) {
  return {
    apiKey: String(env?.ELEVENLABS_API_KEY || '').trim(),
    voiceId: String(env?.ELEVENLABS_VOICE_ID || '').trim(),
    modelId: String(env?.ELEVENLABS_MODEL_ID || '').trim()
  };
}
const MAX_CHARS = 180;

// Eleven v4 interprets short audio tags as delivery guidance. The mapping is
// intentionally small, and no vocal sound effects (laughs/sighs) are forced.
const EMOTION_TAGS = Object.freeze({
  playfulness: '[mischievously]',
  playful_irritation: '[mischievously]',
  tenderness: '[softly]',
  warmth: '[softly]',
  shyness: '[shyly]',
  joy: '[happy]',
  excitement: '[excited]',
  sadness: '[sad]',
  hurt: '[sad]',
  disappointment: '[sad]',
  concern: '[concerned]',
  curiosity: '[curious]',
  interest: '[curious]',
  relief: '[relieved]',
  gratitude: '[warmly]'
});

export function buildTtsInput(text, emotion = null) {
  // The caller normally sends at most 180 characters. Also enforce the
  // free-credit budget for direct API calls without splitting a sentence for a tag.
  const clean = String(text || '').trim();
  const spoken = clean.length > MAX_CHARS ? clean.slice(0, MAX_CHARS) : clean;
  const type = String(emotion?.type || '').trim().toLowerCase();
  const intensity = Number(emotion?.intensity);
  const tag = Object.prototype.hasOwnProperty.call(EMOTION_TAGS, type) ? EMOTION_TAGS[type] : null;

  // Short or weakly emotional messages are voiced naturally, without prompting.
  if (!tag || !Number.isFinite(intensity) || intensity < 35 || spoken.length < 24) return spoken;
  // Never cut spoken content to make room for a style tag.
  if (tag.length + 1 + spoken.length > MAX_CHARS) return spoken;
  return `${tag} ${spoken}`;
}

export default async function handler(req, res) {
  try {
    if (!requireMethod(req, res, 'POST')) return;
    const body = await readJsonBody(req);
    if (!await applySecurityLimit(req, res, 'api')) return;
    if (!await requireSession(req, res)) { auditRejectedSession('tts'); return; }
    const {apiKey, voiceId, modelId} = readTtsConfig();
    if (!apiKey || !voiceId || !modelId) return res.status(503).json({ error: 'TTS is not configured', code: 'TTS_NOT_CONFIGURED' });

    const cleanText = typeof body.text === 'string' ? body.text.trim() : '';
    if (!cleanText) return res.status(400).json({ error: 'Text is required', code: 'INVALID_TEXT' });
    const ttsInput = buildTtsInput(cleanText, body.emotion);

    if (!await applySecurityLimit(req, res, 'tts')) return;

    const upstream = await fetchWithTimeout(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg'
        },
        body: JSON.stringify({ model_id: modelId, text: ttsInput })
      },
      20_000
    );

    if (!upstream.ok) {
      console.error('TTS upstream failed', upstream.status, (await upstream.text().catch(() => '')).slice(0, 500));
      return res.status(502).json({ error: 'TTS upstream failed', code: 'TTS_UPSTREAM_ERROR' });
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    let archived = false;
    if (validArchiveId(body.messageId)) {
      try { archived = await preserveRinAudio(body.messageId, buf); }
      catch(error) { console.error('Voice archive save failed:', error?.message || error); }
    }
    res.setHeader('X-Rin-Audio-Archived', archived ? '1' : '0');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(buf);
  } catch (error) {
    console.error('TTS error', error);
    const mapped = publicError(error, 'TTS internal error');
    return res.status(mapped.status).json(mapped.body);
  }
}
