import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {localDayKey,chatDayLabel,historyDayGroups} from '../public/js/chat_day_groups.js';
import {mergeArchiveHistory} from '../public/js/cloud_archive.js';
import {normalizeStoredHistory, normalizeStoredMessage} from '../public/js/chat_store.js';
import {cloudMessageWithMedia, sanitizeArchiveMessage} from '../lib/archive/core.js';

const message=(id,ts,kind='text')=>({id,ts,kind,role:'assistant',status:'complete',content:'Текст Рин',...(kind==='sticker'?{sticker:{src:'/stickers/kiss_soft_tender.webp'}}:{})});
const day=(year,month,date,hour=12)=>new Date(year,month-1,date,hour).getTime();

test('chat day labels use the device calendar: today, yesterday, day before and DD.MM.YYYY',()=>{
  const now=day(2026,10,13);
  assert.equal(chatDayLabel(day(2026,10,13),now),'Сегодня');
  assert.equal(chatDayLabel(day(2026,10,12),now),'Вчера');
  assert.equal(chatDayLabel(day(2026,10,11),now),'Позавчера');
  assert.equal(chatDayLabel(day(2026,10,10),now),'10.10.2026');
  assert.equal(chatDayLabel(day(2025,12,31),day(2026,1,3)),'31.12.2025');
  assert.equal(chatDayLabel(day(2025,12,31),day(2026,1,1)),'Вчера');
  assert.equal(chatDayLabel(day(2026,1,1),day(2026,1,3)),'Позавчера');
  assert.equal(localDayKey('not-a-timestamp'),null);
});

test('calendar-day comparisons are stable over DST days (never 24-hour division)',()=>{
  const now=day(2026,3,30,0);
  assert.equal(chatDayLabel(day(2026,3,29,1),now),'Вчера');
  assert.equal(chatDayLabel(day(2026,3,28,23),now),'Позавчера');
});

test('date dividers group text, stickers and voice together without synthetic messages',()=>{
  const now=day(2026,10,13);
  const rows=[message('t1',day(2026,10,11,19)),message('s1',day(2026,10,11,20),'sticker'),
    message('t2',day(2026,10,12,9)),message('v1',day(2026,10,12,12),'voice'),
    message('quiet',day(2026,10,12,13),'silence'),message('t3',day(2026,10,13,2))];
  const groups=historyDayGroups(rows,now);
  assert.deepEqual(groups.map(g=>g.label),['Позавчера','Вчера','Сегодня']);
  assert.deepEqual(groups.map(g=>g.messages.map(m=>m.id)),[['t1','s1'],['t2','v1'],['t3']]);
  assert.equal(rows.length,6);
});

test('cloud merge does not apply the 140/40 local trim and keeps chronological interleaving',()=>{
  const text=Array.from({length:212},(_,i)=>message(`t-${i}`,day(2026,10,11)+i*3000));
  const stickers=Array.from({length:42},(_,i)=>message(`s-${i}`,day(2026,10,11)+i*10000+1500,'sticker'));
  const remote=[...text,...stickers].reverse();
  const result=mergeArchiveHistory([],remote);
  assert.equal(result.length,254);
  assert.equal(result[0].id,'t-0');
  assert.equal(result[1].id,'s-0');
  assert.ok(result.some(m=>m.id==='t-1'));
  assert.ok(normalizeStoredHistory(result).length<result.length,'local browser cache remains bounded');
  assert.equal(historyDayGroups(result,day(2026,10,13)).length,1);
});

test('archive keeps a local sticker and inserts remotely saved text on both sides by timestamp',()=>{
  const date=day(2026,10,11);
  const result=mergeArchiveHistory([message('old-sticker',date+2000,'sticker')],
    [message('earlier-text',date+1000),message('later-text',date+3000)]);
  assert.deepEqual(result.map(m=>m.id),['earlier-text','old-sticker','later-text']);
});

test('UI supports archive scanning, dates, and original persistent storage unchanged',()=>{
  const chat=readFileSync(new URL('../public/chat.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../public/archive.css',import.meta.url),'utf8');
  assert.match(chat,/discoverUnseenArchivedPage\(/);
  assert.match(chat,/placeArchivedRow\(/);
  assert.match(chat,/chatDayLabel\(/);
  assert.match(chat,/\.rin-day-divider/);
  assert.match(css,/\.rin-day-divider/);
  assert.doesNotMatch(readFileSync(new URL('../public/js/chat_day_groups.js',import.meta.url),'utf8'),/localStorage|DATABASE_URL/);
});


test('generated MP3 remains attached to a text message after restart and secure archive roundtrip',()=>{
  const original=message('generated-voice',day(2026,10,12), 'text');
  original.media={archived:true,type:'audio',url:'https://not-trusted.example/audio.mp3'};
  const local=normalizeStoredMessage(original);
  assert.deepEqual(local.media,{archived:true,type:'audio'});
  const safe=sanitizeArchiveMessage(original);
  assert.ok(safe);
  assert.equal(Object.hasOwn(safe,'media'),false, 'never trust client blob URLs');
  const fromCloud=cloudMessageWithMedia({payload:safe,has_audio:true});
  assert.equal(fromCloud.kind,'text');
  assert.deepEqual(fromCloud.media,{archived:true,type:'audio'});
  const reconciled=mergeArchiveHistory([local],[fromCloud]);
  assert.equal(reconciled[0].media.archived,true);
  const persisted=normalizeStoredHistory(reconciled);
  assert.equal(persisted[0].media.archived,true);
  const browser=readFileSync(new URL('../public/chat.js',import.meta.url),'utf8');
  assert.match(browser,/\['voice','text'\]\.includes\(message\.kind\) && message\.media\?\.archived/);
});
