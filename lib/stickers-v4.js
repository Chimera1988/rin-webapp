// Rin Stickers v5 — выбор только из реальных файлов проекта.
// Стикер появляется, когда его визуальная эмоция совпадает со сценой и силой момента.

const STORE_KEY = 'rin-stickers-v5-stats';
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const low = value => String(value || '').toLowerCase();
const hasAny = (text, list = []) => list.some(item => low(text).includes(low(item)));

function loadStats() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{"recent":[],"messagesSince":999,"sent":0,"turns":0}'); }
  catch { return { recent: [], messagesSince: 999, sent: 0, turns: 0 }; }
}
function saveStats(stats) { try { localStorage.setItem(STORE_KEY, JSON.stringify(stats)); } catch {} }

export async function loadStickerConfig(url = '/data/stickers-v4.json') {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to load stickers config: ${response.status}`);
  const config = await response.json();
  if (!['v4', 'v5'].includes(config?._schema)) throw new Error('Unexpected stickers schema');
  return config;
}

function explicitFarewell(text) {
  const value = low(text).replace(/\s+/g, ' ').trim();
  return /(?:до встречи|до завтра|спокойной ночи|доброй ночи|увидимся|до связи|не скучай)/i.test(value)
    || /^(?:(?:ну|ладно)[, ]+)?(?:(?:всё|все)[, ]+)?пока[.!…)]*$/i.test(value);
}

function inferScene(userText, replyText, context = {}) {
  const supplied = context.scene || context.activeScene?.type || context.conversationBrain?.activeScene?.type;
  if (supplied) return supplied;
  const both = low(`${userText}\n${replyText}`);
  if (explicitFarewell(userText)) return 'farewell';
  if (hasAny(both, ['прости', 'извини', 'обидел', 'поссор'])) return 'conflict_repair';
  if (hasAny(both, ['тяжело', 'больно', 'груст', 'плохо', 'поддерж'])) return 'emotional_support';
  if (hasAny(both, ['целую', 'поцелуй', 'обним', 'люблю', 'ты рядом'])) return 'romance';
  if (hasAny(both, ['флирт', 'попался', 'хитрый', 'дразн', 'очаровал'])) return 'playful_flirt';
  if (hasAny(both, ['сделай', 'исправь', 'проверь', 'проект', 'задача'])) return 'practical_task';
  if (hasAny(both, ['думаю', 'чувствую', 'вспомни', 'мечта', 'тайн'])) return 'reflective';
  if (hasAny(low(userText), ['привет', 'доброе утро', 'добрый вечер'])) return 'greeting';
  return 'everyday';
}

function deriveSignals(userText, replyText, context = {}) {
  const u = low(userText);
  const r = low(replyText);
  const both = `${u}\n${r}`;
  const greeting = hasAny(u, ['привет', 'доброе утро', 'добрый вечер', 'доброй ночи']);
  const kiss = hasAny(both, ['целую', 'поцелуй', 'чмок', '😘', '💋']);
  const hug = hasAny(both, ['обним', 'объят', 'обнимаш', '🤗']);
  const flirt = hasAny(both, ['красивая', 'милая', 'нравишься', 'люблю', 'флирт', 'очаровал', 'чары', '😉', '😘']);
  const tease = hasAny(both, ['хитрый', 'попался', 'ну-ну', 'смело', 'дразн', 'не удержался']);
  const praise = hasAny(u, ['умница', 'молодец', 'горжусь', 'восхищаюсь', 'прекрасно', 'шикарно', 'красавица', 'вдохновение']);
  const thanks = hasAny(both, ['спасибо', 'благодар']);
  const apology = hasAny(both, ['прости', 'извини', 'виноват', 'сожалею']);
  const regret = hasAny(r, ['жаль', 'сожалею', 'прости', 'неловко']);
  const agreement = hasAny(both, ['согласен', 'согласна', 'точно', 'верно', 'давай так', 'договорились', 'вот и я о том']);
  const neutral_ack = /^(ага|да|хорошо|ладно|понятно)[.!…)]*$/i.test(String(userText || '').trim());
  const tired = hasAny(both, ['устал', 'устала', 'вымот', 'хочу спать', 'сонн', 'зеваю']);
  const sad = hasAny(both, ['груст', 'печаль', 'обидно', 'жаль', 'плохо', 'тяжело', 'больно', '😔', '😢']);
  const angry = hasAny(both, ['злюсь', 'бесит', 'раздраж', 'надоело', 'достало']);
  const frustrated = hasAny(both, ['не получается', 'не могу', 'достало', 'запутал', 'ошибка']);
  const disappointment = hasAny(both, ['разочар', 'обидно', 'не вышло', 'не получилось']);
  const surprise = /(?:^|[\s,!.?])(?:ого|ничего себе|вот это да|неожиданно|серьёзно|правда)(?:$|[\s,!.?])/iu.test(both) || /😮/u.test(both);
  const question = /\?/.test(userText) || /^(как|что|почему|зачем|когда|где|кто|можешь ли)\b/i.test(String(userText || '').trim());
  const confusion = question && hasAny(u, ['не понимаю', 'почему', 'как это', 'что значит']);
  const memory = hasAny(u, ['помнишь', 'вспомни', 'тогда', 'раньше', 'когда мы']);
  const dreamy = hasAny(both, ['мечта', 'представляю', 'словно', 'будто', 'волшеб', 'атмосфер', 'лунн']);
  const reflection = hasAny(both, ['думаю', 'кажется', 'чувствую', 'смысл', 'тайн', 'воспомин']);
  const shy = hasAny(r, ['смуща', 'застесня', 'неловко', 'красне']);
  const jealousy = hasAny(u, ['другая девушка', 'с другой девушкой', 'бывшая', 'она красивее']) && flirt;
  const care = hasAny(both, ['береги себя', 'как ты себя', 'забочусь', 'переживаю', 'рядом']);
  const tenderness = hasAny(both, ['нежн', 'тепло', 'дорог', 'моя китсуне', 'мой хикари']);
  const invitation = hasAny(both, ['иди сюда', 'составить компанию', 'вместе', 'пойдём', 'приходи']);
  const hope = hasAny(both, ['надеюсь', 'верю', 'получится']);
  const pride = hasAny(both, ['горжусь', 'мастер', 'умница']);
  const interest = question || hasAny(both, ['интересно', 'расскажи', 'хочу узнать']);
  const explicitCelebration = /(?:^|[\s,!.?])(?:ура|победа|выиграл(?:а)?|сдал(?:а)?|закончил(?:а)?|получилось|праздную)(?:$|[\s,!.?])/iu.test(both) || hasAny(both, ['отличная новость']);
  const strongEmojiJoy = /(?:🎉|🥳|🤩|😁.*😁|🔥)/u.test(`${userText}${replyText}`);
  const strong_joy = explicitCelebration || strongEmojiJoy;
  const celebration = explicitCelebration;
  const light_joy = greeting || thanks || /(?:😊|☺️|🙂)/u.test(`${userText}${replyText}`);
  const greeting_only = greeting && !flirt && !kiss && !hug && !surprise && !celebration;
  const farewell = explicitFarewell(userText);
  const scene = inferScene(userText, replyText, context);
  const hiddenIntent = low(context.hiddenIntent || context.conversationBrain?.hiddenIntent?.type);
  const explicitGesture = kiss ? 'kiss' : hug ? 'hug' : null;
  const relationalCloseness = ['relationship_reassurance', 'bid_for_reassurance', 'request_more_emotional_response'].includes(hiddenIntent)
    || ['closeness', 'tenderness'].includes(low(context.userEmotion))
    || ['intimate_reflection', 'tenderness'].includes(low(context.intent));
  const affection = flirt || tenderness || hug || kiss || relationalCloseness;
  const informational = String(replyText || '').length > 125 && !affection && !sad && !angry && !surprise;

  let intensity = 0;
  if (greeting || neutral_ack || agreement || question || light_joy) intensity = Math.max(intensity, 1);
  if (praise || thanks || care || tenderness || tease || reflection || memory || tired || relationalCloseness) intensity = Math.max(intensity, 2);
  if (surprise || apology || sad || flirt || invitation) intensity = Math.max(intensity, 3);
  if (kiss || hug || celebration || strong_joy || angry) intensity = Math.max(intensity, 4);
  if ((kiss || hug) && scene === 'romance' && /(?:😘|💋|🤗)/u.test(`${userText}${replyText}`)) intensity = 5;
  const suppliedIntensity = Number(context.intensity ?? context.dialogIntensity);
  if (Number.isFinite(suppliedIntensity)) intensity = clamp(Math.round(suppliedIntensity), 0, 5);

  return { scene, intensity, farewell, greeting, greeting_only, kiss, hug, explicitGesture, relationalCloseness, hiddenIntent, flirt, tease, praise, thanks, apology, regret, agreement, neutral_ack, tired, sad, angry, frustrated, disappointment, surprise, question, confusion, memory, dreamy, reflection, shy, jealousy, care, tenderness, invitation, hope, pride, interest, affection, celebration, strong_joy, light_joy, informational };
}

function relationshipTier(mood = {}) {
  const affection = Number(mood.affection) || 50;
  const trust = Number(mood.trust) || 50;
  if (affection >= 75 && trust >= 65) return 'close';
  if (affection >= 50 && trust >= 40) return 'warm';
  return 'early';
}

function scoreCandidate(sticker, sig, mood, channel) {
  if (Array.isArray(sticker.scenes) && sticker.scenes.length && !sticker.scenes.includes(sig.scene)) return null;
  if (sig.intensity < Number(sticker.minIntensity ?? 0) || sig.intensity > Number(sticker.maxIntensity ?? 5)) return null;
  if (sticker.forbidSignals?.some(signal => sig[signal])) return null;
  if (sticker.requireSignals?.length && !sticker.requireSignals.some(signal => sig[signal])) return null;

  let score = 0;
  const reasons = [];
  for (const signal of sticker.signals || []) {
    if (sig[signal]) { score += 1; reasons.push(signal); }
  }
  if (!reasons.length) return null;
  if (channel === 'reaction_to_user') score += 0.18;
  if (channel === 'expression_of_reply') score += 0.12;

  const tier = relationshipTier(mood);
  const order = { early: 0, warm: 1, close: 2 };
  if (order[tier] < order[sticker.minTier || 'early']) return null;
  const energy = Number(mood.energy) || 50;
  const playfulness = Number(mood.playfulness) || 50;
  if (sticker.energyMax && energy > sticker.energyMax) return null;
  if (sticker.playfulnessMin && playfulness < sticker.playfulnessMin) return null;

  const center = (Number(sticker.minIntensity ?? 0) + Number(sticker.maxIntensity ?? 5)) / 2;
  score += Math.max(0, 0.35 - Math.abs(sig.intensity - center) * 0.12);
  score *= Number(sticker.weight || 1);
  return { sticker, score, reasons, tier };
}

function isMeaningfulStickerMoment(sig) {
  if (sig.informational && !sig.surprise && !sig.kiss && !sig.hug && !sig.sad && !sig.apology) return false;
  if (sig.greeting_only) return sig.intensity <= 2;
  return sig.kiss || sig.hug || sig.relationalCloseness || sig.surprise || sig.celebration || sig.apology || sig.sad || sig.angry || sig.flirt || sig.tease || sig.praise || sig.thanks || sig.tired || sig.memory || sig.reflection || sig.question || sig.agreement;
}

export function decideSticker(config, { userText = '', replyText = '', mood = {}, mode = 'smart', baseProbability = 50, context = {} } = {}) {
  const stats = loadStats();
  stats.turns = (stats.turns || 0) + 1;
  stats.messagesSince = (stats.messagesSince ?? 999) + 1;
  saveStats(stats);

  if (mode === 'off') return { action: 'none', reason: 'mode_off' };
  const sig = deriveSignals(userText, replyText, context);
  const explicit = Boolean(sig.explicitGesture);
  if (!isMeaningfulStickerMoment(sig)) return { action: 'none', reason: 'low_value_moment', signals: sig };

  const minGap = Number(config.defaults?.minGapMessages ?? 3);
  const explicitMinGap = Number(config.defaults?.explicitGestureMinGap ?? 1);
  const effectiveGap = explicit ? explicitMinGap : minGap;
  const ratio = (stats.sent || 0) / Math.max(1, stats.turns || 1);
  if (mode !== 'always' && stats.messagesSince < effectiveGap) return { action: 'none', reason: 'global_cooldown', signals: sig };
  if (mode !== 'always' && !explicit && ratio > Number(config.defaults?.maxRatio ?? 0.26)) return { action: 'none', reason: 'ratio_gate', signals: sig };

  const channel = (sig.kiss || sig.hug || sig.surprise || sig.praise || sig.sad || sig.angry || sig.apology || sig.farewell)
    ? 'reaction_to_user'
    : 'expression_of_reply';
  const recent = new Set((stats.recent || []).slice(0, 10));
  const scored = [];
  for (const sticker of config.stickers || []) {
    const candidate = scoreCandidate(sticker, sig, mood, channel);
    if (!candidate) continue;
    if (recent.has(sticker.src)) candidate.score -= explicit ? 0.25 : 0.8;
    if (candidate.score > 0) scored.push(candidate);
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const threshold = mode === 'always' ? 0.75 : Number(config.defaults?.threshold ?? 1.35);
  const top = scored.slice(0, 3).map(item => ({ src: item.sticker.src, score: +item.score.toFixed(2) }));
  if (!best || best.score < threshold) return { action: 'none', reason: 'no_visual_semantic_match', signals: sig, top };
  if (!explicit && scored[1] && Math.abs(best.score - scored[1].score) < 0.1 && best.sticker.family !== scored[1].sticker.family) {
    return { action: 'none', reason: 'ambiguous_candidates', signals: sig, top };
  }

  const base = clamp(Number(baseProbability) || 50, 0, 100);
  const sceneFactor = Number(config.defaults?.sceneFactor?.[sig.scene] ?? 0.5);
  let finalProbability = Math.round(base * sceneFactor);
  let probabilityReason = `base=${base}*sceneFactor=${sceneFactor}`;
  if (sig.explicitGesture === 'kiss') { finalProbability = Math.max(finalProbability, 92); probabilityReason = 'explicit_kiss'; }
  else if (sig.explicitGesture === 'hug') { finalProbability = Math.max(finalProbability, 88); probabilityReason = 'explicit_hug'; }
  else if (sig.relationalCloseness) { finalProbability = Math.max(finalProbability, clamp(Math.round(base * 1.05), 45, 65)); probabilityReason = 'relational_closeness'; }
  else if (sig.celebration || sig.strong_joy) { finalProbability = Math.max(finalProbability, clamp(Math.round(base * 1.35), 60, 82)); probabilityReason = 'celebration'; }
  else if (sig.flirt || sig.tease) { finalProbability = Math.max(finalProbability, clamp(Math.round(base * 1.1), 45, 70)); probabilityReason = 'flirt_or_tease'; }
  finalProbability = clamp(finalProbability, 0, 100);

  if (mode !== 'always' && Math.random() > finalProbability / 100) {
    return { action: 'none', reason: 'probability_gate', probability: finalProbability, probabilityReason, signals: sig, top, candidate: best.sticker.src };
  }

  return {
    action: 'send',
    mode: channel,
    timing: channel === 'reaction_to_user' ? 'before_reply' : 'after_reply',
    sticker: best.sticker,
    utterance: Array.isArray(best.sticker.utterances) && best.sticker.utterances.length
      ? best.sticker.utterances[Math.floor(Math.random() * best.sticker.utterances.length)]
      : null,
    confidence: clamp(best.score / 2.5, 0, 1),
    probability: finalProbability,
    probabilityReason,
    reason: `${best.reasons.join('+')}|scene=${sig.scene}|intensity=${sig.intensity}`,
    signals: sig,
    top
  };
}

export function markStickerSent(sticker) {
  if (!sticker?.src) return;
  const stats = loadStats();
  stats.sent = (stats.sent || 0) + 1;
  stats.messagesSince = 0;
  stats.recent = [sticker.src, ...(stats.recent || []).filter(src => src !== sticker.src)].slice(0, 12);
  saveStats(stats);
}
