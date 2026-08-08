import { fetchWithTimeout } from '../js/http_client.js';
import {
  SERIOUS_SCENES,
  STICKER_STORE_KEY,
  isAllowedStickerSrc,
  stickerIdFromSrc,
  validateStickerConfig
} from './sticker-contract.js';

const clamp = (n, a, b) => Math.max(a, Math.min(b, Number(n) || 0));
const lower = value => String(value || '').toLowerCase();
const defaultStats = () => ({ recent: [], turnsSinceSticker: 999, sent: 0, turns: 0, outcomes: [] });
function loadStats() {
  try {
    const raw = JSON.parse(localStorage.getItem(STICKER_STORE_KEY) || '{}');
    return { ...defaultStats(), ...raw, recent: Array.isArray(raw.recent) ? raw.recent.slice(0, 12) : [], outcomes: Array.isArray(raw.outcomes) ? raw.outcomes.slice(-50) : [] };
  } catch { return defaultStats(); }
}
function saveStats(stats) { try { localStorage.setItem(STICKER_STORE_KEY, JSON.stringify(stats)); } catch {} }

export async function loadStickerConfig(url = '/data/stickers-v6.json') {
  const response = await fetchWithTimeout(url, { cache: 'no-store' }, 12_000);
  if (!response.ok) throw new Error(`Failed to load stickers config: ${response.status}`);
  const config = await response.json();
  const validation = validateStickerConfig(config);
  if (!validation.ok) throw new Error(`Invalid sticker manifest: ${validation.errors.join('; ')}`);
  return config;
}

const NEGATION = '(?:не|никогда|ни за что|перестань|хватит)';
function affirmed(text, word) {
  const source = lower(text);
  const at = source.search(word);
  if (at < 0) return false;
  const prefix = source.slice(Math.max(0, at - 24), at);
  return !new RegExp(`${NEGATION}\\s+(?:хочу\\s+|надо\\s+|буду\\s+)?$`, 'iu').test(prefix);
}
function has(text, rx) { return rx.test(lower(text)); }

export function deriveStickerSignals(userText = '', replyText = '', context = {}) {
  const u = lower(userText);
  const r = lower(replyText);
  const both = `${u}\n${r}`;
  const kiss = affirmed(both, /(целу|поцелу|чмок|💋|😘)/iu);
  const hug = affirmed(both, /(обним|объят|🤗)/iu);
  const tired = affirmed(both, /(устал|устала|вымот|сонн|хочу спать)/iu);
  const sad = affirmed(both, /(груст|печал|плохо|тяжело|больно|одинок|😔|😢)/iu);
  const flirt = affirmed(both, /(красива|милая|нравишься|флирт|очаровал|😉|😏)/iu);
  const jealousy = has(u, /(другая девушка|с другой девушкой|бывшая|она красивее|познакомился с .*девуш)/iu);
  const apology = has(both, /(прости|извини|виноват|сожалею)/iu);
  const regret = has(r, /(жаль|сожалею|виновата|исправить)/iu);
  const annoyed = has(both, /(перебива|надоело|раздраж|бесит|опять ты)/iu);
  const frustrated = has(both, /(не получается|сломалось|злюсь|достало|ошибка)/iu);
  const disappointment = has(both, /(разочар|обидел|обидно|не пришёл|нарушил обещ)/iu);
  const praise = has(u, /(умница|горжусь|восхищаюсь|прекрасная|лучшая|награду|закончил сложн)/iu);
  const thanks = has(both, /(спасибо|благодар)/iu);
  const agreement = /^(ага|да|хорошо|ладно|понятно|договорились|точно|согласен)[.!…)]*$/iu.test(String(userText || '').trim()) || has(both, /делаем именно так/iu);
  const surprise = has(both, /(ого|ничего себе|вот это да|неожиданно|правда\?|выиграл|внезапно)/iu);
  const celebration = has(both, /(ура|победа|сдал|награда|получилось|🎉|🥳)/iu);
  const question = /\?/.test(userText) || /^(как|что|почему|зачем|когда|где|кто|можно ли)/iu.test(String(userText || '').trim());
  const confusion = question && has(u, /(не понимаю|странн|без объяснения|что значит)/iu);
  const reflection = has(both, /(думаю|кажется|смысл|важно|отношени|обдум)/iu);
  const dreamy = has(both, /(мечта|представь|будущее|у моря|словно|будто)/iu);
  const invitation = has(both, /(иди ко мне|сядь рядом|вместе|приходи|можно я .*рядом)/iu);
  const hope = has(both, /(надеюсь|верю|получится)/iu);
  const interest = question || has(both, /(расскажу|слушаю|интересно|кое-что важное)/iu);
  const shy = has(r, /(смутил|смутилась|красне|неловко)/iu) || praise;
  const warmth = has(both, /(рядом|тепло|дорог|нежн|рад,? что ты)/iu);
  const greeting = has(u, /^(привет|доброе утро|добрый вечер)/iu);
  const farewell = has(u, /(пока|спокойной ночи|до встречи|до завтра)/iu);
  const scene = context.scene || 'everyday';
  const intensity = clamp(context.intensity ?? context.emotionalResponse?.intensity ?? (kiss || hug || celebration ? 5 : jealousy || flirt || sad || annoyed ? 3 : 2), 0, 5);
  return { kiss, hug, tired, sad, flirt, jealousy, apology, regret, annoyed, angry: annoyed, frustrated, disappointment, praise, thanks, agreement, surprise, celebration, strong_joy: celebration, question, confusion, reflection, memory: reflection, dreamy, invitation, hope, interest, shy, care: warmth || sad, tenderness: warmth || kiss || hug, affection: warmth || kiss || hug || flirt, light_joy: thanks || greeting || warmth, neutral_ack: agreement, greeting, greeting_only: greeting && !flirt && !kiss && !hug, farewell, scene, intensity, relationalCloseness: Boolean(context.relationalCloseness), informational: Boolean(context.informational) };
}

