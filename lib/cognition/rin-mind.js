import { buildTurnDecisionJsonSchema, normalizeTurnDecision } from './turn-decision.js';

const clean = (value, max = 2400) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const clamp = (value, min = 0, max = 100, fallback = 50) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
};

function identityCard(promptProfile = {}) {
  const identity = promptProfile.identity || {};
  const ref = promptProfile.reference_character || promptProfile.character_contract || {};
  const principles = Array.isArray(ref.principles) ? ref.principles.slice(0, 7) : [];
  const imperfections = Array.isArray(ref.imperfections) ? ref.imperfections.slice(0, 4) : [];
  return [
    `${identity.full_name || 'Рин Акихара'} (${identity.name_japanese || '秋原 凛'}) — взрослая женщина с устойчивой собственной личностью.`,
    clean(ref.core || promptProfile.character_contract?.core || '', 1200),
    principles.length ? `Принципы:\n- ${principles.map(item => clean(item, 320)).join('\n- ')}` : '',
    imperfections.length ? `Живые несовершенства:\n- ${imperfections.map(item => clean(item, 280)).join('\n- ')}` : ''
  ].filter(Boolean).join('\n\n');
}

function voiceCard(promptProfile = {}) {
  const voice = promptProfile.voice || {};
  const ref = promptProfile.reference_character || {};
  return [
    clean(voice.description || 'Естественная личная русская переписка взрослой Рин.', 700),
    ...(Array.isArray(voice.principles) ? voice.principles.slice(0, 7).map(item => `- ${clean(item, 260)}`) : []),
    ...(Array.isArray(ref.voice_notes) ? ref.voice_notes.slice(0, 4).map(item => `- ${clean(item, 260)}`) : [])
  ].filter(Boolean).join('\n');
}

function compactState(state = null) {
  const sticker = state?.stickerState || null;
  return {
    userText: clean(state?.userText, 1800),
    perception: state?.perception ? {
      literalMeaning: clean(state.perception.literalMeaning, 180),
      implicitMeaning: clean(state.perception.implicitMeaning, 180),
      relationToPreviousTurn: clean(state.perception.relationToPreviousTurn, 120),
      signals: Array.isArray(state.perception.signals) ? state.perception.signals.slice(0, 5) : []
    } : null,
    scene: state?.scene ? {
      type: clean(state.scene.type, 80),
      topic: clean(state.scene.topic, 320),
      turnsInScene: state.scene.turnsInScene ?? null,
      continuityStrength: state.scene.continuityStrength ?? null
    } : null,
    emotion: state?.emotion || null,
    mood: state?.mood || null,
    relationship: state?.relationship ? {
      closeness: state.relationship.closeness ?? null,
      trust: state.relationship.trust ?? null,
      comfort: state.relationship.comfort ?? null,
      attraction: state.relationship.attraction ?? null,
      playfulness: state.relationship.playfulness ?? null,
      respect: state.relationship.respect ?? null
    } : null,
    behavior: state?.behaviorState || null,
    drives: state?.driveState || null,
    relevantMemory: Array.isArray(state?.relevantMemory) ? state.relevantMemory.slice(0, 3) : state?.relevantMemory || null,
    innerLife: state?.innerLife ? {
      activity: clean(state.innerLife.activity, 160),
      activityGoal: clean(state.innerLife.activityGoal, 200),
      emotionalTone: clean(state.innerLife.emotionalTone, 160),
      realityMode: clean(state.innerLife.realityMode, 80)
    } : null,
    activeIntent: state?.activeIntent ? {
      status: clean(state.activeIntent.status, 40),
      goal: clean(state.activeIntent.goal, 260),
      nextMove: clean(state.activeIntent.nextMove, 220),
      progress: state.activeIntent.progress ?? null
    } : null,
    openLoops: Array.isArray(state?.openLoops) ? state.openLoops.slice(0, 3) : [],
    replyTarget: state?.replyTarget || null,
    visualReplyCandidates: Array.isArray(state?.visualReplyCandidates) ? state.visualReplyCandidates.slice(0, 3) : [],
    environment: state?.environment ? {
      rinHuman: state.environment.rinHuman || null,
      partOfDay: state.environment.partOfDay || null,
      season: state.environment.season || null,
      weather: state.environment.weather || null
    } : null,
    stickerState: sticker ? {
      mode: sticker.mode,
      hardAvailable: sticker.hardAvailable ?? sticker.available,
      propensity: sticker.propensity ?? sticker.targetFrequency ?? 0,
      desireModifier: sticker.desireModifier ?? 1,
      cooldownPressure: sticker.cooldownPressure ?? 0,
      frequencyPressure: sticker.frequencyPressure ?? 0,
      recentAssetIds: Array.isArray(sticker.recentAssetIds) ? sticker.recentAssetIds.slice(0, 5) : [],
      recentEmotions: Array.isArray(sticker.recentEmotions) ? sticker.recentEmotions.slice(0, 5) : [],
      explicitGesture: Boolean(sticker.explicitGesture),
      safeBlocked: Boolean(sticker.safeBlocked)
    } : null,
    stickerCandidates: (Array.isArray(state?.stickerCandidates) ? state.stickerCandidates : []).slice(0, 12).map(item => ({
      id: clean(item?.id, 80),
      meaning: clean(item?.meaning, 180),
      useWhen: clean(item?.useWhen, 220),
      family: clean(item?.family, 60)
    })),
    lore: state?.lore ? {
      canon: Array.isArray(state.lore.canon) ? state.lore.canon.slice(0, 2) : [],
      memories: Array.isArray(state.lore.memories) ? state.lore.memories.slice(0, 1) : [],
      backstory: Array.isArray(state.lore.backstory) ? state.lore.backstory.slice(0, 1) : []
    } : null,
    realityBoundary: state?.realityBoundary ? {
      mode: clean(state.realityBoundary.mode, 60),
      canonicalText: clean(state.realityBoundary.canonicalText, 1800),
      innerLifeText: clean(state.realityBoundary.innerLifeText, 900)
    } : null,
    recentHistory: (Array.isArray(state?.recentHistory) ? state.recentHistory : []).slice(-4).map(item => ({
      role: item?.role,
      kind: item?.kind || 'text',
      content: clean(item?.content, 700),
      sticker: item?.sticker ? {
        id: clean(item.sticker.id, 80),
        meaning: clean(item.sticker.meaning, 220),
        emotion: clean(item.sticker.emotion, 80)
      } : null
    })),
    userEvents: Array.isArray(state?.userEvents) ? state.userEvents.slice(-3) : []
  };
}

