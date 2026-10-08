/** Perception only. No response, memory, intent, emoji or delivery decisions. */
import { inspectSceneClosure, inspectVocativeRhythm, inspectMotifNovelty } from '../behavior-state.js';
import { inspectLifeNovelty } from '../life-texture.js';

const EMOJI=/\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu;
const txt=x=>String(x||'');
const norm=x=>txt(x).toLowerCase().replace(/ё/g,'е');
const cleanSocialLength=x=>txt(x).replace(/\s+/gu,' ').trim().length;
// Observations of a scene, not a second author of its actions. Deliberately
// bounded to recent conversational evidence; no guessed change of sleep phase.
const REST_FAREWELL_RE=/(?:засыпай(?!\p{L})|спи\s+(?:спокойно|моя|уже)|пора\s+(?:тебе\s+)?спать(?!\p{L})|(?:закрывай|прикрой)\s+(?:глазки|глаза)|иди\s+спать(?!\p{L})|(?:давай|может|можно|пойдем|пойдём)\s+(?:ещ[её]\s+)?(?:немного\s+)?(?:по\s*)?сп(?:ать|им)(?!\p{L})|(?:вс[её]|ладно)[,!.\s]*спать(?:[,!.\s]*спать)*|отдохни\s+(?:ещ[её]\s+)?(?:немного|чуть-чуть))/iu;
const RIN_ACCEPTS_REST_RE=/(?:закрываю(?!\p{L})|засыпаю(?!\p{L})|усну(?!\p{L})|уснула(?!\p{L})|проваливаюсь\s+в\s+сон|снова\s+в\s+сон|давай\s+(?:ещ[её]\s+)?(?:немного\s+)?поспим|спать\s+так\s+спать|отдохну|пойду\s+спать)/iu;
const SOFT_ACK_RE=/^(?:(?:[\s\p{Extended_Pictographic}\uFE0F\u200D]+)|(?:(?:угу|ага|ладно|хорошо|договорились|учту\s+это|спокойной\s+ночи|всё\s+правильно|значит,?\s+я\s+(?:всё\s+)?делаю\s+это\s+правильно))[\s\p{Extended_Pictographic}\uFE0F\u200D.!?)]*)$/iu;
function observeSceneFlow(history=[],userText=''){
  const recent=(Array.isArray(history)?history:[]).slice(-18);
  const rin=recent.filter(m=>m?.role==='assistant'&&m.kind!=='silence'&&m.kind!=='sticker'&&m.content).slice(-7);
  const recentWords=rin.map(m=>norm(m.content));
  const mmOpenings=recentWords.filter(t=>/^(?:мм|м-м|мгм)[….,!\s]/iu.test(t)).length;
  const sleepMentions=recentWords.filter(t=>/(?:сонн|туман|почти\s+(?:сплю|уснула|заснула|засыпаю)|морган|морг(?!\p{L})|всё\s+ещё\s+сон)/iu.test(t)).length;
  const lastUserRest=recent.map((m,i)=>({m,i})).filter(x=>x.m.role==='user'&&REST_FAREWELL_RE.test(txt(x.m.content))).at(-1);
  // An earlier bedtime agreement is only relevant while that same closing
  // exchange is still active. Do not keep suppressing later conversations.
  const afterRest=lastUserRest?recent.slice(lastUserRest.i+1):[];
  const accepted=Boolean(lastUserRest&&afterRest.filter(m=>m.role==='user').length<=3&&
    afterRest.some(m=>m.role==='assistant'&&RIN_ACCEPTS_REST_RE.test(txt(m.content))));
  const sleepFarewell=REST_FAREWELL_RE.test(userText)&&!/(?:не\s+(?:спи|засыпай)|а\s+если|что\s+если)/iu.test(userText);
  const settledAfterFarewell=Boolean(accepted&&SOFT_ACK_RE.test(userText.trim()));
  const currentPlay=/(?:😏|🤭|😉|😎|хитр|китсуне|кицун|поцелу|целую|обним|😘|💋|хвостик|ушки|поглад|разбуд)/iu.test(userText);
  const topicSwitch=/(?:кстати|сменим\s+тему|поговорим\s+о|вопрос\s+по|по\s+работе|погод|код|репозитор|тест|документ|что\s+читаешь|что\s+за\s+книга)/iu.test(userText);
  const plausibleContinuation=currentPlay||(!topicSwitch&&!/\?/u.test(userText)&&userText.trim().length<=90);
  const sustainedPlay=plausibleContinuation&&recent.slice(-9).filter(m=>m.role==='user'&&/(?:😏|🤭|😉|хитр|китсуне|кицун|поцелу|целую|обним|😘|💋)/iu.test(txt(m.content))).length>=2;
  return {sleepFarewell,settledAfterFarewell,sustainedPlay,
    repeatedOpening:mmOpenings>=3,repeatedSleepBeat:sleepMentions>=3,
    mmOpenings,sleepMentions};
}
export function observeTurn({userText='',history=[],brain=null,memory=null}={}){
  const text=txt(userText),lower=norm(text);
  const dialogue=memory?.conversationState?.dialogueState||{};
  const {guidance:unusedSceneGuidance,...oldClosure}=inspectSceneClosure(history,text,brain);
  const sceneFlow=observeSceneFlow(history,text);
  const hasQuestion=/\?/u.test(text)||brain?.literalIntent==='question';
  const goodbye=/(?:отдыхай|хорошего\s+(?:сна|отдыха)|сладких\s+снов|спокойной\s+ночи|доброй\s+ночи|до\s+(?:завтра|утра)|пока|ложись\s+спать|пора\s+спать|иди\s+отдыхай)/iu.test(text);
  const alreadyClosed=oldClosure.priorClosed||oldClosure.priorSleepSettling||oldClosure.priorQuietClosure;
  const explicitNewTopic=/(?:кстати|а\s+еще|подожди|постой|напоследок\s+вопрос)/iu.test(lower)||hasQuestion;
  const sceneClosure={...oldClosure,
    strong:oldClosure.strong||Boolean(alreadyClosed&&goodbye&&!explicitNewTopic)||sceneFlow.settledAfterFarewell,
    soft:oldClosure.soft||Boolean(goodbye&&!explicitNewTopic)||sceneFlow.sleepFarewell,
    kind:sceneFlow.settledAfterFarewell?'rest_settled':sceneFlow.sleepFarewell?'user_rest_farewell':
      oldClosure.kind==='none'&&goodbye?'user_rest_farewell':oldClosure.kind};
  const explicitNoQuestions=/(?:не\s+(?:надо|нужно|хочу|задавай|спрашивай|расспрашивай)[^.!?]{0,30}(?:вопрос|спрашив|расспрашив)|без\s+вопросов|не\s+задавай\s+вопросов)/iu.test(text);
  const explicitSpace=/(?:оставь\s+меня\s+в\s+покое|не\s+пиши\s+мне|дай\s+мне\s+побыть\s+одному|мне\s+нужно\s+побыть\s+одному)/iu.test(text);
  const recentMotifs=inspectMotifNovelty(dialogue.recentMotifs||[]);
  const lifeNovelty=inspectLifeNovelty(dialogue.recentLifeBeats||[]);
  const {guidance:unusedVocativeGuidance,...vocative}=inspectVocativeRhythm(history,text);
  const correction=brain?.relation?.type==='correction'||/(?:не\s+то\s+имел|я\s+имел\s+в\s+виду|не\s+так\s+поняла|ты\s+не\s+так\s+поняла|не\s+об\s+этом|я\s+говорил\s+не\s+про)/iu.test(lower);
  const hurt=/(?:обидн|обидел|задел|неприятн|расстро|не\s+нравится|ты\s+меня\s+не\s+слыш)/iu.test(lower);
  const playful=/(?:шуч|игра|поддраз|смею|ха-ха|ахаха|хи-хи|😏|😁|😉)/iu.test(text);
  const repair=/(?:прости|извини|не\s+хотел\s+обид|помир|давай\s+разберем)/iu.test(lower);
  const frameAlignment=correction&&!playful?'misread':repair?'repair_seeking':hurt&&!playful?'uncertain':'aligned';
  // Observations, not extra policy owners: a conversational beat and its reason.
  // The TurnPlan is still the only module allowed to select a response action.
  const careForRin=/(?:ты\s+(?:устала|отдохнула|выспалась|замерзла)|тебе\s+(?:лучше|теплее|полегче)|отдыхай|береги\s+себя|выпей\s+(?:чай|воды)|попей\s+чай|завар[иь]\s+чай)/iu.test(lower);
  const playfulInvitation=playful||/(?:хитрец|хитрюг|хитрая|коварн|поймал|попалась|подловил|подразн|суд\s+присяжных|в\s+чем\s+я\s+виновен)/iu.test(lower);
  const personalInterest=/(?:а\s+(?:ты|у\s+тебя)(?:\s|[?!,.]|$)|что\s+ты\s+(?:думаешь|чувствуешь|хочешь)|как\s+ты\s+(?:сама|себя)|тебе\s+(?:нравится|хочется)|твое\s+мнение|по-твоему)/iu.test(lower);
  // Mark only unmistakable play-questions; real requests for facts still get answers.
  const playfulRhetorical=playfulInvitation&&/(?:суд\s+присяжных|в\s+чем\s+я\s+виновен|ну\s+и\s+кто\s+(?:тут|здесь)|а\s+кто\s+у\s+нас\s+тут|ну\s+что,?\s+попалась)/iu.test(lower);
  const seriousCorrection=correction&&!playfulInvitation;
  const seriousHurt=hurt&&!playfulInvitation;
  const smallSocialBeat=cleanSocialLength(text)<=95&&(!hasQuestion||playfulRhetorical)&&!seriousCorrection&&!seriousHurt;
  const morningGreeting=/^\s*(?:доброе\s+утро|с\s+добрым\s+утром)(?!\p{L})/iu.test(text);
  const explicitGreeting=/^\s*(?:(?:доброе\s+утро|с\s+добрым\s+утром)|добрый\s+(?:день|вечер)|доброй\s+ночи)(?!\p{L})/iu.test(text);
  // A split needs two contentful conversational beats, not a random newline
  // or a requested token count. Fatigue may shorten each beat, not ban split.
  const multiBeat=(cleanSocialLength(text)>=58&&
    (/(?:[.!?…]\s+[А-ЯЁ]|(?:^|\s)(?:а\s+ещ[её]|кстати|и\s+ещ[её])(?=\s|[,.!?:]|$)|\n\s*\S)/iu.test(text)||
      /(?:^|\s)и\s+(?:готов|хочу|думаю|собираюсь|решил|помню)(?=\s|[,.!?:]|$)/iu.test(text)))||
    (explicitGreeting&&/(?:надеюсь\s+не\s+разбудил|как\s+ты\s+себя\s+чувствуешь)/iu.test(text));
  const socialCues={careForRin,playfulInvitation,playfulRhetorical,personalInterest,seriousCorrection,
    seriousHurt,repairAttempt:repair,smallSocialBeat,multiBeat,explicitGreeting,morningGreeting};
  const recentAssistant=(Array.isArray(history)?history:[]).filter(x=>x?.role==='assistant').slice(-6);
  const userEmojis=[...new Set(text.match(EMOJI)||[])].slice(0,4);
  const recentEmojis=recentAssistant.flatMap(x=>txt(x.content).match(EMOJI)||[]).slice(-10);
  const repeats=recentEmojis.reduce((m,e)=>Math.max(m,recentEmojis.filter(x=>x===e).length),0);
  const emoji={userEmojis,recentRinEmojis:recentEmojis,mirrorRisk:userEmojis.length>0,
    pressure:Math.min(100,recentEmojis.length*11+Math.max(0,repeats-1)*15)};
  const commitmentCues={fulfillment:/(?:сделал(?:а)?|выполн|готово|держу\s+слово|как\s+обещал)/iu.test(lower),
    release:/(?:освобождаю\s+от\s+обещания|можешь\s+не\s+обещать|не\s+обязательно\s+теперь|договоренность\s+отменяется)/iu.test(lower),
    renegotiation:/(?:давай\s+перенесем|давай\s+передоговоримся|поменяем\s+условия|не\s+смогу\s+как\s+обещал)/iu.test(lower),
    insist:/(?:ты\s+обещала|мы\s+же\s+договорились|не\s+отступай\s+от\s+обещания)/iu.test(lower),
    compromise:/(?:давай\s+(?:найдем|поищем)\s+компромисс|можно\s+частично|сойдемся\s+на)/iu.test(lower),
    explicitFulfilled:/(?:ты\s+выполнила\s+обещание|обещание\s+выполнено|договоренность\s+выполнена)/iu.test(lower),
    explicitBroken:/(?:ты\s+нарушила\s+обещание|договоренность\s+нарушена)/iu.test(lower),
    honor:/(?:держим\s+слово|как\s+договаривались|помню\s+нашу\s+договоренность)/iu.test(lower)};
  return {schema:'rin-turn-observations-v3',sceneClosure,sceneFlow,
    question:{strongNoQuestion:explicitNoQuestions},space:{strongBoundary:explicitSpace},
    novelty:{pressure:Number(recentMotifs.pressure)||0,repeatedMotif:recentMotifs.repeatedMotif||null,
      recentMotifs:(dialogue.recentMotifs||[]).slice(-8)},
    lifeNovelty:{pressure:Number(lifeNovelty.pressure)||0,overusedMotifs:lifeNovelty.overusedMotifs||[]},
    vocative,emoji,commitmentCues,repair,hurt,playful,socialCues,
    literalCorrection:{explicit:correction},frameAlignment};
}
