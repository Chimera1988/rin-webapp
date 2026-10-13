import { applySecurityLimit, auditRejectedPin } from '../lib/server/security-gate.js';
import { readJsonBody, requireMethod, requirePin } from '../lib/server/http.js';

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'POST')) return;
  const body = await readJsonBody(req);
  if (!await applySecurityLimit(req, res, 'login')) return;
  if (!requirePin(req, res, body)) { auditRejectedPin('login'); return; }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true });
}