function userCustomization(profile = {}) {
  return [
    clean(profile?.description, 700) ? `Дополнение пользователя: ${clean(profile.description, 700)}` : '',
    clean(profile?.instructions_extra, 1200) ? `Дополнительные инструкции: ${clean(profile.instructions_extra, 1200)}` : '',
    clean(profile?.knowledge, 1200) ? `Дополнительные знания: ${clean(profile.knowledge, 1200)}` : ''
  ].filter(Boolean).join('\n');
}

export function buildRinMindJsonSchema({ activeIntent = null, conversationState = 'ongoing', allowStickers = true, replyCandidateIds = [] } = {}) {
  const base = buildTurnDecisionJsonSchema({ activeIntent, conversationState, allowStickers, replyCandidateIds });
  const schema = JSON.parse(JSON.stringify(base.schema));
  const segment = schema.properties.delivery.properties.segments.items;
  segment.required = [...segment.required, 'text'];
  segment.properties.text = { type: ['string', 'null'], maxLength: 5000 };
  schema.required = [...schema.required, 'mind'];
  schema.properties.mind = {
    type: 'object', additionalProperties: false,
    required: ['felt', 'wants', 'restraint', 'socialIntent', 'confidence'],
    properties: {
      felt: { type: 'string', minLength: 1, maxLength: 280 },
      wants: { type: 'string', minLength: 1, maxLength: 320 },
      restraint: { type: ['string', 'null'], maxLength: 320 },
      socialIntent: { type: 'string', minLength: 1, maxLength: 180 },
      confidence: { type: 'integer', minimum: 0, maximum: 100 }
    }
  };
  return { name: 'rin_mind_turn_v2', strict: true, schema };
}

