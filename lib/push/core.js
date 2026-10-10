import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const PUSH_SCHEMA = 'rin-push-v1';
export const PUSH_PREFIX = 'rin:push:v1';
export const SNAPSHOT_TTL_SECONDS = 30 * 86400;
export const DELIVERY_TTL_SECONDS = 30 * 86400;

export function pushSecret() {
  const raw = String(process.env.RIN_PUSH_DATA_KEY || '').trim();
  const key = Buffer.from(raw, 'base64url');
  if (key.length !== 32) throw new Error('RIN_PUSH_DATA_KEY must be 32 bytes encoded as base64url');
  return key;
}
export function seal(data, key = pushSecret()) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return ['1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}
export function openSealed(value, key = pushSecret()) {
  const [version, nonce, tag, encrypted] = String(value || '').split('.');
  if (version !== '1' || !nonce || !tag || !encrypted) throw new Error('PUSH_INVALID_CIPHERTEXT');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8'));
}
export function secureEqual(actual, expected) {
  const a = Buffer.from(String(actual || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}
export function validateSubscription(input) {
  if (!input || typeof input !== 'object' || !/^https:\/\//i.test(String(input.endpoint || ''))) throw new Error('INVALID_PUSH_SUBSCRIPTION');
  const url = new URL(input.endpoint);
  if (url.username || url.password || url.href.length > 1500 || !['https:'].includes(url.protocol)) throw new Error('INVALID_PUSH_SUBSCRIPTION');
  // Restrict accepted endpoints to known push services to avoid SSRF via server push.
  if (!/^(?:[a-z0-9-]+\.)*(?:push\.apple\.com|push\.services\.mozilla\.com|fcm\.googleapis\.com|notify\.windows\.com)$/i.test(url.hostname)) throw new Error('INVALID_PUSH_ENDPOINT');
  if (!/^[a-z0-9_-]{50,256}$/i.test(String(input.keys?.p256dh || '')) || !/^[a-z0-9_-]{8,128}$/i.test(String(input.keys?.auth || ''))) throw new Error('INVALID_PUSH_KEYS');
  return { endpoint: url.href, expirationTime: null, keys: { p256dh: input.keys.p256dh, auth: input.keys.auth } };
}
export function validateSnapshot(input) {
  if (!input || typeof input !== 'object') throw new Error('INVALID_PUSH_SNAPSHOT');
  const history = Array.isArray(input.history) ? input.history : [];
  if (history.length > 45) throw new Error('PUSH_HISTORY_TOO_LARGE');
  const memory = input.memory && typeof input.memory === 'object' ? input.memory : null;
  if (!memory || !input.profile || typeof input.profile !== 'object') throw new Error('PUSH_SNAPSHOT_INCOMPLETE');
  // This is the model-facing compact memory, not the entire diary.
  const data = {
    schema: PUSH_SCHEMA,
    history,
    memory,
    profile: input.profile,
    env: input.env && typeof input.env === 'object' ? input.env : {},
    sticker: input.sticker && typeof input.sticker === 'object' ? input.sticker : { mode: 'off' },
    initiation: input.initiation && typeof input.initiation === 'object' ? input.initiation : {},
    updatedAt: Date.now()
  };
  if (Buffer.byteLength(JSON.stringify(data)) > 170_000) throw new Error('PUSH_SNAPSHOT_TOO_LARGE');
  return data;
}
export function scheduledOpportunity({ now = Date.now(), schedule, snapshot, attempts = {}, pending = null } = {}) {
  if (!schedule || !snapshot || pending || !Array.isArray(schedule.windows)) return null;
  const zone = schedule.timezone || 'Europe/Moscow';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: zone, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23' }).formatToParts(new Date(now)).map(x=>[x.type,x.value]));
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  const minutes = Number(parts.hour)*60 + Number(parts.minute);
  const window = schedule.windows.find(w => {
    const parse = s => { const m = /^(\d\d):(\d\d)$/.exec(String(s)); return m ? Number(m[1])*60+Number(m[2]) : NaN; };
    return minutes >= parse(w.from) && minutes <= parse(w.to);
  });
  if (!window) return null;
  const sent = Math.max(Number(attempts?.[dateKey]?.sent || 0),Number(snapshot?.initiation?.days?.[dateKey]?.sent || 0));
  if (sent >= Number(schedule.max_daily_initiations || schedule.maxDailyInitiations || 2)) return null;
  const id = String(window.id || `${window.from}-${window.to}`);
  if (attempts?.[dateKey]?.windows?.includes(id) || snapshot?.initiation?.days?.[dateKey]?.attemptedWindowKeys?.includes(id)) return null;
  const last = [...snapshot.history].reverse().find(m => ['text','voice','sticker','silence'].includes(m?.kind || 'text'));
  if (!last || last.role !== 'assistant' || now - Number(last.ts || now) < Number(schedule.minimum_silence_minutes || schedule.minimumSilenceMinutes || 45)*60000) return null;
  return { dateKey, windowId:id, window, probability: Math.max(0,Math.min(1,Number(window.probability)||0)) };
}
export function nextAttemptState(previous = {}, opportunity, succeeded = false) {
  const source = previous && typeof previous === 'object' ? previous : {};
  const state = Object.fromEntries(Object.entries(source).slice(-6));
  const item = state[opportunity.dateKey] || { sent:0, windows:[] };
  state[opportunity.dateKey] = { sent: Math.max(0,Number(item.sent || 0)) + (succeeded ? 1 : 0), windows: [...new Set([...(item.windows||[]), opportunity.windowId])] };
  return state;
}
export function pushNotificationText(delivery) {
  const segments = Array.isArray(delivery?.deliveryPlan?.segments) ? delivery.deliveryPlan.segments : [];
  const text = segments.filter(s=>s.type==='text').map(s=>String(s.text||'').trim()).filter(Boolean).join(' ').trim() || String(delivery?.reply||'').trim();
  return text.replace(/\s+/g,' ').slice(0,180) || 'Рин прислала новое сообщение';
}
export function createDeliveryId(requestId) {
  return createHash('sha256').update(String(requestId)).digest('hex').slice(0,24);
}
export function freshEnvironment(snapshotEnv = {}, schedule = {}, now = Date.now()) {
  const timezone = schedule.timezone || 'Europe/Moscow';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
  const h = Number(parts.hour), m = Number(parts.month);
  const season = m===12||m<=2?'зима':m<=5?'весна':m<=8?'лето':'осень';
  return { ...snapshotEnv, rinTz:timezone, rinHuman:`${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`,partOfDay:h>=5&&h<12?'утро':h>=12&&h<18?'день':h>=18&&h<23?'вечер':'ночь',season, month: ['','январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'][m], weather:null, _weatherTs:0, _ts:now };
}

/** Normalize stored deliveries to a bounded FIFO, including the older one-item format. */
export function deliveryQueue(value) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.filter(item=>item && typeof item.id==='string' && item.deliveryPlan).slice(-12);
}
export function appendBackgroundMessages(history = [], queue = []) {
  const next = [...history];
  const seen = new Set(next.map(item=>item?.id));
  for (const delivery of deliveryQueue(queue)) {
    for (const [index,segment] of (delivery.deliveryPlan?.segments||[]).entries()) {
      const id = String(segment?.id || `${delivery.requestId}-seg-${index + 1}`);
      if (seen.has(id) || !['text','sticker'].includes(segment?.type)) continue;
      seen.add(id);
      next.push({id,role:'assistant',kind:segment.type,status:'complete',content:segment.type==='text'?String(segment.text||''):String(segment.sticker?.meaning||'невербальный жест'),sticker:segment.type==='sticker'?segment.sticker:undefined,ts:delivery.createdAt,requestId:delivery.requestId});
    }
  }
  return next.slice(-35);
}
