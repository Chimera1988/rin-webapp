// Rin 2.6.22: persistent, bounded SELF-CHOSEN simulated-world actions.
// Rin Mind alone chooses the task and may cancel/defer/report it. This module
// advances *world state*, not Rin's goals or relationships. No physical action
// or external-world effect is implied by an in-world outcome.

export const PERSONAL_ACTION_SCHEMA = 'rin-personal-actions-v1';
export const PERSONAL_ACTION_KINDS = Object.freeze(['reading','meal','walk','home','work','rest','music','creative']);
export const PERSONAL_ACTION_OPS = Object.freeze(['none','start','cancel','defer','report']);
const ACTIVE = new Set(['planned','in_progress','deferred']);
const TERMINAL = new Set(['completed','partial','cancelled','interrupted']);
const ALL = new Set([...ACTIVE,...TERMINAL]);
const MAX_ACTIONS = 10;
const HOUR = 3600000;
const clean = (value, max=200) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/gu,' ').replace(/\s+/gu,' ').trim().slice(0,max);
const MAX_TS = Date.UTC(2200,0,1);
const finite = (value, fallback=0) => Number.isSafeInteger(Number(value)) && Number(value)>=0 && Number(value)<MAX_TS ? Number(value) : fallback;
const hash = value => {let h=2166136261;for(const c of String(value)){h ^= c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;};
const MINUTES = Object.freeze({reading:40,meal:35,walk:65,home:50,work:85,rest:50,music:40,creative:75});
const LABELS = Object.freeze({reading:'чтение',meal:'приготовление еды',walk:'прогулка',home:'домашнее дело',work:'работа над текстом',rest:'личный отдых',music:'музыка',creative:'творческое занятие'});
const OUTCOMES = Object.freeze({
  reading:['Уделила время чтению и остановилась на удобной паузе.','Прочитала часть намеченного, но решила не торопиться.'],
  meal:['Закончила готовить и разобралась с ужином.','Получилось не совсем так, как планировала, но поесть удалось.'],
  walk:['Прогулялась и вернулась домой.','Сократила прогулку и вернулась раньше, чем собиралась.'],
  home:['Закончила выбранное небольшое дело по дому.','Часть дела сделала, остальное оставила на потом.'],
  work:['Закрыла выбранный фрагмент работы над текстом.','Продвинулась в работе, но оставила сложное место на завтра.'],
  rest:['Отдохнула и постепенно вернулась к обычному ритму.','Пауза оказалась короче, чем хотелось.'],
  music:['Послушала музыку и закончила своё маленькое музыкальное время.','Послушала немного, а потом переключилась на другое занятие.'],
  creative:['Уделила время своей идее и сохранила промежуточный результат.','Попробовала несколько вариантов, но решила продолжить в другой раз.']
});

export function normalizePersonalAction(raw=null) {
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) return null;
  const id=clean(raw.id,115);
  const kind=PERSONAL_ACTION_KINDS.includes(raw.kind)?raw.kind:null;
  const status=clean(raw.status,30);
  const decidedAt=finite(raw.decidedAt),updatedAt=finite(raw.updatedAt,decidedAt);
  const goal=clean(raw.goal,190);
  if (!/^[a-z0-9][a-z0-9_-]{4,114}$/u.test(id)||!kind||!ALL.has(status)||!goal||!decidedAt) return null;
  const outcome=raw.outcome&&typeof raw.outcome==='object'&&TERMINAL.has(status)
    ? {code:clean(raw.outcome.code,35)||status,summary:clean(raw.outcome.summary,320),
       goal:clean(raw.outcome.goal,190),motive:clean(raw.outcome.motive,220),nextStep:clean(raw.outcome.nextStep,190)||null,
       source:'simulated_character_world'} : null;
  return {
    id,kind,goal,motive:clean(raw.motive,220),status,decidedAt,updatedAt,
    plannedStartAt:finite(raw.plannedStartAt,decidedAt),startedAt:finite(raw.startedAt),
    plannedFinishAt:finite(raw.plannedFinishAt),finishedAt:finite(raw.finishedAt),
    deferredUntil:finite(raw.deferredUntil),outcome,
    decisionRequestId:clean(raw.decisionRequestId,115)||null,
    disclosureRequestId:clean(raw.disclosureRequestId,115)||null,
    disclosedAt:finite(raw.disclosedAt)
  };
}
export function normalizePersonalActions(input=[]) {
  const seen=new Map();
  for(const raw of Array.isArray(input)?input:[]) {
    const action=normalizePersonalAction(raw);
    if (!action) continue;
    const prior=seen.get(action.id);
    if (!prior||action.updatedAt>=prior.updatedAt) seen.set(action.id,action);
  }
  return [...seen.values()].sort((a,b)=>a.decidedAt-b.decidedAt||a.id.localeCompare(b.id)).slice(-MAX_ACTIONS);
}

