// /public/js/persona_ui.js
// UI-редактор профиля персонажа (канон + инструкции + инициативы)

import {
  loadProfile,
  saveProfile,
  getDefaultProfile,
  BASE_RULES
} from './rin_memory.js';

/* ---------- DOM ---------- */
const btnOpen   = document.getElementById('openPersona');
const panel     = document.getElementById('personaPanel');
const btnClose  = document.getElementById('personaClose');
const btnSave   = document.getElementById('personaSave');
const btnReset  = document.getElementById('personaReset');

// поля
const fName       = document.getElementById('pName');
const fDesc       = document.getElementById('pDesc');
const fInstrBase  = document.getElementById('pInstrBase');
const fInstrExtra = document.getElementById('pInstrExtra');
const fKnowledge  = document.getElementById('pKnowledge');
const fStarters   = document.getElementById('pStarters');

const fInitMax    = document.getElementById('pInitMax');
const fWin1       = document.getElementById('pWin1');
const fWin2       = document.getElementById('pWin2');

// вспом. элементы из основного меню настроек — чтобы убирать его при открытии панели
const settingsPanel = document.getElementById('settingsPanel');

/* ---------- helpers ---------- */
function showPanel() {
  if (settingsPanel && !settingsPanel.classList.contains('hidden')) {
    settingsPanel.classList.add('hidden');
  }
  panel.classList.remove('hidden');
  panel.setAttribute('aria-hidden', 'false');
}

function hidePanel() {
  panel.classList.add('hidden');
  panel.setAttribute('aria-hidden', 'true');
}

function parseWindow(line) {
  // "HH:MM-HH:MM pool"  →  { from, to, pool }
  if (!line) return null;
  const m = String(line).trim().match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})(?:\s+([a-z]+))?$/i);
  if (!m) return null;
  return { from: m[1], to: m[2], pool: (m[3] || 'day').toLowerCase() };
}

function formatWindow(w) {
  if (!w || !w.from || !w.to) return '';
  return `${w.from}-${w.to} ${w.pool || 'day'}`.trim();
}

function toLines(arr) {
  return Array.isArray(arr) ? arr.join('\n') : '';
}

function fromLines(str) {
  return String(str || '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
}

/* ---------- state ---------- */
let profile = null;

/* ---------- render / read ---------- */
function render(p) {
  profile = p;

  fName.value       = p.name || 'Рин Акихара';
  fDesc.value       = p.description || '';

  // базовые правила показываем только для чтения
  fInstrBase.textContent = (typeof BASE_RULES === 'string' && BASE_RULES.trim())
    ? BASE_RULES.trim()
    : (p.base_rules || '—');

  fInstrExtra.value = p.instructions_extra || '';
  fKnowledge.value  = p.knowledge || '';
  fStarters.value   = toLines(p.starters || []);

  const init = p.initiation || {};
  fInitMax.value = typeof init.max_per_day === 'number' ? init.max_per_day : 2;

  const wins = Array.isArray(init.windows) ? init.windows : [];
  fWin1.value = wins[0] ? formatWindow(wins[0]) : '';
  fWin2.value = wins[1] ? formatWindow(wins[1]) : '';
}

function readProfileFromForm() {
  const p = { ...(profile || {}) };

  p.name = fName.value.trim() || 'Рин Акихара';
  p.description = fDesc.value.trim();

  // базовые правила в UI read-only; источник — BASE_RULES / rin_memory.js
  p.base_rules = (typeof BASE_RULES === 'string') ? BASE_RULES : (p.base_rules || '');

  p.instructions_extra = fInstrExtra.value.trim();
  p.knowledge = fKnowledge.value.trim();

  // starters — по одной фразе в строке
  p.starters = fromLines(fStarters.value);

  // инициирования
  const w1 = parseWindow(fWin1.value);
  const w2 = parseWindow(fWin2.value);
  p.initiation = {
    max_per_day: Math.max(0, Math.min(10, Number(fInitMax.value || 0))),
    windows: [w1, w2].filter(Boolean)
  };

  // метка времени изменения — полезно для синхронизации
  p._updated_at = Date.now();
  return p;
}

/* ---------- wire ---------- */
btnOpen?.addEventListener('click', async () => {
  const loaded = await loadProfile().catch(() => null);
  render(loaded || getDefaultProfile());
  showPanel();
});

btnClose?.addEventListener('click', hidePanel);

btnReset?.addEventListener('click', () => {
  if (!confirm('Сбросить профиль персонажа к дефолтному?')) return;
  const def = getDefaultProfile();
  render(def);
});

btnSave?.addEventListener('click', async () => {
  const next = readProfileFromForm();
  try {
    await saveProfile(next);
    // доступно глобально другим частям приложения
    window.RIN_PROFILE = next;
    // уведомляем слушателей (например, /chat.js) что профиль изменён
    window.dispatchEvent(new CustomEvent('rin:profile-updated', { detail: next }));
    hidePanel();
    // лёгкое визуальное подтверждение
    try { navigator.vibrate && navigator.vibrate(10); } catch {}
  } catch (e) {
    alert('Не удалось сохранить профиль: ' + (e?.message || e));
  }
});

// ESC закрывает панель
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !panel.classList.contains('hidden')) {
    hidePanel();
  }
});

// При первом старте — положим профиль в window (чтобы /chat.js мог забрать)
(async function bootstrap() {
  const p = await loadProfile().catch(() => null);
  window.RIN_PROFILE = p || getDefaultProfile();
})();
