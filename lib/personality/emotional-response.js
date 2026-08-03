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
