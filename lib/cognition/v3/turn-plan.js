/** Sole owner of behavioral action. Domain modules contribute observations, not commands. */
import { normalizeTurnDecision } from '../turn-decision.js';
import { inspectGroundedLife } from './life-continuity.js';

const clamp=(x,min=0,max=1)=>Math.max(min,Math.min(max,Number(x)||0));
const trim=(x,n=260)=>String(x||'').replace(/\s+/g,' ').trim().slice(0,n);
const NO_INTENT={operation:'none',goal:null,motive:null,target:null,nextMove:null,progress:null,commitment:null,reason:null};

function groundedLocalScheduleTime(value,timezone){
  const epoch=Number(value);
  if(!(epoch>0)||!timezone)return null;
  try{
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',hour12:false,hourCycle:'h23'}).formatToParts(new Date(epoch));
    const fields=Object.fromEntries(parts.map(p=>[p.type,p.value]));
    if(!fields.year||!fields.month||!fields.day||!fields.hour||!fields.minute)return null;
    return `${fields.year}-${fields.month}-${fields.day} ${fields.hour}:${fields.minute}`;
  }catch{return null;}
}

export function buildCognitiveTurnPlan({settled={},kernelState={},observations={},stickerState={},stickerCandidates=[],sharedSymbolState={},longRequested=false,trigger=null}={}) {
  const b=settled.behavioralState||{}, k=kernelState||{}, percept=k.perception||{},scene=k.scene||{};
  const life=inspectGroundedLife({kernelState:k});
  const social=observations?.socialCues||{};
  const flow=observations?.sceneFlow||{};
  const agency=observations?.agency||{};
  const contracts=observations?.sceneContracts||{};
  const game=contracts.game||null;
  const gameTurnDue=Boolean(game?.rinQuestionDue&&!game?.answerThenAsk);
  const gameAnswerThenAsk=Boolean(game?.answerThenAsk);
  const mustAskGameQuestion=gameTurnDue||gameAnswerThenAsk;
  const relational=k.relationalConstancy||{};
  const work=life.workContinuity||{};
  const invitedAgency=Boolean(agency.topicInvitation);
  const waitForWork=Boolean(agency.offersWait);
  const motifSaturated=Boolean(agency.topicSaturation?.saturated||
    (Number(observations?.novelty?.pressure)>=75));
  const rinClock=String(k.environment?.rinHuman||'').match(/^\d{4}-\d{2}-\d{2}\s+(\d{1,2}):(\d{2})/u);
  const clockHour=rinClock?Number(rinClock[1]):null;
  const actualPartOfDay=clockHour===null?null:clockHour>=5&&clockHour<12?'утро':clockHour>=12&&clockHour<18?'день':clockHour>=18&&clockHour<23?'вечер':'ночь';
  const rinDaily={source:rinClock?'rin_local_clock':'unknown',localTime:rinClock?String(k.environment.rinHuman).slice(0,16):null,
    timezone:k.environment?.rinTz||null,partOfDay:actualPartOfDay,
    sleepPhase:k.innerLife?.sleepPhase||'unknown',wakeReason:k.innerLife?.wakeReason||'unknown',
    scheduledWakeLocal:rinClock?groundedLocalScheduleTime(k.innerLife?.plannedWakeAt,k.environment?.rinTz):null,
    scheduledSleepLocal:rinClock?groundedLocalScheduleTime(k.innerLife?.plannedSleepAt,k.environment?.rinTz):null,
    dayType:k.innerLife?.dayType||'unknown',workMode:k.innerLife?.workMode||'unknown'};
  const groundedGreeting=Boolean(social.explicitGreeting&&!trigger);
  const signals=new Set(percept.signals||[]);
  // A polite question proposing rest is a decision to settle the scene,
  // not a request to restart an active Q&A. Substantive time/why questions
  // remain real questions and must still be answered.
  const restInvitationQuestion=Boolean(flow.sleepFarewell&&
    /(?:может|можно|давай|поспать|поспим|по\s+спать)/iu.test(k.userText||'')&&
    !/(?:во\s+сколько|почему|зачем|когда|что\s+если|а\s+если)/iu.test(k.userText||''));
  const question=Boolean(settled.evidence?.userQuestion||signals.has('direct_question_present'))
    &&!social.playfulRhetorical&&!restInvitationQuestion;
  const userNeeds=Boolean(settled.evidence?.distress||signals.has('user_seeks_emotional_presence')||signals.has('repair_attempt'));
  const obligation=question||userNeeds||signals.has('user_correction_present')||Boolean(k.replyTarget)||Boolean(trigger);
  const goodbye=signals.has('explicit_farewell')||Boolean(observations.sceneClosure?.soft)||/(?:отдыхай|хорошего\s+(?:отдыха|сна)|спокойной\s+ночи|до\s+завтра|до\s+утра|увидимся)/iu.test(trim(k.userText));
  const closure=observations?.sceneClosure||{};
  const strongClosure=Boolean(closure.strong);
  // A direct request not to receive messages is an explicit boundary, not an invitation
  // to produce one more soothing response. Questions or distress still get an answer.
  const noContact=Boolean(observations?.space?.strongBoundary);
  // A confirmed sleep farewell ends the scene even if the graph's general
  // silence tendency is low. Fresh questions, distress and reply targets win.
  const isSilence=(strongClosure&&!obligation&&(flow.settledAfterFarewell||b.silence>=.25))||(noContact&&!obligation);
  const needsRecovery=(k.innerLife?.sleepPhase==='interrupted_sleep'||k.innerLife?.sleepPhase==='sleeping');
  const tired=['drowsy','winding_down','interrupted_sleep','sleeping'].includes(k.innerLife?.sleepPhase)||Number(k.innerLife?.energy)<38||Number(k.innerLife?.needForQuiet)>=65;
  const spaceBoundary=Boolean(observations?.question?.strongNoQuestion||observations?.space?.strongBoundary);
  const contactStance=b.setBoundary>.62&&b.approach<.45?'boundary_without_withdrawal'
    : b.approach>=.43&&(b.support>=.62||userNeeds)?'supportive_presence'
    : b.approach>=.43&&(b.silence>=.35||tired)?'quiet_presence'
    : b.approach>=.45?'open':'strained_presence';
  let depth='normal';
  if(isSilence)depth='micro';
  else if(longRequested)depth='extended';
  else if(goodbye&&!question)depth='short';
  else if(needsRecovery||tired)depth='short';
  else if(!question&&!userNeeds&&(/^(да|ага|угу|ясно|окей|хорошо|понятно|ладно|спасибо|и тебе)[.! )]*$/iu.test(trim(k.userText))||strongClosure))depth='micro';
  else if(!question&&!userNeeds&&social.smallSocialBeat)depth='short';
  else if(question&&trim(k.userText).length>160)depth='normal';
  const reciprocalAnchor=trim(k.reciprocity?.questionAnchor||k.reciprocity?.attentionAnchor?.text||'',220);
  const reciprocalChance=question&&Boolean(k.reciprocity?.attentionOpportunity)&&Boolean(reciprocalAnchor)
    &&!tired&&!userNeeds&&!spaceBoundary;
  const askAllowed= !isSilence&&!goodbye&&!spaceBoundary&&!strongClosure&&!userNeeds&&!social.playfulRhetorical
    &&!waitForWork
    && ((reciprocalChance&&b.ask>=.20)||(!question&&b.ask>=.27&&b.initiative>=.34&&
      (k.reciprocity?.attentionOpportunity||settled.evidence?.initiativeCue>=.8)))
    && !observations?.question?.strongNoQuestion;
  // An accepted scene rule can make a question required, independently of generic question impulse.
  const questionMode=mustAskGameQuestion&&!spaceBoundary&&!isSilence&&!goodbye?'required':askAllowed?'natural':'none';
  const bound={micro:150,short:320,normal:740,extended:1800}[depth];
  const symbol=(sharedSymbolState?.candidates||[]).find(c=>c.directRecall || (Number(c.activation)>=60&&Number(c.repetitionPressure||0)<65))||null;
  const symbolMode=!symbol||userNeeds?'none':symbol.directRecall?'explicit':
    (symbol.activation>=74&&b.disclose>=.52&&Number(symbol.repetitionPressure||0)<42)?'evolve':
    (b.play>=.4||b.tenderGesture>=.45)?'subtle':'none';
  const userGesture=/(?:😘|💋|🤗|🥰|❤️|обним|целую|поцелу|ласк|нежно)/iu.test(k.userText||'');
  const meaningfulGesture=Boolean(stickerState.explicitGesture || userGesture);
  const seenSince=stickerState.turnsSinceSticker==null?99:Number(stickerState.turnsSinceSticker);
  const spontaneousGesture=b.tenderGesture>=.78&&b.initiative>=.43&&seenSince>=4
    &&(settled.evidence?.affectionCue>=.5||settled.evidence?.appreciationCue>=.5||b.play>=.67);
  // Interrupted sleep is NOT actual sleep: Rin can answer quietly and reciprocate
  // an explicitly offered hug/kiss without claiming to be fully awake. Actual
  // sleep, a closed scene and a request for no contact still prohibit a gesture.
  const actuallySleeping=k.innerLife?.sleepPhase==='sleeping';
  const spacing=Math.max(stickerState.mode==='always'?1:3,Number(stickerState.requiredGapTurns)||0);
  const gestureReady=meaningfulGesture&&seenSince>=spacing;
  // Stickers must not become punctuation after every emoji. The preference
  // availability gate remains authoritative; this is additional rhythm control.
  const gestureOk=stickerState.available===true&&(gestureReady||spontaneousGesture&&seenSince>=Math.max(4,spacing))
    &&b.tenderGesture>.5&&!question&&!userNeeds&&(!goodbye||meaningfulGesture)&&!strongClosure&&!actuallySleeping&&!isSilence&&!noContact;
  const stickerCandidate=gestureOk?(stickerCandidates||[]).find(c=>{
    const name=String(c?.id||c?.intent||c?.stickerIntent||'').toLowerCase();
    if(/(?:🤗|обним|объя)/iu.test(k.userText||''))return /^(?:hug_|care_close_|tender_close_)/u.test(name);
    if(/(?:😘|💋|поцелу|целую)/iu.test(k.userText||''))return /^kiss_/u.test(name);
    return /tender|affection|warm|care|hug|kiss/u.test(name);
  }):null;
  const stickerIntent=stickerCandidate?.intent||stickerCandidate?.stickerIntent||stickerCandidate?.id||null;
  const sendSticker=gestureOk&&Boolean(stickerIntent)&&!mustAskGameQuestion;
  const recentShapes=k.dialogueState?.recentMessageShapes||[];
  const recentSplit=recentShapes.slice(-4).filter(x=>x==='split').length;
  const splitCandidate=Boolean(social.multiBeat||(
    flow.sustainedPlay&&trim(k.userText).length>=56&&b.play>=.45));
  // Two independent beats are allowed even in a drowsy exchange. Avoid
  // mechanical two-bubble output for a single emoji, fact question, goodbye,
  // sticker response or an already interrupted/closed scene.
  const split=!isSilence&&!goodbye&&!actuallySleeping&&!noContact&&!userNeeds&&!question&&!mustAskGameQuestion&&!sendSticker
    &&(Number(k.innerLife?.needForQuiet)||0)<90&&recentSplit===0
    &&!recentShapes.slice(-2).includes('split')
    &&(splitCandidate&&b.approach>=.40||
      (!tired&&depth==='extended')||
      (!tired&&depth==='normal'&&b.initiative>=.47&&b.disclose>=.49&&
        (settled.evidence?.initiativeCue>=.5||settled.evidence?.selfInterestCue>=.5)));
  const stickerOnly=sendSticker&&!split&&!question&&!goodbye&&!userNeeds&&
    /^(?:[\s\p{Extended_Pictographic}\uFE0F\u200D]+|(?:обнимаю|целую)\s+тебя[.! )]*)$/iu.test(trim(k.userText))&&
    b.tenderGesture>.60&&b.approach>.55;
  const tripleSplit=split&&longRequested&&social.multiBeat&&b.initiative>=.52&&b.disclose>=.50;
  const segments=isSilence||stickerOnly?[]:tripleSplit
    ?[{type:'text',purpose:'main_beat',stickerIntent:null,maxChars:Math.ceil(bound*.46)},
       {type:'text',purpose:'independent_detail',stickerIntent:null,maxChars:Math.ceil(bound*.32)},
       {type:'text',purpose:'closing_nuance',stickerIntent:null,maxChars:Math.ceil(bound*.22)}]:split
    ?[{type:'text',purpose:'main_beat',stickerIntent:null,maxChars:Math.ceil(bound*.65)},
       {type:'text',purpose:'continuation',stickerIntent:null,maxChars:Math.ceil(bound*.35)}]
    :[{type:'text',purpose:userNeeds?'supportive_response':question?'direct_answer':b.play>.55?'playful_beat':'natural_reply',stickerIntent:null,maxChars:bound}];
  if(sendSticker&&!split)segments.push({type:'sticker',purpose:'nonverbal_gesture',stickerIntent,maxChars:0});
  const deliveryMode=isSilence?'silence':stickerOnly?'sticker_only':sendSticker&&!split?'text_plus_sticker':split?'multi_message':'single_text';
  const intent=k.activeIntent;
  const mutualPlayMotivation=Boolean(flow.sustainedPlay)&&b.play>=.40&&b.approach>=.55
    &&!motifSaturated&&!waitForWork&&!question&&!tired;
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
    const operation=signals.has('user_explicit_refusal')?'cancel':noContact?'suspend':goodbye?'complete':
      (Boolean(agency.userSwitchesTopic)&&intent.target==='self_chosen_topic')?'cancel':
      invitedAgency&&intent.kind==='maintenance'?'complete':reachedHorizon?'cancel':
      !maintenance&&(aligned||(intent.target==='self_chosen_topic'&&
        trim(k.userText).length>=14&&/(?:интересн|подробн|почему\s+тебе|как\s+ты|ты\s+думаешь|что\s+имела\s+в\s+виду)/iu.test(k.userText||'')&&
          !agency.userSwitchesTopic&&!waitForWork))?'advance':'preserve';
    intentTransition={...NO_INTENT,operation,
      progress:operation==='advance'?Math.min(.95,Math.max(0,Number(intent.progress)||0)+.12):null,
      engagement:maintenance?engagement:null,saturation:maintenance?saturation:null,
      reason:noContact?'explicit_space_boundary':reachedHorizon?'achievement_horizon_reached':goodbye?'scene_explicitly_ended':
        operation==='advance'?'observed_relational_progress':'maintain_intent_without_forced_expression'};
  } else if(!goodbye&&!isSilence&&!actuallySleeping&&!noContact&&!userNeeds&&
      (invitedAgency||mutualPlayMotivation||(!question&&!tired&&!waitForWork&&
        (b.initiative>.45&&(b.play>.58||b.disclose>.61||settled.nodes?.curiosity>.82)||
          settled.evidence?.initiativeCue>=.8||
          (Boolean(k.reciprocity?.attentionOpportunity)&&b.initiative>=.33&&b.approach>=.55))))){
    const playful=!invitedAgency&&(mutualPlayMotivation||b.play>.58||settled.evidence?.initiativeCue>=.8&&b.play>.48);
    const newGoal=invitedAgency?'поделиться собственной мыслью или интересом по приглашению Кирилла':
      playful?'развивать взаимную игровую динамику':'развить собственную мысль в текущей сцене';
    const recent=(k.recentIntents||[]).some(item=>{
      const distance=Number(k.revision||0)-Number(item?.terminalAtTurn||item?.updatedAtTurn||0);
      return distance>=0&&distance<=4&&(item.goal===newGoal||
        (playful&&/(?:близост|игровую динамику|флирт)/iu.test(item?.goal||'')));
    });
    if(!recent)intentTransition={...NO_INTENT,operation:'activate',goal:newGoal,
      motive:invitedAgency?'Кирилл пригласил Рин самой выбрать тему':
        playful?'наблюдаемая взаимная игра':'самостоятельный интерес Рин',
      target:invitedAgency?'self_chosen_topic':playful?'playful_closeness':'current_scene',
      nextMove:invitedAgency?'share_one_concrete_thought':'continue_naturally',
      progress:playful?null:.05,commitment:invitedAgency?58:65,
      reason:invitedAgency?'invited_independent_interest':mutualPlayMotivation?'sustained_mutual_play':'graph_initiative',kind:playful?'maintenance':'achievement'};
  }
  // Being drowsy limits pace and message size, not her ability to respond to
  // mutual play. Do not create a waking-up event or override actual sleep.
  const canIntroduceTopic=invitedAgency&&!actuallySleeping&&!noContact&&!isSilence&&!goodbye;
  const contextualPlay=Boolean(social.playfulInvitation||flow.sustainedPlay)&&b.play>=.38
    &&!groundedGreeting&&!actuallySleeping&&!goodbye&&!noContact&&!social.seriousCorrection&&!social.seriousHurt&&!userNeeds
    &&!waitForWork&&!invitedAgency;
  const act=isSilence?'natural_silence':gameTurnDue?'take_game_turn':trigger?'proactive_contact':canIntroduceTopic?'offer_own_topic':
    waitForWork?'acknowledge_wait':question?'answer_user_question':userNeeds?'supportive_presence':goodbye?'say_goodbye':groundedGreeting?'personal_response':b.setBoundary>.57&&settled.evidence?.boundary?'assert_boundary':
    observations.frameAlignment==='misread'?'clarify_misunderstanding':motifSaturated&&!social.playfulInvitation?'personal_response':
    (contextualPlay||b.play>.5)?'playful_response':
    (b.disclose>.52||relational.disclosureOpportunity&&b.disclose>=.38)?'honest_disclosure':'personal_response';
  // A commitment is a discrete observable social act, never inferred just from affection.
  // Only explicit user-negotiated proposals enter this path; ambiguous plans stay callbacks.
  const text=trim(k.userText,520);
  const proposal=text.match(/(?:^|[.!?]\s*)(?:давай\s+договоримся\s*(?:,?\s*что\s*)?|пообещай\s+(?:мне\s+)?|обещай\s+(?:мне\s+)?)([^!?]{5,220})/iu);
  const proposedSubject=proposal?.[1]?.trim()||null;
  const existing=observeCommitmentOpportunity(k,observations);
  const commitment=existing.action!=='none'&&existing.target?{
      action:existing.action,targetId:existing.target.id,subject:existing.target.subject,
      owner:existing.target.owner,strength:Number(existing.target.strength||65),
      reason:'explicit_commitment_context'
    }:proposedSubject&&!isSilence&&!goodbye&&b.setBoundary<.62&&b.support>=.28
    ?{action:'establish',targetId:null,subject:proposedSubject,owner:'shared',strength:Math.round((b.approach*.45+b.support*.25+b.directness*.3)*100),reason:'explicit_mutual_proposal'}
    :{action:'none',targetId:null,subject:null,owner:'none',strength:0,reason:null};
  const callback=observeCallbackOpportunity(k,observations);
  const sceneMotif=groundedGreeting&&!question?'direct_exchange':chooseSceneMotif({behavior:b,observations,kernel:k,question,userNeeds,goodbye});
  const openCallback=callback.direct||(
    !question&&!goodbye&&!tired&&!userNeeds&&b.initiative>.43?callback.spontaneous:null);
  const sceneMotion=isSilence?'rest_silence':goodbye?'sleep_farewell':gameAnswerThenAsk?'answer_then_game_question':gameTurnDue?'take_game_turn':
    canIntroduceTopic?'introduce_own_thread':waitForWork?'respect_offered_wait':
    question?'answer_first':userNeeds?'support_first':groundedGreeting?'grounded_greeting':
    contextualPlay?'advance_mutual_play':social.careForRin?'accept_care':meaningfulGesture?'reciprocate_gesture':'ordinary_continuation';
  const focus=isSilence?'закрытая сцена: не писать лишнего':gameAnswerThenAsk?
    'Сначала содержательно ответить на личный вопрос пользователя, затем самой задать один вопрос согласно принятым правилам игры «Три вопроса»; не ограничиваться фразой «теперь спрашивай».':gameTurnDue?
    `Рин предложила игру с очередностью вопросов. Сейчас её ход: задать ОДИН собственный личный вопрос пользователю в рамках игры, без нового приглашения начать и без ответа вместо вопроса. Ход ${game.turnNumber||1} из 3.`:commitment.action!=='none'?`осмысленно выполнить действие ${commitment.action} для договорённости: ${trim(commitment.subject,170)}`:trigger?`самостоятельный повод Рин: ${trim(trigger.reason||trigger.type,200)}`:
    openCallback&&callback.direct?`ответить по существу и помнить связь с обещанным: ${trim(openCallback.subject,170)}`:
    question&&life.outdoor?.asked?`ответить о Рин вне помещения, учитывая установленное занятие и подтверждённую погоду (weather=${life.outdoor.weatherStatus}, suitability=${life.outdoor.outdoorSuitability||'unknown'}). Не выводить факт прогулки только из вопроса; ${trim(k.userText,220)}`:
    canIntroduceTopic?'самостоятельно выбрать одну живую тему или собственное наблюдение, связанное с реальным днём, интересом Рин или последней общей мыслью. Не возвращать исчерпанную шутку и не придумывать событий. Вопрос необязателен.':
    waitForWork?(work.claimedCompleted?
      'Кирилл готов подождать, но Рин уже сообщила, что закончила с этими делами. Честно признать это и не возобновлять завершённые бумаги. Можно принять его присутствие без новой задачи.':
      work.doingWork?'Кирилл предлагает подождать, пока Рин закончит занятие. Принять заботу и самой решить: действительно доделать дело или прерваться. Не отказываться навязчиво и не заявлять о завершении без факта.':
        'Отнестись к предложению подождать лично, без выдумывания новой работы или готовности.'):
    question&&work.claimedCompleted&&agency.challengesCompletion?'прямо признать: да, ранее сказала, что бумаги уже убраны. Не выдавать старую шутку за возобновившуюся работу.':
    question?`ответить по существу${social.personalInterest?', сохраняя своё мнение и конкретную личную деталь':''}: ${trim(k.userText,220)}`:
    userNeeds?'отнестись к конкретному переживанию пользователя':goodbye?'мягко принять пожелание сна и завершить сцену без приглашения продолжать':
    groundedGreeting?`ответить из собственного времени и режима Рин (${rinDaily.localTime||'время неизвестно'}; ${rinDaily.partOfDay||'часть суток неизвестна'}; сон: ${rinDaily.sleepPhase}); приветствие Кирилла не служит источником времени или подтверждением пробуждения`:
    social.careForRin?'принять конкретную заботу и показать, как она влияет на текущий поступок или темп Рин; не ограничиваться общим спасибо':
    contextualPlay?(motifSaturated?
      'общая шутка уже повторялась. Ответить тепло и, если естественно, сделать реальный новый смысловой шаг или дать шутке закончиться. Не перезапускать тот же предмет разговора и не создавать вопрос-повод.':
      'продолжить взаимную игру собственным небольшим ходом: добавить новый нюанс, инициативу или добрую дерзость; не пересказывать шутку и не требовать вопроса'):
    meaningfulGesture?'ответить на конкретный нежный жест собственной короткой, живой реакцией, не описывая повторно сонливость':
    openCallback?`если естественно, мягко вернуться к незавершённой теме: ${trim(openCallback.subject,170)}`:
    life.domain!=='none'&&b.disclose>.35&&!social.smallSocialBeat&&!flow.sustainedPlay?`содержательно продолжить тему ${life.domain}, опираясь на конкретное занятие или наблюдение`:
    (intent?.goal&&['preserve','advance'].includes(intentTransition.operation)?`сохранить текущую линию: ${trim(intent.goal,180)}`:'естественно продолжить текущую сцену');
  const tone=b.setBoundary>.58?'спокойная и прямая':userNeeds?'внимательная, без наставничества':
    gameTurnDue?'естественная и любопытная, соблюдает свою очередь в игре':
    canIntroduceTopic?'личная, любопытная, с собственным выбором и без допроса':
    waitForWork?'внимательная, самостоятельная, уважает предложение пользователя':
    contextualPlay?(tired?'тихая, сонная, но живая и игривая, с собственным ответным ходом':'живая, личная, с уместной игрой и собственным ответным ходом'):
    tired?'тихая и личная':
    social.careForRin?'тёплая и самостоятельная, принимает заботу делом, а не отчётом':
    b.play>.51?'живая и слегка хитрая':'спокойная, наблюдательная, личная';
  const previousEvent=(k.visualReplyCandidates||[]).find(c=>c.eventId&&
    (k.replyTarget?.messageId===c.eventId||
      (k.userText||'').includes(c.excerpt)&&c.excerpt?.length>12));
  const replyLink=previousEvent?{targetEventId:previousEvent.eventId,reason:'visual_anchor_to_earlier_user_event'}:
    {targetEventId:null,reason:null};
  const decision=normalizeTurnDecision({act,focus,stance:tone,question:{mode:questionMode,reason:mustAskGameQuestion?'accepted_game_turn':askAllowed?'graph_curiosity':null},replyLink,
    delivery:{responseDepth:depth,messageShape:split?'split':'single',segments},intentTransition,
    openLoops:{open:[],resolveIds:[]},realityMode:'grounded'}, {source:'rin-cognitive-turn-plan-v3'});
  return {schema:'rin-cognitive-turn-plan-v3',decision,responseRequired:!isSilence,needsVoice:segments.some(x=>x.type==='text'),contactStance,life,
    symbolId:symbolMode!=='none'?symbol?.id:null,symbolExpression:symbolMode,
    rinDaily,
    volition:{emotion:k.emotion?.primary?.type||null,
      motive:gameTurnDue?'исполнить собственные правила игры':gameAnswerThenAsk?'ответить лично и самой спросить':
        canIntroduceTopic?'самой выбрать содержательную тему':
        userNeeds?'быть рядом при трудности':social.careForRin?'принять заботу':
        contextualPlay?'поддержать живую игру':relational.disclosureOpportunity?'поделиться личной мыслью':
        waitForWork?'решить, как принять заботу и распорядиться временем':null,
      restraint:tired?'бережно относиться к собственной усталости':spaceBoundary?'уважать границу пользователя':
        motifSaturated?'не повторять исчерпанный образ':null,
      relationalSafety:Number(relational.relationalSafety)||null},
    sceneContracts:contracts,
    agency:{topicInvitation:invitedAgency,waitForWork,motifSaturated},
    selfStateDisclosure:(relational.disclosureOpportunity&&b.disclose>=.38&&relational.internal?.primaryIntensity>=45)?'direct':
      (b.disclose>.60&&(observations.frameAlignment==='misread'||b.vigilance>.55))?'direct':
      (relational.disclosureOpportunity&&b.disclose>=.36)||b.disclose>.53?'light':'none',commitment,callback,sceneMotif,sceneMotion,
    frameAlignment:observations.frameAlignment||'aligned',referenceAnchor:k.replyTarget?.excerpt||null,
    expression:{vocative:observations.vocative||{},emoji:observations.emoji||{},socialCues:social,
      sceneFlow:flow,novelty:observations.novelty||{},lifeNovelty:observations.lifeNovelty||{}},
    behavioralState:{...b},
    obligations:{directQuestion:question,userNeed:userNeeds,replyTarget:Boolean(k.replyTarget),hardNoQuestion:spaceBoundary,reciprocityAnchor:askAllowed?reciprocalAnchor:null},
    constraints:{reality:'grounded',depthCap:longRequested?'extended':tired?'short':'extended',stickerAvailable:stickerState.available===true},
    trace:{sources:['perception','world','memory','cognitive_graph','turn_plan'],silenceCandidate:strongClosure,silence:isSilence,
      contactStance,questionMode,responseDepth:depth,act,reason:focus,sceneMotion,lifeDomain:life.domain,lifeGuard:life.guard,sceneMotif,frameAlignment:observations.frameAlignment||'aligned',socialCues:social,sceneFlow:flow,
      stickerReason:sendSticker?(spontaneousGesture&&!meaningfulGesture?'spontaneous_contextual_gesture':'direct_contextual_gesture'):
        actuallySleeping?'sleeping':isSilence||noContact?'contact_boundary':strongClosure||goodbye?'scene_closing':
        !stickerState.available?'sticker_unavailable':meaningfulGesture&&seenSince<spacing?'sticker_spacing':
        meaningfulGesture&&b.tenderGesture<=.5?'low_tender_gesture':
        meaningfulGesture&&question?'answer_priority':
        gestureOk&&!stickerCandidate?'no_matching_sticker':meaningfulGesture?'spacing_or_state_gate':'no_contextual_gesture',
      disagreementRules:[]}};
}


