import { cleanText } from './cognitive-contract.js';

const clamp = (value, min = 0, max = 100, fallback = 50) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
};

const NEGATIVE_SELF_EMOTIONS = new Set(['fatigue', 'sadness', 'frustration', 'irritation', 'hurt', 'disappointment', 'concern']);

export function inspectRelationalConstancy({ innerLife = null, emotionalState = null, relationship = null, mood = null, userText = '', conversationState = 'ongoing' } = {}) {
  const life = innerLife && typeof innerLife === 'object' ? innerLife : {};
  const emotion = emotionalState && typeof emotionalState === 'object' ? emotionalState : {};
  const rel = relationship && typeof relationship === 'object' ? relationship : {};
  const primaryType = cleanText(emotion?.primary?.type, 60).toLowerCase();
  const primaryIntensity = clamp(emotion?.primary?.intensity ?? 0, 0, 100, 0);
  const energy = clamp(life.energy ?? mood?.energy ?? 60, 0, 100, 60);
  const mentalLoad = clamp(life.mentalLoad ?? 42, 0, 100, 42);
  const needForQuiet = clamp(life.needForQuiet ?? 35, 0, 100, 35);
  const desireToShare = clamp(life.desireToShare ?? 48, 0, 100, 48);
  const trust = clamp(rel.trust ?? 55, 0, 100, 55);
  const comfort = clamp(rel.comfort ?? 52, 0, 100, 52);
  const closeness = clamp(rel.closeness ?? 42, 0, 100, 42);
  const vulnerability = clamp(rel.vulnerability ?? 28, 0, 100, 28);
  const negativeStatePressure = NEGATIVE_SELF_EMOTIONS.has(primaryType) ? primaryIntensity : 0;
  const statePressure = clamp(Math.max(100 - energy, mentalLoad, needForQuiet, negativeStatePressure), 0, 100, 0);
  const relationalSafety = clamp(42 + trust * 0.2 + comfort * 0.18 + closeness * 0.1 + vulnerability * 0.06, 0, 100, 62);
  const emotionalMaskingPressure = clamp(72 - relationalSafety * 0.72, 0, 100, 26);
  const quietPresencePreferred = needForQuiet >= 62 || energy <= 38;
  const disclosureOpportunity = relationalSafety >= 58 && (desireToShare >= 58 || negativeStatePressure >= 32 || statePressure >= 72);
  const explicitFarewell = conversationState === 'ending' || /(?:спокойной ночи|до завтра|до утра|пока|увидимся|я пош[её]л|я спать)/iu.test(String(userText || ''));

  return {
    schema: 'rin-relational-constancy-v1',
    contactPriority: 94,
    relationalSafety,
    emotionalMaskingPressure,
    vulnerabilityAllowed: relationalSafety >= 52,
    quietPresencePreferred,
    disclosureOpportunity,
    statePressure,
    internal: {
      energy,
      mentalLoad,
      needForQuiet,
      desireToShare,
      primaryEmotion: primaryType || null,
      primaryIntensity: primaryIntensity || 0
    },
    explicitFarewell,
    guidance: explicitFarewell
      ? 'Пользователь явно завершает контакт: уважай завершение сцены; relational constancy не означает цепляться за разговор.'
      : 'Состояние Рин может менять тон, глубину, темп и степень игривости, но усталость/занятость/потребность в тишине сами по себе не являются причиной отталкивать пользователя или просить написать позже. Рин может честно показать своё состояние и принять поддержку.'
  };
}
