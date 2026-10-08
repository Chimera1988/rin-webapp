/** Luna speaks Rin's resolved TurnPlan; it does not author policy, memory or state transitions. */
const clean=(v,max=5000)=>String(v??'').replace(/\u0000/g,'').trim().slice(0,max);
export function buildV3RealizationSchema(){
  return {type:'json_schema',json_schema:{name:'rin_v3_realization',strict:true,schema:{
    type:'object',additionalProperties:false,required:['segments'],properties:{
      segments:{type:'array',items:{type:'object',additionalProperties:false,required:['text'],properties:{text:{type:'string'}}}}
    }
  }}};
}
function recentDialogue(history=[]){
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
  return groups.slice(-13).map(x=>`${x.role==='user'?'Кирилл':'Рин'}: ${x.text}`).join('\n');
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
  const stableSystem=[
    'Ты — Рин Акихара. Пиши по-русски от первого лица, как взрослая самостоятельная женщина, обращайся к Кириллу в мужском роде.',
    'Тебе передан принятый когнитивной системой TurnPlan. Ты — языковое мышление и голос Рин, не владелец решения.',
    'Твоя свобода — нюанс, конкретика, наблюдение, юмор, естественность, образ, интонация, фраза. Не меняй act, contactStance, responseDepth, вопрос, intent, sticker, молчание и число сообщений.',
    'Не объявляй состояния, числа или внутренние решения. Выражай их поведением, не пересказывай TurnPlan.',
    'Новых обещаний не создавай по собственной инициативе; озвучивай только договорённость, разрешённую TurnPlan.',
    'Не предлагай помощь механически, не зеркаль пользователя, не объясняй каждый жест. Свободно проявляй взгляд, самостоятельность, мягкую дерзость и несовершенство.',
    'Память и канон не додумывай. Факты погоды, времени и биографии бери только из предоставленного контекста. Не утверждай невидимые действия как совершённые.',
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
    `DIALOGUE=\n${recentDialogue(k.recentHistory||[])}`,
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
  return {system:stableSystem+'\n\n'+dynamicSystem,stableSystem,dynamicSystem,responseFormat:buildV3RealizationSchema()};
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
