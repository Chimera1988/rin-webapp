import { checkLoginFailureBudget, recordFailedLogin, auditRejectedPin } from '../lib/server/security-gate.js';
import { pinMatchesRequest, readJsonBody, requirePin } from '../lib/server/http.js';
import { clearSessionCookie, createSession, destroySession, verifySession } from '../lib/server/session.js';

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method==='GET'){
    const session=await verifySession(req,res,{csrf:false});
    if(!session)return;
    return res.status(200).json({ok:true,csrf:session.csrf});
  }
  if(req.method!=='POST'){
    res.setHeader('Allow','GET, POST');
    return res.status(405).json({error:'Method Not Allowed',code:'METHOD_NOT_ALLOWED'});
  }
  const body=await readJsonBody(req);
  if(body?.action==='logout'){
    if(!await destroySession(req,res))return;
    return res.status(200).json({ok:true});
  }
  if(!String(process.env.ACCESS_PIN||'').trim()){requirePin(req,res,body);return;}
  if(!await checkLoginFailureBudget(req,res))return;
  if(!pinMatchesRequest(req,body)){
    if(!await recordFailedLogin(req,res))return;
    auditRejectedPin('login');
    return res.status(401).json({error:'Unauthorized',code:'UNAUTHORIZED'});
  }
  try{
    const session=await createSession(res);
    return res.status(200).json({ok:true,...session});
  }catch{
    clearSessionCookie(res);
    return res.status(503).json({code:'RIN_SESSION_UNAVAILABLE'});
  }
}
