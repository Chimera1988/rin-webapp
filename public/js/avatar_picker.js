/* Rin photographs: manifest generated from public/avatars by Vercel build. */
export const AVATAR_STORAGE_KEY = 'rin-avatar-choice-v1';

const ORIGINAL = 'rin-original.jpg';
const LEGACY_IDS = Object.freeze({
  original: ORIGINAL,
  home: 'rin-home.webp',
  walk: 'rin-walk.webp',
  evening: 'rin-evening.webp',
  morning: 'rin-morning.webp',
  work: 'rin-work.webp'
});
const MANIFEST_URL = '/avatars.json';
// Manifest is generated at build time and never requires an API function.
const FALLBACK_SRC = '';

// The gallery waits for the actual manifest; no hard-coded photograph is required.
export let AVATAR_OPTIONS = Object.freeze([]);

function storedId() {
  try {
    const stored = localStorage.getItem(AVATAR_STORAGE_KEY);
    return LEGACY_IDS[stored] || stored;
  } catch { return null; }
}

let selectedId = storedId() || null;
const optionForId = id => AVATAR_OPTIONS.find(option => option.id === id);
export function getSelectedAvatarUrl() {
  return (optionForId(selectedId) || AVATAR_OPTIONS[0])?.src || FALLBACK_SRC;
}

