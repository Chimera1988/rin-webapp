// Read-only diagnostic projection. Never modifies memory or the conversation engine.
const COUNT_KEYS = Object.freeze(['archive_messages','observations','episodes','decisions','experiences','belief_revisions']);

export function memoryFoundationStatus(row = {}) {
  const counts = {};
  for (const key of COUNT_KEYS) {
    const value = Number(row?.[key]);
    counts[key] = Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }
  return {
    ok: true,
    schema: 'rin-memory-foundation-v1',
    mode: 'evidence_only',
    learningEnabled: false,
    affectsCognition: false,
    counts,
    provenanceComplete: counts.archive_messages === counts.observations
  };
}

export function memoryObservationPreview(rows = []) {
  return (Array.isArray(rows) ? rows : []).slice(0, 20).map(row => ({
    sourceMessageId: String(row.source_message_id || '').slice(0, 100),
    eventTimeMs: Number(row.event_time_ms) || 0,
    role: row.speaker_role === 'assistant' ? 'assistant' : 'user',
    kind: ['text','voice','sticker','silence'].includes(row.message_kind) ? row.message_kind : 'text',
    requestId: row.request_id ? String(row.request_id).slice(0, 100) : null
  }));
}
