import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeConversation } from '../lib/conversation-brain.js';
import { buildKernelState } from '../lib/cognition/kernel-state.js';
import { selectModelHistory, pruneModelHistory } from '../lib/chat-contract.js';

const msg = (role, content, id, extra = {}) => ({ role, kind:'text', status:'complete', id, content, ...extra });

function stateFor(history, userText) {
  const brain = analyzeConversation({ userText, history, conversationState:'ongoing' });
  const state = buildKernelState({ requestId:'r', userText, history, brain, memory:{ conversationState:{revision:0,openLoops:[],rinIntent:null} }, conversationState:'ongoing' });
  return { brain, state };
}

test('short dependent replies preserve a playful scene but perception does not prescribe the next act', () => {
  const history = [
    msg('user','Давай немного пофлиртуем)','u1'),
    msg('assistant','Тогда не жалуйся, если я начну тебя дразнить.','a1'),
    msg('user','Весь в нетерпении 😏','u2'),
    msg('assistant','Потерпи. Мне нравится, когда ты ждёшь.','a2'),
    msg('user','Ну да)','u3')
  ];
  const { brain, state } = stateFor(history, 'Ну да)');
  assert.equal(brain.activeScene.type, 'playful_flirt');
  assert.equal(state.scene.type, 'playful_flirt');
  assert.equal('goal' in brain.activeScene, false);
  assert.equal('responseAct' in brain, false);
});

test('handing initiative to Rin is an observed semantic signal, not a preselected take-lead action', () => {
  const history = [msg('assistant','А ты уверен, что выдержишь?','a1'), msg('user','Так что можешь начинать 😎','u2')];
  const { brain, state } = stateFor(history, history.at(-1).content);
  assert.equal(brain.hiddenIntent.type, 'invite_rin_initiative');
  assert.equal(brain.relation.type, 'initiative_handoff');
  assert.ok(state.perception.signals.includes('user_handed_initiative'));
  assert.equal('initiative' in state, false);
});

test('noticed scene drift is perception only and remains available to the Kernel', () => {
  const history = [msg('user','Давай пофлиртуем)','u1'), msg('assistant','Расскажу тебе историю про загадочного кота.','a1'), msg('user','У нас как-то флирт перетёк в философию 😁','u2')];
  const { brain, state } = stateFor(history, history.at(-1).content);
  assert.equal(brain.hiddenIntent.type, 'reclaim_playful_scene');
  assert.ok(state.perception.signals.includes('user_noticed_scene_drift'));
  assert.equal('responseFocus' in brain, false);
});

test('elliptical follow-up is grounded in Rin previous statement without generating a response directive', () => {
  const history = [msg('assistant','Читаю книгу и иногда задерживаюсь на одной фразе.','a1'), msg('user','Сложное понимание?','u1')];
  const { brain, state } = stateFor(history, 'Сложное понимание?');
  assert.equal(brain.relation.type, 'follow_up_on_rin_statement');
  assert.ok(state.perception.signals.includes('follow_up_on_rin_statement'));
  assert.equal(state.dialogueState.lastRinAction.kind, 'text');
});

test('full continuity may use a scene anchor omitted from the pruned model transcript', () => {
  const raw = [msg('user','Хочу, чтобы ты ко мне поприставала)','anchor-1'), msg('user','Я весь в нетерпении)','anchor-2')];
  for (let index=0; index<8; index+=1) raw.push(msg('assistant',`Длинный промежуточный ответ ${index}: ${'нейтральный текст '.repeat(115)}`,`a${index}`));
  raw.push({ ...msg('user','Ну да)','current'), status:'sent', requestId:'r-current' });
  const full = selectModelHistory(raw,{includeRequestId:'r-current'});
  const pruned = pruneModelHistory(full,42,12000);
  assert.equal(pruned.some(item=>item.id==='anchor-1'),false);
  assert.equal(pruned.some(item=>item.id==='anchor-2'),false);
  const brain = analyzeConversation({ userText:'Ну да)', history:full, conversationState:'ongoing' });
  assert.equal(brain.activeScene.type,'playful_flirt');
  assert.equal(brain.activeScene.openHook.messageId,'anchor-2');
});