function normalizeManifestOptions(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.filter(item => {
    if (!item || typeof item.id !== 'string' || typeof item.src !== 'string') return false;
    if (seen.has(item.id) || !/^[^/\\]{1,160}\.(?:jpg|jpeg|png|webp)$/i.test(item.id)) return false;
    // Only same-origin photographs under /avatars may be shown.
    if (!/^\/avatars\/[^/?#]+\.(?:jpg|jpeg|png|webp)(?:\?v=[a-f0-9]{12})?$/i.test(item.src)) return false;
    seen.add(item.id);
    return true;
  }).slice(0, 200).map(item => ({ id: item.id, src: item.src }));
}

export function initAvatarPicker({ chatRoot = document.getElementById('chat') } = {}) {
  const trigger = document.getElementById('avatarPickerToggle');
  const topAvatar = document.getElementById('avatarTop');
  if (!trigger || !topAvatar || document.getElementById('rinAvatarPicker')) return null;

  const overlay = document.createElement('div');
  overlay.id = 'rinAvatarPicker';
  overlay.className = 'rin-avatar-viewer';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Фотографии Рин');
  overlay.innerHTML = `
    <header class="rin-avatar-viewer__top">
      <button class="rin-avatar-viewer__close" type="button" aria-label="Закрыть просмотр">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
      <span class="rin-avatar-viewer__name">Рин Акихара</span>
      <span class="rin-avatar-viewer__count" aria-live="polite"></span>
    </header>
    <div class="rin-avatar-viewer__stage" aria-label="Фотография Рин">
      <button type="button" class="rin-avatar-viewer__arrow rin-avatar-viewer__arrow--prev" aria-label="Предыдущее фото">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <img class="rin-avatar-viewer__photo" alt="Рин Акихара" draggable="false" />
      <button type="button" class="rin-avatar-viewer__arrow rin-avatar-viewer__arrow--next" aria-label="Следующее фото">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
      </button>
    </div>
    <footer class="rin-avatar-viewer__bottom">
      <div class="rin-avatar-viewer__filmstrip" role="group" aria-label="Все фотографии Рин"></div>
      <button class="rin-avatar-viewer__install" type="button">Установить</button>
    </footer>`;
  document.body.appendChild(overlay);

  const mainPhoto = overlay.querySelector('.rin-avatar-viewer__photo');
  const filmstrip = overlay.querySelector('.rin-avatar-viewer__filmstrip');
  const counter = overlay.querySelector('.rin-avatar-viewer__count');
  const install = overlay.querySelector('.rin-avatar-viewer__install');
  const closeButton = overlay.querySelector('.rin-avatar-viewer__close');
  let thumbs = [];
  let viewedIndex = 0;
  let returnFocus = trigger;
  let touchStart = null;
  let loading = null;

  function renderThumbnails() {
    filmstrip.replaceChildren();
    thumbs = AVATAR_OPTIONS.map((option, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rin-avatar-viewer__thumb';
      button.setAttribute('aria-label', `Фото ${index + 1} из ${AVATAR_OPTIONS.length}`);
      button.setAttribute('aria-current', 'false');
      const thumbnail = document.createElement('img');
      thumbnail.src = option.src;
      thumbnail.alt = '';
      thumbnail.loading = 'lazy';
      thumbnail.decoding = 'async';
      button.appendChild(thumbnail);
      button.addEventListener('click', () => view(index));
      filmstrip.appendChild(button);
      return button;
    });
  }

  function refreshAvatars() {
    const src = getSelectedAvatarUrl();
    if (!src) return;
    if (topAvatar.getAttribute('src') !== src) topAvatar.src = src;
    for (const image of chatRoot?.querySelectorAll('.row.her img.avatar.small') || []) {
      if (image.getAttribute('src') !== src) image.src = src;
    }
  }

  function view(index) {
    if (!AVATAR_OPTIONS.length) {
      counter.textContent = '…';
      mainPhoto.removeAttribute('src');
      install.disabled = true;
      install.textContent = 'Установить';
      return;
    }
    viewedIndex = (index + AVATAR_OPTIONS.length) % AVATAR_OPTIONS.length;
    const option = AVATAR_OPTIONS[viewedIndex];
    if (mainPhoto.getAttribute('src') !== option.src) mainPhoto.src = option.src;
    counter.textContent = `${viewedIndex + 1} / ${AVATAR_OPTIONS.length}`;
    thumbs.forEach((button, i) => {
      button.classList.toggle('is-current', i === viewedIndex);
      button.setAttribute('aria-current', String(i === viewedIndex));
    });
    const installed = option.id === selectedId;
    install.disabled = installed;
    install.textContent = installed ? 'Установлен' : 'Установить';
  }

  async function reloadOptions() {
    if (loading) return loading;
    loading = (async () => {
      const response = await fetch(MANIFEST_URL, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error('AVATARS_FETCH_FAILED');
      const result = await response.json();
      const options = normalizeManifestOptions(result?.avatars);
      if (!options.length) throw new Error('AVATARS_EMPTY');
      const previousViewed = AVATAR_OPTIONS[viewedIndex]?.id;
      AVATAR_OPTIONS = Object.freeze(options);
      if (!optionForId(selectedId)) {
        selectedId = AVATAR_OPTIONS[0].id;
        try { localStorage.setItem(AVATAR_STORAGE_KEY, selectedId); } catch {}
      }
      refreshAvatars();
      renderThumbnails();
      if (!overlay.hidden) {
        const index = AVATAR_OPTIONS.findIndex(item => item.id === previousViewed);
        view(index < 0 ? AVATAR_OPTIONS.findIndex(item => item.id === selectedId) : index);
      }
      return true;
    })().catch(() => false).finally(() => { loading = null; });
    return loading;
  }

  function close() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    document.body.classList.remove('rin-avatar-picker-open');
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKeydown, true);
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }

  function open() {
    if (!overlay.hidden) return;
    returnFocus = document.activeElement;
    document.activeElement?.blur?.();
    const stored = storedId();
    if (stored && optionForId(stored)) selectedId = stored;
    renderThumbnails();
    viewedIndex = Math.max(0, AVATAR_OPTIONS.findIndex(item => item.id === selectedId));
    view(viewedIndex);
    overlay.hidden = false;
    document.body.classList.add('rin-avatar-picker-open');
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', onKeydown, true);
    closeButton.focus({ preventScroll: true });
    void reloadOptions();
  }

  function onKeydown(event) {
    if (overlay.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); close();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault(); event.stopImmediatePropagation();
      view(viewedIndex + (event.key === 'ArrowRight' ? 1 : -1));
    } else if (event.key === 'Tab') {
      const buttons = [...overlay.querySelectorAll('button:not([disabled])')];
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      }
    }
  }

  trigger.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  overlay.querySelector('.rin-avatar-viewer__arrow--prev').addEventListener('click', () => view(viewedIndex - 1));
  overlay.querySelector('.rin-avatar-viewer__arrow--next').addEventListener('click', () => view(viewedIndex + 1));
  install.addEventListener('click', () => {
    const option = AVATAR_OPTIONS[viewedIndex];
    if (!option || option.id === selectedId) return;
    selectedId = option.id;
    try { localStorage.setItem(AVATAR_STORAGE_KEY, selectedId); } catch {}
    refreshAvatars();
    close();
  });

  const stage = overlay.querySelector('.rin-avatar-viewer__stage');
  stage.addEventListener('touchstart', event => {
    const t = event.changedTouches[0];
    if (t && event.touches.length === 1) touchStart = { x: t.clientX, y: t.clientY };
    else touchStart = null;
  }, { passive: true });
  stage.addEventListener('touchend', event => {
    if (!touchStart) return;
    const t = event.changedTouches[0];
    const dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.25) {
      view(viewedIndex + (dx < 0 ? 1 : -1));
    }
  }, { passive: true });
  stage.addEventListener('touchcancel', () => { touchStart = null; }, { passive: true });

  window.addEventListener('storage', event => {
    if (event.key !== AVATAR_STORAGE_KEY && event.key !== null) return;
    const stored = storedId();
    selectedId = optionForId(stored)?.id || AVATAR_OPTIONS[0]?.id || null;
    refreshAvatars();
    if (!overlay.hidden) view(viewedIndex);
  });

  // chat.js can create legacy /avatar.jpg elements. Replace them with the
  // actual chosen image. Never fall back to an image removed from the folder.
  document.addEventListener('error', event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    if (!image.matches('#avatarTop, .row.her img.avatar.small')) return;
    const src = getSelectedAvatarUrl();
    if (src && image.getAttribute('src') !== src) image.src = src;
    else image.removeAttribute('src');
  }, true);

  if (chatRoot && typeof MutationObserver === 'function') {
    const observer = new MutationObserver(records => {
      const src = getSelectedAvatarUrl();
      if (!src) return;
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          const images = node.matches('.row.her img.avatar.small')
            ? [node] : node.querySelectorAll('.row.her img.avatar.small');
          for (const image of images) {
            if (image.getAttribute('src') !== src) image.src = src;
          }
        }
      }
    });
    observer.observe(chatRoot, { childList: true, subtree: true });
  }

  renderThumbnails();
  refreshAvatars();
  void reloadOptions();
  return { open, close, selected: () => selectedId, refresh: reloadOptions };
}
