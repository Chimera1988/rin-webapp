// Rin Push service worker. Deliberately no offline cache: old code must never override a new diary schema.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { payload = {}; }
  // The payload carries only an opaque delivery ID. Private message text stays off OS push servers.
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    if (!payload.test && windows.some(client=>client.visibilityState==='visible')) {
      for (const client of windows) client.postMessage({type:'rin-push-delivery'});
      return;
    }
    await self.registration.showNotification(payload.test ? 'Проверка уведомлений Rin' : 'Рин Акихара', {
      body:payload.test ? 'Подключение работает. Это тест, не сообщение Рин.' : 'Рин написала тебе сообщение',icon:'/icons/rin-kitsune-192.png',badge:'/icons/rin-kitsune-192.png',tag:`rin-${String(payload.id||'message').slice(0,80)}`,
      data:{url:'/',id:String(payload.id||'').slice(0,80)}
    });
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    if (windows.length) { const client=windows[0]; await client.focus();client.postMessage({type:'rin-push-delivery'});return; }
    await self.clients.openWindow('/');
  })());
});
