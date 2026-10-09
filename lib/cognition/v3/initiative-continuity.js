/** Bounded conversational evidence inspired by Rin Mind 2.x.
 * Observation only: never chooses an act, changes the physical schedule or creates facts.
 */
const clean=value=>String(value||'').replace(/\s+/gu,' ').trim();
const lowered=value=>clean(value).toLowerCase().replace(/ё/gu,'е');
const PAPER_RE=/(?:бумаг|документ|редактур|правк|рабоч(?:ий|ие|их|ими)\s+(?:стол|бумаг|текст))/iu;
const FINISHED_RE=/(?:(?:уже|все|наконец|окончательно)[^.!?]{0,65}(?:убрал[аи]?|закончила|закончено|закрыла|спрятала|отложила|переключилась)|(?:убрал[аи]?|закончила|закрыла)[^.!?]{0,35}(?:бумаг|документ|работ))/iu;
const STILL_WORKING_RE=/(?:(?:сейчас|еще|пока|опять|снова|почти)[^.!?]{0,55}(?:убираю|заканчиваю|занимаюсь|разбираю|редактирую)|(?:убираю|заканчиваю|разбираю|редактирую)[^.!?]{0,55}(?:бумаг|документ|редактур|правк))/iu;
const STOP_WORDS=new Set(['тебя','тебе','сейчас','когда','тогда','потом','потому','только','можно','будет','должна','просто','сегодня','немного','снова','хорошо','кажется','очень','почему','вообще','чтобы','будто','конечно','котор','теперь','знаешь','нужно','спокой','поцел','обнима','говори','пока']);

function assistantTurns(history=[]){
  const result=[];
  for(const item of (Array.isArray(history)?history:[]).slice(-32)){
    if(item?.role!=='assistant'||item.kind==='sticker'||item.kind==='silence')continue;
    const text=clean(item.content||item.text);
    if(!text)continue;
    const turnId=item.turnId||item.requestId||null;
    if(turnId && result.at(-1)?.turnId===turnId)result.at(-1).text+=' '+text;
    else result.push({text,turnId});
  }
  return result.slice(-10);
}

export function inspectConversationAgency({history=[],userText='',innerLife={}}={}){
  const user=lowered(userText);
  const rin=assistantTurns(history);
  const recent=rin.slice(-7);
  const workContext=PAPER_RE.test(recent.map(r=>r.text).join(' '));
  // An explicit prior completion claim cannot be undone by a fictional returning
  // pile of papers. It remains evidence of what Rin said, NOT physical proof.
  const completions=rin.map((r,i)=>({i,text:r.text})).filter(r=>FINISHED_RE.test(lowered(r.text))&&
    !/(?:не\s+закончила|не\s+убрала|почти[^.!?]{0,12}закончила|пока\s+не\s+закончила|ещ[её]\s+не\s+закончила)/iu.test(r.text)&&
    (PAPER_RE.test(r.text)||(workContext&&/(?:их|переключилась\s+на\s+вечер)/iu.test(r.text))));
  const lastCompletion=completions.at(-1)||null;
  const subsequent=lastCompletion?rin.slice(lastCompletion.i+1):[];
  const reopened=Boolean(lastCompletion&&subsequent.some(r=>PAPER_RE.test(r.text)&&STILL_WORKING_RE.test(lowered(r.text))));
  const topicInvitation=/(?:о\s+ч[её]м\s+(?:еще\s+|теперь\s+)?поговорим|о\s+ч[её]м\s+ты\s+хочешь\s+поговорить|выбирай\s+тем[уy]|предложи\s+тем[уy]|расскажи\s+(?:что-нибудь|что\s+нибудь)\s+(?:сво[её]|интересн)|чего\s+тебе\s+хочется\s+обсудить)/iu.test(user);
  const userSwitchesTopic=/(?:давай\s+(?:сменим\s+тему|о\s+другом)|сменим\s+тему|кстати[,!:.\s]|а\s+теперь\s+(?:поговорим|расскажи)\s+о)/iu.test(user);
  const offersWait=/(?:(?<![а-яё])подожду(?![а-яё])|подождать|могу\s+подождать|побуду\s+рядом|(?:можешь|давай)\s+(?:пока\s+)?(?:закончить|доделать)|не\s+буду\s+мешать)/iu.test(user);
  const challengesCompletion=/(?:(?:уже|снова|опять)[^.!?]{0,55}(?:законч|появил|бумаг|работ)|(?:бумаг|работ)[^.!?]{0,50}(?:снова|опять|появил))/iu.test(user);
  const papers=recent.filter(r=>PAPER_RE.test(r.text)).length;
  // Detect an overused *conversational* prop without mistaking it for a newly
  // occurring event. Generic lexical echo is not a reason to invent a topic.
  const wordCounts=new Map();
  for(const r of recent){
    const roots=new Set((lowered(r.text).match(/[а-я]{6,}/gu)||[]).map(word=>word.slice(0,5))
      .filter(root=>!STOP_WORDS.has(root)));
    for(const root of roots)wordCounts.set(root,(wordCounts.get(root)||0)+1);
  }
  const repeatedRoots=[...wordCounts.entries()].filter(([_,n])=>n>=4).sort((a,b)=>b[1]-a[1]).slice(0,3).map(x=>x[0]);
  const saturated=papers>=3||repeatedRoots.length>0;
  const currentActivity=lowered(innerLife?.activity);
  const doingWork=/(?:работ|редакт|правк|перевод|текст|документ|материал|бумаг)/u.test(currentActivity);
  const newTaskGrounded=doingWork&&/(?:нов(?:ая|ое|ый|ую|ого|ые)\s+(?:работ|задач|перевод|документ|текст|материал)|друг(?:ая|ой|ое|ие)\s+(?:задач|перевод|текст|работ))/iu.test(currentActivity);
  return {
    topicInvitation,userSwitchesTopic,offersWait,challengesCompletion,
    topicSaturation:{saturated,repeatCount:papers,repeatedRoots},
    workContinuity:{claimedCompleted:Boolean(lastCompletion),priorClaim:lastCompletion?.text||null,
      reopened,doingWork,workContext,newTaskGrounded},
    observationOnly:true
  };
}
