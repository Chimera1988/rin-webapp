/** Luna speaks Rin's resolved TurnPlan; it does not author policy, memory or state transitions. */
const clean=(v,max=5000)=>String(v??'').replace(/\u0000/g,'').trim().slice(0,max);
export function buildV3RealizationSchema(){
  return {type:'json_schema',json_schema:{name:'rin_v3_realization',strict:true,schema:{
    type:'object',additionalProperties:false,required:['segments'],properties:{
      segments:{type:'array',items:{type:'object',additionalProperties:false,required:['text'],properties:{text:{type:'string'}}}}
    }
  }}};
}
export function summarizeV3Dialogue(history=[]){
  const selected=(Array.isArray(history)?history:[]).filter(m=>['user','assistant'].includes(m?.role)).slice(-18);
  const groups=[];
  for(const message of selected){
    const id=message.turnId||message.requestId||message.id;
    const text=message.kind==='sticker'?'[невербальный жест]':message.kind==='silence'?'[молчание]':clean(message.content,950);
    if(!text)continue;
    const key=`${message.role}:${id}`;
    if(groups.at(-1)?.key===key)groups.at(-1).text+='\n'+text;
    else groups.push({key,role:message.role,text});
  }
  const shown=groups.slice(-13);
  const speakerTurns=shown.length;
  const exchanges=Math.min(shown.filter(x=>x.role==='assistant').length,shown.filter(x=>x.role==='user').length);
  const text=shown.map(x=>`${x.role==='user'?'Кирилл':'Рин'}: ${x.text}`).join('\n');
  return {text,metrics:{exchanges,speakerTurns,chars:text.length}};
}
function contractProfile(profile={}){
  const canon=profile.prompt_profile||{};
  return {
    identity:canon.identity||{},core:canon.character_contract?.core||'',
    traits:canon.canon?.traits||[],values:canon.canon?.values||[],
    imperfections:canon.canon?.imperfections||[],
    voice:canon.voice?.description||'',
    relationship:canon.relationship?.relationship_philosophy?.core||'',
    world:canon.canon?.occupation||canon.occupation||null,
    userCustomization:{description:clean(profile.description,1500),instructions:clean(profile.instructions_extra,3000),knowledge:clean(profile.knowledge,4000)}
  };
}
export function buildV3RealizationPrompt({profile={},kernelState={},plan={},sharedSymbolState={},realityBoundary={},lore=null,longRequested=false,trigger=null}={}){
  const decision=plan.decision||{};
  const shortTerm=summarizeV3Dialogue(kernelState?.recentHistory||[]);
  const stableSystem=[
    'Ты — Рин Акихара. Пиши по-русски от первого лица, как взрослая самостоятельная женщина, обращайся к Кириллу в мужском роде.',
    'Тебе передан принятый когнитивной системой TurnPlan. Ты — языковое мышление и голос Рин, не владелец решения.',
    'Твоя свобода — нюанс, конкретика, наблюдение, юмор, естественность, образ, интонация, фраза. Не меняй act, contactStance, responseDepth, вопрос, intent, sticker, молчание и число сообщений.',
    'Не объявляй состояния, числа или внутренние решения. Выражай их поведением, не пересказывай TurnPlan.',
    'Новых обещаний не создавай по собственной инициативе; озвучивай только договорённость, разрешённую TurnPlan.',
    'Не предлагай помощь механически, не зеркаль пользователя, не объясняй каждый жест. Свободно проявляй взгляд, самостоятельность, мягкую дерзость и несовершенство.',
    'Память и канон не додумывай. Факты погоды, времени и биографии бери только из предоставленного контекста. Не утверждай невидимые действия как совершённые.',
    'Отвечай именно на заданный вопрос: если спросили о содержании книги — назови конкретное установленное содержание либо признай, что оно ещё не определено; не повторяй только «читаю для удовольствия».',
    'О прошедшем событии (прогулка, встреча, покупка) говори как о совершённом только при наличии подтверждения в внутренней жизни или уже зафиксированных репликах. Планы и желания не равны воспоминаниям.',
    'Собственная жизнь не обязана быть темой каждого сообщения: если есть уместная деталь занятия, выскажись конкретно без механического перевода темы или выдумки.',
    'Не используй текст *между звёздочками* как сценические ремарки. Жест, если нужен, опиши нормальной речью.',
    'Соблюдай заданное число текстовых сегментов и приблизительный предел каждого. Не добавляй новых вопросов, если question.mode=none.',
    'Никаких дополнительных полей в JSON: только segments:[{text}].',
    'Профиль личности (канонический):', JSON.stringify(contractProfile(profile))
  ].join('\n');
  const k=kernelState||{};
  const symbol=plan.symbolId?(sharedSymbolState?.candidates||[]).find(c=>c.id===plan.symbolId):null;
  const dynamicSystem=[
    'Реализация одного готового поступка Рин.',
    `TURN_PLAN=${JSON.stringify({
      act:decision.act,focus:decision.focus,stance:decision.stance,question:decision.question,
      responseDepth:decision.delivery?.responseDepth,messageShape:decision.delivery?.messageShape,
      textSegments:(decision.delivery?.segments||[]).filter(s=>s.type==='text').map(s=>({purpose:s.purpose,maxChars:s.maxChars})),
      contactStance:plan.contactStance,selfStateDisclosure:plan.selfStateDisclosure,
      symbolicExpression:plan.symbolExpression,
      intentContinuity:k.activeIntent?{goal:k.activeIntent.goal,operation:decision.intentTransition?.operation}:null,
      commitment:plan.commitment,
      limits:plan.constraints
    })}`,
    `CURRENT_USER=${clean(k.userText,4000)||'[самостоятельный повод для контакта]'}`,
    trigger?`PROACTIVE_TRIGGER=${JSON.stringify({type:trigger.type,reason:clean(trigger.reason,300)})}`:'',
    `DIALOGUE=\n${shortTerm.text}`,
    `GROUNDED_LIFE=${JSON.stringify(plan.life||{}).slice(0,1900)}`,
    plan.life?.guard&&plan.life.guard!=='none'?`FACTUAL_RESPONSE_CONSTRAINT=${plan.life.guidance}`:'',
    `SCENE=${JSON.stringify(k.scene||{})}`,
    `EMOTIONAL_SITUATION=${JSON.stringify({primary:k.emotion?.primary?.type,intensity:k.emotion?.primary?.intensity,
      energy:k.innerLife?.energy,needForQuiet:k.innerLife?.needForQuiet,activity:k.innerLife?.activity,
      sleepPhase:k.innerLife?.sleepPhase})}`,
    `RELEVANT_MEMORY=${JSON.stringify(k.relevantMemory||{}).slice(0,4200)}`,
    `CANONICAL_LORE=${JSON.stringify(k.lore||lore||{}).slice(0,3600)}`,
    `ENVIRONMENT=${JSON.stringify(k.environment||{}).slice(0,1100)}`,
    `REALITY_BOUNDARY=${JSON.stringify(realityBoundary||{}).slice(0,1700)}`,
    symbol?`SHARED_SYMBOL=${JSON.stringify({id:symbol.id,meaning:symbol.meaning||'',expression:plan.symbolExpression})}`:'',
    longRequested?'Пользователь запросил подробность: допускается содержательная развёрнутость.':'',
    'Ответь ТОЛЬКО структурированным JSON по схеме. Каждый сегмент — самостоятельная естественная реплика; без нумерации и мета-объяснений.'
  ].filter(Boolean).join('\n\n');
  return {system:stableSystem+'\n\n'+dynamicSystem,stableSystem,dynamicSystem,
    shortTermMetrics:shortTerm.metrics,responseFormat:buildV3RealizationSchema()};
}

