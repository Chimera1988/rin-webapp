import { normalizeRelationshipState } from '../affective-contract.js';

const clamp = (value, fallback = 50) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : fallback;
};
const clean = (value, max = 260) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

export function relationshipInstruction(memory = {}, client = {}, affectiveTurn = null) {
  const state = normalizeRelationshipState(affectiveTurn?.relationshipState || memory?.relationship || {});
  if (!state) return '';
  const now = Number(client?.sentAt) || Date.now();
  const last = Number(memory?.relationship?.lastInteractionAt || memory?.mood?.lastInteractionAt) || null;
  const elapsedHours = last ? Math.max(0, Math.round((now - last) / 3600000)) : null;
  const openLoops = Array.isArray(memory?.openLoops) ? memory.openLoops.slice(0, 5) : [];
  const shared = Array.isArray(state.sharedMoments) ? state.sharedMoments.slice(-4) : [];
  const affect = affectiveTurn?.emotionalState || memory?.conversationState?.emotionalState || null;
  const lines = [
    'СОСТОЯНИЕ ОТНОШЕНИЙ — МЕДЛЕННАЯ ИНЕРЦИЯ, НЕ ИГРОВАЯ ШКАЛА',
    `Текущая стадия: ${clean(state.stage, 50)}. Доверие ${clamp(state.trust, 55)}, близость ${clamp(state.closeness, 45)}, комфорт ${clamp(state.comfort, 55)}, уважение ${clamp(state.respect, 65)}, игривость ${clamp(state.playfulness, 45)}, притяжение ${clamp(state.attraction, 34)}, готовность к уязвимости ${clamp(state.vulnerability, 28)}. Числа никогда не называй.`,
    `Недавняя динамика: ${clean(state.recentDynamic?.lastSignal, 60) || 'neutral'}; восстановление контакта ${state.recentDynamic?.repairPending ? 'ещё не завершено' : 'не требуется'}.`,
    affect?.primary ? `Активная эмоциональная линия: ${affect.primary.type}; причина: ${clean(affect.primary.cause, 300)}; состояние ${affect.primary.resolution}.` : 'Сильной активной эмоциональной линии нет.',
    elapsedHours != null ? `С последнего контакта прошло примерно ${elapsedHours} ч. Не называй число без прямого вопроса.` : '',
    shared.length ? `Общие значимые моменты:\n- ${shared.map(item => clean(item?.text || item, 220)).filter(Boolean).join('\n- ')}` : '',
    openLoops.length ? `Незакрытые линии:\n- ${openLoops.map(item => clean(item?.text || item?.content, 220)).filter(Boolean).join('\n- ')}` : '',
    'Не выдумывай ревность, обиду, любовь или зависимость без причины. Но если canonical emotional state уже содержит такую реакцию, не отрицай её и не сбрасывай нейтральной фразой.',
    'Возвращайся к общей истории только при естественной связи; память не должна звучать как демонстрация базы данных.'
  ];
  return lines.filter(Boolean).join('\n\n');
}
