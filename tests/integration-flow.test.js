import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignMessageBatch,
  createChatMessage,
  createSerialQueue,
  loadChatHistory,
  saveChatHistory,
  toApiHistory,
  updateMessage
} from '../public/js/chat_store.js';
import { buildDecisionStateTransition, normalizeTurnDecision } from '../lib/cognition/turn-decision.js';
import { buildAffectiveTurn } from '../lib/cognition/emotional-state.js';
import { buildKernelState } from '../lib/cognition/kernel-state.js';
import { analyzeConversation } from '../lib/conversation-brain.js';
import { buildStickerState } from '../lib/cognition/sticker-state.js';
import { selectStickerForIntent } from '../lib/cognition/sticker-selector.js';
import { MemoryStorage, createReq, createRes, sleep } from './helpers/runtime.js';

const decision = (overrides = {}) => ({
  act: 'direct_response', focus: 'ответить по смыслу', stance: 'лично и конкретно',
  question: { mode: 'none', reason: null },
  replyLink: { targetEventId: null, reason: null },
  delivery: { mode: 'single_text', segments: [{ type: 'text', purpose: 'main_reply', stickerIntent: null, maxChars: 620 }] },
  intentTransition: { operation: 'none', goal: null, motive: null, target: null, nextMove: null, progress: null, commitment: null, reason: null },
  openLoops: { open: [], resolveIds: [] }, realityMode: 'grounded', ...overrides
});

function oa(content) {
  return new Response(JSON.stringify({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) }, finish_reason: 'stop' }], usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function realization(text) { return { segments: [{ purpose: 'main_reply', text }] }; }

function structuredFetch({ decide, realize, memory } = {}) {
  return async (_url, options = {}) => {
    const payload = JSON.parse(options.body || '{}');
    const schema = payload?.response_format?.json_schema?.name;
    if (schema === 'rin_turn_decision') return oa(typeof decide === 'function' ? decide(payload) : decide || decision());
    if (schema === 'rin_realization') return oa(typeof realize === 'function' ? realize(payload) : realize || realization('Угу.'));
    if (payload?.response_format?.type === 'json_object') return oa(memory || { facts: [], events: [], sharedMoments: [] });
    throw new Error(`unexpected integration fetch: ${schema || payload?.response_format?.type || 'unknown'}`);
  };
}

test('aggregated rapid messages share one request and stay ordered at the end of transport history', async () => {
  const history = [
    createChatMessage({ role: 'assistant', status: 'complete', id: 'a0', content: 'Я слушаю.' }),
    createChatMessage({ role: 'user', status: 'pending', id: 'u1', content: 'Слушай' }),
    createChatMessage({ role: 'user', status: 'pending', id: 'u2', content: 'Я тут подумал' }),
    createChatMessage({ role: 'user', status: 'pending', id: 'u3', content: 'А помнишь нашу кицунэ?)' })
  ];
  assignMessageBatch(history, ['u1','u2','u3'], { requestId: 'batch-1', turnId: 'user-turn-batch-1', status: 'sent' });
  const api = toApiHistory(history, 'batch-1');
  assert.deepEqual(api.map(item => item.id), ['a0','u1','u2','u3']);
  assert.ok(api.slice(-3).every(item => item.requestId === 'batch-1' && item.turnId === 'user-turn-batch-1'));

  const completed = [];
  const queue = createSerialQueue(async ids => { await sleep(ids[0] === 'u1' ? 10 : 1); completed.push(ids.join(',')); });
  await Promise.all([queue.enqueue(['u1','u2']), queue.enqueue(['u3'])]);
  assert.deepEqual(completed, ['u1,u2','u3']);
});

