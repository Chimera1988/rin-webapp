import { hashText } from './utils.js';

function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min;
}

function has(text, rx) { return rx.test(String(text || '')); }

function recentEmotionalTrace(history = []) {
  const recent = (Array.isArray(history) ? history : []).slice(-6).map(x => String(x?.content || '')).join(' ');
  return {
    warmth: has(recent, /(люблю|обнима|целу|красив|милая|дорогая|нежн|скучал|рад тебя)/iu),
    tension: has(recent, /(не хочешь|неинтересно|сухо|обид|злишься|отдалил|холодн)/iu),
    play: has(recent, /(секрет|чары|флирт|подразн|😉|😏|😊|😁)/u)
  };
}


function deriveNonverbalAction({ text, lower, userEmotion, intent, state, conversationBrain, feltEmotion, intensity }) {
  const hidden = conversationBrain?.hiddenIntent?.type || '';
  const scene = conversationBrain?.activeScene?.type || 'everyday';
  const mk = (preferredStickerId, emotion, cause, delivery = 'sticker_only', standalone = true, persistent = false) => ({
    preferredStickerId, emotion, cause, delivery, standalone, persistent,
    intensity: Math.max(0, Math.min(100, Number(intensity) || 50)), scene
  });
  if (/(не\s+(?:целуй|поцелуй|обнимай)|не\s+люблю)/iu.test(lower)) return null;
  if (/(целую|поцелуй|чмок|💋|😘)/iu.test(lower)) return mk(/спокойной ночи|нежно/iu.test(lower) ? 'gentle_kiss' : /лови|воздушн/iu.test(lower) ? 'kiss_gesture' : 'kiss', 'kiss', 'ответ на поцелуй пользователя');
  if (/(обнимаю|обними|объят|🤗)/iu.test(lower)) return mk('embrace', 'hug', 'ответ на объятие или просьбу о поддержке');
  if (/(другая девушка|с другой девушкой|бывшая|она красивее|познакомился с .*девуш)/iu.test(lower)) return mk('mild_jealousy', 'jealousy', 'упоминание возможной романтической соперницы', 'sticker_only', true, true);
  if (/(перебива|опять ты|надоело)/iu.test(lower)) return mk('annoyance', 'annoyance', 'поведение пользователя задело границу Рин', 'sticker_only', true, true);
  if (/(сильно тебя обидел|очень жаль|виноват)/iu.test(lower)) return mk('regret_2', 'deep_regret', 'попытка восстановить контакт после сильной обиды', 'before_text', false, true);
  if (/(прости|извини)/iu.test(lower)) return mk('regret_1', 'regret', 'извинение и восстановление контакта', 'before_text', false, false);
  if (/(ты самая прекрасная|какая ты красивая|очаровательная)/iu.test(lower)) return mk(state.shyness >= 55 ? 'shy' : 'soft_shy_smile', 'shy', 'личный комплимент вызвал смущение');
  if (/(горжусь тобой|умница)/iu.test(lower)) return mk('shy_pride', 'shy_pride', 'похвала вызвала смущённую гордость');
  if (/(ура|сдал экзамен|получил награду|победа|🎉|🥳)/iu.test(lower)) return mk('joy', 'joy', 'радость за успех пользователя');
  if (/(ничего себе|вот это да|неожиданно|правда\?)/iu.test(lower)) return mk('surprise_interest', 'surprise', 'неожиданная новость');
  if (/(мне тяжело|грустно|одиноко|страшно|нет сил)/iu.test(lower)) return mk('gentle', 'support', 'пользователю нужна эмоциональная поддержка', 'before_text', false, true);
  if (/(надеюсь|получится|верю)/iu.test(lower)) return mk('hopeful', 'hope', 'надежда на хороший исход', 'after_text', false, false);
  if (/(устала|ты устала|хочешь спать)/iu.test(lower) || state.fatigue >= 70) return mk('fatigue', 'fatigue', 'низкая энергия Рин', 'sticker_only', true, true);
  if (/(не понимаю|что значит|без объяснения)/iu.test(lower)) return mk('questioning', 'confusion', 'Рин не поняла смысл реплики');
  if (/(расскажу|хочешь расскажу|кое-что важное)/iu.test(lower)) return mk('engaged', 'interest', 'Рин внимательно включилась в рассказ');
  if (/(секрет|любопытно|интересно)/iu.test(lower)) return mk('curiosity', 'curiosity', 'тема вызвала любопытство');
  if (/(представь|мечта|будущее|у моря)/iu.test(lower)) return mk(/вместе|наш|наше/iu.test(lower) ? 'dreamy_smile' : 'dreamy', 'dreamy', 'мечтательный образ');
  if (/(как ты думаешь|что для нас важно|смысл)/iu.test(lower)) return mk('thoughtful', 'thoughtful', 'реплика требует личного размышления', 'after_text', false, true);
  if (/(мы отдалились|обиделась|разочар)/iu.test(lower) || hidden === 'possible_hurt_or_withdrawal') return mk('disappointment', 'disappointment', 'Рин почувствовала дистанцию или разочарование', 'sticker_only', true, true);
  if (/(иди ко мне|сядь рядом|можно я .*рядом)/iu.test(lower)) return mk('inviting', 'invitation', 'желание стать ближе');
  if (/(флирт|дразнишь|😉|😏)/u.test(lower) || userEmotion === 'flirt') return mk('flirty', 'flirt', 'игривый флирт пользователя');
  if (/(спасибо|благодар)/iu.test(lower)) return mk('smile', 'smile', 'благодарность пользователя');
  if (/^(да|ага|хорошо|ладно|договорились|точно)[.!…)]*$/iu.test(text)) return mk('agreement', 'agreement', 'согласие с текущей мыслью');
  if (['relationship_reassurance', 'bid_for_reassurance', 'request_more_emotional_response'].includes(hidden)) return mk('warm_smile', 'warm_smile', 'пользователю нужно подтверждение близости', 'before_text', false, true);
  if (feltEmotion === 'живой интерес к теме') return mk('interested_smile', 'warm_interest', 'живой интерес к словам пользователя', 'after_text', false, false);
  return null;
}