/** Private TurnPlan utilities: only this module chooses behavioral and scene actions. */
const text=x=>String(x||'').trim();
const lower=x=>text(x).toLocaleLowerCase('ru-RU').replace(/ё/g,'е');
export const SCENE_MOTIFS_V3=['direct_exchange','storytelling','self_reveal','shared_reflection','mystery','challenge',
  'mock_conflict','playful_roleplay','tender_presence','sensory_closeness','supportive_care','repair','boundary','farewell','other'];

export function observeCommitmentOpportunity(kernel={},observations={}){
  const commitments=kernel.dialogueState?.sceneCommitments||[];
  const active=commitments.filter(c=>['active','contested','suspended'].includes(c.status));
  const cues=observations.commitmentCues||{};
  const user=lower(kernel.userText);
  const relevant=active.find(c=>{
    const keywords=lower(c.subject).split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>=5);
    return keywords.some(w=>user.includes(w));
  })|| (active.length===1 ? active[0] : null);
  const confirmedBreach=(kernel.recentHistory||[]).filter(x=>x.role==='assistant'&&x.kind!=='sticker')
    .slice(-8).some(x=>/(?:я\s+(?:нарушила\s+обещание|не\s+сдержала\s+слово|забыла\s+про\s+нашу\s+договоренность))/iu.test(String(x.content||'')));
  const action=relevant?(cues.release?'release':cues.renegotiation?'renegotiate':
    cues.compromise?'compromise':cues.explicitFulfilled?'fulfill':
    // Only a previous explicit admission by Rin can verify a broken promise.
    cues.explicitBroken?(confirmedBreach?'break':'renegotiate'):cues.honor||cues.fulfillment?'honor':
    cues.insist?'insist':'none'):'none';
  return {target:action==='none'?null:relevant,action};
}

