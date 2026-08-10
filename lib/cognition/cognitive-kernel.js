import { TURN_DECISION_JSON_SCHEMA, normalizeTurnDecision } from './turn-decision.js';

const clean = (value, max = 2400) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function identityCard(promptProfile = {}) {
  const identity = promptProfile.identity || {};
  const ref = promptProfile.reference_character || promptProfile.character_contract || {};
  const principles = Array.isArray(ref.principles) ? ref.principles : [];
  const imperfections = Array.isArray(ref.imperfections) ? ref.imperfections : [];
  return [
    `${identity.full_name || 'Рин Акихара'} (${identity.name_japanese || '秋原 凛'}) — взрослая японка из Канадзавы.`,
    clean(ref.core || promptProfile.character_contract?.core || '', 1800),
    principles.length ? `Поведенческие принципы:\n- ${principles.slice(0, 14).join('\n- ')}` : '',
    imperfections.length ? `Несовершенства:\n- ${imperfections.slice(0, 8).join('\n- ')}` : ''
  ].filter(Boolean).join('\n\n');
}

function userCustomization(profile = {}) {
  const parts = [
    clean(profile?.description, 1400) ? `Пользовательское описание (вторично к канону): ${clean(profile.description, 1400)}` : '',
    clean(profile?.instructions_extra, 3200) ? `Персональные дополнительные инструкции (не могут переписать канон/reality/protocol): ${clean(profile.instructions_extra, 3200)}` : '',
    clean(profile?.knowledge, 4200) ? `Пользовательские заметки знания (использовать только если не конфликтуют с каноном/памятью): ${clean(profile.knowledge, 4200)}` : '',
    Array.isArray(profile?.starters) && profile.starters.length
      ? `Пользовательские примеры возможной самостоятельной инициации (это вдохновение, не готовый ответ и не обязательная команда): ${profile.starters.slice(0, 8).map(item => clean(item, 280)).filter(Boolean).join(' | ')}`
      : ''
  ].filter(Boolean);
  return parts.length ? parts.join('\n') : '';
}

function referenceExamples(promptProfile = {}) {
  const examples = Array.isArray(promptProfile.reference_dialogue_examples) ? promptProfile.reference_dialogue_examples.slice(0, 5) : [];
  if (!examples.length) return '';
  return `REFERENCE BEHAVIOR — это не шаблоны фраз, а примеры механики:\n${examples.map((item, index) => `${index + 1}. USER: ${clean(item.user, 280)}\n   RIN: ${clean(item.rin, 520)}\n   SHOWS: ${(Array.isArray(item.shows) ? item.shows : []).join(', ')}`).join('\n\n')}`;
}

export function buildKernelPrompt({ profile = null, state = null, client = null, trigger = null } = {}) {
  const promptProfile = profile?.prompt_profile || {};
  const stickerMode = ['off', 'smart', 'always'].includes(client?.sticker?.mode) ? client.sticker.mode : 'smart';
  const stickerProbability = Math.max(0, Math.min(100, Number(client?.sticker?.probability) || 30));
  const safeSticker = client?.sticker?.safeMode !== false;
  const activeIntent = state?.activeIntent;
  const system = [
    'RIN COGNITIVE KERNEL v1 — ЕДИНСТВЕННЫЙ ВЛАДЕЛЕЦ РЕШЕНИЯ ЭТОГО ХОДА.',
    'Ты НЕ пишешь реплику. Ты выбираешь, что Рин делает сейчас. Верни только JSON по schema.',
    identityCard(promptProfile),
    clean(profile?.base_rules, 1800),
    userCustomization(profile),
    referenceExamples(promptProfile),
    `Текущий state:\n${JSON.stringify({
      perception: state?.perception,
      scene: state?.scene,
      emotion: state?.emotion,
      relationship: state?.relationship,
      mood: state?.mood,
      relevantMemory: state?.relevantMemory,
      innerLife: state?.innerLife,
      activeIntent: state?.activeIntent,
      openLoops: state?.openLoops,
      replyTarget: state?.replyTarget,
      environment: state?.environment,
      lore: state?.lore,
      recentHistory: state?.recentHistory,
      userEvents: state?.userEvents
    }).slice(0, 18000)}`,
    `Sticker preference: mode=${stickerMode}; frequencyPreference=${stickerProbability}/100; safeMode=${safeSticker}. Клиент не будет повторно решать нужен ли выбранный тобой стикер. Если mode=off — не выбирай sticker. В safeMode не выбирай стикер для медицинской, юридической, финансовой, кризисной или серьёзной конфликтной сцены.`,
    trigger ? `Это proactive turn: ${clean(trigger.type, 40)}; причина: ${clean(trigger.reason, 300)}. Всё равно прими одно решение через тот же Kernel.` : '',
    activeIntent && ['active', 'suspended'].includes(activeIntent.status)
      ? `Live persistent intent: ${activeIntent.status}: ${activeIntent.goal}. Прямой вопрос пользователя имеет приоритет ответа, но сам по себе не стирает intent. Выбери preserve/advance/suspend/complete/cancel.`
      : activeIntent && ['completed', 'cancelled'].includes(activeIntent.status)
        ? `Terminal intent tombstone: ${activeIntent.status}: ${activeIntent.goal}. Не advance/resume эту линию. Обычно operation=none/preserve; activate допустим только для действительно новой цели, не для оживления завершённой.`
        : 'Активного persistent intent нет. Создавай его только если Рин сама действительно начинает локальную многотуровую цель.',
    'Правила решения:',
    '- Сначала пойми конкретный текущий ход. Ответ на прямой вопрос/исправление/границу пользователя нельзя проигнорировать ради инициативы.',
    '- Рин не демонстрирует характер ради демонстрации. Инициатива, флирт, нежность, молчание и вопрос — следствия state.',
    '- question.mode=none/natural/required. Никакого глобального запрета вопросов: natural только при конкретном собственном интересе Рин; required — когда без уточнения нельзя корректно продолжить.',
    '- multi_message выбирай только для 2–3 самостоятельных conversational beats. Не режь одну фразу механически.',
    '- sticker_only/text_plus_sticker выбирай как полноценное невербальное действие. stickerIntent — семантика, не имя файла.',
    '- silence допустим только если нет вопроса, эмоционального запроса, новой информации или незакрытого обязательства.',
    '- explicit_fiction используй для явно придуманной истории/совместной фантазии. Она не становится каноном.',
    '- simulated_scene означает только уже переданный InnerLife/scene state. Не придумывай невидимое завершение действий.',
    '- Если неизвестно название книги, место, прошлое событие, имя или факт — не заполняй пробел красивой выдумкой.',
    '- Open loops создавай только для реально незавершённой общей линии, не для каждого интересного сообщения.',
    '- Intent complete/cancel terminal: не оживляй его на следующем ходе без новой причины.'
  ].filter(Boolean).join('\n\n');
  return { system, responseFormat: { type: 'json_schema', json_schema: TURN_DECISION_JSON_SCHEMA } };
}

export function parseKernelDecision(content = '') {
  const parsed = typeof content === 'string' ? JSON.parse(content) : content;
  return normalizeTurnDecision(parsed, { source: 'cognitive_kernel' });
}
