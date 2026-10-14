import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createReq,createRes,MemoryStorage} from './helpers/runtime.js';
import {COOKIE_NAME, SESSION_SECONDS,createSession,verifySession,requireSession,destroySession,setSessionRedisForTests} from '../lib/server/session.js';
import {setSecurityRedisForTests} from '../lib/server/security-gate.js';
import login from '../api/login.js';
import archive from '../api/archive.js';
import {createBackup,parseBackup} from '../public/js/data_backup.js';

const orig={pin:process.env.ACCESS_PIN,key:process.env.RIN_PUSH_DATA_KEY,secret:process.env.RIN_SESSION_SECRET};
process.env.ACCESS_PIN='test-pin-2613';
process.env.RIN_PUSH_DATA_KEY=Buffer.alloc(32,15).toString('base64url');
delete process.env.RIN_SESSION_SECRET;
const state=new Map();
const redis={
 async set(k,v){state.set(k,v);return 'OK';},
 async get(k){return state.get(k)||null;},
 async del(k){return state.delete(k)?1:0;}
};
setSessionRedisForTests(redis);
setSecurityRedisForTests({async eval(script,keys,args){return [0,0];}});
function req(method='GET',headers={},body={}){return {method,headers,body,query:{}};}
function getCookie(res){return String(res.headers['set-cookie']).split(';')[0];}

test('login creates a random HttpOnly Secure Strict session and GET returns CSRF',async()=>{
 const res=createRes();await login(req('POST',{'x-rin-pin':'test-pin-2613'}),res);
 assert.equal(res.statusCode,200);
 assert.ok(res.headers['set-cookie'].includes('HttpOnly'));
 assert.ok(res.headers['set-cookie'].includes('Secure'));
 assert.ok(res.headers['set-cookie'].includes('SameSite=Strict'));
 assert.ok(res.headers['set-cookie'].includes('Max-Age='+SESSION_SECONDS));
 assert.equal(res.body.csrf.length,43);
 const status=createRes();await login(req('GET',{cookie:getCookie(res)}),status);
 assert.equal(status.statusCode,200);
 assert.equal(status.body.csrf,res.body.csrf);
 const other=createRes();await login(req('POST',{'x-rin-pin':'test-pin-2613'}),other);
 assert.notEqual(getCookie(other),getCookie(res),'each login must get a fresh independent session');
});

test('a correct legacy PIN cannot directly read archived messages',async()=>{
 const res=createRes();
 await archive(req('GET',{'x-rin-pin':'test-pin-2613'}),res);
 assert.equal(res.statusCode,401);
 assert.equal(res.body.code,'UNAUTHORIZED');
});

test('CSRF required for POST, no cross-origin writes, GET needs session',async()=>{
 const created=createRes();const {csrf}=await createSession(created);const cookie=getCookie(created);
 const missing=createRes();assert.equal(await requireSession(req('POST',{cookie}),missing),false);assert.equal(missing.statusCode,403);
 const wrong=createRes();assert.equal(await requireSession(req('POST',{cookie,'x-rin-csrf':'wrong'}),wrong),false);assert.equal(wrong.body.code,'CSRF_INVALID');
 const cross=createRes();assert.equal(await requireSession(req('POST',{cookie,'x-rin-csrf':csrf,origin:'https://attacker.example',host:'rin-webapp-t4vi.vercel.app'}),cross),false);assert.equal(cross.statusCode,403);
 const valid=createRes();assert.equal(await requireSession(req('POST',{cookie,'x-rin-csrf':csrf,origin:'https://rin-webapp-t4vi.vercel.app',host:'rin-webapp-t4vi.vercel.app'}),valid),true);
 const get=createRes();assert.equal(await requireSession(req('GET',{cookie}),get),true);
});

