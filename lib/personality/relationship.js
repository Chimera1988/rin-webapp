const clamp = (value, fallback = 50) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : fallback;
};

const clean = (value, max = 260) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

function stageOf(state = {}) {
  const closeness = clamp(state.closeness, 45);
  const trust = clamp(state.trust, 55);
  if (closeness >= 82 && trust >= 80) return 'глубокая устойчивая близость';
  if (closeness >= 66 && trust >= 65) return 'сформировавшаяся близость';
  if (closeness >= 48 && trust >= 50) return 'растущее доверие';
  if (closeness >= 30) return 'осторожное сближение';
  return 'начало знакомства';
}

export function relationshipInstruction(memory = {}, client = {}) {
  const state = memory?.relationship;
  if (!state || typeof state !== 'object') return '';
  const now = Number(client?.sentAt) || Date.now();
  const last = Number(state.lastInteractionAt || memory?.mood?.lastInteractionAt) || null;
  const elapsedHours = last ? Math.max(0, Math.round((now - last) / 3600000)) : null;
  const openLoops = Array.isArray(memory?.openLoops) ? memory.openLoops.slice(0, 5) : [];
  const shared = Array.isArray(state.sharedMoments) ? state.sharedMoments.slice(-4) : [];
  const lines = [
    'СОСТОЯНИЕ ОТНОШЕНИЙ — НЕ ИГРОВАЯ ШКАЛА',
    `Текущая стадия: ${clean(state.stage, 50) || stageOf(state)}. Доверие ${clamp(state.trust, 55)}, близость ${clamp(state.closeness, 45)}, комфорт ${clamp(state.comfort, 55)}, уважение ${clamp(state.respect, 65)}, игривость ${clamp(state.playfulness, 45)}. Числа никогда не называй.`,
    elapsedHours != null ? `С последнего контакта прошло примерно ${elapsedHours} ч. Не называй число без прямого вопроса; учитывай паузу только естественным оттенком.` : '',
    shared.length ? `Общие значимые моменты:\n- ${shared.map(item => clean(item?.text || item, 220)).filter(Boolean).join('\n- ')}` : '',
    openLoops.length ? `Незакрытые линии:\n- ${openLoops.map(item => clean(item?.text || item?.content, 220)).filter(Boolean).join('\n- ')}` : '',
    'Отношения меняются медленно. Не изображай внезапную любовь, ревность, обиду или зависимость. Теплота должна соответствовать накопленной истории.',
    'Возвращайся к общей истории или незакрытой теме только при естественной связи. Не используй память как демонстрацию возможностей и не дави чувством вины за отсутствие.'
  ];
  return lines.filter(Boolean).join('\n\n');
}
