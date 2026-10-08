import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { environmentIntent } from '../public/js/environment_intent.js';
import { groundCurrentWeather } from '../lib/cognition/v3/weather-grounding.js';
import { classifyWeather } from '../public/js/daily_rhythm.js';
import { inspectGroundedLife } from '../lib/cognition/v3/life-continuity.js';
import { observeTurn } from '../lib/cognition/v3/turn-observations.js';
import { buildCognitiveTurnPlan } from '../lib/cognition/v3/turn-plan.js';
import { buildV3RealizationPrompt } from '../lib/cognition/v3/realization.js';

function make(text, {activity='читает книгу дома', setting='indoor', weather=null, fresh=false, history=[]}={}) {
  const kernel={userText:text,perception:{signals:['direct_question_present']},
    scene:{type:'everyday'},innerLife:{activity,activitySetting:setting,sleepPhase:'awake',energy:63,needForQuiet:25},
    environment:{rinHuman:'2026-10-09 12:10',rinTz:'Asia/Tokyo',weather,weatherFresh:fresh},
    recentHistory:history,dialogueState:{recentMotifs:[],recentMessageShapes:[]},relationship:{trust:76,closeness:75},
    reciprocity:{attentionOpportunity:false}};
  const observations=observeTurn({userText:text,history});
  const settled={behavioralState:{approach:.67,support:.5,play:.51,disclose:.38,initiative:.29,ask:.2,silence:.36,
    tenderGesture:.55,setBoundary:.15},evidence:{userQuestion:true},nodes:{curiosity:.44}};
  const plan=buildCognitiveTurnPlan({kernelState:kernel,settled,observations,stickerState:{available:false}});
  const prompt=buildV3RealizationPrompt({kernelState:kernel,plan});
  return {kernel,observations,plan,prompt};
}

test('outdoor questions addressed to Rin require weather refresh even without the word weather',()=>{
  for(const line of ['Ты сейчас гуляешь?', 'Ты уже вышла на улицу?', 'Можешь выйти прогуляться?',
    'Как у тебя на улице?', 'А ты сейчас дома или на улице?', 'Твоя прогулка сегодня состоится?']) {
    assert.equal(environmentIntent(line),'weather',line);
  }
});

test('ordinary personal/weather-unrelated greetings do not force a network fetch',()=>{
  for(const line of ['Доброе утро)', 'Я сейчас гуляю', 'Нужно выйти из функции', 'Как у тебя работа?',
    'Во сколько будешь дома?']) {
    assert.notEqual(environmentIntent(line),'weather',line);
  }
});

test('weather is current, direct and independently grounds an outdoor plan',()=>{
  const {plan,prompt}=make('Ты сегодня пойдёшь гулять?',{weather:{desc:'ливень и гроза',temp:15},fresh:true});
  assert.equal(plan.life.outdoor.asked,true);
  assert.equal(plan.life.outdoor.weatherStatus,'fresh');
  assert.equal(plan.life.outdoor.weatherKind,'severe');
  assert.equal(plan.life.outdoor.outdoorSuitability,'avoid');
  assert.equal(plan.decision.act,'answer_user_question');
  assert.match(plan.decision.focus,/weather=fresh/);
  assert.match(prompt.dynamicSystem,/OUTDOOR_REALITY=/);
  assert.match(prompt.dynamicSystem,/серьёзная непогода/);
  assert.equal(plan.life.outdoor.currentlyOutside,false);
});

test('rain/cold/hot conditions are qualified without falsely cancelling a proven outing',()=>{
  for(const weather of [{desc:'морось',temp:9},{desc:'ясно',temp:-2},{desc:'солнечно',temp:35}]){
    const {plan}=make('Как у тебя на улице?',{weather,fresh:true,setting:'outdoor',activity:'гуляет по городу'});
    assert.equal(plan.life.outdoor.currentlyOutside,true);
    assert.equal(plan.life.outdoor.outdoorSuitability,'adapt');
    assert.match(plan.life.outdoor.guidance,/адаптации/);
    assert.equal(plan.life.activity,'гуляет по городу');
  }
});

test('missing or stale weather never becomes invented weather in Rin speech prompt',()=>{
  for (const [weather,fresh] of [[null,false],[{desc:'солнечно',temp:17},false],[{desc:null,temp:null},true]]) {
    const {plan,prompt}=make('Ты гуляешь?',{weather,fresh});
    assert.equal(plan.life.outdoor.weatherStatus,'unavailable');
    assert.equal(plan.life.outdoor.temperatureC,null);
    assert.match(prompt.dynamicSystem,/Свежих подтверждённых данных о погоде/);
  }
});

