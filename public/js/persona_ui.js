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
const fInstrBase  = document.getElementById('pInstrBase');   // read-only
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

function clamp(v, min, max){
  v = Number(v);
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

// "HH:MM-HH:MM pool"  →  { from, to, pool }  (или null, если пусто/некорректно)
function parseWindow(line) {
  if (!line) return null;
  const m = String(line).trim().match(/^(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})(?:\s+([a-z]+))?$/i);
  if (!m) return null;

  const h1 = clamp(m[1], 0, 23), min1 = clamp(m[2], 0, 59);
  const h2 = clamp(m[3], 0, 23), min2 = clamp(m[4], 0, 59);

  const from = `${String(h1).padStart(2,'0')}:${String(min1).padStart(2,'0')}`;
  const to   = `${String(h2).padStart(2,'0')}:${String(min2).padStart(2,'0')}`;

  const t1 = h1*60 + min1;
  const t2 = h2*60 + min2;
  if (t2 <= t1) return null; // окно должно быть возрастанием, без "переворота" через полночь

  // нормализуем пул
  const rawPool = (m[5] || 'day').toLowerCase();
  const poolMap = { morning:'morning', day:'day', evening:'evening', night:'night' };
  const pool = poolMap[rawPool] || 'day';

  return { from, to, pool };
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

function setInstrBase(el, text){
  // Поддерживаем и <textarea readonly>, и <pre>/<div>
  if (!el) return;
  const val = (text ?? '').toString().trim();
  if ('value' in el) el.value = val; else el.textContent = val;
}

function markInvalid(el, on=true){
  if (!el) return;
  el.classList.toggle('is-invalid', !!on);
}

/* ---------- state ---------- */
let profile = null;

/* ---------- render / read ---------- */
function render(p) {
  profile = p;

  fName.value       = p.name || 'Рин Акихара';
  fDesc.value       = p.description || '';

  // базовые правила показываем только для чтения (источник — BASE_RULES)
  setInstrBase(fInstrBase, (typeof BASE_RULES === 'string' && BASE_RULES.trim())
    ? BASE_RULES.trim()
    : (p.base_rules || '—'));

  fInstrExtra.value = p.instructions_extra || '';
  fKnowledge.value  = p.knowledge || '';
  fStarters.value   = toLines(p.starters || []);

  const init = p.initiation || {};
  fInitMax.value = typeof init.max_per_day === 'number' ? init.max_per_day : 2;

  const wins = Array.isArray(init.windows) ? init.windows : [];
  fWin1.value = wins[0] ? formatWindow(wins[0]) : '';
  fWin2.value = wins[1] ? formatWindow(wins[1]) : '';

  // снять возможные прошлые подсветки ошибок
  markInvalid(fWin1, false);
  markInvalid(fWin2, false);
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
  markInvalid(fWin1, false);
  markInvalid(fWin2, false);

  const w1 = fWin1.value.trim() ? parseWindow(fWin1.value) : null;
  const w2 = fWin2.value.trim() ? parseWindow(fWin2.value) : null;

  // Подсветка ошибок ввода интервалов
  if (fWin1.value.trim() && !w1) markInvalid(fWin1, true);
  if (fWin2.value.trim() && !w2) markInvalid(fWin2, true);

  if ((fWin1.value.trim() && !w1) || (fWin2.value.trim() && !w2)) {
    alert('Проверь время окон: формат HH:MM-HH:MM [pool]. Пример: 08:30-10:00 morning');
    throw new Error('Invalid windows');
  }

  const windows = [w1, w2].filter(Boolean);

  // сортируем по времени «from»
  windows.sort((a,b)=>{
    const [ah,am] = a.from.split(':').map(Number);
    const [bh,bm] = b.from.split(':').map(Number);
    return (ah*60+am) - (bh*60+bm);
  });

  p.initiation = {
    max_per_day: clamp(fInitMax.value || 0, 0, 10),
    windows
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
  if (!confirm('Сбросить профиль персонажа к настройкам по умолчанию?')) return;
  const def = getDefaultProfile();
  render(def);
});

btnSave?.addEventListener('click', async () => {
  let next;
  try {
    next = readProfileFromForm();
  } catch {
    // ошибки уже показаны/подсвечены
    return;
  }
  try {
    await saveProfile(next);
    // доступно глобально другим частям приложения
    window.RIN_PROFILE = next;
    // уведомляем слушателей (например, /chat.js), что профиль изменён
    window.dispatchEvent(new CustomEvent('rin:profile-updated', { detail: next }));
    hidePanel();
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
