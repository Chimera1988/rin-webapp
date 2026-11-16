import test from 'node:test';
import assert from 'node:assert/strict';
import { roleDialogue, buildResponsesRequest, readResponsesResult } from '../lib/cognition/rin-responses-transport.js';

const prompt = {
  stableSystem: 'Рин: канон и честность',
  dynamicSystem: 'Состояние Рин',
  responseFormat: { json_schema: { name: 'rin_mind_turn_v2', strict: true, schema: { type: 'object', properties: { mind: { type: 'object' } } } } }
};

test('keeps role-separated dialogue in order and excludes only current request', () => {
  const history = [
    { role: 'user', requestId: 'old', content: 'Мы вчера обсуждали книгу' },
    { role: 'assistant', turnId: 'a1', content: 'Да, ты выбирал между двумя романами' },
    { role: 'user', requestId: 'current', content: 'И какую мы выбрали?' }
  ];
  assert.deepEqual(roleDialogue(history, 'current'), [
    { role: 'user', content: 'Мы вчера обсуждали книгу' },
    { role: 'assistant', content: 'Да, ты выбирал между двумя романами' }
  ]);
  const body = buildResponsesRequest({model:'gpt-6-luna', prompt, history, requestId:'current', userTurn:'И какую мы выбрали?', reasoning_effort:'none', temperature:0.58});
  assert.deepEqual(body.input.map(x => x.role), ['developer','developer','user','assistant','user']);
  assert.equal(body.input.at(-1).content, 'И какую мы выбрали?');
  assert.equal(body.store, false);
  assert.equal(body.reasoning.effort, 'none');
  assert.equal(body.temperature, 0.58);
  assert.equal(body.text.format.name, 'rin_mind_turn_v2');
  assert.ok(!('response_format' in body));
});

test('does not duplicate grouped segments or truncate newest reply', () => {
  const history = [
    {role:'assistant',turnId:'a1',content:'Привет'},
    {role:'assistant',turnId:'a1',content:'Как твой проект?'},
    {role:'user',requestId:'new',content:'Ответ'}
  ];
  assert.deepEqual(roleDialogue(history,'new'),[{role:'assistant',content:'Привет\nКак твой проект?'}]);
});

test('parses structured response and usage without SDK-only output_text', () => {
  const response = readResponsesResult({
    status:'completed', model:'gpt-6-luna',
    output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'{"mind":{}}'}]}],
    usage:{input_tokens:87,output_tokens:24,total_tokens:111,input_tokens_details:{cached_tokens:50},output_tokens_details:{reasoning_tokens:2}}
  });
  assert.equal(response.content, '{"mind":{}}');
  assert.equal(response.finishReason,'stop');
  assert.equal(response.usage.prompt_tokens,87);
  assert.equal(response.usage.prompt_tokens_details.cached_tokens,50);
});

test('incomplete generation exposes truncation to existing fallback', () => {
  const response = readResponsesResult({status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[]});
  assert.equal(response.finishReason,'length');
});

test('older models remain compatible without GPT-6 reasoning', () => {
  const b = buildResponsesRequest({model:'gpt-4.1', prompt, temperature:0.58});
  assert.equal(b.temperature,0.58);
  assert.equal('reasoning' in b,false);
});
