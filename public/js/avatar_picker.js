/* Rin avatar gallery: presentation only. No changes to personality or chat payloads. */
export const AVATAR_STORAGE_KEY = 'rin-avatar-choice-v1';

export const AVATAR_OPTIONS = Object.freeze([
  { id: 'original', label: 'Оригинал', src: '/avatar.jpg' },
  { id: 'home', label: 'Домашний', src: '/avatars/rin-home.webp' },
  { id: 'walk', label: 'Прогулка', src: '/avatars/rin-walk.webp' },
  { id: 'evening', label: 'Вечер', src: '/avatars/rin-evening.webp' },
  { id: 'morning', label: 'Утро', src: '/avatars/rin-morning.webp' },
  { id: 'work', label: 'За работой', src: '/avatars/rin-work.webp' }
]);

const findAvatar = id => AVATAR_OPTIONS.find(item => item.id === id) || AVATAR_OPTIONS[0];
function storedAvatarId() {
  try { return localStorage.getItem(AVATAR_STORAGE_KEY); } catch { return null; }
}
let selectedId = findAvatar(storedAvatarId()).id;

export function getSelectedAvatarUrl() {
  return findAvatar(selectedId).src;
}

/** Attach a selectable, accessible gallery to the existing header avatar. */
export function initAvatarPicker({ chatRoot = document.getElementById('chat') } = {}) {
  const trigger = document.getElementById('avatarPickerToggle');
  const topAvatar = document.getElementById('avatarTop');
  if (!trigger || !topAvatar) return null;

  const overlay = document.createElement('div');
  overlay.id = 'rinAvatarPicker';
  overlay.className = 'rin-avatar-picker';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'rinAvatarPickerTitle');
  overlay.innerHTML = `
    <div class="rin-avatar-picker__backdrop" data-close-avatar-picker></div>
    <section class="rin-avatar-picker__sheet" aria-label="Галерея аватаров">
      <div class="rin-avatar-picker__handle" aria-hidden="true"></div>
      <header class="rin-avatar-picker__head">
        <div>
          <h2 id="rinAvatarPickerTitle">Образ Рин</h2>
          <p>Выбери, какой аватар будет в переписке</p>
        </div>
        <button type="button" class="rin-avatar-picker__close" data-close-avatar-picker aria-label="Закрыть выбор аватара">✕</button>
      </header>
      <div class="rin-avatar-picker__grid" role="group" aria-label="Доступные образы Рин"></div>
    </section>`;
  document.body.appendChild(overlay);
  const grid = overlay.querySelector('.rin-avatar-picker__grid');
  const choices = new Map();
  let returnFocus = trigger;

  for (const option of AVATAR_OPTIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rin-avatar-picker__choice';
    button.dataset.avatarId = option.id;
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', `Выбрать: ${option.label}`);
    const picture = document.createElement('img');
    picture.src = option.src;
    picture.alt = '';
    picture.loading = 'lazy';
    picture.decoding = 'async';
    const label = document.createElement('span');
    label.className = 'rin-avatar-picker__label';
    label.textContent = option.label;
    const tick = document.createElement('span');
    tick.className = 'rin-avatar-picker__tick';
    tick.textContent = '✓';
    tick.setAttribute('aria-hidden', 'true');
    button.append(picture, label, tick);
    button.addEventListener('click', () => {
      selectedId = option.id;
      try { localStorage.setItem(AVATAR_STORAGE_KEY, option.id); } catch { /* private mode */ }
      refreshAvatars();
      closePicker();
    });
    choices.set(option.id, button);
    grid.appendChild(button);
  }

  function refreshAvatars() {
    const src = getSelectedAvatarUrl();
    if (topAvatar.getAttribute('src') !== src) topAvatar.src = src;
    // Update currently rendered and archived message bubbles, not only future replies.
    for (const img of chatRoot?.querySelectorAll('.row.her img.avatar.small') || []) {
      if (img.getAttribute('src') !== src) img.src = src;
    }
    for (const [id, button] of choices) {
      const active = id === selectedId;
      button.classList.toggle('is-selected', active);
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute('aria-label', `${findAvatar(id).label}${active ? ', выбран' : ', выбрать'}`);
    }
  }

  function closePicker() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    document.body.classList.remove('rin-avatar-picker-open');
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', handlePickerKey, true);
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }

  function handlePickerKey(event) {
    if (overlay.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      closePicker();
    } else if (event.key === 'Tab') {
      // Keep keyboard focus inside the modal when navigating with Tab.
      const focusable = [...overlay.querySelectorAll('button:not([disabled])')];
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      }
    }
  }

  function openPicker() {
    if (!overlay.hidden) return;
    returnFocus = document.activeElement;
    document.activeElement?.blur?.(); // close iOS keyboard if it was open
    refreshAvatars();
    overlay.hidden = false;
    document.body.classList.add('rin-avatar-picker-open');
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', handlePickerKey, true);
    overlay.querySelector('.rin-avatar-picker__close')?.focus({ preventScroll: true });
  }

  trigger.addEventListener('click', openPicker);
  overlay.querySelectorAll('[data-close-avatar-picker]').forEach(el => {
    el.addEventListener('click', closePicker);
  });

  // When another tab switches the same local avatar, follow that choice.
  window.addEventListener('storage', event => {
    if (event.key !== AVATAR_STORAGE_KEY && event.key !== null) return;
    selectedId = findAvatar(storedAvatarId()).id;
    refreshAvatars();
  });
  // Fallback if an asset fails to load (e.g. during a partial deployment).
  document.addEventListener('error', event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    if (!image.matches('#avatarTop, .row.her img.avatar.small')) return;
    if (image.getAttribute('src') !== '/avatar.jpg') image.src = '/avatar.jpg';
  }, true);

  // chat.js still creates fresh avatar images with /avatar.jpg.
  // Keep new replies, typing indicators, voice notes and restored history
  // in sync without changing chat.js or its message logic.
  if (chatRoot && typeof MutationObserver === 'function') {
    const observer = new MutationObserver(records => {
      const src = getSelectedAvatarUrl();
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          const images = node.matches('.row.her img.avatar.small')
            ? [node]
            : node.querySelectorAll('.row.her img.avatar.small');
          for (const image of images) {
            if (image.getAttribute('src') !== src) image.src = src;
          }
        }
      }
    });
    observer.observe(chatRoot, { childList: true, subtree: true });
  }

  refreshAvatars();
  return { open: openPicker, close: closePicker, selected: () => selectedId };
}
