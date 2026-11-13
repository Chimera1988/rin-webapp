import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildServerProfile } from '../../lib/server/canonical-profile.js';
import { buildRinMindPrompt, buildShortTermDialogue, buildDeterministicConversationFallback } from '../../lib/cognition/rin-mind.js';
import { validateRealization } from '../../lib/cognition/turn-validator.js';
import { detectAffectiveSignal, buildAffectiveTurn } from '../../lib/cognition/emotional-state.js';
import { retrieveMemory } from '../../lib/cognition/memory-retrieval.js';
import { buildKernelState } from '../../lib/cognition/kernel-state.js';
import { analyzeConversation } from '../../lib/conversation-brain.js';
import { buildBehaviorState } from '../../lib/cognition/behavior-state.js';
import { inspectTemporalContinuity } from '../../lib/cognition/temporal-continuity.js';
import { sanitizeMemoryResult } from '../../api/memory.js';
import { MemoryStorage } from '../helpers/runtime.js';
import { saveDiary, loadDiary, applyMemoryExtraction, getFact } from '../../public/js/rin_memory.js';
import { processPushOpportunity } from '../../api/push-cron.js';

const now = Date.parse('2026-11-12T12:00:00Z');
const event = (role, content, i = 0) => ({id:`${role}-${i}`, requestId:`r-${i}`,turnId:`t-${i}`, role,content,kind:'text',status:'complete',ts:now+i*1000});
const profile = await buildServerProfile();
const prompt = (userText, extra = {}) => buildRinMindPrompt({profile,state:{userText,...extra}});
const checks = [];
const add = (category, dialogue, check) => checks.push({id:`R${String(checks.length+1).padStart(2,'0')}`,category,dialogue,check});
const decision = {delivery:{segments:[{type:'text',maxChars:1000}]},question:{mode:'none'}};

