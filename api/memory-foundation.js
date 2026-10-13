import { requirePin } from '../lib/server/http.js';
import { archiveConfigured } from '../lib/archive/database.js';
import { readMemoryFoundationStatus, readRecentMemorySources } from '../lib/memory-foundation/database.js';

// Diagnostics only: stage 1 never accepts beliefs, experiences or behavioral commands.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
  if (!requirePin(req, res)) return;
  if (!archiveConfigured()) return res.status(503).json({ code: 'MEMORY_FOUNDATION_NOT_CONFIGURED' });
  try {
    const mode = req.query?.mode || 'status';
    if (mode === 'status') return res.status(200).json(await readMemoryFoundationStatus());
    if (mode === 'recent') return res.status(200).json({
      schema: 'rin-memory-foundation-v1', sources: await readRecentMemorySources()
    });
    return res.status(400).json({ code: 'INVALID_MODE' });
  } catch (error) {
    console.error('Memory Foundation diagnostic unavailable:', error?.message || error);
    return res.status(503).json({ code: 'MEMORY_FOUNDATION_UNAVAILABLE' });
  }
}
