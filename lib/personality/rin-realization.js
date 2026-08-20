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
    .slice(-3)
    .map(item => clean(item.content, 700))
    .filter(Boolean);
}

function compactRealizationContext(state = null) {
  return {
    userText: clean(state?.userText, 1600),
    perception: state?.perception ? {
      literalMeaning: clean(state.perception.literalMeaning, 120),
      implicitMeaning: clean(state.perception.implicitMeaning, 120),
      relationToPreviousTurn: clean(state.perception.relationToPreviousTurn, 120),
      signals: Array.isArray(state.perception.signals) ? state.perception.signals.slice(0, 6) : []
    } : null,
    scene: state?.scene ? {
      type: clean(state.scene.type, 80),
      topic: clean(state.scene.topic, 320),
      continuityStrength: state.scene.continuityStrength ?? null,
      turnsInScene: state.scene.turnsInScene ?? null
    } : null,
    emotion: state?.emotion || null,
    mood: state?.mood || null,
    relationship: state?.relationship ? {
      closeness: state.relationship.closeness ?? null,
      trust: state.relationship.trust ?? null,
      comfort: state.relationship.comfort ?? null,
      playfulness: state.relationship.playfulness ?? null
    } : null,
    relevantMemory: Array.isArray(state?.relevantMemory) ? state.relevantMemory.slice(0, 4) : state?.relevantMemory || null,
    innerLife: state?.innerLife ? {
      activity: clean(state.innerLife.activity, 180),
      activityGoal: clean(state.innerLife.activityGoal, 220),
      emotionalTone: clean(state.innerLife.emotionalTone, 180),
      realityMode: clean(state.innerLife.realityMode, 80)
    } : null,
    activeIntent: state?.activeIntent ? {
      status: clean(state.activeIntent.status, 40),
      goal: clean(state.activeIntent.goal, 280),
      nextMove: clean(state.activeIntent.nextMove, 220),
      progress: state.activeIntent.progress ?? null
    } : null,
    openLoops: Array.isArray(state?.openLoops) ? state.openLoops.slice(0, 4) : state?.openLoops || null,
    replyTarget: state?.replyTarget || null,
    environment: state?.environment || null,
    lore: state?.lore ? {
      canon: Array.isArray(state.lore.canon) ? state.lore.canon.slice(0, 2) : [],
      memories: Array.isArray(state.lore.memories) ? state.lore.memories.slice(0, 1) : [],
      backstory: Array.isArray(state.lore.backstory) ? state.lore.backstory.slice(0, 1) : []
    } : null,
    recentHistory: Array.isArray(state?.recentHistory) ? state.recentHistory.slice(-5) : [],
    userEvents: Array.isArray(state?.userEvents) ? state.userEvents.slice(-3) : []
  };
}

function decisionSnapshot(decision = null) {
  return {
    act: decision?.act,
    focus: decision?.focus,
    stance: decision?.stance,
    question: decision?.question,
    realityMode: decision?.realityMode,
    delivery: (decision?.delivery?.segments || []).map(segment => ({
      type: segment?.type,
      purpose: segment?.purpose,
      maxChars: segment?.maxChars,
      stickerIntent: segment?.stickerIntent || null
    }))
  };
}

function realizationResponseFormat() {
  return { type: 'json_schema', json_schema: REALIZATION_JSON_SCHEMA };
}

export function buildRealizationPrompt({ profile = null, state = null, decision = null, realityBoundary = null } = {}) {
  const promptProfile = profile?.prompt_profile || {};
  const recentRin = recentRinMessages(state);
  const realizationState = compactRealizationContext(state);
  return {
    system: [
      'RIN REALIZATION v1 — ТОЛЬКО ФОРМУЛИРОВКА УЖЕ ПРИНЯТОГО РЕШЕНИЯ.',
      'Не меняй act, intent, delivery, количество текстовых beats, вопросный режим или факты. Не добавляй новую цель.',
      `Решение (не переосмысливай):\n${JSON.stringify(decisionSnapshot(decision))}`,
      `Компактный контекст для тона и конкретики:\n${JSON.stringify(realizationState).slice(0, 9000)}`,
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
    responseFormat: realizationResponseFormat()
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

export function buildRealizationRetryPrompt({ profile = null, decision = null, previousRealization = null, previousValidation = null, attempt = 1 } = {}) {
  const promptProfile = profile?.prompt_profile || {};
  const warnings = Array.isArray(previousValidation?.rewriteableWarnings)
    ? previousValidation.rewriteableWarnings.map(String)
    : Array.isArray(previousValidation?.warnings) ? previousValidation.warnings.map(String) : [];
  const textPlans = (decision?.delivery?.segments || []).filter(item => item?.type === 'text');
  const previous = previousRealization && typeof previousRealization === 'object'
    ? clean(JSON.stringify(previousRealization), 5200)
    : '';
  const limits = textPlans.map((item, index) => `segment_${index}: maxChars=${Number(item?.maxChars) || 5000}`).join('; ');
  const ruleLines = [
    'RIN REALIZATION REPAIR v1 — исправь только уже сформированный текст.',
    'TurnDecision уже принят и НЕ подлежит изменению.',
    `Номер исправления: ${Math.max(1, Number(attempt) || 1)}/1.`,
    `TurnDecision: ${JSON.stringify(decisionSnapshot(decision))}`,
    `Нарушения: ${warnings.join(', ') || 'unknown'}.`,
    limits ? `Лимиты: ${limits}.` : '',
    previous ? `Предыдущий отклонённый результат:
${previous}` : '',
    'Сохрани количество text segments, purpose, act, focus, stance, question.mode и все факты. Не добавляй новый conversational beat.',
    warnings.includes('unplanned_question') ? 'question.mode=none: убери вопросительную конструкцию, сохранив исходный смысл.' : '',
    warnings.includes('too_many_questions') ? 'Оставь максимум один вопрос и только если его допускает TurnDecision.' : '',
    warnings.includes('missing_natural_question') ? 'Добавь ровно один естественный вопрос, только если question.mode=natural.' : '',
    warnings.includes('missing_required_question') ? 'Добавь ровно один необходимый вопрос, только если question.mode=required.' : '',
    warnings.includes('user_feminine_address') ? 'Пользователь — мужчина: исправь только род обращения к нему.' : '',
    warnings.some(item => /too_long/.test(item)) ? 'Сократи нарушивший сегмент, не теряя смысл и не обрывая предложение.' : '',
    warnings.some(item => /unfinished/.test(item)) ? 'Заверши нарушивший сегмент естественно.' : '',
    warnings.some(item => /duplicate/.test(item)) ? 'Сохрани смысл текущего TurnDecision, но используй новую формулировку вместо повтора.' : '',
    'Голос: личный русский чат взрослой Рин; конкретно, тепло и естественно. Не объясняй процесс исправления.'
  ].filter(Boolean);
  const voice = voiceCard(promptProfile);
  if (voice) ruleLines.push(`Краткая voice card:\n${clean(voice, 1800)}`);
  return { system: ruleLines.join('\n\n'), responseFormat: realizationResponseFormat() };
}

// Kept as a compatibility export for existing callers/tests; runtime uses the compact retry prompt above.
export function buildRealizationRetryInstruction(warnings = [], decision = null, previousRealization = null, rewriteAttempt = 1) {
  const result = buildRealizationRetryPrompt({
    decision,
    previousRealization,
    previousValidation: { warnings, rewriteableWarnings: warnings },
    attempt: rewriteAttempt
  });
  return result.system;
}
