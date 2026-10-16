// Retry the provenance-qualified write without another model inference.
// Source messages must have reached the immutable Neon chat archive first.
import { requireSession } from '../lib/server/session.js';
import { applySecurityLimit, auditRejectedSession } from '../lib/server/security-gate.js';
import { readJsonBody, requireMethod } from '../lib/server/http.js';
import { archiveSql } from '../lib/archive/database.js';
import { validEpisodeCandidates, saveEpisodeCandidates } from '../lib/memory-foundation/episode-capture.js';

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'POST')) return;
  if (!await applySecurityLimit(req, res, 'api')) return;
  if (!await requireSession(req, res)) { auditRejectedSession('episode-capture'); return; }
  const body = await readJsonBody(req);
  const candidates = (Array.isArray(body?.candidates) ? body.candidates : []).slice(0, 12)
    .filter(x => x && typeof x === 'object' && typeof x.sourceMessageId === 'string');
  if (!candidates.length) return res.status(200).json({ saved: 0, pending: [] });
  try {
    const sql = await archiveSql();
    const ids = [...new Set(candidates.map(x => String(x.sourceMessageId).slice(0, 145)))];
    const rows = await sql.query(`SELECT id,ts,role,payload->>'content' AS content
      FROM rin_archive_messages WHERE id=ANY($1::text[]) AND kind IN ('text','voice')`, [ids]);
    const verified = validEpisodeCandidates(candidates, rows, '');
    const validIds = new Set(verified.map(x => x.sourceMessageId));
    const notYetSynced = candidates.filter(x => !rows.some(m => m.id === x.sourceMessageId));
    const captured = await saveEpisodeCandidates(verified, { sqlClient: sql });
    const stillPending = [...notYetSynced, ...captured.pending]
      .filter((x, i, all) => all.findIndex(y => y.sourceMessageId === x.sourceMessageId && y.episodeKey === x.episodeKey) === i);
    return res.status(200).json({ saved: captured.saved, pending: stillPending.slice(0, 12),
      verified: validIds.size, dropped: candidates.length - verified.length - notYetSynced.length });
  } catch (error) {
    console.warn('Episode capture retry deferred', String(error?.message || error).slice(0, 140));
    return res.status(503).json({ code: 'EPISODE_CAPTURE_DEFERRED' });
  }
}
