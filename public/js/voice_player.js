// Rin 2.6.5 — a single audio transport for every voice bubble and the floating player.
// UI only: no archive writes, audio generation or cognitive state changes.

const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
const RATES = Object.freeze([1, 1.25, 1.5, 2]);

export function voiceWaveHeights(seed = '', count = 34) {
  // Stable, deliberately decorative bars. We do not misrepresent them as MP3 analysis.
  const key = String(seed);
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const total = Math.max(1, Math.min(60, Math.floor(count) || 34));
  const bars = [];
  for (let i = 0; i < total; i++) {
    hash ^= hash << 13;
    hash ^= hash >>> 17;
    hash ^= hash << 5;
    const random = (hash >>> 0) / 4294967295;
    const contour = .45 + .55 * Math.abs(Math.sin(i * .21 + (key.length % 11)));
    bars.push(Math.round(5 + 23 * Math.min(1, contour * (.33 + random * .73))));
  }
  return bars;
}

export function voiceTime(seconds) {
  const value = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

export function createVoicePlayer({ root, onError = () => {} } = {}) {
  if (!root) throw new Error('Voice mini-player root is required');
  const miniPlay = root.querySelector('[data-voice-mini-play]');
  const miniSpeed = root.querySelector('[data-voice-mini-speed]');
  const miniClose = root.querySelector('[data-voice-mini-close]');
  const miniSubtitle = root.querySelector('[data-voice-mini-subtitle]');
  if (!miniPlay || !miniSpeed || !miniClose || !miniSubtitle) throw new Error('Voice mini-player controls are missing');

  let active = null;
  let operation = 0;
  let rateIndex = 0;
  const registered = new Set();

  const updateProgress = track => {
    const { audio, bars, durationNode } = track;
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    const elapsed = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    durationNode.textContent = duration ? `${voiceTime(elapsed)} / ${voiceTime(duration)}` : voiceTime(elapsed);
    const completed = duration && audio.ended ? bars.length : duration ? Math.floor((elapsed / duration) * bars.length) : 0;
    bars.forEach((bar, index) => bar.classList.toggle('is-played', index < completed));
    if (active === track) miniSubtitle.textContent = duration
      ? `Голосовое сообщение · ${voiceTime(elapsed)} / ${voiceTime(duration)}`
      : 'Голосовое сообщение';
  };

  const updateButtons = track => {
    const playing = !track.audio.paused && !track.audio.ended;
    track.playButton.innerHTML = playing ? PAUSE : PLAY;
    track.playButton.setAttribute('aria-label', playing ? 'Приостановить голосовое' : 'Воспроизвести голосовое');
    track.bubble.classList.toggle('playing', playing);
    if (track === active) {
      miniPlay.innerHTML = playing ? PAUSE : PLAY;
      miniPlay.setAttribute('aria-label', playing ? 'Приостановить воспроизведение' : 'Продолжить воспроизведение');
      root.dataset.playing = playing ? 'true' : 'false';
    }
  };

  async function toggle(track) {
    if (!track) return;
    if (active === track && !track.audio.paused && !track.audio.ended) {
      ++operation;
      track.audio.pause();
      return;
    }
    const thisOperation = ++operation;
    if (active && active !== track) active.audio.pause();
    active = track;
    root.hidden = false;
    updateProgress(track);
    updateButtons(track);
    track.playButton.disabled = true;
    miniPlay.disabled = true;
    try {
      const available = await track.ensureSource();
      if (!available || operation !== thisOperation || active !== track) return;
      if (track.audio.ended || (Number.isFinite(track.audio.duration) && track.audio.currentTime >= track.audio.duration)) {
        track.audio.currentTime = 0;
      }
      track.audio.playbackRate = RATES[rateIndex];
      await track.audio.play();
    } catch (error) {
      onError(error);
    } finally {
      track.playButton.disabled = false;
      miniPlay.disabled = false;
      if (active === track) {
        updateProgress(track);
        updateButtons(track);
      }
    }
  }

  function close() {
    ++operation;
    if (active) active.audio.pause();
    active = null;
    root.hidden = true;
    root.dataset.playing = 'false';
    miniPlay.disabled = false;
  }

  function register({ audio, bubble, playButton, wave, durationNode, ensureSource, sourceId = '', releaseSource = null }) {
    if (!audio || !bubble || !playButton || !wave || !durationNode || typeof ensureSource !== 'function') {
      throw new Error('Incomplete voice message binding');
    }
    const bars = [];
    for (const height of voiceWaveHeights(sourceId)) {
      const bar = wave.ownerDocument.createElement('i');
      bar.style.height = `${height}px`;
      wave.appendChild(bar);
      bars.push(bar);
    }
    wave.setAttribute('aria-hidden', 'true');
    const track = { audio, bubble, playButton, bars, durationNode, ensureSource, releaseSource };
    audio.preload = 'metadata';
    audio.playbackRate = RATES[rateIndex];
    playButton.type = 'button';
    playButton.addEventListener('click', () => { void toggle(track); });
    audio.addEventListener('timeupdate', () => updateProgress(track));
    audio.addEventListener('loadedmetadata', () => updateProgress(track));
    audio.addEventListener('durationchange', () => updateProgress(track));
    audio.addEventListener('play', () => {
      if (active && active !== track) active.audio.pause();
      active = track;
      root.hidden = false;
      updateButtons(track);
      updateProgress(track);
    });
    audio.addEventListener('pause', () => updateButtons(track));
    audio.addEventListener('ended', () => { updateButtons(track); updateProgress(track); });
    updateButtons(track);
    updateProgress(track);
    registered.add(track);
    return track;
  }

  miniPlay.addEventListener('click', () => { if (active) void toggle(active); });
  miniClose.addEventListener('click', close);
  miniSpeed.addEventListener('click', () => {
    rateIndex = (rateIndex + 1) % RATES.length;
    for (const track of registered) track.audio.playbackRate = RATES[rateIndex];
    miniSpeed.textContent = `${RATES[rateIndex]}×`;
    miniSpeed.setAttribute('aria-label', `Скорость воспроизведения ${RATES[rateIndex]}×`);
  });
  miniSpeed.textContent = '1×';
  root.hidden = true;

  return {
    register,
    close,
    dispose() {
      close();
      for (const track of registered) {
        if (typeof track.releaseSource === 'function') track.releaseSource();
      }
      registered.clear();
    },
    get activeAudio() { return active?.audio || null; }
  };
}
