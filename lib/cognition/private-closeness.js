// Private Closeness is observational state. Rin Mind makes the social choice;
// this module only normalizes and remembers it, never escalates on a timer.
export const CLOSENESS_MODES = Object.freeze(['everyday', 'tender', 'private', 'quiet']);
export const CLOSENESS_FOCI = Object.freeze(['none', 'affection', 'openness', 'presence', 'mixed']);
export const CLOSENESS_MOVES = Object.freeze(['none', 'initiate', 'stay', 'deepen', 'shift', 'close']);

const asEnum = (value, choices, fallback) => choices.includes(value) ? value : fallback;
const count = (value, maximum = 1000000) => Number.isFinite(Number(value))
  ? Math.max(0, Math.min(maximum, Math.floor(Number(value)))) : 0;

export function normalizePrivateCloseness(input = null) {
  const state = input && typeof input === 'object' ? input : {};
  const mode = asEnum(state.mode, CLOSENESS_MODES, 'everyday');
  const recentMoves = (Array.isArray(state.recentMoves) ? state.recentMoves : [])
    .filter(item => item && typeof item === 'object')
    .map(item => ({
      mode: asEnum(item.mode, CLOSENESS_MODES, 'everyday'),
      move: asEnum(item.move, CLOSENESS_MOVES, 'none'),
      focus: asEnum(item.focus, CLOSENESS_FOCI, 'none')
    }))
    .slice(-6);
  return {
    mode,
    focus: asEnum(state.focus, CLOSENESS_FOCI, 'none'),
    move: asEnum(state.move, CLOSENESS_MOVES, 'none'),
    turnsInMode: count(state.turnsInMode, 10000),
    shiftedAtTurn: count(state.shiftedAtTurn),
    recentMoves
  };
}

export function recordPrivateCloseness({ previous = null, mind = null, conversationState = 'ongoing', contactBoundary = false, revision = 0 } = {}) {
  const prior = normalizePrivateCloseness(previous);
  const terminal = conversationState === 'ending' || contactBoundary === true || mind?.contactStance === 'boundary_without_withdrawal';
  // Technical fallback is neutral only while contact remains open. A farewell or
  // established boundary still closes the private scene, even on fallback.
  if (!terminal && mind?.socialIntent === 'stable_fallback') return prior;
  const mode = terminal ? 'everyday' : asEnum(mind?.closenessMode, CLOSENESS_MODES, 'everyday');
  const focus = terminal ? 'none' : asEnum(mind?.closenessFocus, CLOSENESS_FOCI, 'none');
  const move = terminal ? (prior.mode === 'everyday' ? 'none' : 'close')
    : asEnum(mind?.closenessMove, CLOSENESS_MOVES, 'none');
  const changed = prior.mode !== mode;
  return normalizePrivateCloseness({
    mode, focus, move,
    turnsInMode: changed ? 1 : prior.turnsInMode + 1,
    shiftedAtTurn: changed ? count(revision) + 1 : prior.shiftedAtTurn,
    recentMoves: [...prior.recentMoves, { mode, focus, move }]
  });
}
