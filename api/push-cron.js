import { readFile } from 'node:fs/promises';
import { secureEqual, scheduledOpportunity, nextAttemptState, freshEnvironment, createDeliveryId, pushNotificationText, deliveryQueue, appendBackgroundMessages } from '../lib/push/core.js';
import { pushRedis, readProtected, writeProtected, acquirePushLease, DELIVERY_TTL_SECONDS } from '../lib/push/redis.js';
import { createBackgroundTurn } from '../lib/push/virtual-chat.js';
import { sendRinPush } from '../lib/push/send.js';
import { normalizeScheduleConfig } from '../public/js/rin_lore.js';
import { advanceInnerLifeForBackground, projectBackgroundTransition } from '../public/js/rin_memory.js';

const SCHEDULE_PATH = new URL('../public/data/rin_schedule.json',import.meta.url);
export async function processPushOpportunity({redis, schedule, now = Date.now(), draw = Math.random, generate = createBackgroundTurn, notify = sendRinPush} = {}) {
  const sub = await readProtected(redis,'subscription');
  const snapshot = await readProtected(redis,'snapshot');
  const attempts = await readProtected(redis,'attempts') || {};
  const pending = deliveryQueue(await readProtected(redis,'pending'));
  if (!sub || !snapshot) return {status:'not_registered'};
  if (pending.length >= 8) return {status:'queue_full'};
  const modelSnapshot = structuredClone(snapshot);
  modelSnapshot.history = appendBackgroundMessages(snapshot.history,pending);
  for (const delivery of pending) modelSnapshot.memory = projectBackgroundTransition(modelSnapshot.memory,delivery.stateTransition,delivery.requestId,delivery.createdAt);
  const opp = scheduledOpportunity({now,schedule,snapshot:modelSnapshot,attempts});
  if (!opp) return {status:'not_eligible'};
  if (!await acquirePushLease(redis,`${opp.dateKey}:${opp.windowId}`)) return {status:'busy'};
  // Re-read after obtaining lease; prevent simultaneous cron requests from rerolling.
  const fresh = await readProtected(redis,'attempts') || {};
  if (fresh?.[opp.dateKey]?.windows?.includes(opp.windowId)) return {status:'already_attempted'};
  await writeProtected(redis,'attempts',nextAttemptState(fresh,opp,false));
  if (draw() >= opp.probability) return {status:'draw_skipped'};
  // Do not generate after a different, newer sync/pending event.
  const currentSnapshot = await readProtected(redis,'snapshot');
  if (currentSnapshot?.updatedAt !== snapshot.updatedAt || JSON.stringify(deliveryQueue(await readProtected(redis,'pending')).map(d=>d.id)) !== JSON.stringify(pending.map(d=>d.id))) return {status:'stale_snapshot'};
  const requestId = `rin-bg-${opp.dateKey}-${opp.windowId}-${now}`;
  const currentEnv = freshEnvironment(snapshot.env,schedule,now);
  const currentMemory = structuredClone(modelSnapshot.memory);
  const normalizedSchedule = normalizeScheduleConfig(schedule);
  currentMemory.innerLife = advanceInnerLifeForBackground(currentMemory.innerLife || {}, currentEnv, now, normalizedSchedule.innerLife, {
    relationship:currentMemory.relationship, mood:currentMemory.mood,
    emotionalState:currentMemory.conversationState?.emotionalState
  });
  const response = await generate({
    requestId,
    history:modelSnapshot.history,
    trigger:{type:'scheduled',reason:`окно самостоятельной инициативы ${opp.window.pool||'day'} после ${schedule.minimum_silence_minutes||45}+ минут тишины`},
    env:currentEnv,
    profile:snapshot.profile,
    memory:currentMemory,
    client:{tz:schedule.timezone,sentAt:now,build:'rin-mind-v2.5.1-push',proactive:true,sticker:snapshot.sticker}
  });
  if (response?.deliveryPlan?.mode === 'silence' || response?.turnDecision?.delivery?.mode === 'silence') return {status:'silent'};
  const segments = response?.deliveryPlan?.segments || [];
  if (!segments.length || !segments.some(s=>s.type==='text' || s.type==='sticker')) return {status:'no_segments'};
  if ((await readProtected(redis,'snapshot'))?.updatedAt !== snapshot.updatedAt || JSON.stringify(deliveryQueue(await readProtected(redis,'pending')).map(d=>d.id)) !== JSON.stringify(pending.map(d=>d.id))) return {status:'stale_after_generate'};
  const delivery = {id:createDeliveryId(requestId),requestId,createdAt:now,sourceLastTs:Math.max(0,...modelSnapshot.history.map(m=>Number(m?.ts||0))), stateTransition:response.stateTransition||null,innerLife:currentMemory.innerLife||null,deliveryPlan:response.deliveryPlan,reply:response.reply||'',notificationText:pushNotificationText(response),dateKey:opp.dateKey,windowId:opp.windowId};
  await writeProtected(redis,'pending',[...pending,delivery],DELIVERY_TTL_SECONDS);
  const latest = await readProtected(redis,'attempts') || {};
  await writeProtected(redis,'attempts',nextAttemptState({...latest,[opp.dateKey]:{...latest[opp.dateKey],sent:latest[opp.dateKey]?.sent||0,windows:(latest[opp.dateKey]?.windows||[]).filter(w=>w!==opp.windowId)}},opp,true));
  try { await notify(sub,delivery); }
  catch (error) { console.error('[rin-push] transport failed; delivery retained:',error?.statusCode||error?.message||error); return {status:'queued_without_push'}; }
  return {status:'queued_and_notified'};
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'GET') return res.status(405).json({code:'METHOD_NOT_ALLOWED'});
  const secret = String(process.env.CRON_SECRET||'');
  const authorization = String(req.headers?.authorization||'');
  if (!secret || !secureEqual(authorization,`Bearer ${secret}`)) return res.status(401).json({code:'UNAUTHORIZED'});
  try {
    const redis = await pushRedis();
    const schedule = JSON.parse(await readFile(SCHEDULE_PATH,'utf8'));
    const result = await processPushOpportunity({redis,schedule});
    return res.status(200).json(result);
  } catch (error) {
    console.error('[rin-push-cron]',error?.message||error);
    return res.status(503).json({code:'PUSH_CRON_FAILED'});
  }
}
