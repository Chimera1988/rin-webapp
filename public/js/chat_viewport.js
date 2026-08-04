const DEFAULT_BOTTOM_THRESHOLD = 120;

export function resolveViewportHeight({ visualViewport, innerHeight } = {}) {
  const visualHeight = Number(visualViewport?.height);
  if (Number.isFinite(visualHeight) && visualHeight > 0) return Math.round(visualHeight);

  const fallbackHeight = Number(innerHeight);
  if (Number.isFinite(fallbackHeight) && fallbackHeight > 0) return Math.round(fallbackHeight);

  return 1;
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
  bottomThreshold = DEFAULT_BOTTOM_THRESHOLD
} = {}) {
  if (!root || !chat) throw new TypeError('Chat viewport controller requires root and chat elements.');

  let destroyed = false;
  let firstFrame = 0;
  let secondFrame = 0;

  const cancelScheduledScroll = () => {
    if (firstFrame) cancelFrame(firstFrame);
    if (secondFrame) cancelFrame(secondFrame);
    firstFrame = 0;
    secondFrame = 0;
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
    if (destroyed) return 0;
    const height = resolveViewportHeight({ visualViewport, innerHeight: windowRef?.innerHeight });
    root.style.setProperty('--rin-viewport-height', `${height}px`);

    const keyboardOrInputActive = documentRef?.activeElement === input;
    if (keyboardOrInputActive) requestScrollToBottom({ force: true });
    return height;
  };

  const onInputFocus = () => {
    syncViewport();
    requestScrollToBottom({ force: true });
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
      visualViewport?.removeEventListener?.('resize', onViewportChange);
      visualViewport?.removeEventListener?.('scroll', onViewportChange);
      windowRef?.removeEventListener?.('resize', onViewportChange);
      windowRef?.removeEventListener?.('orientationchange', onViewportChange);
      input?.removeEventListener?.('focus', onInputFocus);
      chat.removeEventListener?.('load', onMediaLoad, true);
    }
  };
}
