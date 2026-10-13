import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRinMindPrompt, serializeCompactState, serializeCompactStateWithMetrics} from '../lib/cognition/rin-mind.js';

const verbose = (prefix, count = 170) => `${prefix}: ` + 'подтверждённая деталь текущего диалога, '.repeat(count);

function overloadedState(){
  return {
    userText:'Помнишь наш вечер? Обещание остаётся в силе.',
    recentHistory:[{id:'earlier',role:'assistant',kind:'text',ts:1791920000000,content:'Мы хотели оставить пространство для тишины.'}],
    relevantMemory:{
      facts:Array.from({length:4},(_,i)=>({path:`user.preference.${i}`,text:verbose('Факт '+i)})),
      events:Array.from({length:3},(_,i)=>({text:verbose('Событие '+i),importance:8})),
      sharedMoments:[{text:verbose('Общий вечер')},{text:verbose('Старый момент')}],
      summaries:[{text:verbose('Сводка')}],directRecall:true,reason:'explicit_recall'
    },
    relationalIntegrity:{contactBoundary:{active:true},boundaries:[
      {status:'active',term:'не называй меня так',reason:'Это ясное требование пользователя'},
      ...Array.from({length:5},(_,i)=>({status:'active',term:`граница_${i}`,reason:verbose('Причина границы '+i)}))
    ],rupture:{phase:'active',affected:'user',cause:'Поправка пользователя'},incidents:Array.from({length:4},(_,i)=>({key:`fault${i}`,count:i+1}))},
    privateCloseness:{mode:'quiet',focus:'presence',move:'stay',thread:verbose('Нить сцены').slice(0,420),
      landmarks:[{kind:'scene',text:'Крепость пользователя',atTurn:1},
        ...Array.from({length:3},(_,i)=>({kind:'scene',text:verbose('Кадр '+i).slice(0,180),atTurn:i+2})),
        {kind:'correction',text:'Поправка: крепость принадлежит пользователю',atTurn:8},
        {kind:'boundary',text:'Пользователь попросил остановиться',atTurn:9}],
      recentMoves:Array(4).fill({move:'stay',mode:'quiet',focus:'presence'}),turnsInMode:8,everydayGap:0},
    dialogueState:{relationToPreviousTurn:'continuation',corrections:['Не возвращайся к поцелуям вопреки просьбе'],
      sceneCommitments:Array.from({length:6},(_,i)=>({id:`commit-${i}`,subject:verbose('Обещание '+i).slice(0,260),owner:'rin',status:'active',rationale:verbose('Обоснование '+i).slice(0,220)})),
      sceneActions:Array.from({length:5},(_,i)=>({action:'stay',actor:'rin',destination:'user',status:'stated',evidence:verbose('Действие '+i).slice(0,200)})),
      discourseAnchors:Array.from({length:6},(_,i)=>({referent:`anchor-${i}`,label:verbose('Опора').slice(0,160),evidence:verbose('Фраза').slice(0,180)})),
      lastRinAction:{kind:'presence',meaning:verbose('Описание').slice(0,360)}},
    activeIntent:{status:'active',kind:'maintenance',phase:'ongoing',goal:'оставаться рядом без давления',target:'quiet_presence',nextMove:'сохранить границу',progress:null,engagement:65,turnCount:18,maxTurns:30},
    innerLife:{activity:'отдыхает',activityGoal:'выспаться',focus:'сон',energy:22,mentalLoad:70,needForQuiet:90,
      sleepPhase:'interrupted_sleep',wakeReason:'kirill_message',sleepDebtMinutes:130,sleepInterruptions:1,
      sleepCarryover:'поздний разговор',unfinishedThought:'сон',dayType:'workday',workMode:'off'},
    openLoops:Array.from({length:5},(_,i)=>({type:'promise',subject:verbose('Петля '+i).slice(0,240),status:'active'})),
    scene:{type:'quiet',topic:'общий вечер',turnsInScene:7},
    environment:{rinTz:'Europe/Moscow',rinHuman:'2026-10-14 02:13',partOfDay:'ночь'},
    behaviorState:{novelty:{recentActs:Array(10).fill('stay'),recentMotifs:Array(9).fill('care'),pressure:90},
      lifeNovelty:{recentBeats:Array.from({length:10},(_,i)=>({motif:`m${i}`,domain:'work'})),overusedMotifs:[{motif:'tea',count:8}],pressure:80},
      vocative:{recentVocativeTurns:Array(20).fill(12),pressure:80,lastExact:'мой хороший',guidance:verbose('Голос').slice(0,520)},
      question:{restraint:30},space:{pressure:50},responseRhythm:{recentShapes:Array(20).fill('single'),singleLockPressure:75}},
    reciprocity:{userAttentionTurns:10,rinAttentionTurns:3,attentionAnchors:Array.from({length:3},(_,i)=>({text:verbose('Опора внимания '+i).slice(0,260)}))},
    stickerState:{available:true,mode:'smart',recentAssetIds:Array(3).fill('a')},
    stickerCandidates:Array.from({length:8},(_,i)=>({id:`s${i}`,meaning:verbose('Жест '+i).slice(0,150)})),
    lore:{canon:[{text:verbose('Канон').slice(0,1000)}],memories:[{text:verbose('Память').slice(0,1000)}]},
    realityBoundary:{mode:'grounded',canonicalText:verbose('Граница').slice(0,950),innerLifeText:verbose('Жизнь').slice(0,450)}
  };
}

