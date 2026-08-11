import { readJsonBody, requireMethod, requirePin } from '../lib/server/http.js';

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'POST')) return;
  const body = await readJsonBody(req);
  if (!requirePin(req, res, body)) return;
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true });
}