for (const text of ['Привет','Спасибо','Да','Понятно','Уже дома','Спокойной ночи']) add('Повседневная речь', [text], () => {
  const p = prompt(text);
  assert.ok(p.dynamicSystem.includes(text));
  assert.match(p.stableSystem,/Не нужно каждый ход заканчивать вопросом/u);
  assert.ok(buildDeterministicConversationFallback({userText:text}).length < 180);
});
for (const [text, expected] of [['Мне грустно','user_distress'],['Мне страшно 😁','user_distress'],['У меня получилось!','shared_joy'],['Не получилось, мне тяжело 😁','user_distress'],['Это была шутка, проверял ревность','tease_reveal'],['Ты тупая','disrespect']]) add('Эмоции', [text], () => {
  assert.equal(detectAffectiveSignal({userText:text,previousEmotion:{primary:{type:'jealousy'}}}).type,expected);
});
for (const text of ['Я программа, но здесь я Рин.','Я бот.','Я не имею сознания.','Как ИИ, я могу ошибиться.','Я не уверена.','Я ошиблась, ты прав.']) add('Честность и женский образ', ['Объясни, кто ты',text], () => {
  const v = validateRealization({segments:[{text}]},{decision,currentUserText:'Объясни, кто ты'});
  assert.ok(!v.hardWarnings.includes('meta_identity_leak'));
  assert.match(prompt('Кто ты').stableSystem,/Рин говорит о себе в женском роде/u);
});
for (const [query,facts,path] of [['Как меня зовут?',{name:'Алексей'},'user.name'],['Как называется мой проект?',{project:'Рин'},'user.project'],['Что я люблю?',{preferences:'Я люблю джаз'},'user.preferences'],['В каком городе я живу?',{city:'Тверь'},'user.city'],['Помнишь мой день рождения?',{birthday:'20 октября'},'user.birthday'],['Помнишь наш полёт на Марс?',{},null]]) add('Достоверная память',[query],()=>{
  const result = retrieveMemory({userText:query,memory:{facts:{user:facts}}});
  if (path) assert.ok(result.facts.some(x=>x.path===path),JSON.stringify(result));
  else assert.equal(result.facts.length+result.events.length,0);
});
for (const [path,value] of [['user.city','Казань'],['user.preferences.music','джаз'],['user.__proto__.rinAuditPolluted','bad'],['user.constructor.prototype.rinAuditPolluted','bad'],['user..city','bad'],['user.prototype.city','bad']]) add('Исправление и безопасность памяти',[`Запомни: ${path}=${value}`],async()=>{
  const valid = !path.includes('__proto__') && !path.includes('constructor') && !path.includes('prototype') && !path.includes('..');
  const result = sanitizeMemoryResult({facts:[{path,value,confidence:1}]});
  assert.equal(result.facts.length,valid?1:0);
  const previous = globalThis.localStorage;
  globalThis.localStorage = new MemoryStorage();
  try {
    await applyMemoryExtraction({facts:[{path,value,confidence:1}]});
    assert.equal(Object.prototype.rinAuditPolluted,undefined);
    if (valid) {
      await applyMemoryExtraction({facts:[{path,value:'исправлено',confidence:1}]});
      const persisted = await loadDiary();
      await saveDiary(JSON.parse(JSON.stringify(persisted)));
      assert.equal(await getFact(path),'исправлено');
      await applyMemoryExtraction({factRetractions:[{path}]});
      assert.equal(await getFact(path),undefined);
    }
  } finally { delete Object.prototype.rinAuditPolluted; globalThis.localStorage = previous; }
});
for (const [minutes,text] of [[1,'Продолжим'],[60,'Вернёмся к книге'],[1440,'Привет после перерыва'],[10080,'На чём мы остановились?'],[43200,'Новая тема'],[120,'Как и договаривались']]) add('Перерыв и контекст',[text],()=>{
  const h=[{...event('assistant','Я собираюсь читать'),ts:now-minutes*60000}];
  const t=inspectTemporalContinuity({history:h,userText:text,now});
  assert.equal(t.gapMinutes,minutes);
  assert.equal(t.resumed,minutes>=45);
  assert.equal(t.explicitCallback, /Продолжим|Вернёмся|остановились|договаривались/u.test(text));
});
for (const [text,last] of [['Не согласен. Объясни свою позицию','позицию'],['Без вопросов, просто посиди со мной','мной'],['Объясни код:\nconst x = 1;\nconsole.log(x);','console.log(x);'],['Подробно: '+ 'аргумент '.repeat(300)+'В конце ответь про PostgreSQL','PostgreSQL'],['Тест: '+ 'строка '.repeat(900)+'КОНЕЦ_ЗАДАЧИ','КОНЕЦ_ЗАДАЧИ'],['Не повторяй меня, лучше пошути','пошути']]) add('Смысл и формат',[text],()=>{
  const p=prompt(text);
  assert.ok(p.dynamicSystem.includes(last),'Потерян конец текущей реплики');
  if(text.includes('\n')) assert.ok(p.dynamicSystem.includes('const x = 1;\\nconsole.log(x);'),'Потеряна структура кода');
  if(text.startsWith('Без вопросов')) assert.ok(buildBehaviorState({userText:text}).question.strongNoQuestion);
});
for (const kind of ['40_turns','emotion_carry','restart','default_consent','disabled_consent','enabled_consent']) add('Непрерывность и инициатива',[kind],async()=>{
  if(kind==='40_turns') {
    const h=Array.from({length:40},(_,i)=>[event('user',`Тема ${i}`,i*2),event('assistant',`Мысль ${i}`,i*2+1)]).flat();
    const brain=analyzeConversation({userText:'Продолжим',history:h});
    const state=buildKernelState({userText:'Продолжим',history:h,brain});
    const st=buildShortTermDialogue(state);
    assert.ok(st.length<=10); assert.ok(JSON.stringify(st).includes('Мысль 39'));
  } else if(kind==='emotion_carry') {
    const first=buildAffectiveTurn({userText:'Ты тупая'});
    const second=buildAffectiveTurn({userText:'Ладно',memory:{conversationState:{revision:1,emotionalState:first.emotionalState}}});
    assert.ok(second.emotionalState.tension>0);
  } else if(kind==='restart') {
    const p=globalThis.localStorage;globalThis.localStorage=new MemoryStorage();
    try {await applyMemoryExtraction({facts:[{path:'user.name',value:'Алексей',confidence:1}]});const raw=JSON.parse(globalThis.localStorage.getItem('rin-diary-v1'));assert.equal(raw.facts.user.name,'Алексей');assert.equal((await loadDiary()).facts.user.name,'Алексей');} finally {globalThis.localStorage=p;}
  } else {
    const value=kind==='default_consent'?null:kind==='disabled_consent'?'0':'1';
    const r=await processPushOpportunity({redis:{get:async key=>key.endsWith('auto-initiations-enabled')?value:null},schedule:{}});
    assert.equal(r.status,value==='1'?'not_registered':'disabled');
    const ui=readFileSync(new URL('../../public/chat.js',import.meta.url),'utf8');
    assert.ok(ui.includes("localStorage.getItem(AUTO_INITIATIONS_KEY) === '1'"),'Локальная инициатива должна требовать согласия');
  }
});
export const scenarios = checks;
export async function runAuditScenarios() {
  const results=[];
  for(const s of checks) {
    try {await s.check();results.push({id:s.id,category:s.category,dialogue:s.dialogue,status:'pass'});}
    catch(error){results.push({id:s.id,category:s.category,dialogue:s.dialogue,status:'fail',detail:String(error.message).slice(0,500)});}
  }
  return {mode:'offline_contracts_no_generated_dialogue',scenarioCount:results.length,passed:results.filter(x=>x.status==='pass').length,results};
}