function tier(relationship = {}, mood = {}) {
  const closeness = Number(relationship.closeness ?? mood.affection ?? 50);
  const trust = Number(relationship.trust ?? 50);
  return closeness >= 75 && trust >= 65 ? 'close' : closeness >= 50 && trust >= 40 ? 'warm' : 'early';
}
const tierRank = { early: 0, warm: 1, close: 2 };

function score(sticker, sig, context, relationship, recent) {
  if (context.preferredStickerId && sticker.id === context.preferredStickerId) return 100;
  if (sticker.scenes?.length && !sticker.scenes.includes(sig.scene)) return null;
  if (sig.intensity < Number(sticker.minIntensity ?? 0) || sig.intensity > Number(sticker.maxIntensity ?? 5)) return null;
  if (tierRank[tier(relationship, context.mood)] < tierRank[sticker.minTier || 'early']) return null;
  if (sticker.forbidSignals?.some(name => sig[name])) return null;
  if (sticker.requireAll?.length && !sticker.requireAll.every(name => sig[name])) return null;
  if (sticker.requireAny?.length && !sticker.requireAny.some(name => sig[name])) return null;
  let value = 0;
  for (const name of sticker.signals || []) if (sig[name]) value += 1;
  if (!value) return null;
  value *= Number(sticker.weight || 1);
  if (recent.has(sticker.src)) value -= 0.65;
  return value;
}

function chooseDelivery(sticker, context, sig) {
  const requested = context.nonverbalAction?.delivery;
  if (sticker.responseModes.includes(requested)) return requested;
  if (context.nonverbalAction?.standalone === true && sticker.responseModes.includes('sticker_only')) return 'sticker_only';
  if (sig.kiss || sig.hug || sig.jealousy || sig.shy || sig.agreement || sig.surprise) return 'sticker_only';
  return sticker.responseModes.includes('after_text') ? 'after_text' : sticker.responseModes[0];
}

export function decideSticker(config, { userText = '', replyText = '', mood = {}, relationship = {}, mode = 'smart', baseProbability = 50, context = {} } = {}) {
  const stats = loadStats();
  stats.turns += 1;
  stats.turnsSinceSticker += 1;
  stats.outcomes = [...stats.outcomes, false].slice(-50);
  saveStats(stats);
  if (mode === 'off') return { action: 'none', reason: 'mode_off' };
  const base = clamp(baseProbability, 0, 100);
  if (mode !== 'always' && base === 0) return { action: 'none', reason: 'probability_zero' };
  const sig = deriveStickerSignals(userText, replyText, { ...context, mood });
  if (context.safeMode && SERIOUS_SCENES.has(sig.scene)) return { action: 'none', reason: 'safe_mode_scene', signals: sig };
  const explicit = Boolean(sig.kiss || sig.hug || context.preferredStickerId);
  const minGap = explicit ? Number(config.defaults?.explicitGestureMinGap ?? 1) : Number(config.defaults?.minGapMessages ?? 2);
  if (mode !== 'always' && stats.turnsSinceSticker <= minGap) return { action: 'none', reason: 'global_cooldown', signals: sig };
  const ratio = stats.outcomes.length ? stats.outcomes.filter(Boolean).length / stats.outcomes.length : 0;
  if (mode !== 'always' && !explicit && ratio >= Number(config.defaults?.maxRatio ?? 0.36)) return { action: 'none', reason: 'ratio_gate', signals: sig };

  const recent = new Set(stats.recent.slice(0, 10));
  const candidates = (config.stickers || []).map(sticker => ({ sticker, score: score(sticker, sig, context, relationship, recent) })).filter(item => item.score != null).sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const threshold = context.preferredStickerId ? 1 : mode === 'always' ? 0.7 : Number(config.defaults?.threshold ?? 1.05);
  if (!best || best.score < threshold) return { action: 'none', reason: 'no_visual_semantic_match', signals: sig, top: candidates.slice(0, 3).map(x => ({ id: x.sticker.id, score: x.score })) };
  const sceneFactor = Number(config.defaults?.sceneFactor?.[sig.scene] ?? 0.65);
  const probability = clamp(Math.round(base * sceneFactor), 0, 100);
  if (mode !== 'always' && Math.random() >= probability / 100) return { action: 'none', reason: 'probability_gate', probability, candidate: best.sticker.id, signals: sig };
  const delivery = chooseDelivery(best.sticker, context, sig);
  const follow = best.sticker.followUp || {};
  return {
    action: 'send', sticker: best.sticker, delivery, timing: delivery === 'before_text' ? 'before_reply' : 'after_reply',
    semanticAction: best.sticker.emotion, utterance: best.sticker.utterances?.[0] || null,
    meaning: best.sticker.meaning, cause: context.nonverbalAction?.cause || context.cause || null,
    intensity: clamp(context.nonverbalAction?.intensity ?? sig.intensity * 20, 0, 100),
    canExplain: follow.canExplain !== false, expiresAfterTurns: Number(follow.maxTurns || 0),
    explanation: follow.explanation || null, probability, reason: `emotion=${best.sticker.emotion}|scene=${sig.scene}|delivery=${delivery}`, signals: sig
  };
}

