import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShortTermDialogue, buildRinMindJsonSchema, buildRinMindPrompt, parseRinMind } from '../lib/cognition/rin-mind.js';
import { normalizeRinIntent, inferRinIntentKind } from '../public/lib/intent-contract.js';
import { normalizePrivateCloseness, recordPrivateCloseness } from '../lib/cognition/private-closeness.js';
import { normalizeDialogueState } from '../lib/cognition/cognitive-contract.js';
import { buildDialogueState } from '../lib/cognition/dialogue-state.js';
import { applyIntentTransition, normalizeTurnDecision } from '../lib/cognition/turn-decision.js';
import { stabilizePersistentIntent } from '../lib/cognition/intent-policy.js';

const mind = (mode, focus = 'affection', move = 'stay', thread = null) => ({
  closenessMode: mode, closenessFocus: focus, closenessMove: move, closenessThread: thread, contactStance:'open'
});
const persist = (old, next, revision) => recordPrivateCloseness({ previous: old, mind: next, revision });
const turn = changes => normalizeTurnDecision({
  act:'accept_closeness', focus:'продолжить взаимность', stance:'тепло',
  question: {mode:'none',reason:null}, replyLink:{targetEventId:null,reason:null},
  delivery:{responseDepth:'short',messageShape:'single',segments:[{type:'text',purpose:'reply',stickerIntent:null,maxChars:240}]},
  intentTransition:{operation:'activate',goal:'сохранять взаимную нежную близость в этом вечере',kind:'achievement',target:'mutual_tenderness',progress:.08,commitment:80, ...changes},
  openLoops:{open:[],resolveIds:[]}, realityMode:'grounded'
});

test('recent dialogue includes up to ten exchanges, without unlimited context growth', () => {
  const history=[];
  for(let i=1;i<=13;i++){
    history.push({id:`u${i}`,role:'user',kind:'text',turnId:`u${i}`,content:`сообщение пользователя номер ${i}`});
    history.push({id:`a${i}`,role:'assistant',kind:'text',turnId:`a${i}`,content:`ответ Рин номер ${i}`});
  }
  const data=buildShortTermDialogue({recentHistory:history});
  assert.equal(data.length,10);
  assert.match(JSON.stringify(data[0]), /номер 4/);
  assert.doesNotMatch(JSON.stringify(data), /номер 3(?:[^0-9]|$)/);
  assert.match(JSON.stringify(data.at(-1)),/номер 13/);
});

test('explicit achievement labels cannot turn preserving tenderness into a short achievement',()=>{
  const candidate={kind:'achievement',goal:'сохранять взаимную нежную близость в этом вечере',target:'mutual_tenderness'};
  assert.equal(inferRinIntentKind(candidate),'maintenance');
  const created=applyIntentTransition(null,turn(),{revision:528,scene:'romance'});
  assert.equal(created.kind,'maintenance');
  assert.equal(created.progress,null);
  assert.ok(created.maxTurns>=14);
  assert.equal(created.turnCount,1);
});

test('old active romantic achievement is safely normalized without wiping its life',()=>{
  const old=normalizeRinIntent({schema:'rin-persistent-intent-v5',kind:'achievement',status:'active',
    goal:'сохранять взаимную нежную близость в этом вечере',target:'romantic_connection',
    startedAtTurn:500,updatedAtTurn:506,turnCount:7,maxTurns:7,progress:0.3});
  assert.equal(old.kind,'maintenance');
  assert.equal(old.progress,null);
  assert.equal(old.turnCount,7);
  assert.ok(old.maxTurns>=14);
  const stabilized=stabilizePersistentIntent({transition:{operation:'complete',reason:'локальный поцелуй завершён'},
    decision:{act:'accept_closeness'},activeIntent:old,recentActs:['accept_closeness'],
    driveState:{connection:80},behaviorState:{space:{strong:false},novelty:{pressure:10},frameAlignment:'aligned'},scene:{type:'romance'}});
  // Old intent may complete if its underlying scene changed, but must not time out at age 7.
  assert.notEqual(stabilized.reason,'achievement_horizon_reached');
  assert.equal(stabilized.kind,'maintenance');
});

test('genuine finite goal remains achievement and retains completion horizon',()=>{
  const achievement=normalizeRinIntent({status:'active',kind:'achievement',goal:'восстановить контакт после спора',target:'relationship_repair',turnCount:6,maxTurns:7});
  assert.equal(achievement.kind,'achievement');
  assert.equal(achievement.maxTurns,7);
});

test('episode thread persists across thirty romantic turns past the dialogue window',()=>{
  let state=persist(null,mind('tender','affection','initiate','Крепость пользователя: Рин сидит у стены, ждёт приглашения'),1);
  for(let i=2;i<32;i++) state=persist(state,mind('tender','affection','stay',null),i);
  assert.equal(state.turnsInMode,31);
  assert.equal(state.thread,'Крепость пользователя: Рин сидит у стены, ждёт приглашения');
  assert.equal(state.recentMoves.length,6);
  assert.equal(normalizeDialogueState({privateCloseness:state}).privateCloseness.thread,state.thread);
  assert.equal(buildDialogueState({previousState:{privateCloseness:state},history:[],userText:'рядом',brain:{activeScene:{type:'romance',topic:'вечер'}}}).privateCloseness.thread,state.thread);
});

