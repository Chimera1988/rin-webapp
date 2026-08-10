import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeConversation } from '../lib/conversation-brain.js';
import { buildKernelState } from '../lib/cognition/kernel-state.js';
import { normalizeTurnDecision } from '../lib/cognition/turn-decision.js';
import { validateTurnDecisionConstraints, validateRealization } from '../lib/cognition/turn-validator.js';
import { buildRealizationPrompt, parseRealization } from '../lib/personality/rin-realization.js';

function validDecision(overrides={}) {
  return normalizeTurnDecision({
    act:'answer_directly', focus:'ответить по смыслу', stance:'лично и конкретно',
    question:{mode:'none',reason:null},
    delivery:{mode:'single_text',segments:[{type:'text',purpose:'answer',stickerIntent:null,maxChars:300}]},
    intentTransition:{operation:'none',goal:null,motive:null,target:null,nextMove:null,progress:null,commitment:null,reason:null},
    openLoops:{open:[],resolveIds:[]}, realityMode:'grounded', ...overrides
  });
}

test('Perception exposes ambiguity as evidence but never turns it into a clarification command', () => {
  const text='Он большой';
  const brain=analyzeConversation({userText:text,history:[],conversationState:'ongoing'});
  const state=buildKernelState({requestId:'r1',userText:text,history:[{role:'user',kind:'text',status:'sent',requestId:'r1',id:'u1',content:text}],brain,memory:{conversationState:{revision:0,openLoops:[]}}});
  assert.ok(brain.ambiguity.level>=75);
  assert.deepEqual(state.perception.ambiguity,{level:brain.ambiguity.level});
  assert.ok(state.perception.signals.includes('high_reference_ambiguity'));
  assert.equal('rule' in brain.ambiguity,false);
  assert.equal('shouldClarify' in brain.ambiguity,false);
});

test('correction and direct question arrive as neutral semantic signals for one Kernel', () => {
  for (const [text,signal] of [['Нет, я имел в виду вечер','user_correction_present'],['Почему?','direct_question_present']]) {
    const brain=analyzeConversation({userText:text,history:[],conversationState:'ongoing'});
    const state=buildKernelState({requestId:'r',userText:text,history:[],brain,memory:{conversationState:{revision:0,openLoops:[]}}});
    assert.ok(state.perception.signals.includes(signal), `${text}: ${state.perception.signals.join(',')}`);
    assert.equal('obligations' in state.perception,false);
  }
});

test('TurnDecision protocol rejects inconsistent delivery but never invents replacement behavior', () => {
  const bad=validDecision({delivery:{mode:'multi_message',segments:[{type:'text',purpose:'only',stickerIntent:null,maxChars:200}]}});
  const checked=validateTurnDecisionConstraints(bad,{conversationState:'ongoing'});
  assert.equal(checked.passed,false);
  assert.ok(checked.warnings.some(item=>/multi_message/i.test(item)));
  assert.equal('replacementDecision' in checked,false);
});

test('realization is subordinate to frozen decision and parser returns only segment text', () => {
  const d=validDecision({delivery:{mode:'multi_message',segments:[
    {type:'text',purpose:'reaction',stickerIntent:null,maxChars:180},
    {type:'text',purpose:'afterthought',stickerIntent:null,maxChars:180}
  ]}});
  const prompt=buildRealizationPrompt({profile:{prompt_profile:{reference_character:{core:'Рин спокойная и наблюдательная.'}}},state:{scene:{type:'everyday'}},decision:d,realityBoundary:{}});
  assert.match(prompt.system,/ТОЛЬКО ФОРМУЛИРОВКА УЖЕ ПРИНЯТОГО РЕШЕНИЯ/);
  const parsed=parseRealization(JSON.stringify({segments:[{text:'Первое.'},{text:'Второе.'}]}),d);
  assert.deepEqual(parsed.segments.map(x=>x.text),['Первое.','Второе.']);
  assert.equal('act' in parsed,false);
});

test('realization validator checks protocol and reality without mutating TurnDecision', () => {
  const d=validDecision();
  const before=JSON.stringify(d);
  const result=validateRealization({segments:[{purpose:'answer',text:'Да, поняла.'}]},{decision:d,realityBoundary:{}});
  assert.equal(result.passed,true);
  assert.equal(JSON.stringify(d),before);
});