export function deriveEmotionalResponse({ userText = '', userEmotion = 'neutral', intent = 'connection', state = {}, history = [], conversationBrain = null } = {}) {
  const text = String(userText || '').trim();
  const lower = text.toLowerCase();
  const trace = recentEmotionalTrace(history);
  const compliment = has(lower, /(красив|прекрасн|очаровательн|милая|умница|горжусь|в тебе.*красот|красот.*в тебе|ты.*лучш)/iu);
  const affectionGesture = has(lower, /(обнима|целу|поцелу|иди сюда|скучал|люблю тебя|моя хорошая|😘|💋|🤗)/iu);
  const flirt = userEmotion === 'flirt' || has(lower, /(флирт|чары|соблазн|необычно красива|😉|😏)/u);
  const reassuranceBid = ['repair', 'intimate_reflection'].includes(intent) || ['request_more_emotional_response', 'relationship_reassurance', 'bid_for_reassurance'].includes(conversationBrain?.hiddenIntent?.type);
  const gratitude = intent === 'gratitude' || userEmotion === 'gratitude';
  const moodQuestion = has(lower, /(как (?:тво[её]|у тебя) настроен|как ты себя|что чувствуешь)/iu);
  const openQuestion = conversationBrain?.literalIntent === 'question' || /\?\s*$/.test(text);

  let feltEmotion = 'спокойный интерес';
  let intensity = 42;
  let impulse = 'ответить по существу и добавить маленькую собственную реакцию';
  let aftertaste = 'оставить одну личную деталь, а не закрывать реплику формальной фразой';
  let expansion = 'natural';
  let embodiedCue = '';

  if (compliment) {
    feltEmotion = clamp(state.shyness, 0, 100) >= 45 ? 'тёплое смущение' : 'тёплая радость';
    intensity = 78;
    impulse = 'сначала показать, что комплимент действительно задел Рин, затем лично отозваться на него';
    aftertaste = 'дать моменту задержаться: короткое признание, игривый ответ или мысль, которая останется после комплимента';
    embodiedCue = 'улыбка или лёгкое смущение';
    expansion = 'developed';
  } else if (affectionGesture) {
    feltEmotion = 'близость и ответное тепло';
    intensity = 84;
    impulse = 'ответить жестом на жест, не оценивать его словами';
    aftertaste = 'можно добавить одну близкую фразу после действия';
    embodiedCue = 'ответное объятие, поцелуй или движение ближе';
    expansion = 'developed';
  } else if (flirt) {
    feltEmotion = 'игривое оживление';
    intensity = 72;
    impulse = 'подхватить игру, а не просто согласиться на флирт';
    aftertaste = 'оставить лёгкое напряжение или недосказанность';
    embodiedCue = 'улыбка, взгляд, короткая пауза';
    expansion = 'developed';
  } else if (reassuranceBid || trace.tension) {
    feltEmotion = 'внимательное беспокойство о связи';
    intensity = 76;
    impulse = 'сначала прямо восстановить контакт и признать, как могла прозвучать холодность';
    aftertaste = 'дать конкретное присутствие, не оправдываться общими словами';
    expansion = 'developed';
  } else if (gratitude) {
    feltEmotion = 'мягкое тепло';
    intensity = 58;
    impulse = 'принять благодарность лично, без служебной вежливости';
    aftertaste = 'добавить короткое искреннее послевкусие, если оно естественно';
    expansion = 'natural';
  } else if (moodQuestion) {
    feltEmotion = 'готовность немного раскрыться';
    intensity = 56;
    impulse = 'назвать настоящее текущее состояние и дать одну конкретную причину или бытовой след';
    aftertaste = 'не сводить ответ к одному прилагательному и не возвращать вопрос автоматически';
    expansion = 'developed';
  } else if (openQuestion) {
    feltEmotion = 'живой интерес к теме';
    intensity = 50;
    impulse = 'сначала ответить, затем при наличии собственной реакции дать ей прозвучать';
    aftertaste = 'не завершать ответ канцелярской формулой';
  } else if (trace.warmth || trace.play) {
    feltEmotion = trace.play ? 'лёгкая игривость' : 'сохраняющееся тепло';
    intensity = 60;
    impulse = 'сохранить эмоциональный тон предыдущих реплик вместо сброса в нейтральность';
    aftertaste = 'оставить маленькую личную реакцию';
  }

  const nonverbalAction = deriveNonverbalAction({ text, lower, userEmotion, intent, state, conversationBrain, feltEmotion, intensity });

  const seed = hashText(`${text}|${history.length}|${feltEmotion}`);
  const allowQuestion = openQuestion && seed % 3 === 0 && !reassuranceBid;
  const sentenceRange = expansion === 'developed' ? 'обычно 2–4 предложения' : 'обычно 1–3 предложения';

  return {
    feltEmotion,
    intensity,
    impulse,
    aftertaste,
    embodiedCue,
    expansion,
    sentenceRange,
    allowQuestion,
    trace,
    nonverbalAction,
    instruction: [
      'ВНУТРЕННЯЯ ЭМОЦИОНАЛЬНАЯ РЕАКЦИЯ РИН — ИСТОЧНИК ОТВЕТА',
      `Рин сейчас чувствует: ${feltEmotion}; сила реакции ${intensity}/100. Число не называй.`,
      `Первичный импульс: ${impulse}.`,
      embodiedCue ? `Телесный или невербальный оттенок: ${embodiedCue}. Не описывай себя со стороны театрально; можно выразить это одним естественным действием или словом.` : '',
      `Эмоциональное послевкусие: ${aftertaste}.`,
      `Естественный объём: ${sentenceRange}. Это не лимит: закончи эмоциональную мысль, но не растягивай её искусственно.`,
      allowQuestion ? 'Один конкретный вопрос допустим только после собственной законченной реакции.' : 'Не задавай встречный вопрос по привычке.',
      'Сначала проживи реакцию, потом формулируй текст. Не отвечай формулой «спасибо/приятно/рада + общий вывод», если можно показать конкретное чувство, жест, мысль или маленькое признание.',
      'Не обрывай ответ только потому, что уже сказано два предложения. Если эмоция ещё не получила личного продолжения, добавь одну короткую фразу-послевкусие.',
      'Не выдумывай события и факты ради живости: развивай только чувство, отношение и уже известную ситуацию.'
    ].filter(Boolean).join('\n')
  };
}
