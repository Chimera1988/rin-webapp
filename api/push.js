import { readJsonBody, requireMethod, requirePin } from '../lib/server/http.js';
import { pushRedis, readProtected, writeProtected, deleteProtected, DELIVERY_TTL_SECONDS } from '../lib/push/redis.js';
import { validateSubscription, validateSnapshot, deliveryQueue, PUSH_SCHEMA } from '../lib/push/core.js';
import { sendRinPush } from '../lib/push/send.js';
import { pushKey } from '../lib/push/redis.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (!requireMethod(req,res,'POST')) return;
  const body = await readJsonBody(req);
  if (!requirePin(req,res,body)) return;
  const action = String(body.action||'');
  if (!['status','enable','sync','pull','ack','disable','test'].includes(action)) return res.status(400).json({code:'INVALID_PUSH_ACTION'});
  try {
    const redis = await pushRedis();
    if (action === 'status') {
      const enabled = Boolean(await readProtected(redis,'subscription'));
      return res.status(200).json({enabled,publicKey:process.env.RIN_PUSH_VAPID_PUBLIC||'',schema:PUSH_SCHEMA});
    }
    if (action === 'enable') {
      const subscription = validateSubscription(body.subscription);
      await writeProtected(redis,'subscription',subscription);
      return res.status(200).json({enabled:true});
    }
    if (action === 'test') {
      const subscription = await readProtected(redis,'subscription');
      if (!subscription) return res.status(409).json({code:'PUSH_NOT_ENABLED'});
      const allowed = await redis.set(pushKey('test:throttle'),'1',{nx:true,ex:60});
      if (allowed !== 'OK') return res.status(429).json({code:'PUSH_TEST_RATE_LIMITED'});
      try {await sendRinPush(subscription,{id:`test-${Date.now()}`,test:true});}
      catch (error) {console.error('[rin-push-test]',error?.statusCode||error?.message||error);return res.status(503).json({code:'PUSH_TEST_DELIVERY_FAILED'});}
      return res.status(200).json({ok:true});
    }
    if (action === 'disable') {
      await deleteProtected(redis,'subscription','snapshot','pending','attempts');
      return res.status(200).json({enabled:false});
    }
    if (action === 'sync') {
      const current = await readProtected(redis,'subscription');
      if (!current) return res.status(409).json({code:'PUSH_NOT_ENABLED'});
      const snapshot = validateSnapshot(body.snapshot);
      // A pending turn is never deleted or overwritten by a newer snapshot.
      await writeProtected(redis,'snapshot',snapshot);
      return res.status(200).json({ok:true});
    }
    if (action === 'pull') {
      const pending = deliveryQueue(await readProtected(redis,'pending'));
      return res.status(200).json({pending: pending[0] || null,remaining:pending.length});
    }
    if (action === 'ack') {
      const pending = deliveryQueue(await readProtected(redis,'pending'));
      if (pending.length && pending[0].id !== String(body.id||'')) return res.status(409).json({code:'PUSH_DELIVERY_MISMATCH'});
      if (pending.length > 1) await writeProtected(redis,'pending',pending.slice(1),DELIVERY_TTL_SECONDS);
      else if (pending.length) await deleteProtected(redis,'pending');
      return res.status(200).json({ack:true,remaining:Math.max(0,pending.length-1)});
    }
  } catch (error) {
    console.error('[rin-push]',error?.code||error?.message||error);
    const bad = /^(?:INVALID_|PUSH_HISTORY_TOO_LARGE|PUSH_SNAPSHOT_TOO_LARGE)/.test(error?.message||'');
    return res.status(bad?400:503).json({code:bad?String(error.message):'PUSH_SERVER_UNAVAILABLE'});
  }
}
