import { authenticatedHeaders, fetchWithTimeout } from './http_client.js';

export const PUSH_SETTING_KEY = 'rin-push-enabled-v1';
export function supportsPush(windowRef = window) {
  return Boolean(windowRef.isSecureContext && windowRef.navigator?.serviceWorker && windowRef.PushManager && windowRef.Notification);
}
export function urlBase64ToUint8Array(input) {
  const value = String(input || '');
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(value)) throw new Error('PUSH_PUBLIC_KEY_INVALID');
  const raw = atob(value.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4-value.length%4)%4));
  return Uint8Array.from(raw, c=>c.charCodeAt(0));
}
async function requestPush(action, body = {}) {
  const res = await fetchWithTimeout('/api/push', { method:'POST',headers: authenticatedHeaders({'Content-Type':'application/json'}),body:JSON.stringify({action,...body}),cache:'no-store' }, 16_000);
  const result = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(result.code || `HTTP_${res.status}`);
  return result;
}
export function createPushController({ getSnapshot, acceptDelivery, onStatus = ()=>{}, log = ()=>{}, storage = localStorage } = {}) {
  const statusText = text=>onStatus(String(text));
  let enabled = storage.getItem(PUSH_SETTING_KEY) === '1';
  let processing = false;
  let syncing = false;
  async function sync() {
    if (!enabled || syncing || !navigator.onLine) return false;
    syncing = true;
    try {
      const snapshot = await getSnapshot();
      if (!snapshot) return false;
      await requestPush('sync',{snapshot});
      return true;
    } catch (error) { log('push sync failed: '+(error?.message || error)); return false; }
    finally { syncing = false; }
  }
  async function pull() {
    if (!enabled || processing || !navigator.onLine) return false;
    processing = true;
    let received = false;
    try {
      for (let i=0;i<8;i++) {
        const {pending} = await requestPush('pull');
        if (!pending) break;
        // Acknowledge only after local state and history have both been persisted.
        if (!await acceptDelivery(pending)) break;
        await requestPush('ack',{id:pending.id});
        received = true;
      }
      if (received) {await sync();return true;}
    } catch (error) { log('push delivery pending: '+(error?.message||error)); }
    finally { processing = false; }
    return false;
  }
  async function connectWithPermission(permissionPromise) {
    if (!supportsPush()) {statusText('Открой Rin через иконку на экране «Домой» (iOS 16.4+).');return false;}
    try {
      const permission = await permissionPromise;
      if (permission !== 'granted') {statusText('iPhone не разрешил уведомления.');return false;}
      const status = await requestPush('status');
      const registration = await navigator.serviceWorker.register('/sw.js',{scope:'/'});
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:urlBase64ToUint8Array(status.publicKey) });
      await requestPush('enable',{subscription:subscription.toJSON()});
      storage.setItem(PUSH_SETTING_KEY,'1');
      enabled = true;
      await pull();
      const saved = await sync();
      statusText(saved ? 'Уведомления включены. Фоновые инициативы готовы.' : 'Подписка создана, но синхронизация пока не завершена.');
      return true;
    } catch(error) {statusText('Ошибка подключения: '+(error?.message||error));log('push enable failed: '+(error?.message||error));return false;}
  }
  // Caller must invoke synchronously within the click gesture on iPhone.
  function enableFromClick() {
    if (!supportsPush()) {statusText('Для iPhone открой установленное PWA с экрана «Домой».');return Promise.resolve(false);}
    return connectWithPermission(Notification.requestPermission());
  }
  async function test() {
    if (!enabled) {statusText('Сначала включи уведомления.');return false;}
    try {await requestPush('test');statusText('Тест отправлен на iPhone. Он не добавляет сообщения в переписку.');return true;}
    catch(error) {statusText('Тест не прошёл: '+(error?.message||error));return false;}
  }
  async function disable() {
    try {
      const registration = await navigator.serviceWorker?.getRegistration?.('/');
      const subscription = await registration?.pushManager?.getSubscription?.();
      await requestPush('disable');
      if (subscription) await subscription.unsubscribe();
      storage.removeItem(PUSH_SETTING_KEY);
      enabled = false;
      statusText('Уведомления отключены. Локальные инициативы продолжат работать в открытом чате.');
      return true;
    } catch(error) {statusText('Не удалось отключить уведомления: '+(error?.message||error));return false;}
  }
  async function initialize() {
    if (!supportsPush()) {statusText('Push доступен в установленном PWA на iPhone (iOS 16.4+).');return;}
    if (!enabled) {statusText('Нажми «Включить уведомления», чтобы разрешить их на iPhone.');return;}
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager?.getSubscription?.();
      if (!sub || Notification.permission !== 'granted') {
        enabled = false; storage.removeItem(PUSH_SETTING_KEY);
        statusText('Подписка больше не активна. Подключи уведомления заново.'); return;
      }
      await pull(); await sync();
      statusText('Уведомления подключены.');
    } catch(e) {statusText('Нет связи с сервером уведомлений. Повторим позже.');log(e?.message||e);}
  }
  function isEnabled() { return enabled; }
  return {initialize,enableFromClick,disable,test,sync,pull,isEnabled};
}
