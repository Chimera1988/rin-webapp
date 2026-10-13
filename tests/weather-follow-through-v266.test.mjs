import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {weatherRefreshIntent,verifiedWeatherEvidence} from '../public/js/weather_evidence.js';
import {selfFollowThrough} from '../public/js/self_follow_through.js';
const utc=(hour,minute=0)=>Date.UTC(2026,9,13,hour,minute,0);
const m=(id,content,ts,role='assistant')=>({id,content,ts,role,kind:'text',status:'complete'});
const src=x=>readFileSync(new URL(`../${x}`, import.meta.url),'utf8');

test('explicit short weather questions refresh observations',()=>{
  assert.equal(weatherRefreshIntent('А дождь идёт?'),true);
  assert.equal(weatherRefreshIntent('Как у вас погода?'),true);
  assert.equal(weatherRefreshIntent('Сейчас посмотри в окно'),true);
  assert.equal(weatherRefreshIntent('О чём твой перевод?'),false);
});
test('weather follow-up refreshes only in the right context',()=>{
  assert.equal(weatherRefreshIntent('Получается?', [m('a','Сейчас гляну в окно',utc(14))]),true);
  assert.equal(weatherRefreshIntent('Получается?', [m('a','Дорабатываю комментарии',utc(14))]),false);
});
test('stale, unsigned and failed reports have no verified provenance',()=>{
  const now=utc(14,30);
  assert.deepEqual(verifiedWeatherEvidence({weather:null},now),{available:false});
  assert.deepEqual(verifiedWeatherEvidence({weather:{desc:'дождь',temp:9}},now),{available:false});
  assert.deepEqual(verifiedWeatherEvidence({weather:{desc:'дождь',temp:9,source:'openweather',checkedAt:now-30*60000}},now),{available:false});
  assert.deepEqual(verifiedWeatherEvidence({weather:{desc:'дождь',temp:9,source:'openweather',checkedAt:now-2*60000}},now),{available:true,source:'openweather',ageMinutes:2,description:'дождь',temperature:9});
});
test('an explicit evening promise is due in Rin local evening, not before',()=>{
  const text='Можешь ожидать, что я ещё вспомню об этом вечером. А вот что именно приготовлю — не выдам заранее, иначе это уже не сюрприз.';
  const h=[m('promise',text,utc(13,57))];
  assert.deepEqual(selfFollowThrough(h,utc(14,30)),[]);
  const due=selfFollowThrough(h,utc(15,20));
  assert.equal(due.length,1);
  assert.equal(due[0].key,'evening_surprise');
  assert.equal(due[0].sourceId,'promise');
  assert.equal(selfFollowThrough(h,utc(22,0)).length,0);
});
test('user suggestions do not turn into Rin promises',()=>{
  const text='Устрой мне вечером сюрприз!';
  assert.equal(selfFollowThrough([m('u',text,utc(14), 'user')],utc(15,20)).length,0);
});
test('Rin owns her work reminder and can resolve it without a permanent nag',()=>{
  const h=[m('remind','Договорились: я сама подам сигнал, когда пора обратно к комментариям.',utc(13))];
  assert.equal(selfFollowThrough(h,utc(13,2)).length,0);
  assert.equal(selfFollowThrough(h,utc(13,6))[0]?.key,'return_to_work');
  h.push(m('resolved','Пожалуй, пора — ты вовремя меня поймал. Ещё минуту побуду без комментариев, а потом вернусь к тексту, как и обещала.',utc(13,8)));
  assert.equal(selfFollowThrough(h,utc(13,11)).length,0);
});
test('cancellation expires and no prompt survives a local date change',()=>{
  const h=[m('p','Хорошо, закончу комментарии и потом вернусь к тебе.',utc(13))];
  assert.equal(selfFollowThrough(h,utc(13,25))[0]?.key,'finish_work');
  assert.equal(selfFollowThrough(h,utc(20,0)).length,0);
  h.push(m('cancel','Не получится, отложу этот разговор.',utc(13,29)));
  assert.equal(selfFollowThrough(h,utc(13,40)).length,0);
});
test('web app passes refreshed evidence and follow-through into both turn types',()=>{
  const chat=src('public/chat.js');
  const prompt=src('lib/cognition/rin-mind.js');
  assert.match(chat,/weatherRefreshIntent\(combinedUserText, history\)/);
  assert.match(chat,/strictWeather: asksWeather/);
  assert.equal((chat.match(/weatherEvidence: verifiedWeatherEvidence\(currentEnv\)/g)||[]).length,2);
  assert.equal((chat.match(/followThrough: selfFollowThrough\(history/g)||[]).length,2);
  assert.match(prompt,/client\?\.weatherEvidence\?\.available/);
  assert.match(prompt,/client\?\.followThrough/);
  assert.match(prompt,/НЕ её личное наблюдение из окна/);
  assert.doesNotMatch(src('public/js/release.js'),/v2\.6\.5/);
});
