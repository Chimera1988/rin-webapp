import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { pushRedis } from '../push/redis.js';
import { INTERNAL_BACKGROUND_CALL } from './security-gate.js';

// A server-side opaque session replaces the persistent client-side PIN.
// No new Vercel function: /api/login serves login, session status and logout.
export const COOKIE_NAME = '__Host-rin-session';
export const SESSION_SECONDS = 7 * 24 * 3600;
const TOKEN_RE = /^[a-zA-Z0-9_-]{43}$/;
let testClient = null;
export function setSessionRedisForTests(redis) { testClient = redis; }
const sessionRedis = () => testClient || pushRedis();

function sessionKey(token, env = process.env) {
  // Uses the already-configured high-entropy 256-bit push encryption key.
  // A distinct domain separator prevents cross-protocol token reuse.
  const encoded = String(env.RIN_SESSION_SECRET || env.RIN_PUSH_DATA_KEY || '');
  const secret = Buffer.from(encoded, 'base64url');
  if (secret.length !== 32) throw new Error('RIN_SESSION_KEY_NOT_CONFIGURED');
  return `rin:session:v2613:${createHmac('sha256',secret).update(`rin-session-v1:${token}`).digest('hex')}`;
}
function pinRevision(env=process.env){
  const key=Buffer.from(String(env.RIN_SESSION_SECRET || env.RIN_PUSH_DATA_KEY || ''),'base64url');
  if(key.length!==32)throw new Error('RIN_SESSION_KEY_NOT_CONFIGURED');
  return createHmac('sha256',key).update(`rin-pin-rev-v1:${String(env.ACCESS_PIN||'')}`).digest('hex');
}
function requestHeader(req, name) {
  const headers = req?.headers || {};
  return typeof headers.get === 'function' ? headers.get(name) : (headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()]);
}
function sessionToken(req) {
  const cookies = String(requestHeader(req, 'cookie') || '').split(';');
  for (const part of cookies) {
    const index = part.indexOf('=');
    if (index<0 || part.slice(0,index).trim()!==COOKIE_NAME) continue;
    const value=part.slice(index+1).trim();
    return TOKEN_RE.test(value) ? value : null;
  }
  return null;
}
function csrfValid(req, expected) {
  const provided=String(requestHeader(req,'x-rin-csrf')||'');
  const a=Buffer.from(provided), b=Buffer.from(String(expected||''));
  if(!a.length || a.length!==b.length || !timingSafeEqual(a,b)) return false;
  // Reject cross-origin writes, including when a browser supplies both Origin and token.
  const origin=String(requestHeader(req,'origin')||'');
  if(origin){
    const host=String(requestHeader(req,'host')||'');
    const expectedOrigin=`https://${host}`;
    if(!host || origin!==expectedOrigin) return false;
  }
  return true;
}
function reject(res,status,code){
  res.setHeader?.('Cache-Control','no-store');
  res.status(status).json({code});
  return null;
}
export function clearSessionCookie(res){
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}
export async function createSession(res, {redis=null,env=process.env}={}){
  const token=randomBytes(32).toString('base64url');
  const csrf=randomBytes(32).toString('base64url');
  const client=redis||await sessionRedis();
  await client.set(sessionKey(token,env),JSON.stringify({csrf,pinRevision:pinRevision(env)}),{ex:SESSION_SECONDS});
  res.setHeader('Set-Cookie',`${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`);
  res.setHeader('Cache-Control','no-store');
  return {csrf,expiresIn:SESSION_SECONDS};
}
export async function verifySession(req,res,{redis=null,env=process.env,csrf=true}={}){
  if(req?.[INTERNAL_BACKGROUND_CALL]===true) return {internal:true};
  const token=sessionToken(req);
  if(!token) return reject(res,401,'UNAUTHORIZED');
  try{
    const client=redis||await sessionRedis();
    const raw=await client.get(sessionKey(token,env));
    if(!raw)return reject(res,401,'UNAUTHORIZED');
    const record=typeof raw==='string'?JSON.parse(raw):raw;
    if(!record?.csrf || !TOKEN_RE.test(record.csrf) || record.pinRevision!==pinRevision(env)) return reject(res,401,'UNAUTHORIZED');
    if(csrf && !['GET','HEAD','OPTIONS'].includes(String(req.method||'').toUpperCase()) && !csrfValid(req,record.csrf)){
      return reject(res,403,'CSRF_INVALID');
    }
    return {csrf:record.csrf,token,client};
  }catch{
    return reject(res,503,'RIN_SESSION_UNAVAILABLE');
  }
}
export async function requireSession(req,res){return Boolean(await verifySession(req,res));}
export async function destroySession(req,res){
  const session=await verifySession(req,res);
  if(!session)return false;
  if(!session.internal){
    try{await session.client.del(sessionKey(session.token));}
    catch{return reject(res,503,'RIN_SESSION_UNAVAILABLE');}
  }
  clearSessionCookie(res);
  return true;
}
