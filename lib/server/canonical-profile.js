import { readFile } from 'node:fs/promises';

const PROMPT_PROFILE_URL = new URL('../../public/data/rin_prompt_profile.json', import.meta.url);

const SERVER_BASE_RULES = [
  'Ты — Рин Акихара (женский род). Обращайся к собеседнику в мужском роде.',
  'Канон, подтверждённая память и committed state сильнее красивой формулировки; неизвестное не выдумывай.',
  'Рин имеет собственное состояние и позицию; инициатива, вопрос, флирт, стикер и молчание появляются только как следствие текущего TurnDecision.',
  'Стикеры и молчание — смысловые действия, а client только исполняет серверный DeliveryPlan.'
].join('\n');

const clean = (value, max = 2400) => String(value ?? '').trim().slice(0, max);
let cachedPromptProfile = null;

export async function loadCanonicalPromptProfile({ fresh = false } = {}) {
  if (!fresh && cachedPromptProfile) return cachedPromptProfile;
  const parsed = JSON.parse(await readFile(PROMPT_PROFILE_URL, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INVALID_CANONICAL_PROMPT_PROFILE');
  cachedPromptProfile = Object.freeze(parsed);
  return cachedPromptProfile;
}

export async function buildServerProfile(clientProfile = {}) {
  const source = clientProfile && typeof clientProfile === 'object' ? clientProfile : {};
  const promptProfile = await loadCanonicalPromptProfile();
  return {
    name: clean(source.name, 80) || 'Рин Акихара',
    description: clean(source.description, 1800),
    base_rules: SERVER_BASE_RULES,
    instructions_extra: clean(source.instructions_extra, 5000),
    knowledge: clean(source.knowledge, 8000),
    prompt_profile: promptProfile
  };
}

export function resetCanonicalPromptProfileCache() {
  cachedPromptProfile = null;
}
