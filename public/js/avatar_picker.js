/* Rin profile photographs. Browsing never changes the chosen picture. */
export const AVATAR_STORAGE_KEY = 'rin-avatar-choice-v1';

export const AVATAR_OPTIONS = Object.freeze([
  { id: 'original', src: '/avatar.jpg' },
  { id: 'home', src: '/avatars/rin-home.webp' },
  { id: 'walk', src: '/avatars/rin-walk.webp' },
  { id: 'evening', src: '/avatars/rin-evening.webp' },
  { id: 'morning', src: '/avatars/rin-morning.webp' },
  { id: 'work', src: '/avatars/rin-work.webp' }
]);

const optionFor = id => AVATAR_OPTIONS.find(item => item.id === id) || AVATAR_OPTIONS[0];
function savedAvatarId() {
  try { return localStorage.getItem(AVATAR_STORAGE_KEY); }
  catch { return null; }
}
let selectedId = optionFor(savedAvatarId()).id;

export function getSelectedAvatarUrl() {
  return optionFor(selectedId).src;
}

/** Full-screen messenger-style viewer. Runs in the existing, authenticated UI. */
export function initAvatarPicker({ chatRoot = document.getElementById('chat') } = {}) {
  const trigger = document.getElementById('avatarPickerToggle');
  const topAvatar = document.getElementById('avatarTop');
  if (!trigger || !topAvatar) return null;

  // Avoid duplicated listeners when the profile UI is initialized again.
  const existing = document.getElementById('rinAvatarPicker');
  if (existing) return null;

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
  const thumbs = [];
  let viewedIndex = 0;
  let returnFocus = trigger;
  let touchStart = null;

  for (const [index, option] of AVATAR_OPTIONS.entries()) {
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
    thumbs.push(button);
  }

  function refreshAvatars() {
    const src = getSelectedAvatarUrl();
    if (topAvatar.getAttribute('src') !== src) topAvatar.src = src;
    // Existing messages, reloaded archive, voice notes and future messages use one avatar.
    for (const image of chatRoot?.querySelectorAll('.row.her img.avatar.small') || []) {
      if (image.getAttribute('src') !== src) image.src = src;
    }
  }

  function view(index) {
    viewedIndex = (index + AVATAR_OPTIONS.length) % AVATAR_OPTIONS.length;
    const option = AVATAR_OPTIONS[viewedIndex];
    mainPhoto.src = option.src;
    counter.textContent = `${viewedIndex + 1} / ${AVATAR_OPTIONS.length}`;
    thumbs.forEach((button, i) => {
      button.classList.toggle('is-current', i === viewedIndex);
      button.setAttribute('aria-current', String(i === viewedIndex));
    });
    // Browsing a photograph is not a selection. Only the install button saves it.
    const installed = option.id === selectedId;
    install.disabled = installed;
    install.textContent = installed ? 'Установлен' : 'Установить';
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
    selectedId = optionFor(savedAvatarId()).id;
    view(AVATAR_OPTIONS.findIndex(item => item.id === selectedId));
    overlay.hidden = false;
    document.body.classList.add('rin-avatar-picker-open');
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', onKeydown, true);
    closeButton.focus({ preventScroll: true });
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
    if (option.id === selectedId) return;
    selectedId = option.id;
    try { localStorage.setItem(AVATAR_STORAGE_KEY, selectedId); } catch { /* private browsing */ }
    refreshAvatars();
    close();
  });

  // Horizontal gestures on the photograph, without treating vertical movement as a swipe.
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

  // Cross-tab selection sync; the viewer does not change a selected photo on preview.
  window.addEventListener('storage', event => {
    if (event.key !== AVATAR_STORAGE_KEY && event.key !== null) return;
    selectedId = optionFor(savedAvatarId()).id;
    refreshAvatars();
    if (!overlay.hidden) view(viewedIndex);
  });

  // Safe fallback for an incomplete deployment.
  document.addEventListener('error', event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    if (!image.matches('#avatarTop, .row.her img.avatar.small')) return;
    if (image.getAttribute('src') !== '/avatar.jpg') image.src = '/avatar.jpg';
  }, true);

  // chat.js still creates new bubbles with /avatar.jpg: keep them in sync in place.
  if (chatRoot && typeof MutationObserver === 'function') {
    const observer = new MutationObserver(records => {
      const src = getSelectedAvatarUrl();
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

  refreshAvatars();
  return { open, close, selected: () => selectedId };
}
