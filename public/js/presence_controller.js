export const PRESENCE_LABELS = Object.freeze({
  offline: 'не в сети',
  online: 'онлайн',
  typing: 'печатает…'
});

const DEFAULT_ONLINE_AFTER_REPLY = [22_000, 70_000];

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
  const isTransportOnline = typeof options.isTransportOnline === 'function' ? options.isTransportOnline : () => true;
  const isVisible = typeof options.isVisible === 'function' ? options.isVisible : () => true;
  const onlineAfterReply = normalizeRange(options.delays?.onlineAfterReply, DEFAULT_ONLINE_AFTER_REPLY);

  let mode = 'offline';
  let engaged = false;
  let activeTurn = null;
  let idleTimer = null;
  let disposed = false;
  let sequence = 0;

  function available() { return !disposed && isTransportOnline() !== false && isVisible() !== false; }
  function sample([min, max]) { return max <= min ? min : Math.round(min + Math.min(1, Math.max(0, Number(random()) || 0)) * (max - min)); }
  function setMode(nextMode) {
    const normalized = Object.hasOwn(PRESENCE_LABELS, nextMode) ? nextMode : 'offline';
    if (mode === normalized) return;
    mode = normalized;
    render(mode, PRESENCE_LABELS[mode]);
  }
  function clearIdle() { if (idleTimer != null) clearTimer(idleTimer); idleTimer = null; }
  function scheduleIdleOffline() {
    clearIdle();
    if (!available() || activeTurn) { if (!available()) setMode('offline'); return; }
    idleTimer = setTimer(() => {
      idleTimer = null;
      if (!activeTurn) setMode('offline');
    }, sample(onlineAfterReply));
  }

  function beginTurn({ userInitiated = true, onTyping } = {}) {
    if (disposed) return null;
    if (userInitiated) engaged = true;
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
    getSnapshot: () => ({ mode, engaged, active: Boolean(activeTurn) })
  };
}
