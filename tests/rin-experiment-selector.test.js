import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const client=readFileSync(new URL('../public/chat.js',import.meta.url),'utf8');
const api=readFileSync(new URL('../api/chat.js',import.meta.url),'utf8');
test('three inline settings modes and authenticated mode dispatch exist',()=>{
  for(const mode of ['original','dialogue','freedom']) assert.match(html,new RegExp(`data-rin-experiment-mode="${mode}"`));
  assert.match(html,/data-settings-page="experiments"/);
  assert.match(client,/experimentMode: readRinExperimentMode\(\)/);
  assert.match(api,/experimentMode === 'freedom'/);
  assert.match(api,/!body\.trigger && \['original', 'dialogue', 'freedom'\]/);
});
