import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {observeTurn} from '../lib/cognition/v3/turn-observations.js';
import {mapCognitiveInputs,settleCognitiveGraph} from '../lib/cognition/v3/cognitive-dynamics.js';
import {buildCognitiveTurnPlan,SCENE_MOTIFS_V3} from '../lib/cognition/v3/turn-plan.js';
import {buildV3RealizationPrompt,summarizeV3Dialogue} from '../lib/cognition/v3/realization.js';
import {inspectGroundedLife} from '../lib/cognition/v3/life-continuity.js';

const profile=JSON.parse(await readFile(new URL('../data/canon/rin_prompt_profile.json',import.meta.url),'utf8'));
const kernel=(userText='',other={})=>({userText,scene:{type:'everyday'},perception:{signals:[]},
  innerLife:{energy:60,needForQuiet:40,sleepPhase:'awake',dayType:'weekday',workMode:'normal'},
  mood:{affection:73},relationship:{trust:78,closeness:84,playfulness:57},
  dialogueState:{recentMotifs:[],recentMessageShapes:[],sceneCommitments:[]},recentHistory:[],openLoops:[],
  ...other});
const make=(k,options={})=>{
  const observations=options.observations||observeTurn({userText:k.userText,memory:{conversationState:{dialogueState:k.dialogueState}},history:options.history||[]});
  const inputs=mapCognitiveInputs({kernelState:k,observations,sharedSymbolState:options.sharedSymbolState||{}});
  const settled=settleCognitiveGraph({inputs});
  return buildCognitiveTurnPlan({settled,kernelState:k,observations,stickerState:options.stickerState||{available:false},
    stickerCandidates:options.stickerCandidates||[],sharedSymbolState:options.sharedSymbolState||{},longRequested:options.longRequested||false});
};

test('canonical personality migration includes reference character, imperfections, full voice and relationship principles',()=>{
  const k=kernel('Привет');const p=make(k);
  const prompt=buildV3RealizationPrompt({profile:{prompt_profile:profile},kernelState:k,plan:p});
  for(const tag of ['referenceCharacter','characterContract','voice_notes','imperfections','principles','exampleDialogue','не зеркаль','Эмодзи'])
    assert.ok(prompt.stableSystem.includes(tag),tag);
  assert.ok(prompt.stableSystem.includes('не всегда сразу говорит об обиде'));
});

test('emoji economy detects mirror risk and recent repetition without reinstating legacy decision owner',()=>{
  const history=[{role:'assistant',content:'Ну да 😏'},{role:'assistant',content:'Ладно 😏'}];
  const o=observeTurn({userText:'😘',history});
  assert.deepEqual(o.emoji.userEmojis,['😘']);
  assert.equal(o.emoji.mirrorRisk,true);
  assert.ok(o.emoji.pressure>=35);
  const k=kernel('😘',{recentHistory:history});
  const voice=buildV3RealizationPrompt({kernelState:k,plan:make(k,{observations:o})});
  assert.match(voice.dynamicSystem,/EMOJI_POLICY=prefer_plain_text/);
});

test('vocative rhythm is observable and visible to Luna, not a competing action picker',()=>{
  const history=[{role:'assistant',content:'Кирилл, ну ты хитрый.'},{role:'assistant',content:'Ну Кирилл, опять ты)'}];
  const o=observeTurn({userText:'А вот так)',history});
  const p=make(kernel('А вот так)'),{observations:o});
  const voice=buildV3RealizationPrompt({kernelState:kernel('А вот так)'),plan:p});
  assert.ok('vocative' in p.expression);
  assert.match(voice.dynamicSystem,/SPEECH_RHYTHM/);
});

test('playful ambiguity and genuine literal corrections are distinct frame evidence',()=>{
  assert.equal(observeTurn({userText:'Ты не так поняла, я про музыку!'}).frameAlignment,'misread');
  assert.equal(observeTurn({userText:'Ты не так поняла, я шучу 😏'}).frameAlignment,'aligned');
  assert.equal(observeTurn({userText:'Извини, давай помиримся'}).frameAlignment,'repair_seeking');
});

test('explicit manual reply target reaches the voice prompt with original excerpt',()=>{
  const k=kernel('Я вот про это',{replyTarget:{messageId:'rin-1',role:'assistant',excerpt:'Сегодня читаю старую книгу',reason:'selected'}});
  const p=make(k);const voice=buildV3RealizationPrompt({kernelState:k,plan:p});
  assert.equal(p.referenceAnchor,'Сегодня читаю старую книгу');
  assert.match(voice.dynamicSystem,/EXPLICIT_REPLY_TARGET/);
  assert.match(voice.dynamicSystem,/Сегодня читаю старую книгу/);
});