export function observeCallbackOpportunity(kernel={},observations={}){
  const callbacks=(kernel.openLoops||[]).filter(c=>c.type==='future_callback'&&
    !['cancelled','resolved','stale'].includes(c.status));
  const phrase=lower(kernel.userText);
  const direct=callbacks.find(c=>{
    const subject=lower(c.subject);
    return subject.split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>=5).some(w=>phrase.includes(w));
  });
  const opportunistic=callbacks.find(c=>{
    const elapsed=Number(kernel.revision||0)-Number(c.createdAtTurn||c.updatedAtTurn||kernel.revision||0);
    return c.waitingFor==='user'&&elapsed>=5&&kernel.reciprocity?.attentionOpportunity===true;
  });
  return {waiting:callbacks.slice(0,3).map(c=>({id:c.id,subject:c.subject,waitingFor:c.waitingFor,status:c.status})),
    direct:direct?{id:direct.id,subject:direct.subject}:null,
    // Opportunity, not a mandatory reminder: the TurnPlan still decides whether to attend.
    spontaneous:opportunistic?{id:opportunistic.id,subject:opportunistic.subject}:null};
}

export function chooseSceneMotif({behavior={},observations={},kernel={},question=false,userNeeds=false,goodbye=false}={}){
  const user=lower(kernel.userText);
  const last=observations.novelty?.repeatedMotif;
  let result=goodbye?'farewell':userNeeds?'supportive_care':observations.repair?'repair':
    observations.space?.strongBoundary?'boundary':observations.frameAlignment==='misread'?'shared_reflection':
    /(?:обним|целу|поцелу|нежн|😘|💋|🤗)/u.test(user)?'sensory_closeness':
    /(?:ай\s+ну\s+ты|вот\s+хитрюг|ну\s+ты\s+и\s+хитрец|ах\s+ты\s+коварн)/u.test(user)&&behavior.play>.37?'mock_conflict':
    /(?:давай\s+представим|сыграем\s+в|представь\s+будто)/u.test(user)?'playful_roleplay':
    /(?:просто\s+побудем\s+рядом|давай\s+помолчим\s+вместе)/u.test(user)?'tender_presence':
    /(?:секрет|тайн|загадак|загадк|китсуне)/u.test(user)&&behavior.play>.45?'mystery':
    /(?:спор|докажи|слабо|не\s+соглас)/u.test(user)?'challenge':
    /(?:расскажи|вспомни|случилось)/u.test(user)&&!question?'storytelling':
    question&&behavior.disclose>.47?'self_reveal':
    behavior.play>.51?'playful_roleplay':behavior.disclose>.5?'self_reveal':
    behavior.reflection>.5?'shared_reflection':'direct_exchange';
  // Repetition changes the *meaningful function* of a beat, not the tone or affection.
  if(observations.novelty?.pressure>=65&&result===last&&!question&&!goodbye&&!userNeeds){
    if(result==='playful_roleplay')result=behavior.disclose>.43?'self_reveal':'tender_presence';
    else if(result==='mystery')result='shared_reflection';
    else if(result==='direct_exchange')result=behavior.play>.45?'tender_presence':'shared_reflection';
  }
  return result;
}
