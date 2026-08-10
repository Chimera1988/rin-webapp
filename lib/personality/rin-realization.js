const clean = (value, max = 5000) => String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);

export const REALIZATION_JSON_SCHEMA = {
  name: 'rin_realization',
  strict: true,
  schema: {
    type: 'object', additionalProperties: false, required: ['segments'],
    properties: {
      segments: {
        type: 'array', minItems: 1, maxItems: 3,
        items: {
          type: 'object', additionalProperties: false, required: ['purpose', 'text'],
          properties: {
            purpose: { type: 'string', minLength: 1, maxLength: 120 },
            text: { type: 'string', minLength: 1, maxLength: 5000 }
          }
        }
      }
    }
  }
};

function voiceCard(promptProfile = {}) {
  const voice = promptProfile.voice || {};
  const ref = promptProfile.reference_character || {};
  return [
    clean(voice.description || 'Личный естественный русский чат взрослой Рин.', 900),
    ...(Array.isArray(voice.principles) ? voice.principles.slice(0, 10).map(item => `- ${item}`) : []),
    ...(Array.isArray(ref.voice_notes) ? ref.voice_notes.slice(0, 8).map(item => `- ${item}`) : [])
  ].filter(Boolean).join('\n');
}

export function buildRealizationPrompt({ profile = null, state = null, decision = null, realityBoundary = null } = {}) {
  const promptProfile = profile?.prompt_profile || {};
  const textSegments = (decision?.delivery?.segments || []).filter(item => item.type === 'text');
  return {
    system: [
      'RIN REALIZATION v1 — ТОЛЬКО ФОРМУЛИРОВКА УЖЕ ПРИНЯТОГО РЕШЕНИЯ.',
      'Не меняй act, intent, delivery, количество текстовых beats, вопросный режим или факты. Не добавляй новую цель.',
      `Решение:\n${JSON.stringify({
        act: decision?.act,
        focus: decision?.focus,
        stance: decision?.stance,
        question: decision?.question,
        realityMode: decision?.realityMode,
        textSegments
      })}`,
      `State для тона и конкретики:\n${JSON.stringify({
        scene: state?.scene,
        emotion: state?.emotion,
        relationship: state?.relationship,
        relevantMemory: state?.relevantMemory,
        canonicalContext: state?.lore,
        innerLife: state?.innerLife,
        replyTarget: state?.replyTarget,
        environment: state?.environment,
        userEvents: state?.userEvents
      }).slice(0, 12000)}`,
      'Голос Рин:',
      voiceCard(promptProfile),
      'Практические правила:',
      '- Пиши как сообщение в личном мессенджере, не как AI-ассистент и не как литературный анализ разговора.',
      '- Конкретная реакция лучше абстрактного «это важно/приятно/интересно».',
      '- Не пересказывай пользователя и не объясняй отношения со стороны; проявляй их поведением.',
      '- Тёплая сцена не означает обязательный флирт. Флирт только если он уже следует из TurnDecision/state.',
      '- Если question.mode=none — ни одного вопросительного предложения. natural/required — максимум один содержательный вопрос во всём delivery.',
      '- Каждый text segment реализует только свой purpose и должен быть самостоятельным пузырём.',
      '- Не придумывай названия книг, места, завершившиеся действия или прошлые события Рин, которых нет в state/canon/relevant memory.',
      realityBoundary?.mode === 'shared_imagination' || decision?.realityMode === 'explicit_fiction'
        ? '- Явную фантазию можно писать свободнее, но сохраняй понятную условность/историйность и не превращай её в биографический факт.'
        : '- Реальные автобиографические детали должны иметь источник.'
    ].filter(Boolean).join('\n\n'),
    responseFormat: { type: 'json_schema', json_schema: REALIZATION_JSON_SCHEMA }
  };
}

export function parseRealization(content = '', decision = null) {
  const parsed = typeof content === 'string' ? JSON.parse(content) : content;
  const wanted = (decision?.delivery?.segments || []).filter(item => item.type === 'text');
  const raw = Array.isArray(parsed?.segments) ? parsed.segments : [];
  const segments = wanted.map((plan, index) => ({
    type: 'text',
    purpose: plan.purpose,
    text: clean(raw[index]?.text, plan.maxChars || 5000).slice(0, plan.maxChars || 5000)
  })).filter(item => item.text);
  return { segments };
}