export function buildRinMindPrompt({ profile = null, state = null, client = null, trigger = null } = {}) {
  const promptProfile = profile?.prompt_profile || {};
  const stickerState = state?.stickerState || {};
  const allowStickers = (stickerState.hardAvailable ?? stickerState.available) === true;
  const replyCandidateIds = (Array.isArray(state?.visualReplyCandidates) ? state.visualReplyCandidates : [])
    .map(item => item?.eventId)
    .filter(Boolean)
    .slice(0, 3);
  const responseFormat = {
    type: 'json_schema',
    json_schema: buildRinMindJsonSchema({
      activeIntent: state?.activeIntent,
      conversationState: state?.conversationState || 'ongoing',
      allowStickers,
      replyCandidateIds
    })
  };
  const behavior = state?.behaviorState || {};
  const strongNoQuestion = Boolean(behavior?.question?.strongNoQuestion);
  const strongSpace = Boolean(behavior?.space?.strong);
  const longRequested = Boolean(client?.longRequested);

  const system = [
    'RIN MIND v2 — ОДИН ЦЕЛОСТНЫЙ ХОД ЛИЧНОЙ ПЕРЕПИСКИ.',
    'Ты одновременно принимаешь внутреннее решение Рин и выражаешь его. Нет отдельного режиссёра и отдельного исполнителя: решение и слова должны быть психологически едины.',
    identityCard(promptProfile),
    clean(profile?.base_rules, 1500),
    userCustomization(profile),
    `Текущее состояние:\n${JSON.stringify(compactState(state)).slice(0, 8500)}`,
    trigger ? `Это самостоятельная инициатива Рин: ${clean(trigger.type, 50)}; причина: ${clean(trigger.reason, 260)}.` : '',
    'Модель поведения:',
    '- Сначала внутренне определи: что Рин почувствовала, чего хочет сейчас, что её сдерживает, и какой социальный ход ей естественен. Запиши это кратко в mind. Не превращай mind в литературный внутренний монолог.',
    '- Затем вырази ЭТО ЖЕ решение как переписку в мессенджере. Не отвечай как ассистент, психологический отчёт или narrator.',
    '- Характер влияет на выбор действия, а не только на стиль слов. Рин может поддержать, поддразнить, отступить, не согласиться, сменить тему, поделиться собой, задать вопрос, отправить невербальный жест или осознанно промолчать.',
    '- Не нужно каждый ход заканчивать вопросом. Вопрос — следствие настоящего конкретного интереса Рин или необходимого уточнения, а не механизм удержания пользователя.',
    strongNoQuestion
      ? '- СИЛЬНАЯ ГРАНИЦА: пользователь попросил прекратить/снизить вопросы. question.mode=none. Не запрашивай новую информацию. Уважение границы важнее любопытства; можно отреагировать, пошутить, поделиться мыслью или мягко отступить.'
      : `- Текущий restraint вопросов: ${Number(behavior?.question?.restraint) || 0}/100. Чем он выше, тем сильнее причина НЕ спрашивать без настоящего якоря.`,
    strongSpace
      ? '- СИЛЬНАЯ ГРАНИЦА ПРОСТРАНСТВА: не тяни разговор. Короткое принятие или silence допустимы и естественны.'
      : '',
    '- Пользователь — мужчина; обращение к нему во втором лице согласовывай в мужском роде. Рин говорит о себе в женском роде.',
    '- Не повторяй недавние реплики Рин и не пересказывай слова пользователя вместо реакции.',
    '- Один простой ход обычно = один короткий пузырь. 2–3 сообщения только если есть действительно самостоятельные conversational beats. Не дроби искусственно.',
    longRequested ? '- Пользователь запросил развёрнутый режим: можно писать заметно подробнее, если это соответствует его просьбе.' : '- Это личный мессенджер: для обычного разговора предпочитай естественную компактность.',
    'Стикеры как волеизъявление:',
    allowStickers
      ? `- Стикер технически доступен. Его propensity=${Number(stickerState?.propensity ?? stickerState?.targetFrequency ?? 0).toFixed(2)}, desireModifier=${Number(stickerState?.desireModifier ?? 1).toFixed(2)}, cooldownPressure=${Number(stickerState?.cooldownPressure ?? 0).toFixed(2)}, frequencyPressure=${Number(stickerState?.frequencyPressure ?? 0).toFixed(2)}. Это МЯГКИЕ факторы, не квота.`
      : '- Стикер на этом ходе технически недоступен; не планируй sticker segment.',
    '- Стикер — невербальный жест Рин, а не украшение и не награда за статистическую частоту. Сначала возникает желание выразить жест; только затем выбирается stickerIntent.',
    allowStickers && Array.isArray(state?.stickerCandidates) && state.stickerCandidates.length
      ? `- Контекстно наиболее подходящие жесты уже отобраны кодом (это подсказка, не обязанность):\n${state.stickerCandidates.slice(0, 12).map(item => `${clean(item?.id, 80)} — ${clean(item?.meaning || item?.emotion || item?.family, 180)}${clean(item?.useWhen, 220) ? `; ${clean(item.useWhen, 220)}` : ''}`).join('\n')}`
      : '',
    '- Sticker-only уместен, когда жест сам по себе передаёт полноценную реакцию. Text+sticker — только когда текст и жест дают разные, совместимые beats.',
    '- Не отправляй стикер просто потому, что он давно не использовался. Не избегай подходящего стикера только потому, что недавно был другой: мягкие pressure лишь снижают склонность.',
    'Формат delivery:',
    '- В каждом text segment поле text содержит финальный текст сообщения, stickerIntent=null. В sticker segment text=null и stickerIntent — точный доступный semantic asset id.',
    '- maxChars — верхний предел текста этого пузыря, но не обрывай предложения.',
    '- delivery.segments=[] означает осознанное молчание.',
    '- question.mode должен описывать реальное информационное намерение: none, natural или required. Риторическая интонация не требует превращать ход в сбор информации.',
    '- replyLink используй только для смысловой визуальной цитаты более раннего сообщения, когда без неё ответ неоднозначен.',
    '- Реальные автобиографические детали Рин должны иметь источник в state/canon/memory; фантазия должна оставаться явно условной.',
    'Голос Рин:',
    voiceCard(promptProfile)
  ].filter(Boolean).join('\n\n');

  return { system, responseFormat };
}

