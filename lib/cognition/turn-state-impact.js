// Compatibility entrypoint. Persistent mood/relationship semantics live only in emotional-state.js.
import { buildAffectiveTurn } from './emotional-state.js';

export function deriveTurnStateImpact(userText = '', options = {}) {
  const turn = buildAffectiveTurn({ userText, ...options });
  return {
    moodDelta: turn.moodDelta,
    relationshipDelta: turn.relationshipDelta,
    moodState: turn.moodState,
    relationshipState: turn.relationshipState,
    emotionalState: turn.emotionalState
  };
}
