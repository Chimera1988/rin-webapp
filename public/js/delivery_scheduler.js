export const USER_AGGREGATION_WINDOW_MS = 1250;

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const sample = (random, min, max) => Math.round(min + clamp(random(), 0, 1) * (max - min));

export function computeHumanReadDelay({ userChars = 0, messageCount = 1, random = Math.random } = {}) {
  const chars = Math.max(0, Number(userChars) || 0);
  const count = Math.max(1, Number(messageCount) || 1);
  const base = 550 + Math.min(1500, chars * 7) + Math.min(500, (count - 1) * 180);
  return Math.round(clamp(base + sample(random, -160, 260), 450, 2400));
}

export function computeHumanComposeDelay({ chars = 0, kind = 'text', random = Math.random } = {}) {
  if (kind === 'sticker') return sample(random, 450, 950);
  const length = Math.max(0, Number(chars) || 0);
  let min;
  let max;
  if (length <= 24) [min, max] = [800, 1700];
  else if (length <= 80) [min, max] = [1500, 3200];
  else if (length <= 160) [min, max] = [2600, 5000];
  else if (length <= 300) [min, max] = [4200, 7600];
  else [min, max] = [6500, 10500];
  return sample(random, min, max);
}

export function computeInterSegmentDelay({ nextKind = 'text', random = Math.random } = {}) {
  return nextKind === 'sticker' ? sample(random, 350, 850) : sample(random, 520, 1200);
}

async function waitCancelable(ms, { shouldCancel = () => false, setTimer = setTimeout } = {}) {
  let remaining = Math.max(0, Number(ms) || 0);
  while (remaining > 0) {
    if (shouldCancel()) return false;
    const chunk = Math.min(100, remaining);
    await new Promise(resolve => setTimer(resolve, chunk));
    remaining -= chunk;
  }
  return !shouldCancel();
}

export function createHumanDeliveryScheduler({ random = Math.random, setTimer = setTimeout } = {}) {
  return {
    async waitBeforeSilence({ userChars = 0, messageCount = 1, onPresence = () => {}, shouldCancel = () => false } = {}) {
      onPresence('online');
      const readDelay = computeHumanReadDelay({ userChars, messageCount, random });
      if (!await waitCancelable(readDelay, { shouldCancel, setTimer })) return { cancelled: true, phase: 'read' };
      return { cancelled: false, readDelay, composeDelay: 0 };
    },

    async waitBeforeFirstSegment({ userChars = 0, messageCount = 1, firstSegment = null, onPresence = () => {}, shouldCancel = () => false } = {}) {
      onPresence('online');
      const readDelay = computeHumanReadDelay({ userChars, messageCount, random });
      if (!await waitCancelable(readDelay, { shouldCancel, setTimer })) return { cancelled: true, phase: 'read' };
      onPresence('typing');
      const composeDelay = computeHumanComposeDelay({ chars: String(firstSegment?.text || '').length, kind: firstSegment?.type || 'text', random });
      if (!await waitCancelable(composeDelay, { shouldCancel, setTimer })) return { cancelled: true, phase: 'compose' };
      return { cancelled: false, readDelay, composeDelay };
    },

    async waitBetweenSegments({ nextSegment = null, onPresence = () => {}, shouldCancel = () => false } = {}) {
      onPresence('online');
      const gap = computeInterSegmentDelay({ nextKind: nextSegment?.type || 'text', random });
      if (!await waitCancelable(gap, { shouldCancel, setTimer })) return { cancelled: true, phase: 'gap' };
      if (nextSegment?.type === 'text') {
        onPresence('typing');
        const composeDelay = computeHumanComposeDelay({ chars: String(nextSegment?.text || '').length, kind: 'text', random });
        if (!await waitCancelable(composeDelay, { shouldCancel, setTimer })) return { cancelled: true, phase: 'compose' };
        return { cancelled: false, gap, composeDelay };
      }
      return { cancelled: false, gap, composeDelay: 0 };
    }
  };
}

export function createInputAggregator({
  delayMs = USER_AGGREGATION_WINDOW_MS,
  onFlush,
  canFlush = () => true,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  if (typeof onFlush !== 'function') throw new TypeError('Input aggregator requires onFlush');
  let timer = null;
  const ids = [];
  const schedule = () => {
    if (timer != null) clearTimer(timer);
    timer = setTimer(async () => {
      timer = null;
      if (!ids.length) return;
      if (!canFlush()) {
        schedule();
        return;
      }
      const batch = ids.splice(0, ids.length);
      await onFlush(batch);
    }, Math.max(0, Number(delayMs) || USER_AGGREGATION_WINDOW_MS));
  };
  return {
    push(id) {
      const value = String(id || '').trim();
      if (value && !ids.includes(value)) ids.push(value);
      schedule();
      return ids.length;
    },
    prepend(values = []) {
      const next = [...new Set([...(Array.isArray(values) ? values : []), ...ids].map(String).filter(Boolean))];
      ids.splice(0, ids.length, ...next);
      schedule();
    },
    flushNow() {
      if (timer != null) clearTimer(timer);
      timer = null;
      if (!ids.length) return Promise.resolve([]);
      const batch = ids.splice(0, ids.length);
      return Promise.resolve(onFlush(batch)).then(() => batch);
    },
    pending() { return [...ids]; },
    clear() {
      if (timer != null) clearTimer(timer);
      timer = null;
      ids.splice(0, ids.length);
    }
  };
}
