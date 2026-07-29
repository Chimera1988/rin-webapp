// public/lib/stickers.js
// Минимальная автономная библиотека для:
// 1) загрузки конфигурации стикеров (v3),
// 2) эвристической оценки сигналов (sentiment/intent/timeOfDay/phase),
// 3) принятия решения "ставить ли стикер",
// 4) выбора стикера и вспомогательной подписи (utterance),
// 5) учёта частоты использования (кулдауны / diversity / user affinity).

// ---- УТИЛИТЫ

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const todayKey = () => new Date().toISOString().slice(0, 10);

function lower(s) { return (s || "").toLowerCase(); }
function includesAny(text, items = []) {
  const t = lower(text);
  return items.some(k => t.includes(lower(k)));
}

function readStats() {
  try {
    const raw = localStorage.getItem('rin-stats');
    if (!raw) return { bySrc: {}, recent: [], today: todayKey() };
    const obj = JSON.parse(raw);
    if (obj.today !== todayKey()) {
      // новый день — обнулим дневные счётчики
      for (const k of Object.keys(obj.bySrc)) {
        obj.bySrc[k].today = 0;
      }
      obj.today = todayKey();
    }
    obj.recent ||= [];
    return obj;
  } catch {
    return { bySrc: {}, recent: [], today: todayKey() };
  }
}
function writeStats(stats) {
  try { localStorage.setItem('rin-stats', JSON.stringify(stats)); } catch {}
}

function bumpStats(stats, src) {
  stats.bySrc[src] ||= { today: 0, liked: 0, skipped: 0 };
  stats.bySrc[src].today++;
  // поддерживаем историю последних 10 уникальных
  stats.recent = [src, ...stats.recent.filter(s => s !== src)].slice(0, 10);
  writeStats(stats);
}

function userAffinity(stats, src) {
  const s = stats.bySrc[src];
  if (!s) return 1.0;
  const base = 1.0 + Math.max(-0.2, Math.min(0.2, (s.liked - s.skipped) * 0.05));
  return +(base.toFixed(3));
}

/* === ДЕТЕРМИНИРОВАННЫЙ РАНДОМ (seeded) === */
function hash32(str) {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function seededRand(seedText) {
  const h = hash32(String(seedText || ""));
  // один шаг LCG для 0..1
  const x = (h * 1664525 + 1013904223) >>> 0;
  return x / 2 ** 32;
}

// ---- КЛАССИФИКАЦИИ (простые эвристики)

function detectTimeOfDay(date = new Date()) {
  const h = date.getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 18) return "day";
  if (h >= 18 && h < 24) return "evening";
  return "night";
}

function detectSentiment(text) {
  const t = lower(text);
  const happy = ["ура", "класс", "супер", "рада", "рад", "счаст", "обож", "люблю", "😍", "😊", ":)", "☺️", "❤️"];
  const veryHappy = ["офигенно", "лучше не бывает", "мечта сбылась", "🎉", "🥳", "💖"];
  const sad = ["груст", "жаль", "обидно", "плохо", "печаль", "😔", "😢", "😭", ":("];
  const verySad = ["невозможно", "ужас", "депресс", "невыносимо", "отчаян", "безнадёж"];
  const angry = ["злюсь", "бесит", "раздраж", "чёрт", "ненавиж", "капец", "%$#@", "!!!"];

  if (includesAny(t, veryHappy)) return "very_happy";
  if (includesAny(t, angry)) return "angry";
  if (includesAny(t, verySad)) return "very_sad";
  if (includesAny(t, sad)) return "sad";
  if (includesAny(t, happy)) return "happy";
  return "neutral";
}

function detectIntent(text) {
  const t = lower(text);
  if (t.includes("?") || includesAny(t, ["почему", "как", "когда", "что", "зачем"])) return "question";
  if (includesAny(t, ["спасибо", "благодарю", "благодарен", "благодарна"])) return "thanks";
  if (includesAny(t, ["прости", "извини", "сорри"])) return "apology";
  if (includesAny(t, ["обними", "поддержи", "тяжело", "мне плохо", "нужна поддержка"])) return "support";
  if (includesAny(t, ["целую", "обнимаю", "скуч", "поцелуй", "милый", "милая", "❤️", "😘"])) return "flirt";
  if (includesAny(t, ["давай", "сделаем", "поехали", "план", "запланируем"])) return "plan";
  if (includesAny(t, ["пока", "спокойной ночи", "до завтра", "увидимся"])) return "goodbye";
  if (includesAny(t, ["просьба", "можешь", "сделай", "нужно"])) return "request";
  return "smalltalk";
}

