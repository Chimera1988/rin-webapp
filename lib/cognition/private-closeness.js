// Private Closeness is observational state. Rin Mind makes the social choice;
// this module only normalizes and remembers it, never escalates on a timer.
export const CLOSENESS_MODES = Object.freeze(['everyday', 'tender', 'private', 'quiet']);
export const CLOSENESS_FOCI = Object.freeze(['none', 'affection', 'openness', 'presence', 'mixed']);
export const CLOSENESS_MOVES = Object.freeze(['none', 'initiate', 'stay', 'deepen', 'shift', 'close']);

const asEnum = (value, choices, fallback) => choices.includes(value) ? value : fallback;
const threadText = value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 420) || null;
const landmarkText = value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 180);
const landmarkKinds = new Set(['scene', 'correction', 'boundary']);
function normalizedLandmarks(input) {
  return (Array.isArray(input) ? input : []).filter(x => x && typeof x === 'object')
    .map(x => ({kind: landmarkKinds.has(x.kind) ? x.kind : 'scene', text:landmarkText(x.text), atTurn:count(x.atTurn)}))
    .filter(x => x.text).slice(-6);
}
function addLandmark(prior, candidate) {
  const entries = normalizedLandmarks(prior);
  if (!candidate?.text || entries.some(item => item.kind === candidate.kind && item.text === candidate.text)) return entries;
  // Preserve the opening scene fact plus the most recent pivotal events.
  return [entries[0], ...entries.slice(1).slice(-4), candidate].filter(Boolean);
}
function explicitUserLandmark(userText, priorMode) {
  const text = landmarkText(userText);
  if (!text) return null;
  if (/(?:мы же говорили|я имел[аи]? в виду|ты перепутал[аи]?|это (?:моя|мой|моё|твоя|твой|твоё)\b)/iu.test(text))
    return {kind:'correction',text:`Поправка пользователя: «${text.slice(0,145)}»`};
  if (priorMode !== 'everyday' && /(?:лучше остановиться|давай остановимся|хочу остановиться|не хочу продолжать)/iu.test(text))
    return {kind:'boundary',text:'Пользователь обозначил желание остановить развитие этого момента'};
  return null;
}

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
    // Bounded narrative continuity survives the short dialogue window. It is
    // observational and cannot force a new act or stage of intimacy.
    thread: threadText(state.thread),
    landmarks: normalizedLandmarks(state.landmarks),
    everydayGap: count(state.everydayGap, 100),
    recentMoves
  };
}

export function recordPrivateCloseness({ previous = null, mind = null, conversationState = 'ongoing', contactBoundary = false, revision = 0, userText = '' } = {}) {
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
  const quietOrClose = terminal || move === 'close';
  const everydayGap = mode === 'everyday' && !quietOrClose && prior.thread ? (prior.everydayGap + 1) : 0;
  // A brief ordinary-life detour (e.g. a question about the weather) does not
  // erase a live episode. After a genuine departure, clear its transient thread.
  const keptThread = !quietOrClose && (mode !== 'everyday' || everydayGap <= 3);
  const thread = keptThread
    ? (mode === 'everyday' ? prior.thread : threadText(mind?.closenessThread) || prior.thread)
    : null;
  let landmarks = keptThread ? prior.landmarks : [];
  if (keptThread) {
    const correction = explicitUserLandmark(userText, prior.mode);
    if (correction) landmarks = addLandmark(landmarks, {...correction,atTurn:count(revision)+1});
    // This captures the Mind's reported scene summaries, not independently verified events.
    // A user correction always remains separate and takes precedence over these summaries.
    const significantShift = mode !== 'everyday' && ['initiate','deepen','shift'].includes(move)
      && thread && thread !== prior.thread;
    if (significantShift) landmarks = addLandmark(landmarks, {
      kind:'scene',text:thread.slice(0,175),atTurn:count(revision)+1
    });
  }
  return normalizePrivateCloseness({
    mode, focus, move, thread, landmarks, everydayGap,
    turnsInMode: changed ? 1 : prior.turnsInMode + 1,
    shiftedAtTurn: changed ? count(revision) + 1 : prior.shiftedAtTurn,
    recentMoves: [...prior.recentMoves, { mode, focus, move }]
  });
}
