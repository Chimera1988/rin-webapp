import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeChatMessage } from '../public/lib/chat-contract.js';
import { normalizeStoredHistory } from '../public/js/chat_store.js';
import { archiveMessages, archiveCursor, sanitizeArchiveMessage, cloudMessageWithMedia, ARCHIVE_BATCH_LIMIT } from '../lib/archive/core.js';
import { createCloudArchive, mergeArchiveHistory } from '../public/js/cloud_archive.js';

const msg=(id,ts=1791836421891,opts={})=>({id,ts,role:'assistant',kind:'text',status:'complete',content:'Привет, это реальная запись',...opts});

test('archive only accepts final or transmitted valid messages and rejects malformed batches',()=>{
  assert.deepEqual(sanitizeArchiveMessage(msg('m-1')).content,'Привет, это реальная запись');
  assert.equal(sanitizeArchiveMessage(msg('a',Date.now(),{status:'pending'})),null);
  assert.equal(sanitizeArchiveMessage(msg('a',Date.now(),{status:'failed'})),null);
  assert.equal(sanitizeArchiveMessage(msg('x;DROP')),null);
  assert.equal(sanitizeArchiveMessage(msg('a',Date.now(),{ts:50})),null);
  assert.equal(sanitizeArchiveMessage(msg('a',Date.now(),{role:'bad'})),null);
  assert.equal(sanitizeArchiveMessage(msg('a',Date.now(),{content:'[Невербальный жест Рин: скрытый]'})),null);
  assert.equal(archiveMessages([]),null);
  assert.equal(archiveMessages([msg('a'),msg('a')]),null);
  assert.equal(archiveMessages(Array.from({length:ARCHIVE_BATCH_LIMIT+1},(_,i)=>msg(`x-${i}`))),null);
});

test('server projection never trusts client-supplied media paths',()=>{
  const m=sanitizeArchiveMessage(msg('voice_1',Date.now(),{kind:'voice',media:{archived:true,url:'https://attacker'},content:'тихо'}));
  assert.equal(m.kind,'voice');
  assert.equal(Object.hasOwn(m,'media'),false);
  const audio=cloudMessageWithMedia({payload:m,has_audio:true});
  assert.deepEqual(audio.media,{archived:true,type:'audio'});
  assert.equal(cloudMessageWithMedia({payload:m,has_audio:false}).media,undefined);
  assert.deepEqual(normalizeChatMessage(audio).media,{archived:true,type:'audio'});
});

test('cursor checks both timestamp and id to prevent same-millisecond pagination loss',()=>{
  assert.equal(archiveCursor({}),null);
  assert.equal(archiveCursor({beforeTs:'1791836421891',beforeId:'r_1'}).id,'r_1');
  assert.equal(archiveCursor({beforeTs:'1791836421891',beforeId:'not safe !'}),undefined);
  assert.equal(archiveCursor({beforeTs:'NaN',beforeId:'id'}),undefined);
});

test('cloud merge reconciles by message id and preserves confirmed audio; local fallback persists',()=>{
  const local=[msg('m1',1791836421000,{kind:'voice',content:'local'}),msg('m2',1791836422000)];
  const remote=[msg('old',1791836420000),msg('m1',1791836421000,{kind:'voice',content:'remote',media:{archived:true,type:'audio'}})];
  const result=mergeArchiveHistory(local,remote);
  assert.deepEqual(result.map(x=>x.id),['old','m1','m2']);
  assert.equal(result[1].content,'local');
  assert.equal(result[1].media.archived,true);
  assert.equal(normalizeStoredHistory(result)[1].media.archived,true);
});

test('cloud adapter skips network sync when disabled; migrates in batches idempotently and paginates',async()=>{
  const calls=[];
  let posted=0;
  let tick=null;
  const t=(cb,ms)=>{tick=cb;return 1;};
  const send=async(url,opts={})=>{
    calls.push(url);
    if(url.includes('mode=status'))return {ok:true,json:async()=>({ok:true})};
    if(url.includes('mode=page'))return {ok:true,json:async()=>({messages:[msg('remote')],hasMore:true,nextCursor:{beforeTs:1791836421891,beforeId:'remote'}})};
    if(url==='/api/archive'){
      const payload=JSON.parse(opts.body);
      assert.ok(payload.messages.length<=70);
      posted+=payload.messages.length;
      return {ok:true,json:async()=>({ok:true})};
    }
    throw Error('unexpected endpoint');
  };
  const a=createCloudArchive({fetchFn:send,headers:()=>({'X-Rin-Pin':'test'}),timer:t});
  a.enqueue([msg('before')]);
  assert.equal(calls.length,0);
  const startup=await a.start();
  assert.equal(startup.messages.length,1);
  assert.equal(a.hasEarlier(),true);
  assert.equal(a.getCursor().beforeId,'remote');
  a.enqueue([msg('new'),msg('new'),msg('remote')]);
  assert.equal(typeof tick,'function');
  await a.flush();
  assert.equal(posted,1);
  a.enqueue([msg('new')]);
  await a.flush();
  assert.equal(posted,1);
});

test('cloud network failure does not affect normal local storage',async()=>{
  const failure=createCloudArchive({fetchFn:async()=>({ok:false,status:503}),log:()=>{}});
  assert.equal(await failure.start(),null);
  assert.equal(failure.isEnabled(),false);
  failure.enqueue([msg('a')]);
});

test('migration SQL is idempotent and audio is private rather than linked publicly',()=>{
  const sql=readFileSync(new URL('../db/migrations/001_cloud_archive.sql',import.meta.url),'utf8');
  const media=readFileSync(new URL('../lib/archive/media.js',import.meta.url),'utf8');
  const tts=readFileSync(new URL('../api/tts.js',import.meta.url),'utf8');
  const archiveApi=readFileSync(new URL('../api/archive.js',import.meta.url),'utf8');
  const browser=readFileSync(new URL('../public/chat.js',import.meta.url),'utf8');
  assert.match(sql,/IF NOT EXISTS rin_archive_messages/);
  assert.match(sql,/IF NOT EXISTS rin_archive_assets/);
  assert.match(media,/access:'private'/);
  assert.match(tts,/preserveRinAudio\(body.messageId, buf\)/);
  assert.match(archiveApi,/requirePin\(req,res\)/);
  assert.match(browser,/api\/archive-media/);
});
