const clean = (value, max = 4000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export const ASSISTANT_VOICE_PATTERNS = Object.freeze({
  genericSupport: /(каждый человек уникален|важно помнить|главное\s*[—-]?\s*(?:продолжать|не сдаваться|двигаться)|всегда рада помочь|обращайся|смех\s*[—-]\s*это всегда хорошо|пауза\s*[—-]\s*это всегда (?:хорошая|отличная) идея)/iu,
  genericValidation: /(?:^|[.!?]\s)(?:(?:да|согласна|точно)[,!]?\s+)?(?:это (?:действительно )?(?:интересно|здорово|замечательно|прекрасно|приятно|важно)|здорово[.!]|отлично[.!]|рада,? что ты|мне приятно(?:,? что| общаться| слышать| видеть)|это делает (?:наш )?разговор|такие повороты делают|загадочность делает всё|музыка действительно может|пауза\s*[—-]\s*это всегда)/iu,
  metaConversation: /(кажется,? (?:у нас|разговор)|наш разговор (?:становится|получается)|разговор (?:становится|получается) (?:более )?интересн|флирт может неожиданно|это подогревает интерес|у нас получается (?:забавная )?игра|какой ещё интересной мыслью|это делает разговор ещё более приятным|разговор ещё более (?:приятным|интересным))/iu,
  permissionSeeking: /(если ты так хочешь|если хочешь,? (?:я )?могу|могу немного пофлиртовать|как тебе это\?|хочешь,? (?:я|мы)|можем представить|давай представим,? что|ну,? если ты так хочешь)/iu,
  serviceVoice: /(с удовольствием (?:послушаю|помогу|расскажу)|чем я могу помочь|можем поделиться|надеюсь,? смогу не разочаровать|рада,? что ты согласен|мне приятно общаться|с удовольствием проведу|готова выслушать)/iu,
  abstractGeneralization: /(?:^|[.!?]\s)(?:(?:да|ну да)[,]?\s+)?(?:иногда|порой|обычно) (?:действительно )?(?:бывает|нужно|может|хочется)|(?:^|[.!?]\s)(?:это|такие моменты|маленькие шаги) (?:помогает|помогают|делает|делают|могут)|(?:^|[.!?]\s)главное[, —-]|(?:^|[.!?]\s)(?:всё|даже самое сложное) становится/iu,
  reflectiveFiller: /(наверное,? это связано с|интересно,? какие|это как маленькая игра|каждый шаг открывает|сохранялась интрига|атмосферу и помочь отвлечься)/iu
});

const STOP_WORDS = new Set([
  'когда', 'который', 'которая', 'которые', 'потому', 'просто', 'очень', 'тогда', 'кажется',
  'может', 'будет', 'этого', 'такое', 'сейчас', 'тебя', 'тебе', 'меня', 'мне', 'свои', 'свой',
  'тоже', 'этот', 'эта', 'того', 'чтобы', 'сегодня', 'действительно'
]);

export function assistantVoiceWords(value = '') {
  return clean(value, 2200)
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter(item => item.length >= 4 && !STOP_WORDS.has(item));
}

export function assistantVoiceOverlap(reply = '', userText = '') {
  const user = new Set(assistantVoiceWords(userText));
  const response = assistantVoiceWords(reply);
  if (user.size < 2 || response.length < 3) return 0;
  const overlap = response.filter(word => user.has(word)).length;
  return overlap / Math.max(1, Math.min(user.size, response.length));
}

export function analyzeAssistantVoice(value = '', { userText = '', scene = '', plan = null } = {}) {
  const text = clean(value, 8000);
  const flags = {
    genericSupport: ASSISTANT_VOICE_PATTERNS.genericSupport.test(text),
    genericValidation: ASSISTANT_VOICE_PATTERNS.genericValidation.test(text),
    metaConversation: ASSISTANT_VOICE_PATTERNS.metaConversation.test(text),
    permissionSeeking: ASSISTANT_VOICE_PATTERNS.permissionSeeking.test(text),
    serviceVoice: ASSISTANT_VOICE_PATTERNS.serviceVoice.test(text),
    abstractGeneralization: ASSISTANT_VOICE_PATTERNS.abstractGeneralization.test(text),
    reflectiveFiller: ASSISTANT_VOICE_PATTERNS.reflectiveFiller.test(text),
    endsWithQuestion: /\?\s*$/u.test(text),
    longQuestion: /\?\s*$/u.test(text) && text.length > 78,
    mirrored: false
  };
  const overlap = assistantVoiceOverlap(text, userText);
  flags.mirrored = overlap >= 0.72 && assistantVoiceWords(userText).length >= 4 && text.length >= 70;

  const score = [
    flags.genericSupport ? 2 : 0,
    flags.genericValidation ? 2 : 0,
    flags.metaConversation ? 4 : 0,
    flags.permissionSeeking ? 4 : 0,
    flags.serviceVoice ? 3 : 0,
    flags.abstractGeneralization ? 2 : 0,
    flags.reflectiveFiller ? 2 : 0,
    flags.mirrored ? 4 : 0,
    flags.longQuestion ? 1 : 0
  ].reduce((sum, item) => sum + item, 0);

  const personalAct = ['clarify_self', 'state_personal_view', 'specific_personal_reaction', 'reassure_with_boundary', 'explain_previous_nonverbal'].includes(plan?.responseAct);
  const agencyAct = ['take_lead', 'reclaim_scene', 'tease_and_advance', 'advance_play', 'playful_stance'].includes(plan?.responseAct);
  const reactive = score >= 3
    || flags.metaConversation
    || flags.permissionSeeking
    || flags.serviceVoice
    || (flags.endsWithQuestion && text.length > 90)
    || (scene === 'playful_flirt' && (flags.abstractGeneralization || flags.reflectiveFiller));

  return { text, flags, score, overlap, reactive, personalAct, agencyAct };
}

export function looksReactiveAssistantText(value = '', options = {}) {
  return analyzeAssistantVoice(value, options).reactive;
}
