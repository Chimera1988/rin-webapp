import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MemoryStorage } from './helpers/runtime.js';
import {
  CHAT_SCHEMA_VERSION as CLIENT_SCHEMA,
  CHAT_STORAGE_KEY,
  createChatMessage,
  createReplySnapshot,
  loadChatHistory,
  saveChatHistory,
  toApiHistory
} from '../public/js/chat_store.js';
import { CHAT_SCHEMA_VERSION as SERVER_SCHEMA, normalizeChatHistory, selectModelHistory } from '../lib/chat-contract.js';
import { buildKernelState } from '../lib/cognition/kernel-state.js';
import { analyzeConversation } from '../lib/conversation-brain.js';

const memory = { conversationState: { revision:0, openLoops:[], rinIntent:null } };

function kernelFor(history, userText, explicitReply=null, memoryOverride=memory) {
  const brain=analyzeConversation({userText,history,conversationState:'ongoing'});
  return buildKernelState({requestId:'r1',userText,history,memory:memoryOverride,brain,explicitReply,conversationState:'ongoing'});
}

test('reply snapshots survive schema v6 storage and API transport', () => {
  const storage = new MemoryStorage();
  const source = createChatMessage({ role:'assistant',kind:'text',status:'complete',id:'a1',content:'Я застряла на одной фразе.' });
  const reply = createChatMessage({ role:'user',kind:'text',status:'complete',requestId:'r1',id:'u1',content:'На какой именно?',inReplyTo:source.id,replySnapshot:createReplySnapshot(source) });
  assert.equal(CLIENT_SCHEMA,6);
  assert.equal(saveChatHistory([source,reply],storage),true);
  const loaded=loadChatHistory(storage);
  assert.equal(loaded[1].inReplyTo,'a1');
  assert.equal(loaded[1].replySnapshot.excerpt,'Я застряла на одной фразе.');
  assert.equal(toApiHistory(loaded,'r1').at(-1).inReplyTo,'a1');
  assert.ok(storage.getItem(CHAT_STORAGE_KEY));
});

test('sticker reply snapshot stays visual and does not expose semantic cause', () => {
  const sticker=createChatMessage({role:'assistant',kind:'sticker',status:'complete',id:'s1',content:'[Невербальный жест Рин: ревность; причина: другая девушка]',sticker:{id:'mild_jealousy',src:'/stickers/mild_jealousy.webp',meaning:'лёгкая ревность',cause:'другая девушка'}});
  const snapshot=createReplySnapshot(sticker);
  assert.equal(snapshot.excerpt,'Стикер');
  assert.equal(snapshot.stickerId,'mild_jealousy');
  assert.doesNotMatch(JSON.stringify(snapshot),/ревност|другая девушка/iu);
});

test('server preserves explicit reply metadata through model history selection', () => {
  assert.equal(SERVER_SCHEMA,6);
  const history=normalizeChatHistory([
    {role:'assistant',kind:'text',status:'complete',id:'a1',content:'Скажи точнее.'},
    {role:'user',kind:'text',status:'sent',requestId:'r1',id:'u1',content:'Вот это и уточняю.',inReplyTo:'a1',replySnapshot:{role:'assistant',kind:'text',excerpt:'Скажи точнее.'}}
  ]);
  const selected=selectModelHistory(history,{includeRequestId:'r1'});
  assert.equal(selected.at(-1).inReplyTo,'a1');
  assert.equal(selected.at(-1).replySnapshot.excerpt,'Скажи точнее.');
});

test('explicit selected reply becomes a first-class Kernel state target, not a separate response planner', () => {
  const history=[
    {role:'assistant',kind:'text',status:'complete',id:'a1',content:'Мне больше нравится первый вариант.'},
    {role:'user',kind:'text',status:'sent',requestId:'r1',id:'u1',content:'Почему?',inReplyTo:'a1',replySnapshot:{role:'assistant',kind:'text',excerpt:'Мне больше нравится первый вариант.'}}
  ];
  const explicitReply={messageId:'a1',role:'assistant',kind:'text',excerpt:'Мне больше нравится первый вариант.',reason:'пользователь вручную выбрал это сообщение',confidence:1};
  const state=kernelFor(history,'Почему?',explicitReply);
  assert.equal(state.replyTarget.messageId,'a1');
  assert.equal(state.dialogueState.explicitReplyTarget.messageId,'a1');
  assert.ok(state.perception.signals.includes('explicit_reply_target_selected'));
  assert.equal('responsePlan' in state,false);
});

test('conversation open loop is state for the Kernel and never auto-selects a reply target', () => {
  const history=[
    {role:'user',kind:'text',status:'complete',id:'u-music',content:'Иногда я слушаю Linkin Park, когда нужно освободить голову.'},
    {role:'assistant',kind:'text',status:'complete',id:'a-music',content:'Понимаю этот ритм.'},
    {role:'user',kind:'text',status:'sent',requestId:'r1',id:'u-now',content:'А вечером снова займусь проектом.'}
  ];
  const mem={conversationState:{revision:4,rinIntent:null,openLoops:[{id:'loop-music',type:'topic',subject:'музыка Linkin Park',status:'active',importance:75,confidence:.9}]}};
  const state=kernelFor(history,history.at(-1).content,null,mem);
  assert.equal(state.openLoops[0].id,'loop-music');
  assert.equal(state.replyTarget,null);
});

test('dialogue state remembers when Rin replied to a selected earlier user message', () => {
  const history=[
    {role:'user',kind:'text',status:'complete',id:'u-source',content:'Иногда я слушаю Linkin Park, когда нужно освободить голову.'},
    {role:'assistant',kind:'text',status:'complete',id:'a-linked',content:'Какая песня у тебя обычно первая?',inReplyTo:'u-source',replySnapshot:{role:'user',kind:'text',excerpt:'Иногда я слушаю Linkin Park, когда нужно освободить голову.'}},
    {role:'user',kind:'text',status:'sent',requestId:'r1',id:'u-next',content:'Наверное, Numb.'}
  ];
  const state=kernelFor(history,history.at(-1).content);
  assert.equal(state.dialogueState.lastRinAction.kind,'text');
  assert.match(state.dialogueState.lastRinAction.cause,/ответ на выбранное сообщение пользователя/);
  assert.match(state.dialogueState.lastRinAction.cause,/Linkin Park/);
});

test('reply UI keeps the existing composer and bubble design tokens', async () => {
  const [html,css,chat]=await Promise.all([
    readFile(new URL('../public/index.html',import.meta.url),'utf8'),
    readFile(new URL('../public/style.css',import.meta.url),'utf8'),
    readFile(new URL('../public/chat.js',import.meta.url),'utf8')
  ]);
  assert.match(html,/id="replyPreview" class="reply-preview"/);
  assert.match(html,/id="replyCancel"/);
  assert.match(css,/\.reply-preview[\s\S]*var\(--surface\)/);
  assert.match(css,/\.reply-quote[\s\S]*var\(--accent\)/);
  assert.match(chat,/inReplyTo/);
  assert.match(chat,/replySnapshot/);
});
