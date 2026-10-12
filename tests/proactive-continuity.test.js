import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectProactiveHandoff } from '../lib/cognition/proactive-handoff.js';
import { analyzeConversation } from '../lib/conversation-brain.js';
import { buildRinMindPrompt } from '../lib/cognition/rin-mind.js';
import { appendBackgroundMessages } from '../lib/push/core.js';
import { normalizeChatMessage, selectModelHistory } from '../lib/chat-contract.js';
import { createChatMessage, saveChatHistory, loadChatHistory, toApiHistory } from '../public/js/chat_store.js';

const morning = Date.parse('2026-10-12T07:03:00Z');
const make = (role, text, opts={}) => ({
  id:opts.id || `${role}-${Math.random().toString(36).slice(2)}`,
  role,kind:opts.kind||'text',status:role==='user'?'sent':'complete',
  requestId:opts.requestId||(role==='assistant'?'initiative-1':'user-1'),
  content:text,ts:opts.ts??morning,
  ...(opts.proactiveType?{proactiveType:opts.proactiveType}:{}),
  ...(opts.sticker?{sticker:opts.sticker}:{})
});
const greet = make('assistant','Доброе утро. Уже разбираю редакторские правки.',{id:'greet',proactiveType:'scheduled'});
const reply = text => make('user',text,{id:'reply',ts:morning+120000});

function storage() {
  const values=new Map();
  return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
}

test('local proactive message provenance survives storage, transport and model-history normalization', () => {
  const store=storage();
  const original=[createChatMessage(greet)];
  assert.equal(saveChatHistory(original,store),true);
  const loaded=loadChatHistory(store);
  assert.equal(loaded[0].proactiveType,'scheduled');
  const model=selectModelHistory(toApiHistory([...loaded,createChatMessage(reply('Доброе утро)'))],'user-1'),{includeRequestId:'user-1'});
  assert.equal(model[0].proactiveType,'scheduled');
  assert.equal(loaded[0].status,'complete');
  assert.equal(inspectProactiveHandoff(model,'Доброе утро)').mode,'acknowledgement');
  const analyzed=analyzeConversation({userText:'Доброе утро)',history:model});
  assert.equal(analyzed.relation.type,'acknowledges_proactive_turn');
  assert.equal(analyzed.proactiveHandoff.message,greet.content);
});

test('the first reply after a scheduled Push initiative is one continuation, including split bubbles and sticker', () => {
  const requestId='rin-bg-2026-10-12-morning-12345';
  const pending={id:'p1',requestId,proactiveType:'scheduled',createdAt:morning,deliveryPlan:{segments:[
    {id:'one',type:'text',text:'Доброе утро.'},
    {id:'two',type:'text',text:'Сегодня выбираю между правками и кофе.'},
    {id:'three',type:'sticker',sticker:{meaning:'тёплая улыбка'}}
  ]}};
  const projected=appendBackgroundMessages([], [pending]);
  const history=[...projected,reply('Доброе утро)')];
  const state=inspectProactiveHandoff(history,'Доброе утро)');
  assert.equal(state.source,'push');
  assert.equal(state.type,'scheduled');
  assert.equal(state.mode,'acknowledgement');
  assert.match(state.message,/выбираю между правками/u);
  assert.equal(projected.length,3);
  assert.ok(projected.every(event=>event.proactiveType==='scheduled'));
  const prompt=buildRinMindPrompt({profile:{prompt_profile:{}},state:{requestId:'user-1',proactiveHandoff:state}});
  assert.match(prompt.dynamicSystem,/ОТКЛИК НА ИНИЦИАТИВУ РИН/u);
  assert.match(prompt.dynamicSystem,/не приветствуй его заново/u);
  assert.match(prompt.dynamicSystem,/выбираю между правками/u);
});

test('a regular greeting must not trigger proactive continuation', () => {
  const history=[{...greet,proactiveType:undefined},reply('Доброе утро)')];
  assert.equal(inspectProactiveHandoff(history,'Доброе утро)'),null);
  assert.notEqual(analyzeConversation({userText:'Доброе утро)',history}).relation.type,'acknowledges_proactive_turn');
});

test('one-shot origin closes after a user reply and the next standard response', () => {
  const history=[greet,reply('Доброе утро)'),make('assistant','Кофе сегодня меня точно спасёт.',{requestId:'user-1',ts:morning+180000}),make('user','А у меня чай.',{requestId:'user-2',ts:morning+240000})];
  assert.equal(inspectProactiveHandoff(history,'А у меня чай.'),null);
});

test('substantive first replies preserve user choice of topic instead of enforcing greeting',()=>{
  const history=[greet,reply('А ты сегодня планируешь выходить из дома?')];
  const data=inspectProactiveHandoff(history,'А ты сегодня планируешь выходить из дома?');
  assert.equal(data.mode,'followup');
  const mind=buildRinMindPrompt({profile:{prompt_profile:{}},state:{proactiveHandoff:data}});
  assert.match(mind.dynamicSystem,/Если пользователь начал другую тему/u);
});

test('legacy Push messages still connect without an added marker',()=>{
  const legacy={...greet,requestId:'rin-bg-2026-10-12-morning-111'};
  delete legacy.proactiveType;
  assert.equal(inspectProactiveHandoff([legacy,reply('Доброе утро)')],'Доброе утро)').source,'push');
});

test('only assistant messages can have trusted proactive provenance',()=>{
  const wrong=normalizeChatMessage({...reply('Доброе утро)'),proactiveType:'scheduled'});
  assert.equal(wrong.proactiveType,undefined);
  const wrongType=normalizeChatMessage({...greet,proactiveType:'arbitrary'});
  assert.equal(wrongType.proactiveType,undefined);
});

test('an explicitly delayed reply retains the source text without claiming immediate presence',()=>{
  const history=[greet,make('user','О, привет!',{requestId:'late',ts:morning+5*3600000})];
  const handoff=inspectProactiveHandoff(history,'О, привет!');
  assert.equal(handoff.delayed,true);
  assert.equal(handoff.mode,'followup');
});


test('local new-chat greeting and emoji-only acknowledgements also hand off correctly',()=>{
  const initial=make('assistant','Доброе утро, я тут.',{proactiveType:'greeting',requestId:'local-greeting',ts:morning});
  const state=inspectProactiveHandoff([initial,reply('😊')],'😊');
  assert.equal(state.source,'local');
  assert.equal(state.type,'greeting');
  assert.equal(state.mode,'acknowledgement');
  assert.equal(analyzeConversation({userText:'😊',history:[initial,reply('😊')]}).relation.type,'acknowledges_proactive_turn');
});
