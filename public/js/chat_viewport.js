const DEFAULT_BOTTOM_THRESHOLD = 120;
const KEYBOARD_RESYNC_DELAYS = [70, 220, 520, 820];

function finitePositive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function finiteOffset(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export function resolveViewportMetrics({ visualViewport, innerHeight, innerWidth } = {}) {
  const height = finitePositive(visualViewport?.height, finitePositive(innerHeight, 1));
  const width = finitePositive(visualViewport?.width, finitePositive(innerWidth, 1));

  return {
    height: Math.round(height),
    width: Math.round(width),
    offsetTop: Math.round(finiteOffset(visualViewport?.offsetTop)),
    offsetLeft: Math.round(finiteOffset(visualViewport?.offsetLeft))
  };
}

export function resolveViewportHeight(options = {}) {
  return resolveViewportMetrics(options).height;
}

export function isNearChatBottom(chat, threshold = DEFAULT_BOTTOM_THRESHOLD) {
  if (!chat) return true;
  const distance = Number(chat.scrollHeight || 0) - Number(chat.clientHeight || 0) - Number(chat.scrollTop || 0);
  return distance <= Math.max(0, Number(threshold) || 0);
}

export function createChatViewportController({
  root,
  chat,
  input,
  windowRef,
  documentRef,
  visualViewport = windowRef?.visualViewport,
  requestFrame = windowRef?.requestAnimationFrame?.bind(windowRef) || (callback => setTimeout(callback, 0)),
  cancelFrame = windowRef?.cancelAnimationFrame?.bind(windowRef) || clearTimeout,
  setTimer = windowRef?.setTimeout?.bind(windowRef) || setTimeout,
  clearTimer = windowRef?.clearTimeout?.bind(windowRef) || clearTimeout,
  bottomThreshold = DEFAULT_BOTTOM_THRESHOLD
} = {}) {
  if (!root || !chat) throw new TypeError('Chat viewport controller requires root and chat elements.');

  let destroyed = false;
  let firstFrame = 0;
  let secondFrame = 0;
  const deferredTimers = new Set();

  const cancelScheduledScroll = () => {
    if (firstFrame) cancelFrame(firstFrame);
    if (secondFrame) cancelFrame(secondFrame);
    firstFrame = 0;
    secondFrame = 0;
  };

  const cancelDeferredSync = () => {
    for (const timer of deferredTimers) clearTimer(timer);
    deferredTimers.clear();
  };

  const scrollToBottomNow = () => {
    chat.scrollTop = chat.scrollHeight;
  };

  const requestScrollToBottom = ({ force = true } = {}) => {
    if (destroyed || (!force && !isNearChatBottom(chat, bottomThreshold))) return false;

    cancelScheduledScroll();
    firstFrame = requestFrame(() => {
      firstFrame = 0;
      scrollToBottomNow();
      secondFrame = requestFrame(() => {
        secondFrame = 0;
        scrollToBottomNow();
      });
    });
    return true;
  };

  const syncViewport = () => {
    if (destroyed) return resolveViewportMetrics({});

    const metrics = resolveViewportMetrics({
      visualViewport,
      innerHeight: windowRef?.innerHeight,
      innerWidth: windowRef?.innerWidth
    });

    root.style.setProperty('--rin-viewport-height', `${metrics.height}px`);
    root.style.setProperty('--rin-viewport-width', `${metrics.width}px`);
    root.style.setProperty('--rin-viewport-offset-top', `${metrics.offsetTop}px`);
    root.style.setProperty('--rin-viewport-offset-left', `${metrics.offsetLeft}px`);

    const keyboardOrInputActive = documentRef?.activeElement === input;
    root.classList?.toggle?.('rin-input-active', Boolean(keyboardOrInputActive));
    if (keyboardOrInputActive) requestScrollToBottom({ force: true });
    return metrics;
  };

  const scheduleDeferredSync = () => {
    cancelDeferredSync();
    for (const delay of KEYBOARD_RESYNC_DELAYS) {
      const timer = setTimer(() => {
        deferredTimers.delete(timer);
        if (destroyed) return;
        syncViewport();
      }, delay);
      deferredTimers.add(timer);
    }
  };

  const onInputFocus = () => {
    syncViewport();
    requestScrollToBottom({ force: true });
    scheduleDeferredSync();
  };

  const onInputBlur = () => {
    root.classList?.remove?.('rin-input-active');
    scheduleDeferredSync();
  };

  const onViewportChange = () => {
    syncViewport();
  };

  const onMediaLoad = event => {
    const target = event?.target;
    if (!target || !['IMG', 'VIDEO', 'AUDIO'].includes(target.tagName)) return;
    requestScrollToBottom({ force: isNearChatBottom(chat, bottomThreshold) });
  };

  visualViewport?.addEventListener?.('resize', onViewportChange);
  visualViewport?.addEventListener?.('scroll', onViewportChange);
  windowRef?.addEventListener?.('resize', onViewportChange);
  windowRef?.addEventListener?.('orientationchange', onViewportChange);
  input?.addEventListener?.('focus', onInputFocus);
  input?.addEventListener?.('blur', onInputBlur);
  chat.addEventListener?.('load', onMediaLoad, true);

  syncViewport();

  return {
    syncViewport,
    requestScrollToBottom,
    isNearBottom: () => isNearChatBottom(chat, bottomThreshold),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelScheduledScroll();
      cancelDeferredSync();
      root.classList?.remove?.('rin-input-active');
      visualViewport?.removeEventListener?.('resize', onViewportChange);
      visualViewport?.removeEventListener?.('scroll', onViewportChange);
      windowRef?.removeEventListener?.('resize', onViewportChange);
      windowRef?.removeEventListener?.('orientationchange', onViewportChange);
      input?.removeEventListener?.('focus', onInputFocus);
      input?.removeEventListener?.('blur', onInputBlur);
      chat.removeEventListener?.('load', onMediaLoad, true);
    }
  };
}
