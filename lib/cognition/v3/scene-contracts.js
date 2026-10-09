/** Factual scene contract perception. No action authority; TurnPlan resolves competing obligations. */
const normalized=value=>String(value||'').replace(/\s+/gu,' ').trim().toLowerCase().replace(/ё/gu,'е');
const text=value=>String(value||'').replace(/\s+/gu,' ').trim();
const noQuestion=/(?:без\s+вопросов|не\s+задавай\s+вопросов|не\s+(?:нужно|надо|хочу)\s+(?:мне\s+)?(?:вопросов|расспросов)|не\s+расспрашивай)/iu;
const liftQuestion=/(?:можешь\s+спросить|задай\s+(?:мне\s+)?вопрос|твоя\s+очередь|твой\s+вопрос|теперь\s+спрашивай|спрашивай\s+меня|давай\s+с\s+вопросами)/iu;
const gameOffer=/(?:три\s+вопроса|игр(?:а|у|аем)\s+(?:в\s+)?(?:вопрос|честн)|по\s+очереди\s+зада[её]м|задаем\s+друг\s+другу\s+по)/iu;
const sceneExit=/(?:хватит\s+играть|игра\s+закончена|давай\s+сменим\s+тему|выйдем\s+из\s+игры|больше\s+не\s+играем|игра\s+не\s+интересна)/iu;
const gameHandoff=/(?:твой\s+(?:вопрос|ход)|твоя\s+очередь|после\s+твой\s+вопрос|теперь\s+ты\s+спрашивай|(?:а\s+)?твой\s+вопрос\s+ко\s+мне|вопрос\s+номер\s+\d+\s+от\s+тебя|мы\s+играем\s+в\s+игру\s+три\s+вопроса)/iu;
const userTakesTurn=/(?:моя\s+очередь|мой\s+(?:вопрос|ход)|сейчас\s+я\s+спрашиваю)/iu;
function events(history=[]){
  const result=[];
  for(const item of (Array.isArray(history)?history:[]).slice(-100)){
    if(!['assistant','user'].includes(item?.role)||['sticker','silence'].includes(item?.kind))continue;
    const value=text(item.content||item.text);if(!value)continue;
    const id=item.turnId||item.requestId||item.id||null;
    if(id&&result.at(-1)?.role===item.role&&result.at(-1)?.id===id)result.at(-1).content+=' '+value;
    else result.push({role:item.role,content:value,id});
  }
  return result.slice(-72);
}
export function observeSceneContracts({history=[],userText=''}={}){
  const rows=events(history),u=normalized(userText);
  const preceding=rows.filter(r=>r.role==='user'&&normalized(r.content)===u);
  // Last current user event is already in transport history. Don't accidentally double-count it.
  const context=preceding.length?rows:rows.concat({role:'user',content:userText,id:null});
  const lastBoundary=[...context].reverse().findIndex(r=>r.role==='user'&&(noQuestion.test(r.content)||liftQuestion.test(r.content)));
  const boundaryIndex=lastBoundary<0?-1:context.length-1-lastBoundary;
  const boundary=boundaryIndex>=0?context[boundaryIndex]:null;
  const newerUser=context.slice(boundaryIndex+1).filter(r=>r.role==='user').length;
  const questionRestraint=Boolean(boundary&&noQuestion.test(boundary.content)&&newerUser<=4&&!liftQuestion.test(u));
  let game=null;
  for(let i=context.length-1;i>=0;i--){
    const r=context[i];
    if(!gameOffer.test(r.content))continue;
    const tail=context.slice(i+1);
    if(tail.filter(x=>x.role==='user').length>18||tail.some(x=>sceneExit.test(x.content)))break;
    const accepted=tail.some(x=>x.role==='user'&&/(?:давай|хорошо|соглас|играем|начина|договорились|первый\s+вопрос)/iu.test(x.content));
    if(!accepted)break;
    const afterUser=tail.filter(x=>x.role==='user').filter(x=>/\?/u.test(x.content)&&!/(?:твой\s+(?:вопрос|ход)|твоя\s+очередь)/iu.test(x.content.split('?').at(-1)||''));
    const rinQuestions=tail.filter(x=>x.role==='assistant').filter(x=>/\?/u.test(x.content));
    const explicitHandoff=gameHandoff.test(u);
    const answerThenAsk=explicitHandoff&&/\?/u.test(userText)&&
      /(?:как\s+ты|что\s+ты|почему|что\s+думаешь|что\s+чувствуешь|когда|где|как\s+относишься)/iu.test(userText.split('?')[0]||'');
    // The question that Rin owes is a scene obligation, not generic curiosity.
    const nextTurnForRin=(explicitHandoff||tail.at(-1)?.role==='user'&&/^(?:засчитано|ответил|готов|теперь\s+ты)/iu.test(u))&&!userTakesTurn.test(u);
    const lastRinQuestion=tail.findLastIndex(x=>x.role==='assistant'&&/\?/u.test(x.content));
    const lastUserQuestion=tail.findLastIndex(x=>x.role==='user'&&/\?/u.test(x.content)&&!gameHandoff.test(x.content));
    const lastRinAnswered=tail.some((x,j)=>j>lastUserQuestion&&x.role==='assistant'&&!/\?/u.test(x.content));
    game={type:'alternating_questions',accepted:true,turnNumber:Math.min(3,rinQuestions.length+1),
      rinAsked:rinQuestions.length,userAsked:afterUser.length,onePass:true,
      rinQuestionDue:Boolean(nextTurnForRin&&lastRinAnswered&&lastRinQuestion<=lastUserQuestion&&rinQuestions.length<3),
      answerThenAsk:Boolean(answerThenAsk&&rinQuestions.length<3),
      explicitHandoff,source:'observed_recent_dialogue'};
    break;
  }
  return {questionRestraint,questionBoundaryAge:questionRestraint?newerUser:null,game};
}