// ---- СКОРИНГ

function kwScore(text, kws) {
  if (!kws?.length) return 0;
  const t = lower(text);
  const hits = kws.filter(k => t.includes(lower(k))).length;
  if (!hits) return 0;
  return clamp01(hits / Math.min(4, kws.length)); // насыщение
}

function moodScore(candidateMoods, desiredMoods) {
  if (!desiredMoods?.length) return 0.5;
  const set = new Set(candidateMoods);
  const hit = desiredMoods.filter(m => set.has(m)).length;
  return clamp01(hit / desiredMoods.length) || (set.has("neutral") ? 0.5 : 0.0);
}

function intentScore(candidate, intent) {
  if (!candidate.intents?.length) return 0.5;
  return candidate.intents.includes(intent) ? 1 : 0;
}

function timeOfDayScore(cfg, tod, moods) {
  const pref = cfg.defaults?.byTime?.[tod]?.moods || [];
  if (!pref.length) return 0.5;
  const s = new Set(pref);
  const hit = moods.some(m => s.has(m));
  return hit ? 1 : 0.4;
}

// стабилен выбор среди равных по score
function pickStableByScore(cands, seedText) {
  if (!cands || !cands.length) return null;
  return cands
    .slice()
    .sort((a, b) =>
      b.score - a.score ||
      (seededRand(String(seedText) + a.s.src) - seededRand(String(seedText) + b.s.src))
    )[0];
}

// ---- ПРАВИЛА

function violatesGlobal(cfg, history) {
  const g = cfg.defaults?.global || { min_gap_messages: 2, max_ratio: 0.35 };
  const ratio = history.withStickers / Math.max(1, history.total);
  if (history.messagesSinceSticker < g.min_gap_messages) return true;
  if (ratio > g.max_ratio) return true;
  return false;
}

function shouldConsider(cfg, s, signals, stats) {
  if (violatesGlobal(cfg, signals.history)) return false;

  // Кулдауны/кап
  if (s.cooldown_messages && signals.history.messagesSinceSticker < s.cooldown_messages) return false;
  const todayCount = (readStats().bySrc[s.src]?.today || 0);
  if (s.daily_cap && todayCount >= s.daily_cap) return false;

  // Требования/запреты
  if (s.require?.user_state_any?.length) {
    const ok = s.require.user_state_any.some(u => signals.user_state.includes(u));
    if (!ok) return false;
  }
  if (s.avoid?.user_sentiment?.includes(signals.sentiment)) return false;

  // Анти-конфликт
  if (signals.sentiment === "angry" && (s.moods?.includes("romantic") || s.moods?.includes("playful"))) return false;

  // Разнообразие
  if (signals.history.recentStickerSrcs?.includes(s.src)) return false;

  return true;
}

// ---- ВЫБОР

function pickUtterance(sticker) {
  if (!sticker?.utterances?.length) return null;
  return sticker.utterances[Math.floor(Math.random() * sticker.utterances.length)];
}

/**
 * Выбор стикера с расчётом score по кандидатам.
 * Добавлен seedText для детерминированного tie-break и grace.
 */
