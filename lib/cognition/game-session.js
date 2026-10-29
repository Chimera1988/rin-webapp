// v2.6.26 — bounded conversational game rules, derived from real chat turns.
// No persistent game facts, private state, AI guesses, or invented user preferences.
const norm = value => String(value ?? '').replace(/ё/giu, 'е').replace(/\s+/gu, ' ').trim().toLowerCase();
const clean = (value, limit = 700) => String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit);

const STARTS = [
  { type: 'ten_questions', re: /(?:\b10\b|десят[ьи])\s+вопрос(?:ов|а)?|зада[её]шь\s+(?:мне\s+)?десять\s+вопрос/iu },
  { type: 'word_chain', re: /(?:по\s+одному\s+слову|по\s+очереди\s+(?:пишем|пиш[её]т|называем)\s+(?:по\s+)?(?:одному\s+)?слов)/iu },
  { type: 'two_truths', re: /(?:два\s+правдивых\s+факта\s+и\s+одн[ау]\s+выдумк|два\s+факта\s+и\s+одн[ау]\s+выдумк|две\s+правд[ыи]\s+и\s+одн[ау]\s+лож)/iu }
];
const STOP = /^(?:(?:вс[её]|ну\s+вс[её]|хватит|стоп)[,! .]*(?:игр[ауые]|играем)?|(?:стоп\s+игр[ауые])|(?:давай\s+(?:другую|новую|ещ[её]\s+одну)\s+игру))\s*[)!?.]*$/iu;
const ANSWER_LABEL = /(?:^|[.!?]\s*)вопрос\s+(?:первый|второй|третий|четв[её]ртый|пятый|шестой|седьмой|восьмой|девятый|десятый|одиннадцатый|последний|\d+)[\s:—.-]/iu;
const GAME_STOP = /^(?:стоп\s+игр[ауые]|игра\s+окончена|закончим\s+игру|хватит\s+играть)/iu;

function rowText(item) { return clean(item?.content, 1200); }
function compactTurns(history = []) {
  const rows = Array.isArray(history) ? history.filter(x => ['user','assistant'].includes(x?.role)).slice(-100) : [];
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const key = `${row.role}:${row.turnId || row.requestId || row.id || i}`;
    const prior = out.at(-1);
    if (prior?.key === key) { prior.text += ` ${rowText(row)}`; continue; }
    out.push({ key, role: row.role, text: rowText(row) });
  }
  return out;
}

