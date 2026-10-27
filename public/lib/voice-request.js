// Rin v2.6.25 — literal user request for speech, shared by server and PWA.
// Does not mistake ordinary questions such as "что скажешь об этом?" for audio orders.
const VOICE_CUE = /(?:голос(?:ом|овое|овую|овым)?(?![\p{L}\p{N}])|вслух(?![\p{L}\p{N}])|произнес(?:и|ти|ла|ёшь|ешь)|озвуч(?:ь|ить|ишь)?|запиши\s+(?:мне\s+)?голосовое|послушать\s+(?:твой\s+голос|твою\s+речь|как\s+ты))/iu;
const HEAR_RIN = /(?:хочу|хотел(?:ось|\s+бы)?|хотел\s+бы|можно|можешь|могла\s+бы|дай|давай).{0,65}(?:услышать|послушать).{0,70}(?:тебя|твой\s+голос|твою\s+речь|как\s+тво[яй]\s+реч[ьи]|как\s+ты\s+(?:говоришь|читаешь|произносишь))/iu;
const POLITE_SPEECH = /(?:можешь|могла\s+бы|не\s+могла\s+бы|хочу|хотел(?:\s+бы)?).{0,55}(?:сказать|произнести|прочитать|рассказать)(?![\p{L}\p{N}])/iu;
const JAPANESE = /(?:по[-\s]?японски|на\s+японском|японск[а-яё]{1,9}\s+(?:фраз[а-яё]*|реч[ьа-яё]*|язык[а-яё]*|слов[а-яё]*|стих[а-яё]*|текст[а-яё]*))/iu;
const SPEECH_IMPERATIVE = /(?:^|[.!?…]\s*|[,;]\s*)(?:рин[,\s]+)?(?:скажи|прочитай|спой|расскажи|повтори|говори)(?![\p{L}\p{N}])/iu;
const JAPANESE_CHARS = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const clean = s => String(s ?? '').replace(/\s+/gu, ' ').trim();

export function detectExplicitVoiceRequest(userText = '') {
  const text = clean(userText).slice(0, 1400);
  const japanese = JAPANESE.test(text);
  const requested = VOICE_CUE.test(text) || HEAR_RIN.test(text)
    || SPEECH_IMPERATIVE.test(text) || POLITE_SPEECH.test(text);
  return { requested, language: requested && japanese ? 'ja' : null };
}

// Speak a complete phrase. Never silently trim a long response to the TTS limit.
function firstCompletePhrase(text, limit = 180) {
  const source = clean(text);
  if (source.length <= limit) return source || null;
  const match = source.match(/^(.{2,175}?[.!?。！？])(?:\s|$)/u);
  return match && match[1].length <= limit ? match[1] : null;
}
function japaneseSpeech(text) {
  const source = clean(text);
  const quote = source.match(/[「『]([^」』]{2,})[」』]/u);
  if (quote && JAPANESE_CHARS.test(quote[1])) return quote[1].trim().length <= 180 ? quote[1].trim() : null;
  // Separate Japanese sentence from a Russian translation, if the model has
  // combined them in one bubble.
  const bare = source.match(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー、。！？\s]{2,})/u);
  const speech = clean(bare?.[1]);
  return speech && speech.length <= 180 && JAPANESE_CHARS.test(speech) ? speech : null;
}

export function selectRequestedVoiceSegment(segments = [], request = null, { enabled = false } = {}) {
  if (!enabled || !request?.requested) return null;
  const texts = (Array.isArray(segments) ? segments : []).map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => segment?.type === 'text' && clean(segment?.text));
  if (request.language === 'ja') {
    for (const { segment, index } of texts) {
      const speech = japaneseSpeech(segment.text);
      if (speech && speech.length <= 180) return { index, speech, language: 'ja' };
    }
    return null; // Cannot manufacture Japanese audio from a Russian explanation.
  }
  for (const { segment, index } of texts) {
    const speech = firstCompletePhrase(segment.text);
    if (speech) return { index, speech, language: 'auto' };
  }
  return null;
}