function pickSticker(cfg, signals, stats, seedText = null) {
  const desired = cfg.defaults?.byTime?.[signals.timeOfDay]?.moods || [];
  const allStickers = cfg.stickers || [];
  const candidates = allStickers.filter(s => shouldConsider(cfg, s, signals, stats));
  const ratio = signals.history.withStickers / Math.max(1, signals.history.total);
  const threshold = cfg.defaults?.global?.score_threshold ?? 0.52;
  const grace = cfg.defaults?.global?.random_grace ?? 0.06;

  const diagnosticBase = {
    signals: {
      intent: signals.intent,
      sentiment: signals.sentiment,
      timeOfDay: signals.timeOfDay
    },
    history: {
      messagesSinceSticker: signals.history.messagesSinceSticker,
      ratio
    },
    threshold,
    eligible: candidates.length,
    total: allStickers.length,
    topCandidates: []
  };

  if (!candidates.length) {
    return {
      sticker: null,
      diagnostic: {
        ...diagnosticBase,
        reason: violatesGlobal(cfg, signals.history)
          ? 'global_gate'
          : 'no_eligible_candidates'
      }
    };
  }

  const scored = [];
  for (const s of candidates) {
    const keyword = kwScore(signals.text, s.keywords);
    const mood = moodScore(s.moods || [], desired);
    const intent = intentScore(s, signals.intent);
    const time = timeOfDayScore(cfg, signals.timeOfDay, s.moods || []);

    // Намерение должно иметь чуть больший вес: раньше без точного keyword-hit
    // даже очевидные flirt/thanks/question почти никогда не достигали порога.
    const score =
      keyword * 0.42 +
      mood * 0.20 +
      intent * 0.30 +
      time * 0.08;

    const diversityPenalty = signals.history.recentStickerSrcs?.slice(-8).includes(s.src) ? 0.85 : 1;
    const aff = userAffinity(stats, s.src);
    const finalScore = score * (s.weight ?? 1) * aff * diversityPenalty;

    scored.push({
      s,
      score: finalScore,
      components: { keyword, mood, intent, time }
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0] || null;
  const topCandidates = scored.slice(0, 5).map(x => ({
    src: x.s.src,
    score: +x.score.toFixed(4),
    components: x.components
  }));

  if (!best) {
    return {
      sticker: null,
      diagnostic: { ...diagnosticBase, reason: 'no_scored_candidates', topCandidates }
    };
  }

  if (best.score >= threshold) {
    const top = scored.filter(x => x.score === best.score);
    return {
      sticker: pickStableByScore(top, seedText)?.s || best.s,
      diagnostic: { ...diagnosticBase, reason: 'selected_threshold', topCandidates }
    };
  }

  if (best.score >= threshold * (1 - grace) && seededRand(seedText) < grace) {
    return {
      sticker: best.s,
      diagnostic: { ...diagnosticBase, reason: 'selected_grace', topCandidates }
    };
  }

  return {
    sticker: null,
    diagnostic: { ...diagnosticBase, reason: 'below_threshold', topCandidates }
  };
}

// ---- ПУБЛИЧНЫЕ API

/**
 * Загружает JSON-конфиг v3 (например: /data/stickers.json) без кэша.
 */
export async function loadStickerConfig(url = "/data/stickers.json") {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to load stickers.json: ${r.status}`);
  const cfg = await r.json();
  if (!cfg || cfg._schema?.toLowerCase() !== "v3") {
    console.warn("Unexpected stickers schema, expected v3");
  }
  return cfg;
}

/**
 * Лёгкая оценка сигналов по тексту пользователя и контексту.
 * Вы можете передать уже готовые поля, чтобы переопределить эвристики.
 */
export function buildSignals({
  userText,
  history, // { total, withStickers, messagesSinceSticker, recentStickerSrcs, todayCountBySrc }
  user_state = [],
  intent, sentiment, timeOfDay, phase
}) {
  const sig = {
    text: userText || "",
    sentiment: sentiment || detectSentiment(userText || ""),
    intent: intent || detectIntent(userText || ""),
    phase: phase || "mid",
    timeOfDay: timeOfDay || detectTimeOfDay(),
    user_state: user_state || [],
    history: history || {
      total: 0,
      withStickers: 0,
      messagesSinceSticker: 999,
      recentStickerSrcs: [],
      todayCountBySrc: {}
    }
  };
  return sig;
}

/**
 * Основной помощник: решает, ставить ли стикер, и возвращает результат.
 * Возвращает:
 *  { sticker: {src,...} | null, utterance: string|null, delayMs: number }
 *
 * Новое: опциональный seedText — для детерминизма tie-break и grace.
 */
export function decideSticker(cfg, signals, {
  attachUtterance = true,
  addDelay = true,
  seedText = null
} = {}) {
  const stats = readStats();
  const result = pickSticker(cfg, signals, stats, seedText);
  const selected = result?.sticker || null;
  const diagnostic = result?.diagnostic || null;

  if (!selected) {
    return { sticker: null, utterance: null, delayMs: 0, diagnostic };
  }

  const utter = attachUtterance ? pickUtterance(selected) : null;
  const delayMs = addDelay ? (200 + Math.floor(Math.random() * 700)) : 0;

  return { sticker: selected, utterance: utter, delayMs, diagnostic };
}

/**
 * Сообщить библиотеке, что стикер был реально отправлен — обновит счётчики и недавние.
 */
export function markStickerSent(sticker) {
  if (!sticker?.src) return;
  const stats = readStats();
  bumpStats(stats, sticker.src);
}

/**
 * Отметить реакцию пользователя на стикер (повышает/понижает аффинити).
 * Пример использования: markFeedback(src, "like") или markFeedback(src, "skip")
 */
export function markFeedback(src, kind) {
  const stats = readStats();
  stats.bySrc[src] ||= { today: 0, liked: 0, skipped: 0 };
  if (kind === "like") stats.bySrc[src].liked++;
  if (kind === "skip") stats.bySrc[src].skipped++;
  writeStats(stats);
}