export function inspectGameSession(history = [], currentUserText = '') {
  const turns = compactTurns(history);
  const current = clean(currentUserText, 1200);
  // For callers whose history excludes the newest user message.
  if (current && !(turns.at(-1)?.role === 'user' && norm(turns.at(-1).text) === norm(current))) {
    turns.push({key:'user:current',role:'user',text:current});
  }
  let start = -1, type = null;
  for (let i = Math.max(0, turns.length - 85); i < turns.length; i++) {
    const t = turns[i], value = t.text.slice(0, 550);
    if (/один\s+вопрос\s+без\s+отговорок/iu.test(value) || /(?:ещ[её]\s+одна\s+игра|предлагаю\s+(?:ещ[её]\s+одну|новую)\s+игру)/iu.test(value)) { start = -1; type = null; continue; }
    if (GAME_STOP.test(value)) { start = -1; type = null; continue; }
    if (STOP.test(value) && type) { start = -1; type = null; continue; }
    for (const item of STARTS) {
      if (item.re.test(value)) { start = i; type = item.type; break; }
    }
    if (start >= 0 && i - start > 75) { start = -1; type = null; }
  }
  if (start < 0 || !type) return null;
  const activeTurns = turns.slice(start + 1);
  const assistantTurns = activeTurns.filter(x => x.role === 'assistant');
  const userTurns = activeTurns.filter(x => x.role === 'user');
  if (type === 'ten_questions') {
    const questionsAsked = assistantTurns.filter(x => ANSWER_LABEL.test(x.text) || x.text.includes('?')).length;
    const passUsed = userTurns.some(x => /^пас(?=$|[^\p{L}])/iu.test(x.text));
    const lastQuestion = assistantTurns.findLast(x => ANSWER_LABEL.test(x.text) || x.text.includes('?'));
    const repliesSinceLast = lastQuestion ? activeTurns.slice(activeTurns.indexOf(lastQuestion) + 1).filter(x => x.role === 'user').length : 0;
    return {type,limit:10,questionsAsked,passUsed,finished: questionsAsked >= 10 && repliesSinceLast > 2,
      nextQuestion: Math.min(10, questionsAsked + 1)};
  }
  if (type === 'word_chain') {
    const contributions = activeTurns.filter(x => /^\p{L}+(?:[’-]\p{L}+)*[.!…]?$/u.test(x.text.trim()));
    const words = contributions.map(x => norm(x.text).replace(/[^\p{L}’-]/gu,''));
    const lastUserWord = [...contributions].reverse().find(x=>x.role==='user');
    return {type, limit:10, contributions:contributions.length, lastUserWord:lastUserWord ? norm(lastUserWord.text).replace(/[^\p{L}’-]/gu,'') : null,
      words:words.slice(-16), finished: contributions.length >= 10};
  }
  const lastUser = userTurns.at(-1);
  const prior = [...turns].reverse().find(x => x.role === 'assistant');
  const pendingGuess = Boolean(lastUser && (prior?.text || '').match(/(?:тво[яй]\s+очередь|твои\s+(?:три|факты)|загада[йи]|слушаю\s+тво[ий]|давай\s+твои)/iu)
    && /(?:,|\sили\s|\sи\s).*(?:я\s|мне\s|бываю|встаю|люблю|был\s|хочу\s)/iu.test(lastUser.text));
  return {type, limit:null, pendingGuess, lastUserText:clean(lastUser?.text || '', 450), lastAssistantText:clean(prior?.text || '', 350), finished:false};
}

export function gameMemoryGuard({userText = '',recentHistory = []} = {}) {
  const text = clean(userText, 1600);
  // The client may send history with the assistant response after this user turn.
  // For grounding, exclude everything after the *user's* original game claim.
  const rows = Array.isArray(recentHistory) ? recentHistory : [];
  const index = rows.findLastIndex(x=>x?.role==='user' && norm(x?.content) === norm(text));
  const sourceHistory = index>=0 ? rows.slice(0,index+1) : rows;
  const game = inspectGameSession(sourceHistory, text);
  if (game?.type !== 'two_truths') return {suppressFacts:false,reason:null};
  if (/^(?:да[,!]|нет[,!]|на\s+самом\s+деле|это\s+правда|правда\s+в\s+том|угадал[аи]?|не\s+угадал[аи]?)/iu.test(text))
    return {suppressFacts:false,reason:'game_reveal'};
  const lastAssistant = [...compactTurns(sourceHistory)].reverse().find(x=>x.role==='assistant');
  const waiting = /(?:твоя\s+очередь|твои\s+(?:три|факты)|загадай|угадывай|давай\s+ты|ты\s+загадываешь)/iu.test(lastAssistant?.text || '');
  const multipleClaims = /(?:^|[^\p{L}])(?:я|мне|мой|моя|люблю|встаю|бываю|был|была)(?=$|[^\p{L}])/iu.test(text)
    && (/,/u.test(text) || /\sили\s/iu.test(text) || /\sи\s(?:я|мне|мой|моя|был|была)/iu.test(text));
  return {suppressFacts: Boolean(multipleClaims && (waiting || game.pendingGuess || /\?\s*$/u.test(text))),
    reason: multipleClaims && (waiting || game.pendingGuess) ? 'unresolved_two_truths_claims' : null};
}