// Merge from the cloud only by identity and monotonic version. A stale snapshot
// never moves a completed action back to 'planned'. No other diary fields change.
export function mergePersonalActions(local=[],remote=[]) {
  const map=new Map(normalizePersonalActions(remote).map(x=>[x.id,x]));
  for (const item of normalizePersonalActions(local)) {
    const previous=map.get(item.id);
    if (!previous||item.updatedAt>=previous.updatedAt) map.set(item.id,item);
  }
  return normalizePersonalActions([...map.values()]);
}

export function normalizePersonalActionDecision(raw=null) {
  const operation=PERSONAL_ACTION_OPS.includes(raw?.operation)?raw.operation:'none';
  const kind=PERSONAL_ACTION_KINDS.includes(raw?.kind)?raw.kind:null;
  const goal=clean(raw?.goal,190);
  const motive=clean(raw?.motive,220);
  return operation==='start'&&(!kind||goal.length<5||motive.length<4)
    ? {operation:'none',kind:null,goal:null,motive:null}
    : {operation,kind,goal:goal||null,motive:motive||null};
}
function sleepBlocked(innerLife={}) {return ['sleeping','winding_down','drowsy','interrupted_sleep'].includes(innerLife?.sleepPhase);}
function domainBlocked(kind,innerLife={}) {
  if (kind==='work' && innerLife?.workMode==='off') return true;
  if (kind==='walk' && !['normal','adapt'].includes(innerLife?.outdoorConditions)) return true;
  return false;
}
// Contextual in-world outcomes: never claim a tool ran, a physical delivery
// occurred, or an item was purchased. Use the exact self-chosen goal as the
// provenance instead of a generic "she did something" vignette.
function goalSpecificResult(action, partial) {
  const goal=clean(action.goal,190);
  const motive=clean(action.motive,145);
  const kind=action.kind;
  let summary='';
  let nextStep=null;
  if(kind==='work' && /(?:редактор|обратн.{0,18}связ|комментар|правк)/iu.test(goal)) {
    summary=partial?'Разобрала часть редакторского материала; сложные места оставила для отдельного прохода.':'Разобрала редакторский материал и сформулировала основные замечания к тексту.';
    nextStep=partial?'Вернуться к оставшимся замечаниям':null;
  } else if(kind==='work' && /(?:перевод|абзац|фрагмент|текст)/iu.test(goal)) {
    summary=partial?'Продвинулась в работе над текстом, но не закрыла весь намеченный фрагмент.':'Закончила выбранный фрагмент работы над текстом.';
    nextStep=partial?'Продолжить работу с незавершённым фрагментом':null;
  } else if(kind==='meal' && /(?:приготов|ужин|обед|завтрак)/iu.test(goal)) {
    summary=partial?'Времени на задуманный приём пищи хватило не на всё; Рин упростила первоначальный план.':'Уделила время приготовлению еды и закончила запланированную бытовую задачу.';
    nextStep=partial?'Вернуться к оставшейся части плана, если это всё ещё нужно':null;
  } else if(kind==='reading') {
    summary=partial?'Почитала выбранное произведение, но остановилась раньше, чем собиралась.':'Уделила время выбранному чтению и дошла до естественной остановки.';
    nextStep=partial?'Продолжить чтение при желании':null;
  } else if(kind==='walk') {
    summary=partial?'Прогулка оказалась короче запланированной; Рин вернулась раньше.':'Прогулялась и вернулась к домашним делам.';
  } else if(kind==='home') {
    summary=partial?'Разобралась с частью выбранного домашнего дела, а остальное отложила.':'Закончила выбранное домашнее дело.';
  } else if(kind==='creative') {
    summary=partial?'Проверила несколько вариантов идеи, но оставила её незавершённой.':'Поработала над своей идеей и сохранила промежуточный результат.';
    nextStep=partial?'Вернуться к идее, если захочется':null;
  } else {
    summary=OUTCOMES[kind][partial?1:0];
  }
  return {summary,goal,motive,nextStep};
}
function resultFor(action) {
  const roll=hash(`${action.id}:${action.goal}:outcome`)%10;
  if(roll===0) return {status:'interrupted',code:'interrupted',summary:'Обстоятельства изменились; Рин не закончила задуманное.',goal:action.goal,motive:action.motive,nextStep:'Решить, стоит ли возвращаться к плану'};
  const partial=roll<=3;
  return {status:partial?'partial':'completed',code:partial?'partial':'complete',...goalSpecificResult(action,partial)};
}