export function decidePlannedSticker(config, {
  planned = null,
  mode = 'smart',
  baseProbability = 50,
  safeMode = false
} = {}) {
  const preferredStickerId = String(planned?.preferredStickerId || '').trim();
  if (!planned || !preferredStickerId) return { action: 'none', reason: 'no_server_plan' };
  if (mode === 'off') return { action: 'none', reason: 'mode_off' };
  const sticker = (config?.stickers || []).find(item => item.id === preferredStickerId);
  if (!sticker) return { action: 'none', reason: 'planned_sticker_missing' };
  const delivery = sticker.responseModes?.includes(planned.delivery)
    ? planned.delivery
    : planned.standalone !== false && sticker.responseModes?.includes('sticker_only')
      ? 'sticker_only'
      : sticker.responseModes?.includes('after_text') ? 'after_text' : sticker.responseModes?.[0];
  if (!delivery) return { action: 'none', reason: 'planned_delivery_unsupported' };
  if (safeMode && SERIOUS_SCENES.has(planned.scene || '')) return { action: 'none', reason: 'safe_mode_scene' };

  const stats = loadStats();
  stats.turns += 1;
  stats.turnsSinceSticker += 1;
  stats.outcomes = [...stats.outcomes, false].slice(-50);
  saveStats(stats);

  const explicit = planned.standalone === true || delivery === 'sticker_only';
  const minGap = explicit ? Number(config.defaults?.explicitGestureMinGap ?? 1) : Number(config.defaults?.minGapMessages ?? 2);
  if (mode !== 'always' && stats.turnsSinceSticker <= minGap) return { action: 'none', reason: 'global_cooldown' };
  const probability = mode === 'always' ? 100 : clamp(baseProbability, 0, 100);
  if (mode !== 'always' && Math.random() >= probability / 100) {
    return { action: 'none', reason: 'probability_gate', probability, candidate: sticker.id };
  }
  const follow = sticker.followUp || {};
  return {
    action: 'send',
    sticker,
    delivery,
    timing: delivery === 'before_text' ? 'before_reply' : 'after_reply',
    semanticAction: planned.emotion || sticker.emotion,
    utterance: sticker.utterances?.[0] || null,
    meaning: planned.meaning || sticker.meaning,
    cause: planned.cause || null,
    intensity: clamp(planned.intensity ?? 50, 0, 100),
    canExplain: follow.canExplain !== false,
    expiresAfterTurns: Number(planned.expiresAfterTurns ?? follow.maxTurns ?? 0),
    explanation: follow.explanation || null,
    probability,
    reason: `server_plan=${sticker.id}|delivery=${delivery}`
  };
}

export function markStickerSent(sticker) {
  if (!sticker?.src || !isAllowedStickerSrc(sticker.src)) return;
  const stats = loadStats();
  stats.sent += 1;
  stats.turnsSinceSticker = 0;
  stats.recent = [sticker.src, ...stats.recent.filter(src => src !== sticker.src)].slice(0, 12);
  if (stats.outcomes.length) stats.outcomes[stats.outcomes.length - 1] = true;
  saveStats(stats);
}
export function resetStickerState() { try { localStorage.removeItem(STICKER_STORE_KEY); } catch {} }
export { validateStickerConfig, stickerIdFromSrc } from './sticker-contract.js';