// Even after revealing the lie, an "yes, you guessed it" confirmation does not
// independently establish every preceding proposition. Allow only an explicit
// first-person statement with matching lexical evidence and polarity.
export function gameRevealFactGrounded(factValue = '', userText = '') {
  const user = norm(userText);
  if (!/(?:^|[^\p{L}])(?:я|мне|меня|мой|моя)(?=$|[^\p{L}])/iu.test(user)) return false;
  const lexical = input => new Set((norm(input).match(/\p{L}{4,}/gu)||[])
    .map(word=>word.slice(0,4)).filter(x=> !new Set(['меня','мне','моя','мой','тебе','твоё','этот','вот','когда','было','тогда','само','очен','таки','проc']).has(x)));
  const declared=lexical(user), extracted=lexical(factValue);
  let common=0;
  for(const word of extracted)if(declared.has(word))common++;
  const valueNegative = /(?:^|[^\p{L}])не\s+(?:люб|был|была|хоч|нрав|уме|предпочит|мог|хотел|ездил|встав)/iu.test(norm(factValue));
  const userNegative = /(?:^|[^\p{L}])не\s+(?:люб|был|была|хоч|нрав|уме|предпочит|мог|хотел|ездил|встав)/iu.test(user);
  return common >= 2 && valueNegative === userNegative;
}

function cleanWord(value='') { return norm(value).replace(/[^\p{L}’-]/gu, ''); }
const BACKUP_WORDS = ['случайно','тихо','рядом','вдруг','вместе','снова','бережно','весной','улыбнувшись','потом','неожиданно','навстречу'];
function safeWord(game, proposed='') {
  const normalized=cleanWord(proposed);
  if (/^\p{L}+(?:[’-]\p{L}+)*$/u.test(proposed.trim()) && normalized && normalized!==game?.lastUserWord && !game?.words?.includes(normalized)) return proposed.trim();
  const used=new Set(game?.words || []);
  for(const candidate of BACKUP_WORDS){if(!used.has(candidate) && candidate!==game?.lastUserWord)return candidate;}
  return 'дальше';
}
function oneTextReply(turn, text, purpose='game_reply') {
  const old = turn?.decision || {};
  return { ...turn, decision: {...old, question:{mode:text.includes('?')?'natural':'none',reason:null},
    delivery:{...old.delivery,responseDepth:'micro',messageShape:'single',segments:[{type:'text',purpose,stickerIntent:null,maxChars:Math.max(64,text.length+4)}]}},
    realization:{segments:[{type:'text',purpose,text}]}};
}
export function enforceGameReply(game, turn = null) {
  if (!game || !turn?.decision || !turn?.realization) return turn;
  const text = (turn.realization.segments || []).filter(x=>x.type==='text').map(x=>x.text||'').join(' ').trim();
  if (game.type === 'word_chain') {
    if (game.contributions >= game.limit) return oneTextReply(turn,'Вот и десять слов) Давай прочитаем, что у нас получилось.','game_finish');
    // Each turn contributes exactly one new word, with no sticker or commentary.
    const word = safeWord(game,text);
    return oneTextReply(turn,word,'game_word');
  }
  if (game.type === 'ten_questions') {
    if (!game.finished && game.questionsAsked >= game.limit && /\?|вопрос\s+(?:последний|\d+|одиннадцатый)/iu.test(text)) {
      return oneTextReply(turn,'Все десять вопросов позади) Спасибо, мне было интересно узнавать тебя.','game_finish');
    }
    return turn;
  }
  if (game.type === 'two_truths' && game.pendingGuess &&
      !/(?:выдумк|лож[ьи]|ставлю|полагаю|думаю.*(?:это|перв|втор|трет)|угада)/iu.test(text)) {
    return oneTextReply(turn,'Поставлю на второе утверждение — кажется, именно оно выдумка. Угадала?','game_guess');
  }
  return turn;
}