test('all fifteen old scene motifs have a semantic representation in the new path',()=>{
  assert.equal(SCENE_MOTIFS_V3.length,15);
  const p=make(kernel('Я тебя обнимаю 🤗'));
  assert.equal(p.sceneMotif,'sensory_closeness');
});

test('high motif repetition results in a different meaning, not more duplicated banter',()=>{
  const k=kernel('Ну вот так)',{dialogueState:{recentMotifs:['playful_roleplay','playful_roleplay','playful_roleplay'],recentMessageShapes:[],sceneCommitments:[]}});
  const o=observeTurn({userText:k.userText,memory:{conversationState:{dialogueState:k.dialogueState}}});
  o.novelty.pressure=100;o.novelty.repeatedMotif='playful_roleplay';
  const p=make(k,{observations:o});
  assert.notEqual(p.sceneMotif,'playful_roleplay');
});

test('drowsiness results in quieter contact and shorter response even with persistent warmth',()=>{
  const k=kernel('Обнимаю тебя',{innerLife:{energy:59,needForQuiet:66,sleepPhase:'drowsy'}});
  const p=make(k);
  assert.equal(p.decision.delivery.responseDepth,'short');
  assert.equal(p.contactStance,'quiet_presence');
});

test('sleep and weekend causality are retained in Luna context',()=>{
  const k=kernel('Как день?',{innerLife:{dayType:'sunday',workMode:'off',sleepPhase:'interrupted_sleep',wakeReason:'kirill_message',
    lateConversationMinutes:78,sleepDebtMinutes:45,sleepInterruptions:1,weatherGrounded:false}});
  const prompt=buildV3RealizationPrompt({kernelState:k,plan:make(k)}).dynamicSystem;
  assert.match(prompt,/DAILY_CONTEXT/);assert.match(prompt,/sunday/);assert.match(prompt,/interrupted_sleep/);
  assert.match(prompt,/Выходной считается настоящим отдыхом/);
});

test('existing commitment may be honored or renegotiated but is not silently re-established',()=>{
  const c={id:'commit-x',subject:'встретиться завтра',status:'active',strength:72,owner:'shared'};
  const k=kernel('Давай перенесем встречу завтра',{dialogueState:{sceneCommitments:[c]}});
  const p=make(k);
  assert.equal(p.commitment.action,'renegotiate');assert.equal(p.commitment.targetId,'commit-x');
  assert.notEqual(p.commitment.action,'establish');
});

test('no invented fulfillment of commitment from vague praise',()=>{
  const c={id:'commit-x',subject:'встретиться завтра',status:'active',strength:72,owner:'shared'};
  const k=kernel('Как здорово!',{dialogueState:{sceneCommitments:[c]}});
  assert.equal(make(k).commitment.action,'none');
});

test('future callback is present as social memory, but not a forced question',()=>{
  const k=kernel('Как ты?',{openLoops:[{id:'callback-x',type:'future_callback',subject:'потом покажу фотографию',waitingFor:'user',status:'waiting_for_user'}],
    perception:{signals:['direct_question_present']}});
  const p=make(k);
  assert.equal(p.callback.waiting[0].id,'callback-x');
  const prompt=buildV3RealizationPrompt({kernelState:k,plan:p}).dynamicSystem;
  assert.match(prompt,/UNFINISHED_CALLBACKS/);assert.match(prompt,/потом покажу фотографию/);
});

test('private symbol direct recall overrides historical repetition pressure',()=>{
  const k=kernel('Моя Китсуне)');
  const sharedSymbolState={candidates:[{id:'kitsune',activation:83,repetitionPressure:100,directRecall:true,meaning:'частная ассоциация'}]};
  const p=make(k,{sharedSymbolState});
  assert.equal(p.symbolId,'kitsune');assert.equal(p.symbolExpression,'explicit');
});

test('unprompted symbol stays optional and can remain silent',()=>{
  const k=kernel('Как день?');
  const sharedSymbolState={candidates:[{id:'kitsune',activation:42,repetitionPressure:88,directRecall:false}]};
  const p=make(k,{sharedSymbolState});
  assert.equal(p.symbolExpression,'none');
});

test('single-word listener is not an invented music activity',()=>{
  const k=kernel('Мм, я слушаю тебя',{recentHistory:[]});
  assert.notEqual(inspectGroundedLife({kernelState:k}).domain,'music');
});

test('a farewell inviting rest is recognized even without literal old farewell phrase',()=>{
  const o=observeTurn({userText:'Отдыхай, моя Китсуне, хорошего отдыха 😘'});
  assert.equal(o.sceneClosure.soft,true);
  assert.equal(make(kernel('Отдыхай, моя Китсуне, хорошего отдыха 😘'),{observations:o}).decision.act,'say_goodbye');
});