test('a meaningful change updates the same thread, not a new romance',()=>{
  const first=persist(null,mind('tender','affection','initiate','Крепость пользователя: Рин у ворот'),1);
  const deeper=persist(first,mind('private','openness','deepen','Крепость пользователя: он пригласил Рин внутрь, затем они поделились важной мыслью'),2);
  const quiet=persist(deeper,mind('quiet','presence','shift','Вместе спокойно рядом после близкого разговора; продолжать не обязаны'),3);
  assert.match(deeper.thread,/он пригласил/);
  assert.match(quiet.thread,/продолжать не обязаны/);
  assert.equal(quiet.mode,'quiet');
});

test('brief weather detour retains episode but does not force romance to resume',()=>{
  let state=persist(null,mind('tender','affection','initiate','Договорились провести вечер вместе'),1);
  state=persist(state,mind('everyday','none','shift',null),2);
  assert.equal(state.thread,'Договорились провести вечер вместе');
  assert.equal(state.mode,'everyday');
  assert.equal(state.everydayGap,1);
  state=persist(state,mind('everyday','none','stay',null),3);
  assert.ok(state.thread);
  state=persist(state,mind('tender','affection','initiate',null),4);
  assert.equal(state.thread,'Договорились провести вечер вместе');
  assert.equal(state.everydayGap,0);
  for(let i=5;i<9;i++) state=persist(state,mind('everyday','none','stay',null),i);
  assert.equal(state.thread,null);
});

test('explicit close and farewell clear episode while consent boundaries remain authoritative',()=>{
  const starting=persist(null,mind('private','mixed','deepen','Поцелуи с взаимного согласия'),1);
  const closed=persist(starting,mind('everyday','none','close',null),2);
  assert.equal(closed.thread,null);
  const farewell=recordPrivateCloseness({previous:starting,mind:mind('private','mixed','stay',starting.thread),conversationState:'ending',revision:2});
  assert.equal(farewell.thread,null);
  assert.equal(farewell.mode,'everyday');
  const boundary=recordPrivateCloseness({previous:starting,mind:mind('private','mixed','stay',starting.thread),contactBoundary:true,revision:2});
  assert.equal(boundary.thread,null);
});

test('fallback cannot mutate an existing narrative thread',()=>{
  const starting=persist(null,mind('tender','affection','initiate','Не придумывать новый поцелуй'),1);
  assert.deepEqual(recordPrivateCloseness({previous:starting,mind:{socialIntent:'stable_fallback',closenessThread:'Вымышленное продолжение'}}),starting);
});

test('strict Mind schema and prompt carry the narrative thread as observation, not script',()=>{
  const schema=buildRinMindJsonSchema().schema.properties.mind;
  assert.ok(schema.required.includes('closenessThread'));
  assert.equal(schema.properties.closenessThread.maxLength,420);
  const prompt=buildRinMindPrompt({state:{privateCloseness:normalizePrivateCloseness({mode:'tender',thread:'Открыли ворота крепости пользователя'})}});
  assert.match(prompt.stableSystem,/closenessThread/);
  assert.match(prompt.stableSystem,/нет планового завершения после 6–10 ходов/);
  assert.match(prompt.dynamicSystem,/Открыли ворота крепости пользователя/);
  const parsed=parseRinMind({act:'share_self',focus:'личное',stance:'мягко',question:{mode:'none',reason:null},
    replyLink:{targetEventId:null,reason:null},delivery:{responseDepth:'short',messageShape:'single',segments:[{type:'text',purpose:'message',stickerIntent:null,maxChars:250,text:'Я расскажу тебе одну мысль.'}]},
    intentTransition:{operation:'none'},openLoops:{open:[],resolveIds:[]},realityMode:'grounded',mind:{...mind('private','openness','stay','Они поговорили о доверии')}});
  assert.equal(parsed.mind.closenessThread,'Они поговорили о доверии');
});

test('near-duplicate completed romantic maintenance cannot restart immediately with a paraphrase',()=>{
  const earlier=normalizeRinIntent({status:'completed',kind:'maintenance',goal:'сохранять взаимную нежную близость, пока она приятна обоим',target:'emotional_closeness',
    startedAtTurn:20,updatedAtTurn:24,terminalAtTurn:24,cooldownUntilTurn:34,turnCount:4});
  const result=stabilizePersistentIntent({transition:turn().intentTransition,decision:{act:'accept_closeness'},activeIntent:null,recentIntents:[earlier],revision:24,
    behaviorState:{space:{strong:false}},driveState:{connection:85}});
  assert.equal(result.operation,'none');
  assert.equal(result.reason,'recent_intent_cooldown');
});


test('long-lived scene counters remain accurate beyond the prior forty-turn cap',()=>{
  assert.equal(normalizeDialogueState({turnsInScene:65}).turnsInScene,65);
  const intent=normalizeRinIntent({kind:'maintenance',goal:'сохранять нежность без спешки',target:'emotional_closeness',turnCount:68,maxTurns:18});
  assert.equal(intent.turnCount,68);
  assert.equal(intent.kind,'maintenance');
});
