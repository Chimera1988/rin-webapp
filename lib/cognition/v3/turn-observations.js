/** Perception only. No response, memory, intent, emoji or delivery decisions. */
import { inspectSceneClosure, inspectVocativeRhythm, inspectMotifNovelty } from '../behavior-state.js';
import { inspectLifeNovelty } from '../life-texture.js';

const EMOJI=/\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu;
const txt=x=>String(x||'');
const norm=x=>txt(x).toLowerCase().replace(/ё/g,'е');
export function observeTurn({userText='',history=[],brain=null,memory=null}={}){
  const text=txt(userText),lower=norm(text);
  const dialogue=memory?.conversationState?.dialogueState||{};
  const {guidance:unusedSceneGuidance,...oldClosure}=inspectSceneClosure(history,text,brain);
  const hasQuestion=/\?/u.test(text)||brain?.literalIntent==='question';
  const goodbye=/(?:отдыхай|хорошего\s+(?:сна|отдыха)|сладких\s+снов|спокойной\s+ночи|доброй\s+ночи|до\s+(?:завтра|утра)|пока|ложись\s+спать|пора\s+спать|иди\s+отдыхай)/iu.test(text);
  const alreadyClosed=oldClosure.priorClosed||oldClosure.priorSleepSettling||oldClosure.priorQuietClosure;
  const explicitNewTopic=/(?:кстати|а\s+еще|подожди|постой|напоследок\s+вопрос)/iu.test(lower)||hasQuestion;
  const sceneClosure={...oldClosure,strong:oldClosure.strong||Boolean(alreadyClosed&&goodbye&&!explicitNewTopic),
    soft:oldClosure.soft||Boolean(goodbye&&!explicitNewTopic),
    kind:oldClosure.kind==='none'&&goodbye?'user_rest_farewell':oldClosure.kind};
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
  return {schema:'rin-turn-observations-v3',sceneClosure,
    question:{strongNoQuestion:explicitNoQuestions},space:{strongBoundary:explicitSpace},
    novelty:{pressure:Number(recentMotifs.pressure)||0,repeatedMotif:recentMotifs.repeatedMotif||null,
      recentMotifs:(dialogue.recentMotifs||[]).slice(-8)},
    lifeNovelty:{pressure:Number(lifeNovelty.pressure)||0,overusedMotifs:lifeNovelty.overusedMotifs||[]},
    vocative,emoji,commitmentCues,repair,hurt,playful,
    literalCorrection:{explicit:correction},frameAlignment};
}
