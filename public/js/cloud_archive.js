import { normalizeStoredHistory } from './chat_store.js';

const BATCH=70;
const RETRY_MS=15000;
const GOOD_STATUS=new Set(['complete']);
const cleanBatch = messages => (Array.isArray(messages)?messages:[]).filter(m=>
  m?.id && GOOD_STATUS.has(m.status) && ['text','voice','sticker','silence'].includes(m.kind) &&
  (['user','assistant'].includes(m.role)));

export function mergeArchiveHistory(local=[],remote=[]) {
  const ids=new Map();
  for(const message of remote) if (message?.id) ids.set(message.id,message);
  for(const message of local) if (message?.id) {
    const prior=ids.get(message.id);
    ids.set(message.id,{...prior,...message,
      ...(prior?.media?.archived || message.media?.archived ? {media:{archived:true,type:'audio'}} : {})});
  }
  return normalizeStoredHistory([...ids.values()].sort((a,b)=>Number(a.ts)-Number(b.ts)||String(a.id).localeCompare(String(b.id))));
}

export function createCloudArchive({fetchFn=fetch,headers=()=>({}),log=()=>{},timer=setTimeout}={}) {
  let enabled=false;
  let pending=new Map();
  let timerId=null;
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
  async function start(){
    try{
      const res=await request('/api/archive?mode=status');
      if (!res.ok){log(`archive unavailable: HTTP ${res.status}`);return null;}
      const status=await res.json();
      if (status.audioReady!==true) log('archive ready for text; private audio store is not connected');
      enabled=true;
      const first=await page(null);
      return first;
    }catch(error){log(`archive startup skipped: ${error.message}`);enabled=false;return null;}
  }
  return {
    start,enqueue,page,flush,
    isEnabled:()=>enabled,
    getCursor:()=>cursor,
    hasEarlier:()=>hasMore
  };
}