test('logout revokes cookie and rejects replay of old session',async()=>{
 const loginRes=createRes();await login(req('POST',{'x-rin-pin':'test-pin-2613'}),loginRes);
 const cookie=getCookie(loginRes);
 const res=createRes();await login(req('POST',{cookie,'x-rin-csrf':loginRes.body.csrf},{action:'logout'}),res);
 assert.equal(res.statusCode,200);
 assert.match(res.headers['set-cookie'],/Max-Age=0/);
 const old=createRes();assert.equal(await requireSession(req('GET',{cookie}),old),false);assert.equal(old.statusCode,401);
});

test('changing the PIN invalidates every previous session without a database migration',async()=>{
 const created=createRes();await login(req('POST',{'x-rin-pin':'test-pin-2613'}),created);
 const cookie=getCookie(created);
 const old=process.env.ACCESS_PIN;
 try{
   process.env.ACCESS_PIN='new-test-pin-2613';
   const res=createRes();assert.equal(await requireSession(req('GET',{cookie}),res),false);
   assert.equal(res.statusCode,401);
 }finally{process.env.ACCESS_PIN=old;}
});

test('session Redis outage fails closed and never logs credentials',async()=>{
 const loginRes=createRes();await login(req('POST',{'x-rin-pin':'test-pin-2613'}),loginRes);
 const cookie=getCookie(loginRes);
 setSessionRedisForTests({async get(){throw Error('leaked-key-123');}});
 try {const res=createRes();assert.equal(await requireSession(req('GET',{cookie}),res),false);assert.equal(res.statusCode,503);assert.equal(res.body.code,'RIN_SESSION_UNAVAILABLE');}
 finally {setSessionRedisForTests(redis);}
});

test('encrypted backup never exposes message text, rejects tamper, and restores legacy v1 files',async()=>{
 const storage=new MemoryStorage({'rin-history-v6':JSON.stringify([{role:'user',content:'private 2613 conversation',id:'u1',ts:1}]),'rin-pin':'SENSITIVE'});
 const wallpaperStore={get:async()=>'',set:async()=>true,remove:async()=>true};
 const pass='another independent password to save';
 const backup=await createBackup({storage,wallpaperStore,password:pass,cryptoRef:webcrypto});
 assert.doesNotMatch(backup.json,/private 2613 conversation|SENSITIVE|another independent password/);
 assert.equal((await parseBackup(backup.json,{password:pass,cryptoRef:webcrypto})).summary.messages,1);
 const oldPayload={storage:{'rin-history-v6':'[]'},wallpaper:''};
 const digest=createHash('sha256').update(JSON.stringify(oldPayload)).digest('hex');
 const old={format:'rin-local-backup',version:1,createdAt:'2026-10-14T01:00:00.000Z',payload:oldPayload,digest};
 const parsed=await parseBackup(JSON.stringify(old),{cryptoRef:webcrypto});
 assert.equal(parsed.legacy,true);
 assert.equal(parsed.summary.messages,0);
});

test('release v2.6.13 and logout UI ship with no extra serverless endpoint',async()=>{
 const root=new URL('../',import.meta.url);
 const [release,html,loginHtml,client]=await Promise.all(['public/js/release.js','public/index.html','public/login.html','public/js/http_client.js'].map(p=>readFile(new URL(p,root),'utf8')));
 const releaseId=release.match(/RIN_RELEASE_ID = '([^']+)'/)?.[1];
 assert.match(releaseId,/v2\.6\.13-secure-session-private-backup/);
 assert.ok(html.includes(releaseId)&&loginHtml.includes(releaseId));
 assert.match(html,/id="securityLogout"/);
 assert.doesNotMatch(client,/localStorage\.setItem/);
 const {readdir}=await import('node:fs/promises');
 assert.ok((await readdir(new URL('api/',root))).filter(n=>n.endsWith('.js')).length<=12);
});

test.after(()=>{
 setSessionRedisForTests(null);setSecurityRedisForTests(null);
 for(const [name,val] of [['ACCESS_PIN',orig.pin],['RIN_PUSH_DATA_KEY',orig.key],['RIN_SESSION_SECRET',orig.secret]]){
  if(val===undefined)delete process.env[name];else process.env[name]=val;
 }
});