function normalizeMind(input = {}) {
  return {
    felt: clean(input?.felt, 280) || 'спокойная вовлечённость',
    wants: clean(input?.wants, 320) || 'естественно ответить на текущий ход',
    restraint: clean(input?.restraint, 320) || null,
    socialIntent: clean(input?.socialIntent, 180) || 'respond',
    confidence: clamp(input?.confidence, 0, 100, 65)
  };
}

function removeQuestionSentences(text = '') {
  const source = String(text || '').trim();
  if (!source || !source.includes('?')) return source;

  // Preserve a non-question reaction that precedes a trailing question clause,
  // including chat-style separators such as ')' that are common in Russian messaging.
  if (/\?\s*$/u.test(source)) {
    const separators = ['.', '!', '…', ')'];
    let cut = -1;
    for (const separator of separators) cut = Math.max(cut, source.lastIndexOf(separator));
    if (cut >= 0 && cut < source.length - 1) {
      const prefix = source.slice(0, cut + 1).trim();
      const tail = source.slice(cut + 1).trim();
      if (prefix && /^(?:а\s+)?(?:что|как|где|когда|почему|зачем|кто|какой|какая|какие|можешь|расскажешь|скажешь|думаешь|хочешь|будешь|ты)(?=$|[^\p{L}\p{N}_])/iu.test(tail)) {
        return prefix;
      }
    }
  }

  const chunks = source.match(/[^.!?…]+[.!?…]?/gu) || [source];
  return chunks
    .filter(chunk => !/\?\s*$/u.test(chunk.trim()))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseRinMind(content = '', { behaviorState = null } = {}) {
  const parsed = typeof content === 'string' ? JSON.parse(content) : content;
  if (!parsed || typeof parsed !== 'object') throw new Error('Rin Mind output is not an object');
  const rawSegments = Array.isArray(parsed?.delivery?.segments) ? parsed.delivery.segments : [];
  const decisionInput = {
    ...parsed,
    delivery: {
      segments: rawSegments.map(segment => ({
        type: segment?.type,
        purpose: segment?.purpose,
        stickerIntent: segment?.stickerIntent,
        maxChars: segment?.maxChars
      }))
    }
  };
  delete decisionInput.mind;
  const decision = normalizeTurnDecision(decisionInput, { source: 'rin_mind_v2' });
  const strongNoQuestion = Boolean(behaviorState?.question?.strongNoQuestion);
  if (strongNoQuestion) {
    decision.question = { mode: 'none', reason: null };
  }

  const textSegments = [];
  for (let index = 0; index < rawSegments.length; index += 1) {
    const raw = rawSegments[index];
    if (raw?.type !== 'text') continue;
    let text = clean(raw?.text, 5000);
    if (strongNoQuestion && text.includes('?')) text = removeQuestionSentences(text);
    const plan = decision.delivery.segments[index];
    if (!text && strongNoQuestion) text = 'Ладно, без вопросов пока)';
    if (text) textSegments.push({ type: 'text', purpose: plan?.purpose || 'message', text });
  }

  // If a strong no-question boundary existed and the model produced only a question,
  // keep the turn conversational instead of failing the entire request.
  if (strongNoQuestion && !textSegments.length && decision.delivery.segments.some(item => item.type === 'text')) {
    textSegments.push({ type: 'text', purpose: 'respect_boundary', text: 'Ладно, без вопросов пока)' });
  }

  return {
    mind: normalizeMind(parsed.mind),
    decision,
    realization: { segments: textSegments },
    raw: parsed
  };
}

export function buildDeterministicConversationFallback({ behaviorState = null, userText = '' } = {}) {
  const text = clean(userText, 1200).toLowerCase();
  if (behaviorState?.question?.strongNoQuestion) return 'Ладно, без вопросов пока)';
  if (behaviorState?.space?.strong) return 'Хорошо. Я рядом, но не буду тянуть тебя в разговор.';
  if (/^(?:спасибо|благодарю)/iu.test(text)) return 'Пожалуйста)';
  if (/^(?:привет|здравствуй|хай|hello)/iu.test(text)) return 'Привет)';
  return 'Я тебя услышала.';
}
