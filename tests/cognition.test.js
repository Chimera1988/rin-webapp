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

test('TurnDecision derives delivery mode from semantic segments instead of trusting a competing mode field', () => {
  const projected=validDecision({delivery:{mode:'multi_message',segments:[{type:'text',purpose:'only',stickerIntent:null,maxChars:200}]}});
  assert.equal(projected.delivery.mode,'single_text');
  const checked=validateTurnDecisionConstraints(projected,{conversationState:'ongoing'});
  assert.equal(checked.passed,true);
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



test('realization parser preserves full model text so validator can reject overlong segments instead of clipping them', () => {
  const d=validDecision({delivery:{segments:[{type:'text',purpose:'answer',stickerIntent:null,maxChars:80}]}});
  const long='Это законченное предложение намеренно длиннее лимита, чтобы проверить, что parser не обрежет его посреди слова и не скроет нарушение.';
  const parsed=parseRealization(JSON.stringify({segments:[{text:long}]}),d);
  assert.equal(parsed.segments[0].text,long);
  const result=validateRealization(parsed,{decision:d,realityBoundary:{}});
  assert.equal(result.passed,false);
  assert.ok(result.warnings.includes('segment_0_too_long'));
});

test('realization validator rejects feminine second-person agreement for the male user', () => {
  const d=validDecision();
  const wrong=validateRealization({segments:[{purpose:'answer',text:'О, ты решила добавить искру.'}]},{decision:d,realityBoundary:{}});
  assert.equal(wrong.passed,false);
  assert.ok(wrong.warnings.includes('user_feminine_address'));
  const right=validateRealization({segments:[{purpose:'answer',text:'О, ты решил добавить искру.'}]},{decision:d,realityBoundary:{}});
  assert.equal(right.passed,true);
  const noFalsePositive=validateRealization({segments:[{purpose:'answer',text:'Ты сначала послушай, потом решай.'}]},{decision:d,realityBoundary:{}});
  assert.equal(noFalsePositive.passed,true);
});

test('realization validator checks protocol and reality without mutating TurnDecision', () => {
  const d=validDecision();
  const before=JSON.stringify(d);
  const result=validateRealization({segments:[{purpose:'answer',text:'Да, поняла.'}]},{decision:d,realityBoundary:{}});
  assert.equal(result.passed,true);
  assert.equal(JSON.stringify(d),before);
});

test('realization validator rejects exact and conservative near repeats of recent Rin messages', () => {
  const d=validDecision();
  const previous='Ты меня немного смутил сейчас... Но это приятно. Я улыбаюсь — пусть ты этого не видишь.';
  const exact=validateRealization({segments:[{purpose:'answer',text:previous}]},{
    decision:d, realityBoundary:{}, currentUserText:'Я чувствую...',
    recentHistory:[{role:'assistant',kind:'text',content:previous},{role:'user',kind:'text',content:'Я чувствую...'}]
  });
  assert.equal(exact.passed,false);
  assert.ok(exact.warnings.includes('recent_assistant_duplicate'));

  const near=validateRealization({segments:[{purpose:'answer',text:'Ты меня немного смутил сейчас... Но это приятно. Я улыбаюсь — просто ты этого не видишь.'}]},{
    decision:d, realityBoundary:{}, currentUserText:'Я чувствую...',
    recentHistory:[{role:'assistant',kind:'text',content:previous}]
  });
  assert.equal(near.passed,false);
  assert.ok(near.warnings.includes('recent_assistant_near_duplicate'));

  const fresh=validateRealization({segments:[{purpose:'answer',text:'Тогда я, пожалуй, не буду от этого прятаться.'}]},{
    decision:d, realityBoundary:{}, currentUserText:'Я чувствую...',
    recentHistory:[{role:'assistant',kind:'text',content:previous}]
  });
  assert.equal(fresh.passed,true);
});

test('realization duplicate guard allows an explicit request to repeat and does not police tiny conventional phrases', () => {
  const d=validDecision();
  const repeated='Ты меня немного смутил сейчас... Но это приятно.';
  const requested=validateRealization({segments:[{purpose:'answer',text:repeated}]},{
    decision:d, realityBoundary:{}, currentUserText:'Повтори, пожалуйста, что ты сказала.',
    recentHistory:[{role:'assistant',kind:'text',content:repeated}]
  });
  assert.equal(requested.passed,true);
  const short=validateRealization({segments:[{purpose:'answer',text:'Спасибо.'}]},{
    decision:d, realityBoundary:{}, currentUserText:'Не за что)', recentHistory:[{role:'assistant',kind:'text',content:'Спасибо.'}]
  });
  assert.equal(short.passed,true);
  const notARepeatRequest=validateRealization({segments:[{purpose:'answer',text:repeated}]},{
    decision:d, realityBoundary:{}, currentUserText:'Ещё раз спасибо тебе)', recentHistory:[{role:'assistant',kind:'text',content:repeated}]
  });
  assert.equal(notARepeatRequest.passed,false);
  assert.ok(notARepeatRequest.warnings.includes('recent_assistant_duplicate'));
});

test('realization validator rejects duplicate text segments inside one multi-message delivery', () => {
  const d=validDecision({delivery:{segments:[
    {type:'text',purpose:'reaction',stickerIntent:null,maxChars:180},
    {type:'text',purpose:'afterthought',stickerIntent:null,maxChars:180}
  ]}});
  const result=validateRealization({segments:[
    {purpose:'reaction',text:'Я это заметила. И да, мне приятно.'},
    {purpose:'afterthought',text:'Я это заметила. И да, мне приятно.'}
  ]},{decision:d,realityBoundary:{}});
  assert.equal(result.passed,false);
  assert.ok(result.warnings.includes('duplicate_text_segments'));
});
