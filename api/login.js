import { readJsonBody, requirePin } from '../lib/server/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED' });
  }
  const body = await readJsonBody(req);
  if (!requirePin(req, res, body)) return;
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true });
}
