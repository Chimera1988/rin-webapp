import { loadChatHistory, normalizeStoredMessage } from './chat_store.js';

const BATCH=70;
const RETRY_MS=15000;
const RECONNECT_MS=30000;
const GOOD_STATUS=new Set(['complete']);
const cleanBatch = messages => (Array.isArray(messages)?messages:[]).filter(m=>
  m?.id && GOOD_STATUS.has(m.status) && ['text','voice','sticker','silence'].includes(m.kind) &&
  (['user','assistant'].includes(m.role)));

// Never trim the immutable server archive by a browser cache budget.
export function mergeArchiveHistory(local=[],remote=[]) {
  const ids=new Map();
  for(const message of remote) if (message?.id) ids.set(message.id,message);
  for(const message of local) if (message?.id) {
    const prior=ids.get(message.id);
    ids.set(message.id,{...prior,...message,
      ...(prior?.media?.archived || message.media?.archived ? {media:{archived:true,type:'audio'}} : {})});
  }
  return [...ids.values()].map(normalizeStoredMessage).filter(Boolean)
    .sort((a,b)=>Number(a.ts)-Number(b.ts)||String(a.id).localeCompare(String(b.id)));
}

// Load an actual contiguous recent archive window, not the old mixed-kind
// browser cache (which can have holes between separately retained stickers).
// Keep fetched pages so excluded older events remain available on demand.
export async function collectRecentArchiveWindow(firstPage, loadEarlier, limit = 180) {
  if (!firstPage || !Array.isArray(firstPage.messages)) return null;
  if (typeof loadEarlier !== 'function') throw new TypeError('Archive page loader is required.');
  const pages = [];
  const ids = new Set();
  const cursors = new Set();
  let page = firstPage;
  let error = null;
  while (page && pages.length < 8) {
    pages.push(page);
    for (const item of page.messages) if (item?.id) ids.add(item.id);
    if (ids.size >= limit || !page.hasMore || !page.cursor) break;
    const cursorKey = `${page.cursor.beforeTs}:${page.cursor.beforeId}`;
    if (cursors.has(cursorKey)) break;
    cursors.add(cursorKey);
    try {
      const older = await loadEarlier(page.cursor);
      if (!older || !Array.isArray(older.messages)) break;
      page = older;
    } catch (cause) {
      error = String(cause?.message || cause);
      break; // Network errors must not prevent Rin from opening with local data.
    }
  }
  const last = pages.at(-1);
  return {
    messages: pages.flatMap(part => part.messages),
    pages,
    cursor: last.cursor || null,
    hasMore: last.hasMore === true,
    error
  };
}

export function createCloudArchive({fetchFn=fetch,headers=()=>({}),log=()=>{},timer=setTimeout}={}) {
  let enabled=false;
  let pending=new Map();
  let timerId=null;
  let reconnectTimerId=null;
  let reconnecting=false;
  let reconnectFailures=0;
  let busy=false;
  let cursor=null;
  let hasMore=false;
  const received=new Set();
  const request=async(url,options={},timeout=11000)=>{
    const controller=new AbortController();
    const tid=setTimeout(()=>controller.abort(),timeout);
    try {return await fetchFn(url,{...options,headers:{...headers(),...(options.headers||{})},signal:controller.signal,cache:'no-store'});}
    finally {clearTimeout(tid);}
  };
  const schedule=(delay=950)=>{
    if (!enabled || timerId!==null) return;
    timerId=timer(async()=>{timerId=null;await flush();},delay);
  };
  async function flush(){
    if (!enabled || busy || !pending.size) return;
    busy=true;
    try {
      while(pending.size){
        const batch=[...pending.values()].slice(0,BATCH);
        // Stay well below the 1 MB JSON API cap, including multi-byte Unicode.
        while(batch.length>1 && new TextEncoder().encode(JSON.stringify({action:'append',messages:batch})).length>280000) batch.pop();
        const response=await request('/api/archive',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'append',messages:batch})},16000);
        if (!response.ok) throw new Error(`sync_http_${response.status}`);
        for(const message of batch){
          // An updated complete version might arrive while the request was running.
          if (pending.get(message.id)===message) pending.delete(message.id);
          received.add(message.id);
        }
      }
    } catch(error){log(`archive sync postponed: ${error.message}`);if (enabled)schedule(RETRY_MS);}
    finally {busy=false;if(pending.size && timerId===null)schedule();}
  }
  function enqueue(history){
    if (!enabled) return;
    for(const message of cleanBatch(history)) {
      // Final messages already present on server don't need to be uploaded again.
      if (received.has(message.id)) continue;
      pending.set(message.id,message);
    }
    schedule();
  }
  async function page(next=null){
    if (!enabled) return null;
    const qs=new URLSearchParams({mode:'page'});
    if(next){qs.set('beforeTs',String(next.beforeTs));qs.set('beforeId',next.beforeId);}
    const response=await request(`/api/archive?${qs}`);
    if (!response.ok) throw new Error(`page_http_${response.status}`);
    const value=await response.json();
    if (!Array.isArray(value.messages)) throw new Error('invalid_archive_page');
    for(const m of value.messages) if (m?.id)received.add(m.id);
    cursor=value.nextCursor||null;
    hasMore=value.hasMore===true;
    return {messages:value.messages,cursor,hasMore};
  }
  // A slow/offline startup must not disable cloud archival for the entire PWA session.
  // Recover independently from the initial history-page read and replay completed
  // messages from the existing local cache (without touching Rin's diary or state).
  function scheduleReconnect(){
    if (enabled || reconnecting || reconnectTimerId!==null) return;
    const delay=Math.min(RECONNECT_MS*Math.pow(2,Math.min(reconnectFailures,2)),120000);
    reconnectTimerId=timer(async()=>{
      reconnectTimerId=null;
      if (enabled || reconnecting) return;
      reconnecting=true;
      try {
        const response=await request('/api/archive?mode=status');
        if (!response.ok) throw new Error(`status_http_${response.status}`);
        const status=await response.json();
        if (status?.ok!==true) throw new Error('invalid_archive_status');
        enabled=true;
        reconnectFailures=0;
        // The startup path may have discarded enqueue() calls while disconnected.
        // Rescan the local cache rather than relying on transient in-memory batches.
        try { enqueue(loadChatHistory(localStorage)); }
        catch (error) { log(`archive local replay unavailable: ${error?.message||error}`); }
        log('cloud archive reconnected; local history sync resumed');
      } catch (error) {
        reconnectFailures++;
        log(`archive reconnect postponed: ${error?.message||error}`);
      } finally {
        reconnecting=false;
        if (!enabled) scheduleReconnect();
      }
    },delay);
    if (typeof reconnectTimerId?.unref === 'function') reconnectTimerId.unref();
  }
  async function start(){
    try{
      const res=await request('/api/archive?mode=status');
      if (!res.ok){log(`archive unavailable: HTTP ${res.status}`);scheduleReconnect();return null;}
      const status=await res.json();
      if (status.audioReady!==true) log('archive ready for text; private audio store is not connected');
      enabled=true;
      const first=await page(null);
      return first;
    }catch(error){log(`archive startup skipped: ${error.message}`);enabled=false;scheduleReconnect();return null;}
  }
  return {
    start,enqueue,page,flush,
    isEnabled:()=>enabled,
    getCursor:()=>cursor,
    hasEarlier:()=>hasMore
  };
}
