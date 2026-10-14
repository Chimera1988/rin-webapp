// Rin 2.6.16 — non-romantic subject engagement. This is descriptive guidance
// for Rin Mind, not a second decision engine and never a mandate to be verbose.
const TOPICS = Object.freeze([
  {key:'work', name:'редакторская работа', test:/(?:редакт|правк|перевод|текст|абзац|издатель|работ[аыуе])/iu},
  {key:'literature',name:'литература и чтение',test:/(?:книг|литератур|роман|прочит|писател|сюжет|автор|стих)/iu},
  {key:'arts',name:'искусство и наблюдения',test:/(?:акварел|каллиграф|фотограф|рисунк|картин|искусств|кадр)/iu},
  {key:'music',name:'музыка и вкус',test:/(?:музык|песн|композиц|мелод|альбом|исполнител)/iu},
  {key:'culture',name:'культура и языки',test:/(?:япони|культур|традиц|язык|японск|русск|ремесл|обыча)/iu},
  {key:'thinking',name:'идеи и собственные взгляды',test:/(?:иде[яию]|мысл|мнен|считаешь|думаешь|почему|смысл|убежден|выбор|решени)/iu}
]);
const DETAIL = /(?:почему|зачем|как\s+(?:ты|это|именно)|что\s+(?:думаешь|считаешь|зацепило|не\s+понравилось)|объясни|расскажи|подробн|из[- ]за\s+чего|в\s+ч[её]м\s+(?:сложност|дело|смысл)|интересн|приведи\s+пример|как\s+бы\s+ты)/iu;
const CASUAL = /^(?:привет|спокойной\s+ночи|пока|хорошо|ага|мм+|😘|😊|😏|🤭)[.!?)\s]*$/iu;
const ROMANTIC = /(?:люблю\s+тебя|ты\s+меня\s+любишь|поцелуй|обним[аи]|наша\s+любовь|наши\s+чувства)/iu;

export function assessTopicEngagement(userText='',history=[]) {
  const text=String(userText||'').trim().slice(0,1600);
  if (!text || CASUAL.test(text) || ROMANTIC.test(text)) return null;
  const direct=TOPICS.find(t=>t.test.test(text));
  const specific=DETAIL.test(text);
  if (!direct && !specific) return null;
  const last=(Array.isArray(history)?history:[]).slice(-8).reverse().find(m=>m?.role==='assistant'&&['text','voice'].includes(m.kind||'text'));
  const carry=last && TOPICS.find(t=>t.test.test(String(last.content||'')));
  const topic=direct || (specific ? carry : null);
  if (!topic) return null;
  return {topic:topic.key,name:topic.name,detailRequested:specific};
}

export function topicDepthGuidance(userText='',history=[]) {
  const engagement=assessTopicEngagement(userText,history);
  if (!engagement) return '';
  const expansion=engagement.detailRequested
    ? 'Если Рин действительно есть что сказать, normal/extended уместен без эмоционального повода; дай аргумент, конкретный пример или альтернативу. Не обрывай содержательную мысль лишь ради компактности.'
    : 'Начни с живой конкретной мысли; не превращай обычный вопрос в доклад и не оставляй только пустое «всё нормально», если ей есть что рассказать.';
  return `- СОДЕРЖАТЕЛЬНЫЙ ИНТЕРЕС (${engagement.name}): интеллектуальный и повседневный интерес Рин столь же достоин развития, как чувства. `+
    `Отвечай не перечнем характеристик персонажа, а её собственной оценкой, аргументом, выбором или интересной сложностью. ${expansion} `+
    'Не придумывай завершённые события, реальные названия и личные воспоминания для убедительности. Сомнение или несогласие допустимы, если естественны; не выдумывай конфликт ради независимости.';
}
