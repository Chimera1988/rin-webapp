export const PRESENCE_LABELS = Object.freeze({
  offline: 'не в сети',
  online: 'онлайн',
  typing: 'печатает…'
});

const DEFAULT_ONLINE_AFTER_REPLY = [45_000, 100_000];
const DEFAULT_DENSE_ONLINE_AFTER_REPLY = [180_000, 360_000];
const DEFAULT_DENSE_WINDOW_MS = 4 * 60_000;
const DEFAULT_DENSE_TURN_THRESHOLD = 2;

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
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const isTransportOnline = typeof options.isTransportOnline === 'function' ? options.isTransportOnline : () => true;
  const isVisible = typeof options.isVisible === 'function' ? options.isVisible : () => true;
  const onlineAfterReply = normalizeRange(options.delays?.onlineAfterReply, DEFAULT_ONLINE_AFTER_REPLY);
  const denseOnlineAfterReply = normalizeRange(options.delays?.denseOnlineAfterReply, DEFAULT_DENSE_ONLINE_AFTER_REPLY);
  const denseWindowMs = Math.max(30_000, Number(options.delays?.denseWindowMs) || DEFAULT_DENSE_WINDOW_MS);
  const denseTurnThreshold = Math.max(2, Math.round(Number(options.delays?.denseTurnThreshold) || DEFAULT_DENSE_TURN_THRESHOLD));

  let mode = 'offline';
  let engaged = false;
  let activeTurn = null;
  let idleTimer = null;
  let disposed = false;
  let sequence = 0;
  let recentUserTurns = [];

  function available() { return !disposed && isTransportOnline() !== false && isVisible() !== false; }
  function sample([min, max]) { return max <= min ? min : Math.round(min + Math.min(1, Math.max(0, Number(random()) || 0)) * (max - min)); }
  function setMode(nextMode) {
    const normalized = Object.hasOwn(PRESENCE_LABELS, nextMode) ? nextMode : 'offline';
    if (mode === normalized) return;
    mode = normalized;
    render(mode, PRESENCE_LABELS[mode]);
  }
  function clearIdle() { if (idleTimer != null) clearTimer(idleTimer); idleTimer = null; }
  function trimRecentUserTurns(at = Number(now()) || Date.now()) {
    recentUserTurns = recentUserTurns.filter(ts => at - ts <= denseWindowMs);
    return recentUserTurns.length;
  }
  function sessionIsDense(at = Number(now()) || Date.now()) {
    return trimRecentUserTurns(at) >= denseTurnThreshold;
  }
  function scheduleIdleOffline() {
    clearIdle();
    if (!available() || activeTurn) { if (!available()) setMode('offline'); return; }
    const delayRange = sessionIsDense() ? denseOnlineAfterReply : onlineAfterReply;
    idleTimer = setTimer(() => {
      idleTimer = null;
      if (!activeTurn) {
        setMode('offline');
        trimRecentUserTurns();
      }
    }, sample(delayRange));
  }

  function beginTurn({ userInitiated = true, onTyping } = {}) {
    if (disposed) return null;
    const at = Number(now()) || Date.now();
    if (userInitiated) {
      engaged = true;
      trimRecentUserTurns(at);
      recentUserTurns.push(at);
      trimRecentUserTurns(at);
    }
    clearIdle();
    activeTurn = { id: ++sequence, typingStarted: false, onTyping: typeof onTyping === 'function' ? onTyping : null };
    if (available()) setMode('online'); else setMode('offline');
    return activeTurn.id;
  }

  function setPhase(turnId, nextMode) {
    if (!activeTurn || activeTurn.id !== turnId || !available()) {
      if (!available()) setMode('offline');
      return false;
    }
    if (nextMode === 'typing') {
      setMode('typing');
      if (!activeTurn.typingStarted) {
        activeTurn.typingStarted = true;
        activeTurn.onTyping?.();
      }
      return true;
    }
    if (nextMode === 'online') {
      setMode('online');
      return true;
    }
    return false;
  }

  function finishTurn(turnId) {
    if (turnId == null || !activeTurn || activeTurn.id !== turnId) return false;
    activeTurn = null;
    clearIdle();
    if (!available()) { setMode('offline'); return true; }
    setMode('online');
    scheduleIdleOffline();
    return true;
  }

  function syncAvailability() {
    clearIdle();
    if (!available()) { setMode('offline'); return; }
    if (activeTurn) { setMode(mode === 'typing' ? 'typing' : 'online'); return; }
    // Возвращение сети или вкладки само по себе не делает Рин онлайн.
    setMode('offline');
  }

  function dispose() {
    disposed = true;
    clearIdle();
    activeTurn = null;
    setMode('offline');
  }

  render(mode, PRESENCE_LABELS[mode]);
  return {
    beginTurn,
    setPhase,
    setTyping: turnId => setPhase(turnId, 'typing'),
    setOnline: turnId => setPhase(turnId, 'online'),
    finishTurn,
    syncAvailability,
    dispose,
    getSnapshot: () => ({ mode, engaged, active: Boolean(activeTurn), dense: sessionIsDense(), recentUserTurns: trimRecentUserTurns() })
  };
}