export function guardImmediateContradictions(text = '',userText = '') {
  let reply=String(text||'');
  const user=norm(userText);
  if (/(?:ты\s+угадал[аи]?|так\s+что\s+ты\s+угадал[аи]?|да,?\s+угадал[аи]?)/iu.test(user)) {
    reply=reply.replace(/(?:^|(?<=\s))Японию\s+я\s+не\s+угадала(?=$|[^\p{L}])/giu,'с Японией я угадала');
    reply=reply.replace(/(?:^|(?<=\s))(?:я\s+)?не\s+угадала(?=$|[^\p{L}])/giu,'я угадала');
  }
  if (/(?:я\s+бы\s+(?:поехал|приехал|заглянул)\s+к\s+тебе\s+в\s+гости)/iu.test(user)) {
    reply=reply.replace(/^(\s*)К\s+тебе\s+в\s+гости(?=$|[^\p{L}])/u,'$1Ко мне в гости');
  }
  return reply;
}

const COMMON = new Set('меня тебе тебя просто будет теперь потом снова потому очень когда только конечно именно вообще сегодня сейчас хорошо тогда такой такая такие может надо можно совсем тоже уже есть свое свой свои которую который которые чтобы даже конечно было были была этот этот ведь много перед назад здесь туда сюда время сказал сказала думаю кажется почему потому будем теперь теперь будто самый самые'.split(' '));
// Frequent subjects of normal conversation are not a stale joke: never strip
// a legitimate topic merely because it came up in several recent turns.
const NON_JOKE_TOPICS = 'проект любовь обним объятия поцелуи отношения человек говорить вопрос ответы память день вечер утро работа музыка книга книги читать чувства спокойствие девушка парень сегодня завтра поздравления поездка япония свобода игра история'.split(' ');
const COMMON_STEMS = new Set([...COMMON,...NON_JOKE_TOPICS].map(w=>w.slice(0,6)));
const stems = text => new Set((norm(text).match(/\p{L}{5,}/gu)||[]).map(w=>w.slice(0,6)).filter(w=>!COMMON_STEMS.has(w)));
// Surface only highly repeated concrete subjects as soft guidance to Rin Mind.
// Never force a topic change when the user deliberately continues the subject.
export function repeatedMotifCandidates(history = [], userText = '') {
  const assistants=compactTurns(history).filter(x=>x.role==='assistant').slice(-8);
  if (assistants.length<4)return [];
  const frequency=new Map(), examples=new Map();
  for (const msg of assistants) {
    for (const token of new Set((norm(msg.text).match(/\p{L}{5,}/gu)||[]))) {
      const root=token.slice(0,6);
      if(COMMON_STEMS.has(root))continue;
      // Count each distinct root once per assistant semantic turn.
      (frequency.get(root) || frequency.set(root, new Set()).get(root)).add(msg.key);
      examples.set(root,token);
    }
  }
  const current=stems(userText);
  return [...frequency.entries()].filter(([root,turns])=>turns.size>=4 && !current.has(root))
    .sort((a,b)=>b[1].size-a[1].size).slice(0,3)
    .map(([root,turns])=>({root,example:examples.get(root),repetitions:turns.size}));
}

export function overusedMotifWords(history = [], userText = '', candidateText = '') {
  const assistants=compactTurns(history).filter(x=>x.role==='assistant').slice(-8);
  if (assistants.length<4)return [];
  const frequency=new Map();
  for (const message of assistants){for(const word of stems(message.text))frequency.set(word,(frequency.get(word)||0)+1);}
  const current=stems(userText), generated=stems(candidateText);
  return [...generated].filter(x=>frequency.get(x)>=4 && !current.has(x));
}
export function reduceStaleMotif(text = '',history = [],userText = '') {
  const repeated=overusedMotifWords(history,userText,text);
  if (!repeated.length) return String(text||'');
  const source=String(text||'');
  const sentences=source.split(/(?<=[.!?])\s+|(?<=\))\s+(?=[А-ЯЁ])/u).filter(Boolean);
  if(sentences.length<2)return source; // no destructive replacement of the entire answer
  const kept=sentences.filter(sentence=> !repeated.some(stem=>stems(sentence).has(stem)));
  return kept.length ? kept.join(' ').trim() : source;
}