test('overloaded state retains retrieved memory, explicit boundaries, sleep and scene anchors inside budget',()=>{
  const state=overloadedState();
  const original=JSON.stringify(state);
  const result=serializeCompactStateWithMetrics(state,9800);
  const parsed=JSON.parse(result.text);
  assert.ok(result.totalChars <= 9800);
  assert.ok(result.sourceChars > 9800);
  assert.ok(parsed.relevantMemory?.facts?.length >= 1);
  assert.ok(parsed.relevantMemory?.events?.length >= 1);
  assert.match(parsed.relevantMemory.facts[0].text,/Факт 0/);
  assert.equal(parsed.relevantMemory.directRecall,true);
  assert.equal(parsed.relationalIntegrity.contactBoundary,true);
  assert.ok(parsed.relationalIntegrity.boundaries.some(x=>x.term==='не называй меня так'));
  assert.equal(parsed.innerLife.sleepPhase,'interrupted_sleep');
  assert.equal(parsed.innerLife.wakeReason,'kirill_message');
  assert.equal(parsed.activeIntent.goal,'оставаться рядом без давления');
  assert.equal(parsed.privateCloseness.mode,'quiet');
  assert.ok(parsed.privateCloseness.landmarks.some(x=>x.kind==='correction'));
  assert.ok(parsed.privateCloseness.landmarks.some(x=>x.kind==='boundary'));
  assert.match(JSON.stringify(parsed.continuity),/Не возвращайся к поцелуям/);
  assert.ok(result.trimmedFields.length > 0 || result.omittedFields.length > 0);
  assert.equal(JSON.stringify(state),original,'serializer must not mutate persisted state');
});

test('compact state metadata reports exact sizes and omissions without quoting personal text',()=>{
  const {text,...metrics}=serializeCompactStateWithMetrics(overloadedState(),9800);
  assert.equal(metrics.totalChars,text.length);
  assert.equal(metrics.budgetChars,9800);
  assert.ok(metrics.includedFields.includes('relevantMemory'));
  assert.equal(serializeCompactState({userText:'Ок',recentHistory:[]}),serializeCompactStateWithMetrics({userText:'Ок',recentHistory:[]}).text);
  assert.doesNotMatch(JSON.stringify(metrics),/подтверждённая деталь текущего диалога|Не возвращайся к поцелуям/u);
  for(const field of [...metrics.trimmedFields,...metrics.omittedFields]) assert.match(field,/^[a-zA-Z]+$/u);
});

test('small prompts remain lossless and budget is respected even when artificially tiny',()=>{
  const state={userText:'Привет',innerLife:{sleepPhase:'awake'},relevantMemory:{facts:[{path:'work',text:'Чай'}]}};
  const r=serializeCompactStateWithMetrics(state,9800);
  assert.deepEqual(r.trimmedFields,[]);
  assert.deepEqual(r.omittedFields,[]);
  const tiny=serializeCompactStateWithMetrics(state,60);
  assert.ok(tiny.totalChars <= 60);
  assert.doesNotThrow(()=>JSON.parse(tiny.text));
});

test('dynamic prompt removes duplicate private scene and sleep data, but preserves safeguards and cacheable identity',()=>{
  const state=overloadedState();
  const a=buildRinMindPrompt({state});
  const b=buildRinMindPrompt({state:{...state,userText:'Другая реплика'}});
  assert.equal(a.stableSystem,b.stableSystem);
  assert.match(a.dynamicSystem,/PRIVATE CLOSENESS CONTINUITY/);
  assert.match(a.dynamicSystem,/DAILY RHYTHM/);
  assert.match(a.dynamicSystem,/Крепость пользователя/);
  assert.match(a.dynamicSystem,/interrupted_sleep/);
  assert.doesNotMatch(a.dynamicSystem,/PRIVATE CLOSENESS CONTINUITY: previous=/);
  assert.doesNotMatch(a.dynamicSystem,/DAILY RHYTHM: dayType=.*; sleepPhase=/);
  assert.equal(a.contextMetrics.dynamicChars,a.dynamicSystem.length);
  assert.equal(a.contextMetrics.stableChars,a.stableSystem.length);
  assert.ok(a.contextMetrics.compactStateChars <= 9800);
  assert.ok(a.contextMetrics.shortTermChars > 0);
});

test('API exposes context accounting without copying user messages into telemetry', async()=>{
  const {readFile} = await import('node:fs/promises');
  const code=await readFile(new URL('../api/chat.js',import.meta.url),'utf8');
  for(const field of ['contextStableChars','contextDynamicChars','contextStateChars','contextStateSourceChars','contextStateBudgetChars','contextTrimmedFields','contextOmittedFields']) {
    assert.match(code,new RegExp(`${field}:\\s*`,'u'));
  }
  assert.match(code,/contextOmittedFields: prompt\?\.contextMetrics\?\.compactOmittedFields \|\| \[\]/u);
});
