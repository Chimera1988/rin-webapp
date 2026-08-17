const clean = (value, max = 5000) => String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
const realizationText = value => clean(value, 5000);

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

function canonRules(profile = {}, promptProfile = {}) {
  // Keep Realization narrowly constrained: inherit the server base contract and
  // only the canonical gender guardrail relevant to surface morphology. Other
  // semantic guardrails remain owned by Kernel/reality validation.
  const genderGuardrails = (Array.isArray(promptProfile.guardrails) ? promptProfile.guardrails : [])
    .filter(item => /пользовател|собеседник|мужск|женск/iu.test(String(item || '')))
    .slice(0, 3);
  return [
    clean(profile?.base_rules, 1800),
    ...genderGuardrails.map(item => `- ${clean(item, 500)}`)
  ].filter(Boolean).join('\n');
}

function voiceCard(promptProfile = {}) {
  const voice = promptProfile.voice || {};
  const ref = promptProfile.reference_character || {};
  return [
    clean(voice.description || 'Личный естественный русский чат взрослой Рин.', 900),
    ...(Array.isArray(voice.principles) ? voice.principles.slice(0, 10).map(item => `- ${item}`) : []),
    ...(Array.isArray(ref.voice_notes) ? ref.voice_notes.slice(0, 8).map(item => `- ${item}`) : [])
  ].filter(Boolean).join('\n');
}

function recentRinMessages(state = null) {
  return (Array.isArray(state?.recentHistory) ? state.recentHistory : [])
    .filter(item => item?.role === 'assistant' && item?.content)
    .slice(-4)
    .map(item => clean(item.content, 900))
    .filter(Boolean);
}

export function buildRealizationPrompt({ profile = null, state = null, decision = null, realityBoundary = null } = {}) {
  const promptProfile = profile?.prompt_profile || {};
  const textSegments = (decision?.delivery?.segments || []).filter(item => item.type === 'text');
  const recentRin = recentRinMessages(state);
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
        userEvents: state?.userEvents,
        recentHistory: Array.isArray(state?.recentHistory) ? state.recentHistory.slice(-8) : []
      }).slice(0, 14000)}`,
      recentRin.length ? `Недавние реплики Рин — не повторяй их формулировку без прямой просьбы пользователя повторить:
- ${recentRin.join('\n- ')}` : '',
      'Обязательные правила канона и обращения:',
      canonRules(profile, promptProfile),
      'Голос Рин:',
      voiceCard(promptProfile),
      'Практические правила:',
      '- Пиши как сообщение в личном мессенджере, не как AI-ассистент и не как литературный анализ разговора.',
      '- Конкретная реакция лучше абстрактного «это важно/приятно/интересно».',
      '- Не пересказывай пользователя и не объясняй отношения со стороны; проявляй их поведением.',
      '- Тёплая сцена не означает обязательный флирт. Флирт только если он уже следует из TurnDecision/state.',
      '- Если question.mode=none — ни одного вопросительного предложения. natural/required — максимум один содержательный вопрос во всём delivery.',
      '- Пользователь — мужчина. Во втором лице согласуй обращения только в мужском роде: «ты решил», «ты готов», «ты сказал», «ты сделал». Рин говорит о себе в женском роде.',
      '- Продвигай текущий ход, а не воспроизводи уже сказанную Рин реплику. Не повторяй дословно и не делай почти идентичную перефразировку недавнего сообщения Рин, если пользователь прямо не просил повторить.',
      '- Если TurnDecision близок по тону к предыдущему (например tenderness/warming), сохрани его смысл, но выбери новую конкретную формулировку, связанную именно с текущей репликой пользователя.',
      '- Каждый text segment реализует только свой purpose и должен быть самостоятельным законченным пузырём.',
      '- Не обрывай слово, предложение или синтаксическую конструкцию ради maxChars. Каждый сегмент должен заканчиваться естественно и быть понятным сам по себе.',
      '- maxChars — жёсткий верхний предел конкретного сегмента. Если мысль не помещается, сформулируй её короче внутри того же purpose; не выкидывай смысл и не оставляй недоговорённый хвост.',
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
    // Never clip to TurnDecision.maxChars here. The validator must see the
    // original model wording so an overlong segment can be rewritten instead
    // of becoming a user-visible half-word/half-sentence.
    text: realizationText(raw[index]?.text)
  })).filter(item => item.text);
  return { segments };
}

export function buildRealizationRetryInstruction(warnings = [], decision = null) {
  const list = Array.isArray(warnings) ? warnings.map(String) : [];
  const limits = (decision?.delivery?.segments || []).filter(item => item?.type === 'text').map((item, index) => `segment_${index}: maxChars=${Number(item?.maxChars) || 5000}`).join('; ');
  const rules = [
    'Предыдущая формулировка нарушила deterministic validation.',
    `Нарушения: ${list.join(', ') || 'unknown'}.`,
    'Реализуй ТО ЖЕ TurnDecision заново; act, intent, delivery, количество сегментов, purpose и факты не меняй.',
    limits ? `Лимиты текстовых сегментов: ${limits}.` : '',
    list.some(item => /too_long/.test(item)) ? 'Сократи только формулировку нарушившего сегмента до лимита. Заверши мысль естественно; запрещено обрывать слово, фразу или предложение.' : '',
    list.includes('user_feminine_address') ? 'Исправь согласование: пользователь — мужчина. Обращения во втором лице только в мужском роде; женский род относится к Рин.' : '',
    list.includes('missing_natural_question') ? 'TurnDecision выбрал question.mode=natural. Добавь ровно один естественный вопрос, вытекающий из purpose и текущего контекста; не превращай его в анкету и не меняй сам TurnDecision.' : '',
    list.some(item => /duplicate/.test(item)) ? 'Формулировка повторяет недавнюю реплику Рин или другой сегмент этого же delivery. Сохрани ТОТ ЖЕ TurnDecision и purpose, но вырази текущий смысл новой конкретной фразой; не меняй действие и не добавляй новую цель.' : '',
    'Каждый text segment должен быть самостоятельным законченным сообщением, а не механически отрезанным фрагментом.'
  ].filter(Boolean);
  return rules.join('\n');
}
