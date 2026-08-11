// User-owned persona overrides. Canonical identity, rules, lore and proactive
// timing are server/runtime-owned and intentionally not editable here.

import { getDefaultProfile, loadProfile, saveProfile } from './rin_memory.js';

const btnOpen = document.getElementById('openPersona');
const panel = document.getElementById('personaPanel');
const btnClose = document.getElementById('personaClose');
const btnSave = document.getElementById('personaSave');
const btnReset = document.getElementById('personaReset');
const fDesc = document.getElementById('pDesc');
const fInstrExtra = document.getElementById('pInstrExtra');
const fKnowledge = document.getElementById('pKnowledge');
const settingsPanel = document.getElementById('settingsPanel');

let profile = null;

function showPanel() {
  if (settingsPanel && !settingsPanel.classList.contains('hidden')) settingsPanel.classList.add('hidden');
  panel?.classList.remove('hidden');
  panel?.setAttribute('aria-hidden', 'false');
}

function hidePanel() {
  panel?.classList.add('hidden');
  panel?.setAttribute('aria-hidden', 'true');
}

function render(value) {
  profile = value || getDefaultProfile();
  if (fDesc) fDesc.value = profile.description || '';
  if (fInstrExtra) fInstrExtra.value = profile.instructions_extra || '';
  if (fKnowledge) fKnowledge.value = profile.knowledge || '';
}

function readProfileFromForm() {
  return {
    ...(profile || getDefaultProfile()),
    description: String(fDesc?.value || '').trim(),
    instructions_extra: String(fInstrExtra?.value || '').trim(),
    knowledge: String(fKnowledge?.value || '').trim(),
    _updated_at: Date.now()
  };
}

async function publishProfile(next) {
  const saved = await saveProfile(next);
  render(saved);
  window.RIN_PROFILE = saved;
  window.dispatchEvent(new CustomEvent('rin:profile-updated', { detail: saved }));
  return saved;
}

btnOpen?.addEventListener('click', async () => {
  render(await loadProfile().catch(() => getDefaultProfile()));
  showPanel();
});

btnClose?.addEventListener('click', hidePanel);

btnReset?.addEventListener('click', async () => {
  if (!confirm('Сбросить пользовательские дополнения к профилю? Канон и системные правила не изменяются.')) return;
  try {
    await publishProfile(getDefaultProfile());
  } catch {
    alert('Не удалось сбросить профиль. Проверь доступность локального хранилища.');
  }
});

btnSave?.addEventListener('click', async () => {
  try {
    await publishProfile(readProfileFromForm());
    hidePanel();
    try { navigator.vibrate?.(10); } catch {}
  } catch (error) {
    alert('Не удалось сохранить профиль: ' + (error?.message || error));
  }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && panel && !panel.classList.contains('hidden')) hidePanel();
});

(async function bootstrap() {
  window.RIN_PROFILE = await loadProfile().catch(() => getDefaultProfile());
})();