test('login → kernel chat → durable memory extraction → next kernel request carries remembered fact', async () => {
  const original = { pin: process.env.ACCESS_PIN, key: process.env.OPENAI_API_KEY, fetch: globalThis.fetch, storage: globalThis.localStorage };
  process.env.ACCESS_PIN = '9999'; process.env.OPENAI_API_KEY = 'integration-key';
  const login = (await import('../api/login.js?kernel-integration')).default;
  const chat = (await import('../api/chat.js?kernel-integration')).default;
  const memoryApi = (await import('../api/memory.js?kernel-integration')).default;
  const storage = new MemoryStorage(); globalThis.localStorage = storage;
  const memoryStore = await import('../public/js/rin_memory.js?kernel-integration');
  const prompts = [];
  let chatCount = 0;
  try {
    const loginRes = createRes(); await login(createReq({ headers: { 'x-rin-pin': '9999' } }), loginRes); assert.equal(loginRes.statusCode, 200);
    globalThis.fetch = structuredFetch({
      decide: payload => { prompts.push(payload.messages[0].content); chatCount += 1; return decision(); },
      realize: () => realization(chatCount === 1 ? 'Запомнила.' : 'Да, помню проект Rin.'),
      memory: { facts: [{ path: 'user.project', value: 'Rin', confidence: 0.95 }], events: [], sharedMoments: [] }
    });

    const firstRes = createRes();
    await chat(createReq({ headers: { 'x-rin-pin': '9999' }, body: { requestId:'r1', history:[{role:'user',kind:'text',status:'sent',requestId:'r1',id:'u1',content:'Я делаю проект Rin'}] } }), firstRes);
    assert.equal(firstRes.statusCode, 200);

    const memoryRes = createRes();
    await memoryApi(createReq({ headers: { 'x-rin-pin': '9999' }, body: { userText:'Я делаю проект Rin', assistantText:firstRes.body.reply, existingMemory:{} } }), memoryRes);
    assert.equal(memoryRes.statusCode, 200);
    for (const fact of memoryRes.body.facts) await memoryStore.upsertFact(fact.path, fact.value);
    const diary = await memoryStore.loadDiary();
    assert.equal(diary.facts.user.project, 'Rin');

    const secondRes = createRes();
    await chat(createReq({ headers: { 'x-rin-pin': '9999' }, body: {
      requestId:'r2', history:[{role:'user',kind:'text',status:'sent',requestId:'r2',id:'u2',content:'Как называется мой проект?'}],
      memory:{facts:diary.facts,recentEvents:diary.events,mood:diary.mood,relationship:diary.relationship,conversationState:diary.conversationState}
    } }), secondRes);
    assert.equal(secondRes.statusCode, 200);
    assert.match(prompts.at(-1), /Rin/);
  } finally {
    globalThis.fetch = original.fetch; globalThis.localStorage = original.storage;
    if (original.pin === undefined) delete process.env.ACCESS_PIN; else process.env.ACCESS_PIN = original.pin;
    if (original.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = original.key;
  }
});

test('kernel state transition commits once, survives reload, and is visible to the next kernel snapshot', async () => {
  const storage = new MemoryStorage(); const previous = globalThis.localStorage; globalThis.localStorage = storage;
  const memoryStore = await import('../public/js/rin_memory.js?kernel-state-flow');
  try {
    const history = [{ role:'user', kind:'text', status:'sent', requestId:'s1', id:'u1', content:'Нет, отправлю письмо именно вечером.' }];
    const brain = analyzeConversation({ userText: history[0].content, history, conversationState:'ongoing' });
    const affect = buildAffectiveTurn({ userText: history[0].content, history, memory:null, brain });
    const kernelState = buildKernelState({ requestId:'s1', userText:history[0].content, history, memory:null, brain, affectiveTurn:affect, conversationState:'ongoing' });
    const transition = buildDecisionStateTransition({ kernelState, affectiveTurn: affect, decision: normalizeTurnDecision(decision()) });
    await memoryStore.commitTurnState({ requestId:'s1', stateTransition:transition, now:5_000_000 });
    const persisted = await memoryStore.loadDiary();
    assert.equal(persisted.conversationState.revision, 1);

    const nextHistory = [{ role:'user', kind:'text', status:'sent', requestId:'s2', id:'u2', content:'Ну вот, готово.' }];
    const nextBrain = analyzeConversation({ userText:nextHistory[0].content, history:nextHistory, conversationState:'ongoing' });
    const nextAffect = buildAffectiveTurn({ userText:nextHistory[0].content, history:nextHistory, memory:persisted, brain:nextBrain });
    const nextState = buildKernelState({ requestId:'s2', userText:nextHistory[0].content, history:nextHistory, memory:{...persisted,conversationState:persisted.conversationState}, brain:nextBrain, affectiveTurn:nextAffect, conversationState:'ongoing' });
    assert.equal(nextState.revision, 1);
    assert.ok(nextState.dialogueState);
  } finally { globalThis.localStorage = previous; }
});

test('40-turn synthetic long-flow preserves one persistent intent owner, open loop continuity and terminal completion across reloads', async () => {
  const storage = new MemoryStorage(); const previous = globalThis.localStorage; globalThis.localStorage = storage;
  const memoryStore = await import('../public/js/rin_memory.js?long-kernel-flow');
  try {
    let memory = await memoryStore.loadDiary();
    let activeLoopId = null;
    for (let index = 0; index < 40; index += 1) {
      const requestId = `long-${index+1}`;
      const userText = index === 0 ? 'Тогда отдохни и выпей зелёного чая)' : index === 39 ? 'Доброй ночи)' : `ход ${index+1}`;
      const history = [{ role:'user',kind:'text',status:'sent',requestId,id:`u-${index}`,content:userText }];
      const brain = analyzeConversation({ userText, history, conversationState:index === 39 ? 'ending' : 'ongoing' });
      const affect = buildAffectiveTurn({ userText, history, memory, brain });
      const state = buildKernelState({ requestId,userText,history,memory,brain,affectiveTurn:affect,conversationState:index===39?'ending':'ongoing' });
      let d;
      if (index === 0) d = decision({
        act:'accept_care_and_act',
        intentTransition:{operation:'activate',goal:'отдохнуть после работы',motive:'усталость',target:'evening_rest',nextMove:'заварить чай',progress:.05,commitment:75,reason:'приняла заботу'},
        openLoops:{open:[{subject:'шутливое пари о десяти поцелуях',type:'shared_joke',importance:58}],resolveIds:[]}
      });
      else if (index === 39) d = decision({ act:'close_evening', intentTransition:{operation:'complete',goal:null,motive:null,target:null,nextMove:null,progress:1,commitment:null,reason:'вечер завершён'}, openLoops:{open:[],resolveIds:[]} });
      else d = decision({ act:'continue_naturally', intentTransition:{operation:index % 5 === 0?'advance':'preserve',goal:null,motive:null,target:null,nextMove:'продолжить отдых',progress:Math.min(.95,index/40),commitment:75,reason:'линия ещё актуальна'}, openLoops:{open:[],resolveIds:[]} });
      const transition = buildDecisionStateTransition({ kernelState:state, affectiveTurn:affect, decision:normalizeTurnDecision(d), now:7_000_000+index });
      await memoryStore.commitTurnState({ requestId,stateTransition:transition,now:7_000_000+index });
      memory = await memoryStore.loadDiary();
      assert.equal(memory.conversationState.revision, index+1);
      if (index === 0) activeLoopId = memory.conversationState.openLoops[0]?.id;
      if (index > 0 && index < 39) assert.equal(memory.conversationState.rinIntent?.goal, 'отдохнуть после работы');
      if (activeLoopId && index < 39) assert.equal(memory.conversationState.openLoops.some(loop => loop.id === activeLoopId), true);
    }
    assert.equal(memory.conversationState.rinIntent.status, 'completed');
    assert.equal(memory.conversationState.rinIntent.terminalAtTurn > 0, true);
    assert.equal(memory.conversationState.revision, 40);
  } finally { globalThis.localStorage = previous; }
});

test('explicit-fiction decision can create a shared scene without mutating canon or durable user facts', () => {
  const state = { revision:3, scene:{type:'creative_story'}, dialogueState:null, beliefModel:{beliefs:[]}, activeIntent:null };
  const d = normalizeTurnDecision(decision({ act:'tell_kitsune_story', realityMode:'explicit_fiction', openLoops:{open:[],resolveIds:[]} }));
  const transition = buildDecisionStateTransition({ kernelState:state, affectiveTurn:null, decision:d });
  assert.equal(d.realityMode, 'explicit_fiction');
  assert.equal(transition.rinIntent, null);
  assert.deepEqual(transition.beliefUpdates || [], []);
});

test('persistent intent survives diary reload and direct unrelated questions can preserve it', async () => {
  const storage = new MemoryStorage(); const previous = globalThis.localStorage; globalThis.localStorage = storage;
  const memoryStore = await import('../public/js/rin_memory.js?intent-kernel-flow');
  try {
    const initialState = { revision:0, scene:{type:'evening'}, dialogueState:null, beliefModel:{beliefs:[]}, activeIntent:null };
    const activated = buildDecisionStateTransition({ kernelState:initialState, decision:normalizeTurnDecision(decision({ intentTransition:{operation:'activate',goal:'отдохнуть после работы',motive:'усталость',target:'rest',nextMove:'чай',progress:.1,commitment:70,reason:'care'} })) });
    await memoryStore.commitTurnState({ requestId:'i1',stateTransition:activated,now:1_000 });
    let diary = await memoryStore.loadDiary();
    assert.equal(diary.conversationState.rinIntent.status, 'active');

    const preserveState = { revision:diary.conversationState.revision, scene:{type:'everyday'}, dialogueState:diary.conversationState.dialogueState, beliefModel:{beliefs:diary.conversationState.beliefs||[]}, activeIntent:diary.conversationState.rinIntent };
    const preserved = buildDecisionStateTransition({ kernelState:preserveState, decision:normalizeTurnDecision(decision({ act:'answer_unrelated_question', intentTransition:{operation:'preserve',goal:null,motive:null,target:null,nextMove:null,progress:null,commitment:null,reason:'direct question has priority'} })) });
    await memoryStore.commitTurnState({ requestId:'i2',stateTransition:preserved,now:1_100 });
    diary = await memoryStore.loadDiary();
    assert.equal(diary.conversationState.rinIntent.status, 'active');
    assert.equal(diary.conversationState.rinIntent.goal, 'отдохнуть после работы');
  } finally { globalThis.localStorage = previous; }
});

test('failed turn remains excluded and retry becomes current without corrupting following completed turn', () => {
  const history = [
    createChatMessage({ role:'user',status:'failed',requestId:'r1',id:'u1',content:'первый' }),
    createChatMessage({ role:'user',status:'complete',requestId:'r2',id:'u2',content:'второй' }),
    createChatMessage({ role:'assistant',status:'complete',requestId:'r2',id:'a2',content:'ответ на второй' })
  ];
  updateMessage(history,'u1',{status:'sent',requestId:'retry'});
  assert.deepEqual(toApiHistory(history,'retry').map(item=>item.id), ['u2','a2','u1']);
});

test('40-turn sticker flow respects 30% rolling budget, survives history reload and preserves exact semantic intent', async () => {
  const storage = new MemoryStorage();
  let history = [];
  const stickerTurns = [];
  const selectedIds = [];
  for (let turn = 1; turn <= 40; turn += 1) {
    const state = await buildStickerState({
      history: toApiHistory(history),
      preference: { mode:'smart', probability:30, safeMode:true },
      scene: 'everyday',
      userText: 'обычный тёплый разговор'
    });
    const turnId=`sticker-flow-${turn}`;
    history.push(createChatMessage({ role:'assistant',kind:'text',status:'complete',id:`sf-text-${turn}`,requestId:`sf-${turn}`,turnId,content:`ответ ${turn}` }));
    if (state.available) {
      const selected=await selectStickerForIntent('tender_soft_smile',{
        delivery:'after_text',scene:'everyday',intensity:45
      });
      assert.ok(selected);
      stickerTurns.push(turn);
      selectedIds.push(selected.sticker.id);
      history.push(createChatMessage({
        role:'assistant',kind:'sticker',status:'complete',id:`sf-sticker-${turn}`,requestId:`sf-${turn}`,turnId,
        sticker:{...selected.sticker,delivery:'after_text',cause:'flow test',intensity:45,canExplain:true,expiresAfterTurns:1}
      }));
    }
    if (turn === 20) {
      saveChatHistory(history,storage);
      history=loadChatHistory(storage);
    }
  }

  assert.equal(stickerTurns.length,12);
  for (let start=1; start<=31; start+=1) {
    const used=stickerTurns.filter(turn=>turn>=start && turn<start+10).length;
    assert.ok(used<=3,`window ${start}-${start+9} has ${used} sticker turns`);
  }
  assert.ok(selectedIds.every(id => id === 'tender_soft_smile'));

  const reconstructed=await buildStickerState({history:toApiHistory(history),preference:{mode:'smart',probability:30,safeMode:true},scene:'everyday'});
  assert.ok(reconstructed.recentAssetIds.length>0);
  assert.equal(reconstructed.schema,'rin-sticker-state-v1');
});