test('sticker-only behavior is a real delivery mode with zero speech segments',()=>{
  const k=kernel('🤗');
  const p=make(k,{stickerState:{available:true,turnsSinceSticker:4,explicitGesture:true},stickerCandidates:[{id:'hug_soft'}]});
  assert.equal(p.decision.delivery.mode,'sticker_only');
  assert.equal(p.needsVoice,false);
  assert.equal(p.decision.delivery.segments.length,1);
});

test('sticker history retains actual meaning and cause rather than a generic tag',()=>{
  const d=summarizeV3Dialogue([{role:'assistant',kind:'sticker',sticker:{meaning:'тёплое объятие',cause:'встреча после разлуки'},turnId:'t1'}]);
  assert.match(d.text,/тёплое объятие/);assert.match(d.text,/встреча после разлуки/);
});

test('no production reactivation of legacy RinMind, behavior-state decision or drive-state decision',async()=>{
  const api=await readFile(new URL('../api/chat.js',import.meta.url),'utf8');
  for(const legacy of [/buildRinMindPrompt/,/buildBehaviorState\s*\(/,/buildDriveState\s*\(/,/stabilizeTurn\s*\(/])
    assert.doesNotMatch(api,legacy);
  assert.match(api,/buildCognitiveTurnPlan/);
  assert.match(api,/turnPlan\.sceneMotif/);
});

test('reciprocal question only uses a concrete remembered anchor',()=>{
  const k=kernel('А у тебя как?',{perception:{signals:['direct_question_present']},reciprocity:{attentionOpportunity:true,questionAnchor:'его предстоящая поездка'}});
  const p=make(k);
  assert.equal(p.decision.question.mode,'natural');
  assert.equal(p.obligations.reciprocityAnchor,'его предстоящая поездка');
  const noAnchor=make({...k,reciprocity:{attentionOpportunity:true}});
  assert.equal(noAnchor.decision.question.mode,'none');
});

test('user initiative handoff can generate own intent while default does not flood new goals',()=>{
  const handoff=make(kernel('Выбирай сама, что будем делать')); const noHandoff=make(kernel('Понятно)'));
  assert.equal(handoff.decision.intentTransition.operation,'activate');
  assert.equal(noHandoff.decision.intentTransition.operation,'none');
});

test('confirmed existing commitment may be fulfilled but an unsupported allegation cannot auto-break it',()=>{
  const c={id:'commit-y',subject:'написать письмо',status:'active',strength:70,owner:'rin'};
  const fulfilled=make(kernel('Ты выполнила обещание написать письмо',{dialogueState:{sceneCommitments:[c]}}));
  assert.equal(fulfilled.commitment.action,'fulfill');
  assert.equal(fulfilled.commitment.targetId,c.id);
  const contested=make(kernel('Ты нарушила обещание написать письмо',{dialogueState:{sceneCommitments:[c]}}));
  assert.notEqual(contested.commitment.action,'break');
});

test('meaningful callbacks are eligible after a pause and relationship attention, not asked every turn',()=>{
  const cb={id:'cb-old',type:'future_callback',subject:'расскажу про поездку',waitingFor:'user',status:'waiting_for_user',createdAtTurn:6};
  const k=kernel('Вот такой вечер)',{revision:16,reciprocity:{attentionOpportunity:true},openLoops:[cb]});
  const p=make(k);
  assert.equal(p.callback.spontaneous?.id,cb.id);
  const immediate=make({...k,revision:7});
  assert.equal(immediate.callback.spontaneous,null);
});

test('roleplay, mock conflict and shared quiet are different semantic motifs',()=>{
  assert.equal(make(kernel('Давай представим, что мы в Киото')).sceneMotif,'playful_roleplay');
  assert.equal(make(kernel('Ай ну ты коварная)')).sceneMotif,'mock_conflict');
  assert.equal(make(kernel('Просто побудем рядом)')).sceneMotif,'tender_presence');
});


test('previous explicit admission supports break, while a mere allegation does not',()=>{
  const c={id:'commit-b',subject:'договоренность написать письмо',status:'active',strength:72,owner:'rin'};
  const prior=[{role:'assistant',kind:'text',content:'Я нарушила обещание. Это мой выбор и я понимаю последствия.'}];
  const k=kernel('Ты нарушила обещание написать письмо',{dialogueState:{sceneCommitments:[c]},recentHistory:prior});
  const p=make(k);
  assert.equal(p.commitment.action,'break');
  assert.equal(p.commitment.targetId,c.id);
  const allegation=make({...k,recentHistory:[]});
  assert.notEqual(allegation.commitment.action,'break');
});