test('present weather cannot prove yesterday walk or what it was like yesterday',()=>{
  const {plan,prompt}=make('Ты вчера уже погуляла?',{weather:{desc:'ясно',temp:17},fresh:true});
  assert.equal(plan.life.outdoor.retrospective,true);
  assert.equal(plan.life.guard,'past_walk_unconfirmed');
  assert.match(prompt.dynamicSystem,/Текущая погода относится только к текущему моменту/);
  assert.match(prompt.dynamicSystem,/Не говори «да, гуляла»/);
});

test('currently outdoors can answer she already stepped out, without invented finished walk',()=>{
  const {plan}=make('Ты уже вышла на улицу?',{setting:'outdoor',activity:'идёт по улице',weather:{desc:'слабый дождь',temp:12},fresh:true});
  assert.equal(plan.life.guard,'none');
  assert.equal(plan.life.outdoor.currentlyOutside,true);
  assert.equal(plan.life.outdoor.weatherKind,'precipitation');
  assert.equal(plan.life.outdoor.retrospective,true);
});

test('outdoor facts are contextual and do not inject weather into irrelevant tender turn',()=>{
  const {plan,prompt}=make('Я тебя обнимаю 🤗',{setting:'indoor',weather:{desc:'ливень',temp:13},fresh:true});
  assert.equal(plan.life.outdoor.asked,false);
  assert.doesNotMatch(prompt.dynamicSystem,/OUTDOOR_REALITY=/);
});

test('client fail-closes expired weather; server requires timestamp; debug remains unchanged',()=>{
  const chat=readFileSync(new URL('../public/chat.js',import.meta.url),'utf8');
  const api=readFileSync(new URL('../api/chat.js',import.meta.url),'utf8');
  assert.match(chat,/env\.weather = null/);
  assert.match(chat,/env\._weatherTs = 0/);
  assert.match(api,/groundCurrentWeather\(kernelState\.environment, env\)/);
  assert.match(chat,/dbg\(`turn state committed:/);
});

test('API evidence accepts fresh measurements and distinguishes missing temperature from real zero Celsius',()=>{
  const now=Date.parse('2026-10-09T10:00:00Z');
  const raw={_weatherTs:now-5*60_000,weather:{desc:'сухо',temp:null,feels:null,wind:12}};
  const normalized=groundCurrentWeather({weather:{desc:'сухо',temp:0,feels:0}},raw,now);
  assert.equal(normalized.weatherFresh,true);
  assert.equal(normalized.weather.temp,null);
  assert.equal(normalized.weather.feels,null);
  assert.equal(normalized.weather.wind,12);
  assert.equal(normalized.weatherObservedAt,now-5*60_000);
  const zero=groundCurrentWeather({weather:{desc:'ясно',temp:0}},{_weatherTs:now,weather:{desc:'ясно',temp:0}},now);
  assert.equal(zero.weather.temp,0);
});

test('old, missing, future and empty weather observations are rejected',()=>{
  const now=Date.parse('2026-10-09T10:00:00Z');
  const snapshot={weather:{desc:'солнечно',temp:20}};
  for(const sample of [
    {_weatherTs:now-26*60_000,weather:{temp:20}},
    {_weatherTs:null,weather:{temp:20}},
    {_weatherTs:now+3*60_000,weather:{temp:20}},
    {_weatherTs:now,weather:{temp:null,desc:''}}
  ]) {
    const checked=groundCurrentWeather(snapshot,sample,now);
    assert.equal(checked.weatherFresh,false);
    assert.equal(checked.weather,null);
  }
});

test('strong wind in the official API changes outdoor suitability even when the sky is clear',()=>{
  const severe=classifyWeather({desc:'ясно',temp:18,wind:19});
  assert.equal(severe.outdoor,'avoid');
  assert.match(severe.reason,/м\/с/);
  const breezy=classifyWeather({desc:'ясно',temp:18,wind:12});
  assert.equal(breezy.outdoor,'adapt');
  const {plan}=make('Ты выйдешь на улицу?',{weather:{desc:'ясно',temp:18,wind:19},fresh:true});
  assert.equal(plan.life.outdoor.outdoorSuitability,'avoid');
  assert.equal(plan.life.outdoor.windMs,19);
});
