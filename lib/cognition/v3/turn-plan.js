/** Sole owner of behavioral action. Domain modules contribute observations, not commands. */
import { normalizeTurnDecision } from '../turn-decision.js';
import { inspectGroundedLife } from './life-continuity.js';

const clamp=(x,min=0,max=1)=>Math.max(min,Math.min(max,Number(x)||0));
const trim=(x,n=260)=>String(x||'').replace(/\s+/g,' ').trim().slice(0,n);
const NO_INTENT={operation:'none',goal:null,motive:null,target:null,nextMove:null,progress:null,commitment:null,reason:null};

export function buildCognitiveTurnPlan({settled={},kernelState={},observations={},stickerState={},stickerCandidates=[],sharedSymbolState={},longRequested=false,trigger=null}={}) {
  const b=settled.behavioralState||{}, k=kernelState||{}, percept=k.perception||{},scene=k.scene||{};
  const life=inspectGroundedLife({kernelState:k});
  const signals=new Set(percept.signals||[]);
  const question=Boolean(settled.evidence?.userQuestion||signals.has('direct_question_present'));
  const userNeeds=Boolean(settled.evidence?.distress||signals.has('user_seeks_emotional_presence')||signals.has('repair_attempt'));
  const obligation=question||userNeeds||signals.has('user_correction_present')||Boolean(k.replyTarget)||Boolean(trigger);
  const goodbye=signals.has('explicit_farewell') || /^(?:спокойной ночи|до завтра|до утра|пока|увидимся)/iu.test(trim(k.userText));
  const closure=observations?.sceneClosure||{};
  const strongClosure=Boolean(closure.strong);
  const isSilence=strongClosure&&!obligation && b.silence>=.25;
  const needsRecovery=(k.innerLife?.sleepPhase==='interrupted_sleep'||k.innerLife?.sleepPhase==='sleeping');
  const tired=Number(k.innerLife?.energy)<38||Number(k.innerLife?.needForQuiet)>76;
  const spaceBoundary=Boolean(observations?.question?.strongNoQuestion||observations?.space?.strongBoundary);
  const contactStance=b.setBoundary>.62&&b.approach<.45?'boundary_without_withdrawal'
    : b.approach>=.43&&(b.support>=.5||userNeeds)?'supportive_presence'
    : b.approach>=.43&&(b.silence>=.35||tired)?'quiet_presence'
    : b.approach>=.45?'open':'strained_presence';
  let depth='normal';
  if(isSilence)depth='micro';
  else if(longRequested)depth='extended';
  else if(needsRecovery||tired||goodbye)depth='short';
  else if(!question&&!userNeeds&&(/^(да|ага|угу|ясно|окей|хорошо|понятно|ладно|спасибо|и тебе)[.! )]*$/iu.test(trim(k.userText))||strongClosure))depth='micro';
  else if(question&&trim(k.userText).length>160)depth='normal';
  const askAllowed= !isSilence&&!goodbye&&!spaceBoundary&&!question&&!strongClosure&&!userNeeds
    &&b.ask>=.37&&b.initiative>=.34&& !observations?.question?.strongNoQuestion;
  const questionMode=askAllowed?'natural':'none';
  const bound={micro:150,short:320,normal:740,extended:1800}[depth];
  const symbol=(sharedSymbolState?.candidates||[]).find(c=>Number(c.activation)>=60 && Number(c.repetitionPressure||0)<65)||null;
  const symbolMode=symbol&&(b.play>=.4||b.tenderGesture>=.45)&&!userNeeds?'subtle':'none';
  const userGesture=/(?:😘|💋|🤗|🥰|❤️|обним|целую|поцелу|ласк|нежно)/iu.test(k.userText||'');
  const meaningfulGesture=Boolean(stickerState.explicitGesture || userGesture);
  const seenSince=stickerState.turnsSinceSticker==null?99:Number(stickerState.turnsSinceSticker);
  const spontaneousGesture=b.tenderGesture>=.78&&b.initiative>=.43&&seenSince>=4
    &&(settled.evidence?.affectionCue>=.5||settled.evidence?.appreciationCue>=.5||b.play>=.67);
  // A warm baseline never authorizes a decorative sticker. Require a conversational
  // gesture OR an exceptional internally motivated gesture, plus actual spacing.
  const gestureOk=stickerState.available===true&&(meaningfulGesture&&seenSince>=2||spontaneousGesture)
    &&b.tenderGesture>.5&&!question&&!userNeeds&&!goodbye&&!strongClosure&&!needsRecovery;
  const stickerCandidate=gestureOk?(stickerCandidates||[]).find(c=>{
    const name=String(c?.id||c?.intent||c?.stickerIntent||'').toLowerCase();
    if(/(?:🤗|обним)/u.test(k.userText||''))return /hug|embrace|care_close|affection|tender/u.test(name);
    if(/(?:😘|💋|поцелу|целую)/iu.test(k.userText||''))return /kiss|tender|affection/u.test(name);
    return /tender|affection|warm|care|hug|kiss/u.test(name);
  }):null;
  const stickerIntent=stickerCandidate?.intent||stickerCandidate?.stickerIntent||stickerCandidate?.id||null;
  const sendSticker=gestureOk&&Boolean(stickerIntent);
  const split=depth==='extended'&& !isSilence;
  const segments=isSilence?[]:split
    ?[{type:'text',purpose:'main_beat',stickerIntent:null,maxChars:Math.ceil(bound*.65)},
       {type:'text',purpose:'continuation',stickerIntent:null,maxChars:Math.ceil(bound*.35)}]
    :[{type:'text',purpose:userNeeds?'supportive_response':question?'direct_answer':b.play>.55?'playful_beat':'natural_reply',stickerIntent:null,maxChars:bound}];
  if(sendSticker&&!split)segments.push({type:'sticker',purpose:'nonverbal_gesture',stickerIntent,maxChars:0});
  const deliveryMode=isSilence?'silence':sendSticker&&!split?'text_plus_sticker':split?'multi_message':'single_text';
  const intent=k.activeIntent;
  // Scene ending, intent lifecycle and silence are different axes. Silence preserves an active intent.
  let intentTransition={...NO_INTENT};
  if(intent?.status==='active'||intent?.status==='suspended'){
    const age=Math.max(0,Number(intent.turnCount)||0);
    const maintenance=intent.kind==='maintenance';
    const reachedHorizon= !maintenance && age>=Math.max(6,Number(intent.maxTurns)||10);
    const sameScene=!intent.scene||intent.scene===scene.type;
    const engagement= Math.round(clamp(b.approach*.35+b.play*.25+b.support*.2+b.disclose*.2)*100);
    const saturation= Math.min(100,Math.round(age*6+Number(observations?.novelty?.pressure||0)*.18));
    const aligned=sameScene&&!isSilence&&(settled.evidence?.affectionCue>=.5||settled.evidence?.appreciationCue>=.5||
      (/(?:близост|игр|разговор|контакт)/iu.test(intent.goal||'')&&b.approach>.5));
    const operation=signals.has('user_explicit_refusal')?'cancel':goodbye?'complete':reachedHorizon?'complete':
      !maintenance&&aligned?'advance':'preserve';
    intentTransition={...NO_INTENT,operation,
      progress:operation==='advance'?Math.min(.95,Math.max(0,Number(intent.progress)||0)+.12):null,
      engagement:maintenance?engagement:null,saturation:maintenance?saturation:null,
      reason:reachedHorizon?'achievement_horizon_reached':goodbye?'scene_explicitly_ended':
        operation==='advance'?'observed_relational_progress':'maintain_intent_without_forced_expression'};
  } else if(!goodbye&&!isSilence&&!question&&b.initiative>.45&&(b.play>.58||b.disclose>.61||settled.nodes?.curiosity>.82)&&!userNeeds){
    const playful=b.play>.58;
    const newGoal=playful?'развивать взаимную игровую динамику':'развить собственную мысль в текущей сцене';
    const recent=(k.recentIntents||[]).some(item=>{
      const distance=Number(k.revision||0)-Number(item?.terminalAtTurn||item?.updatedAtTurn||0);
      return distance>=0&&distance<=4&&(item.goal===newGoal||
        (playful&&/(?:близост|игровую динамику|флирт)/iu.test(item?.goal||'')));
    });
    if(!recent)intentTransition={...NO_INTENT,operation:'activate',goal:newGoal,
      motive:playful?'естественная взаимная игра':'самостоятельный интерес Рин',
      target:playful?'playful_closeness':'current_scene',nextMove:'continue_naturally',progress:playful?null:.05,commitment:65,
      reason:'graph_initiative',kind:playful?'maintenance':'achievement'};
  }
  const act=isSilence?'natural_silence':trigger?'proactive_contact':question?'answer_user_question':userNeeds?'supportive_presence':goodbye?'say_goodbye':b.setBoundary>.57&&settled.evidence?.boundary?'assert_boundary':b.play>.5?'playful_response':b.disclose>.52?'honest_disclosure':'personal_response';
  // A commitment is a discrete observable social act, never inferred just from affection.
  // Only explicit user-negotiated proposals enter this path; ambiguous plans stay callbacks.
  const text=trim(k.userText,520);
  const proposal=text.match(/(?:^|[.!?]\s*)(?:давай\s+договоримся\s*(?:,?\s*что\s*)?|пообещай\s+(?:мне\s+)?|обещай\s+(?:мне\s+)?)([^!?]{5,220})/iu);
  const proposedSubject=proposal?.[1]?.trim()||null;
  const commitment=proposedSubject&&!isSilence&&!goodbye&&b.setBoundary<.62&&b.support>=.28
    ?{action:'establish',subject:proposedSubject,owner:'shared',strength:Math.round((b.approach*.45+b.support*.25+b.directness*.3)*100),reason:'explicit_mutual_proposal'}
    :{action:'none',subject:null,owner:'none',strength:0,reason:null};
  const focus=isSilence?'закрытая сцена: не писать лишнего':commitment.action==='establish'?`подтвердить осознанную договорённость: ${trim(commitment.subject,170)}`:trigger?`самостоятельный повод Рин: ${trim(trigger.reason||trigger.type,200)}`:question?`ответить по существу: ${trim(k.userText,220)}`:userNeeds?'отнестись к конкретному переживанию пользователя':goodbye?'попрощаться без новой темы':
    life.domain!=='none'&&b.disclose>.35?`содержательно продолжить тему ${life.domain}, опираясь на конкретное занятие или наблюдение`:
    (intent?.goal&&['preserve','advance'].includes(intentTransition.operation)?`сохранить текущую линию: ${trim(intent.goal,180)}`:'естественно продолжить текущую сцену');
  const tone=b.setBoundary>.58?'спокойная и прямая':b.play>.51?'живая и слегка хитрая':tired?'тихая и личная':userNeeds?'внимательная, без наставничества':'спокойная, наблюдательная, личная';
  const replyLink=k.replyTarget?.messageId?{targetEventId:null,reason:null}:{targetEventId:null,reason:null};
  const decision=normalizeTurnDecision({act,focus,stance:tone,question:{mode:questionMode,reason:askAllowed?'graph_curiosity':null},replyLink,
    delivery:{responseDepth:depth,messageShape:split?'split':'single',segments},intentTransition,
    openLoops:{open:[],resolveIds:[]},realityMode:'grounded'}, {source:'rin-cognitive-turn-plan-v3'});
  return {schema:'rin-cognitive-turn-plan-v3',decision,responseRequired:!isSilence,contactStance,life,
    symbolId:symbolMode!=='none'?symbol?.id:null,symbolExpression:symbolMode,
    selfStateDisclosure:b.disclose>.53?'light':'none',commitment,behavioralState:{...b},
    obligations:{directQuestion:question,userNeed:userNeeds,replyTarget:Boolean(k.replyTarget),hardNoQuestion:spaceBoundary},
    constraints:{reality:'grounded',depthCap:longRequested?'extended':tired?'short':'extended',stickerAvailable:stickerState.available===true},
    trace:{sources:['perception','world','memory','cognitive_graph','turn_plan'],silenceCandidate:strongClosure,silence:isSilence,
      contactStance,questionMode,responseDepth:depth,act,reason:focus,lifeDomain:life.domain,lifeGuard:life.guard,
      stickerReason:sendSticker?(spontaneousGesture&&!meaningfulGesture?'spontaneous_contextual_gesture':'direct_contextual_gesture'):
        meaningfulGesture?'spacing_or_state_gate':'no_contextual_gesture',
      disagreementRules:[]}};
}
