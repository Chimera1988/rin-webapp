export const PRESENCE_LABELS = Object.freeze({
  offline: 'офлайн',
  online: 'онлайн',
  typing: 'печатает…'
});

const DEFAULT_DELAYS = Object.freeze({
  firstReturn: [450, 1_250],
  returnAfterIdle: [1_200, 4_500],
  readBeforeTyping: [650, 1_700],
  onlineAfterReply: [22_000, 70_000]
});

function normalizeRange(value, fallback) {
  if (!Array.isArray(value) || value.length !== 2) return fallback;
  const min = Math.max(0, Number(value[0]));
  const max = Math.max(min, Number(value[1]));
  return Number.isFinite(min) && Number.isFinite(max) ? [min, max] : fallback;
}

export function createPresenceController(options = {}) {
  const render = typeof options.render === 'function' ? options.render : () => {};
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const setTimer = typeof options.setTimer === 'function' ? options.setTimer : setTimeout;
  const clearTimer = typeof options.clearTimer === 'function' ? options.clearTimer : clearTimeout;
  const isTransportOnline = typeof options.isTransportOnline === 'function'
    ? options.isTransportOnline
    : () => true;
  const isVisible = typeof options.isVisible === 'function'
    ? options.isVisible
    : () => true;

  const delays = {
    firstReturn: normalizeRange(options.delays?.firstReturn, DEFAULT_DELAYS.firstReturn),
    returnAfterIdle: normalizeRange(options.delays?.returnAfterIdle, DEFAULT_DELAYS.returnAfterIdle),
    readBeforeTyping: normalizeRange(options.delays?.readBeforeTyping, DEFAULT_DELAYS.readBeforeTyping),
    onlineAfterReply: normalizeRange(options.delays?.onlineAfterReply, DEFAULT_DELAYS.onlineAfterReply)
  };

  let mode = 'offline';
  let engaged = false;
  let activeTurn = null;
  let transitionTimer = null;
  let idleTimer = null;
  let disposed = false;
  let sequence = 0;

  function available() {
    return !disposed && isTransportOnline() !== false && isVisible() !== false;
  }

  function sample([min, max]) {
    if (max <= min) return min;
    const unit = Math.min(1, Math.max(0, Number(random()) || 0));
    return Math.round(min + (max - min) * unit);
  }

  function setMode(nextMode) {
    const normalized = Object.hasOwn(PRESENCE_LABELS, nextMode) ? nextMode : 'offline';
    if (mode === normalized) return;
    mode = normalized;
    render(mode, PRESENCE_LABELS[mode]);
  }

  function clearTransition() {
    if (transitionTimer != null) clearTimer(transitionTimer);
    transitionTimer = null;
  }

  function clearIdle() {
    if (idleTimer != null) clearTimer(idleTimer);
    idleTimer = null;
  }

  function scheduleIdleOffline() {
    clearIdle();
    if (!engaged || !available() || activeTurn) {
      if (!available()) setMode('offline');
      return;
    }
    idleTimer = setTimer(() => {
      idleTimer = null;
      if (!activeTurn) setMode('offline');
    }, sample(delays.onlineAfterReply));
  }

  function startTypingPhase(turn) {
    if (!turn || activeTurn?.id !== turn.id || !available()) {
      if (!available()) setMode('offline');
      return;
    }
    if (turn.typingStarted) {
      setMode('typing');
      return;
    }
    setMode('online');
    transitionTimer = setTimer(() => {
      transitionTimer = null;
      if (activeTurn?.id !== turn.id || !available()) {
        if (!available()) setMode('offline');
        return;
      }
      turn.typingStarted = true;
      setMode('typing');
      turn.onTyping?.();
    }, sample(delays.readBeforeTyping));
  }

  function beginTurn({ userInitiated = true, onTyping } = {}) {
    if (disposed) return null;
    const wasEngaged = engaged;
    if (userInitiated) engaged = true;
    if (!engaged) return null;

    clearTransition();
    clearIdle();

    const turn = {
      id: ++sequence,
      typingStarted: false,
      onTyping: typeof onTyping === 'function' ? onTyping : null
    };
    activeTurn = turn;

    if (!available()) {
      setMode('offline');
      return turn.id;
    }

    const returnDelay = mode === 'offline'
      ? sample(wasEngaged ? delays.returnAfterIdle : delays.firstReturn)
      : 0;

    if (returnDelay > 0) {
      setMode('offline');
      transitionTimer = setTimer(() => {
        transitionTimer = null;
        startTypingPhase(turn);
      }, returnDelay);
    } else {
      startTypingPhase(turn);
    }

    return turn.id;
  }

  function finishTurn(turnId) {
    if (turnId == null) return false;
    if (!activeTurn || activeTurn.id !== turnId) return false;
    clearTransition();
    activeTurn = null;
    if (!available()) {
      setMode('offline');
      return true;
    }
    setMode('online');
    scheduleIdleOffline();
    return true;
  }

  function syncAvailability() {
    clearTransition();
    clearIdle();
    if (!available()) {
      setMode('offline');
      return;
    }
    if (activeTurn) {
      startTypingPhase(activeTurn);
      return;
    }
    // Возвращение сети или вкладки само по себе не делает Рин онлайн.
    setMode('offline');
  }

  function dispose() {
    disposed = true;
    clearTransition();
    clearIdle();
    activeTurn = null;
    setMode('offline');
  }

  render(mode, PRESENCE_LABELS[mode]);

  return {
    beginTurn,
    finishTurn,
    syncAvailability,
    dispose,
    getSnapshot: () => ({ mode, engaged, active: Boolean(activeTurn) })
  };
}