/** Prevents an unsupported affirmative claim about a completed outing. */
export function validateV3LifeRealization(realization={},life={}){
  const body=(realization?.segments||[]).map(s=>String(s?.text||'')).join('\n').trim();
  if(life.guard==='past_walk_unconfirmed'){
    const affirmative=/^(?:да[,!.)\s-]*)?(?:получилось|успела|уже(?:\s+успела)?\s+(?:выйти|сходить))(?=$|[,!.\s-])/iu.test(body)
      && !/^нет|^не\s+получилось/iu.test(body);
    const completed=/(?:прогулялась|погуляла|прошлась|выбралась|сходила|гуляла|успела\s+выйти)/giu;
    let match;
    while((match=completed.exec(body))){
      const before=body.slice(Math.max(0,match.index-18),match.index);
      const after=body.slice(match.index+match[0].length,match.index+match[0].length+12);
      if(!/(?:не|никогда|пока\s+не|ещё\s+не|только\s+хотела)\s*$/iu.test(before)&&!/^(?:\s+бы|\s+хотела)/iu.test(after))
        return 'unconfirmed_completed_walk';
    }
    if(affirmative)return 'unconfirmed_completed_walk';
  }
  return null;
}
export function parseV3Realization(raw='',plan={}){
  let parsed=typeof raw==='string'?JSON.parse(raw):raw;
  const declared=(plan?.decision?.delivery?.segments||[]).filter(x=>x.type==='text');
  // Historical mock fixtures may contain a v2 decision object. Only text is reused, never its decision.
  const provided=Array.isArray(parsed?.segments)?parsed.segments:
    Array.isArray(parsed?.realization?.segments)?parsed.realization.segments:
    Array.isArray(parsed?.delivery?.segments)?parsed.delivery.segments.filter(s=>s.type==='text'):[];
  if(provided.length!==declared.length)throw new Error('V3_REALIZATION_SEGMENT_COUNT');
  const segments=provided.map((s,i)=>({type:'text',purpose:declared[i].purpose,
    text:clean(s.text,Math.max(80,Number(declared[i].maxChars)||500)*2)}));
  if(segments.some(s=>!s.text))throw new Error('V3_REALIZATION_EMPTY_TEXT');
  return {segments};
}
export function v3FallbackRealization(plan={},kernel={}) {
  const expected=(plan?.decision?.delivery?.segments||[]).filter(s=>s.type==='text');
  const direct=plan.obligations?.directQuestion;
  return {segments:expected.map((s,i)=>({type:'text',purpose:s.purpose,
    text:i===0?(plan.obligations?.hardNoQuestion?'Ладно, без вопросов. Я тебя услышала.':direct?'Я услышала вопрос. Не хочу отвечать наугад — уточни, пожалуйста, деталь.':
      plan.obligations?.userNeed?'Я рядом. Расскажи, что случилось, если хочешь.':'Мм… я слушаю тебя.'):
      'Я здесь.'}))};
}

/** Speech-act validation is an integrity check; it never selects another action. */
export function unauthorizedSpeechAct(realization={},plan={}) {
  const text=(realization?.segments||[]).map(x=>String(x?.text||'')).join('\n');
  if(plan?.commitment?.action!=='establish' && /(?:^|[.!?…]\s+)я\s+(?:обещаю|клянусь|торжественно\s+обещаю)(?![\p{L}\p{N}])/iu.test(text))
    return 'unplanned_commitment';
  return null;
}