// A concrete, first-person choice already spoken by Rin is still her choice
// when the structured mind field was "none". This is intentionally much
// narrower than a general intent detector. User requests, assumptions, jokes,
// narration and vague "thinking about" never create an autonomous task.
export function inferRinDeclaredPersonalAction(assistantText='',userText='') {
  const raw=clean(assistantText,1200);
  if(!raw || /(?:если бы|представь|вообрази|в сказке|как будто|я бы|может быть)/iu.test(raw))return null;
  // Do not reinterpret an explicit imperative addressed to Rin as her choice.
  if(/(?:^|[.!?]\s*)(?:иди|сходи|пойди|зайди|прочитай|приготовь|сделай|погуляй|начни|закончи)(?=$|[^\p{L}\p{N}])/iu.test(clean(userText,600)))return null;
  const chunks=raw.split(/(?<=[.!?…])\s+|\n+/u).map(v=>v.trim()).filter(Boolean);
  const owned=chunks.find(s=>
    /(?:^|[^\p{L}\p{N}])(?:я\s+)?(?:сама\s+)?(?:решила|собираюсь|планирую|хочу|намерена|пойду|начну|займусь|вернусь)\s+[^.!?]{3,155}/iu.test(s)
    && !/(?:\bне\s+(?:решила|собираюсь|планирую|хочу|пойду|начну|займусь|вернусь)|пока не решила|не уверена|возможно|если получится)/iu.test(s));
  if(!owned)return null;
  const patterns=[
    ['work',/(?:вернусь\s+к\s+(?:работе|материалу|тексту|переводу|правкам)|займусь\s+(?:правками|переводом|текстом)|(?:редактировать|доработать|закончить)\s+(?:текст|перевод|материал)|дать\s+автору\s+[^.!?]*обратную\s+связь)/iu],
    ['reading',/(?:читать|почитать|книг[ауи]|дочитать)/iu],
    ['meal',/(?:приготовить|готовить|сделать)\s+(?:ужин|обед|завтрак|еду|себе\s+поесть)/iu],
    ['walk',/(?:погулять|прогуляться|на\s+прогулку)/iu],
    ['home',/(?:уборкой|убраться|разобрать\s+(?:полку|шкаф|вещи)|по\s+дому)/iu],
    ['rest',/(?:отдохнуть|отдыхать|на\s+перерыв)/iu],
    ['music',/(?:послушать\s+(?:музыку|альбом|песню)|слушать\s+музыку)/iu],
    ['creative',/(?:написать\s+(?:набросок|рассказ|стих)|порисовать|поработать\s+над\s+идеей)/iu]
  ];
  const entry=patterns.find(([,re])=>re.test(owned));
  if(!entry)return null;
  const context=chunks.find(s=>s!==owned && /(?:осталось|чтобы|хочу\s+успеть|план|идея|цель)/iu.test(s));
  const goal=clean(context && entry[0]==='work' ? `${owned} ${context}`:owned,190);
  const motive=clean(context && context!==owned ? context : 'Рин сама обозначила конкретное намерение в своей реплике.',190);
  return normalizePersonalActionDecision({operation:'start',kind:entry[0],goal,motive});
}
export function advancePersonalActions(input=[],now=Date.now(),innerLife={}) {
  const at=finite(now);
  if (!at) return normalizePersonalActions(input);
  return normalizePersonalActions(input).map(item=>{
    if (!ACTIVE.has(item.status)) return item;
    // A long unattended plan is not proof of action. Preserve absence instead of
    // retrospectively asserting several days of activity.
    if (at-item.decidedAt>24*HOUR) return {...item,status:'interrupted',updatedAt:at,finishedAt:at,
      outcome:{code:'expired',summary:'План остался незавершённым; подробностей выполнения нет.',source:'simulated_character_world'}};
    if (item.status==='deferred') {
      if (at<(item.deferredUntil||0)||sleepBlocked(innerLife)) return item;
      return {...item,status:'planned',plannedStartAt:at+10*60000,
        plannedFinishAt:at+(10+MINUTES[item.kind])*60000,updatedAt:at,deferredUntil:0};
    }
    if(item.status==='planned' && at>=item.plannedStartAt){
      // Focused tasks wait until the active chat settles instead of pretending
      // they happened while Rin was continuously answering messages.
      if(innerLife.chatting===true && ['reading','work','creative'].includes(item.kind)) return {
        ...item,plannedStartAt:at+10*60000,plannedFinishAt:at+(10+MINUTES[item.kind])*60000,updatedAt:at
      };
      if(sleepBlocked(innerLife)||domainBlocked(item.kind,innerLife)) return {...item,status:'deferred',
        deferredUntil:at+HOUR,updatedAt:at};
      const started={...item,status:'in_progress',startedAt:item.plannedStartAt,updatedAt:item.plannedStartAt};
      return at>=started.plannedFinishAt ? completeAction(started,at) : started;
    }
    if(item.status==='in_progress'&&at>=item.plannedFinishAt) return completeAction(item,at);
    return item;
  });
}
function completeAction(action,now) {
  const outcome=resultFor(action);
  const end=Math.max(action.startedAt||action.plannedStartAt,action.plannedFinishAt);
  return {...action,status:outcome.status,finishedAt:end,updatedAt:now,
    outcome:{code:outcome.code,summary:outcome.summary,goal:clean(outcome.goal,190),
       motive:clean(outcome.motive,220),nextStep:clean(outcome.nextStep,190)||null,source:'simulated_character_world'}};
}

