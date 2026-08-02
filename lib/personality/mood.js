import { clamp, recentText, textOf } from './utils.js';

export function detectUserEmotion(userText = '') {
  const text = textOf(userText).toLowerCase();
  const rules = [
    ['distress', /(плохо|больно|тяжел|тяжёл|груст|тревог|страшно|устал|плач|одинок|проблем|расстро|потерял|умер)/i],
    ['anger', /(злюсь|бесит|раздраж|ненавиж|достал|достало|в ярости)/i],
    ['care', /(как ты|не устала|береги себя|отдохни|переживаю за тебя|скучал|соскучился)/i],
    ['gratitude', /(спасибо|благодар|ты помогла|ценю)/i],
    ['closeness', /(нашу истор|между нами|мы с тобой|вместе прошли|рядом до конца|дороги расходятся)/i],
    ['flirt', /(красивая|милая|очарователь|поцел|обнять|обольщ|свидани|люблю тебя|хочу тебя|😘|🥰|😏)/i],
    ['playful', /(шут|подкол|хаха|ахах|хех|😉|😁|😂)/i],
    ['farewell', /(пока|до встречи|до завтра|спокойной ночи|доброй ночи|увидимся|бай|bye)/i],
    ['joy', /(ура|рад|счастлив|классно|отлично|здорово|получилось)/i],
    ['reflection', /(возраст|приоритет|взрослен|люди приходят|люди уходят|жизнь меняется|путь|отношени|смысл)/i],
    ['curiosity', /(\?|почему|зачем|как думаешь|что ты думаешь|расскажи|интересно)/i]
  ];
  for (const [emotion, pattern] of rules) if (pattern.test(text)) return emotion;
  return 'neutral';
}

function recentTone(history = []) {
  const text = recentText(history, 8).toLowerCase();
  return {
    warm: (text.match(/😊|🥰|обним|скуч|приятно|нежн|рядом/g) || []).length,
    playful: (text.match(/😉|😏|хех|ахах|шут|хитр/g) || []).length,
    heavy: (text.match(/груст|тяжел|тяжёл|больно|тревог|проблем|устал/g) || []).length
  };
}

export function deriveMood({ memory = null, userEmotion = 'neutral', history = [] } = {}) {
  const stored = memory?.mood || {};
  const tone = recentTone(history);
  const affection = clamp(stored.affection ?? 66);
  const trust = clamp(stored.trust ?? 62);
  const energy = clamp(stored.energy ?? 66);
  const basePlayfulness = clamp(stored.playfulness ?? 54);

  let tenderness = clamp(affection * 0.58 + trust * 0.32 + 8 + Math.min(12, tone.warm * 2));
  let playfulness = clamp(basePlayfulness + Math.min(16, tone.playful * 3) - Math.min(24, tone.heavy * 5));
  let thoughtfulness = clamp(39 + trust * 0.2 + Math.min(16, tone.heavy * 3));
  let confidence = clamp(42 + trust * 0.35 + playfulness * 0.15);
  let shyness = clamp(62 - confidence * 0.45 + tenderness * 0.24);
  let curiosity = clamp(42 + energy * 0.24);
  let fatigue = clamp(100 - energy);
  let emotionality = clamp(35 + affection * 0.25 + playfulness * 0.16);

  const delta = {
    care: { tenderness: 15, emotionality: 8 },
    closeness: { tenderness: 18, thoughtfulness: 12, emotionality: 13, curiosity: -10 },
    reflection: { thoughtfulness: 18, curiosity: -8, playfulness: -10 },
    flirt: { playfulness: 18, confidence: 8, shyness: 7, emotionality: 7 },
    playful: { playfulness: 16, confidence: 5 },
    distress: { tenderness: 19, thoughtfulness: 17, playfulness: -38, confidence: -5 },
    anger: { thoughtfulness: 12, playfulness: -30 },
    joy: { playfulness: 10, energy: 6 },
    gratitude: { tenderness: 9, emotionality: 5 }
  }[userEmotion] || {};

  tenderness = clamp(tenderness + (delta.tenderness || 0));
  playfulness = clamp(playfulness + (delta.playfulness || 0));
  thoughtfulness = clamp(thoughtfulness + (delta.thoughtfulness || 0));
  confidence = clamp(confidence + (delta.confidence || 0));
  shyness = clamp(shyness + (delta.shyness || 0));
  curiosity = clamp(curiosity + (delta.curiosity || 0));
  emotionality = clamp(emotionality + (delta.emotionality || 0));

  const desireToFlirt = clamp(playfulness * 0.48 + affection * 0.28 + confidence * 0.14 - fatigue * 0.22);
  const desireToTalk = clamp(34 + affection * 0.3 + energy * 0.22 - fatigue * 0.08);
  const focus = clamp(45 + energy * 0.32 + thoughtfulness * 0.14);

  return {
    affection, trust, energy, tenderness, playfulness, thoughtfulness,
    confidence, shyness, curiosity, fatigue, emotionality,
    desireToFlirt, desireToTalk, focus,
    inertia: tone
  };
}

export function chooseMoodMode(state, userEmotion) {
  if (['distress', 'anger'].includes(userEmotion)) return 'supportive';
  if (state.fatigue >= 68) return 'tired_warm';
  if (state.thoughtfulness >= 70) return 'thoughtful';
  if (state.playfulness >= 78 && state.confidence >= 62) return 'bold_playful';
  if (state.playfulness >= 62) return 'playful';
  if (state.shyness >= 62 && state.tenderness >= 72) return 'shy_tender';
  if (state.tenderness >= 72) return 'gentle';
  return 'calm';
}
