import { checkLoginFailureBudget, recordFailedLogin, auditRejectedPin } from '../lib/server/security-gate.js';
import { pinMatchesRequest, readJsonBody, requireMethod, requirePin } from '../lib/server/http.js';

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'POST')) return;
  const body = await readJsonBody(req);
  // With no configured PIN there is no valid login to brute-force. Preserve
  // the existing AUTH_NOT_CONFIGURED response without touching the limiter.
  if (!String(process.env.ACCESS_PIN ?? '').trim()) { requirePin(req, res, body); return; }
  if (!await checkLoginFailureBudget(req, res)) return;
  if (!pinMatchesRequest(req, body)) {
    if (!await recordFailedLogin(req, res)) return;
  }
  if (!requirePin(req, res, body)) { auditRejectedPin('login'); return; }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true });
}