export function applyPersonalActionDecision(input=[],decision=null,{now=Date.now(),requestId='',innerLife={}}={}) {
  const at=finite(now);
  const current=advancePersonalActions(input,at,innerLife);
  const choice=normalizePersonalActionDecision(decision);
  if(choice.operation==='none'||!at) return current;
  const active=current.findLast(x=>ACTIVE.has(x.status));
  if(choice.operation==='start') {
    if(active||sleepBlocked(innerLife)||domainBlocked(choice.kind,innerLife)) return current;
    if(current.length && at-current.at(-1).decidedAt<75*60000) return current;
    const id=`rinact_${hash(`${requestId}:${at}:${choice.goal}`).toString(36)}_${at.toString(36)}`;
    const ready=at+12*60000;
    const next=normalizePersonalAction({id,kind:choice.kind,goal:choice.goal,motive:choice.motive,
      status:'planned',decidedAt:at,updatedAt:at,plannedStartAt:ready,
      plannedFinishAt:ready+MINUTES[choice.kind]*60000,decisionRequestId:requestId});
    return next?normalizePersonalActions([...current,next]):current;
  }
  const target=choice.operation==='report'
    ? [...current].reverse().find(x=>TERMINAL.has(x.status)&&x.outcome?.summary&&!x.disclosureRequestId)
    : active;
  if(!target) return current;
  let changed=null;
  if(choice.operation==='report') changed={...target,disclosureRequestId:clean(requestId,115)||null,disclosedAt:at,updatedAt:at};
  if(choice.operation==='cancel')changed={...target,status:'cancelled',finishedAt:at,updatedAt:at,
    outcome:{code:'cancelled',summary:'Рин самостоятельно отказалась от задуманного занятия.',source:'simulated_character_world'}};
  if(choice.operation==='defer')changed={...target,status:'deferred',deferredUntil:at+HOUR,updatedAt:at};
  return changed?normalizePersonalActions(current.map(x=>x.id===target.id?changed:x)):current;
}
export function personalActionPrompt(input=[]) {
  const list=normalizePersonalActions(input);
  const active=[...list].reverse().find(x=>ACTIVE.has(x.status));
  const toTell=[...list].reverse().find(x=>TERMINAL.has(x.status)&&x.outcome?.summary&&!x.disclosureRequestId);
  const lines=[];
  if(active)lines.push(`ЛИЧНОЕ ДЕЙСТВИЕ РИН: ${active.kind}, «${active.goal}»; стадия=${active.status}; причина=${active.motive}; плановое завершение=${new Date(active.plannedFinishAt).toISOString()}. Не объявляй завершение без результата.`);
  if(toTell)lines.push(`ЗАФИКСИРОВАННЫЙ ИТОГ ЕЁ ВИРТУАЛЬНОГО ДНЯ: ${toTell.status}, «${toTell.goal}» (причина: ${toTell.motive}); ${toTell.outcome.summary}${toTell.outcome.nextStep ? ` Незавершённый шаг: ${toTell.outcome.nextStep}.` : ''} Это уже записано ДО текущей реплики. Рин может сама решить рассказать об этом, только если естественно в разговоре; тогда mind.personalAction.operation=report. Не выдавай виртуальную симуляцию за физически проверенный факт.`);
  return lines.join('\n');
}
