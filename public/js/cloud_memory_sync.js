// Best-effort cloud backup; never blocks chat and never alters local diary.
import {prepareClientSnapshot} from './cloud_memory_snapshot.js';
const SYNC_HASH_KEY='rin-neon-memory-last-snapshot-hash-v1';
const BACKFILL_CURSOR_KEY='rin-neon-memory-backfill-cursor-v1';
const BACKFILL_DONE_KEY='rin-neon-memory-backfill-done-v1';
export function createCloudMemorySync({getDiary,headers=()=>({}),fetchFn=fetch,storage=localStorage,log=()=>{},restoreActionLedger=false}={}) {
  let running=null;
  let restorationAttempted=false;
  const get=(key)=>{try{return storage.getItem(key);}catch{return null;}};
  const put=(key,v)=>{try{storage.setItem(key,v);return true;}catch{return false;}};
  const request=async(body,timeout=16000)=>{
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),timeout);
    try {return await fetchFn('/api/archive',{method:'POST',cache:'no-store',
      headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});}
    finally {clearTimeout(timer);}
  };
  async function restoreActions(){
    if(restorationAttempted)return true;
    restorationAttempted=true;
    try {
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),8000);
      let response;
      try {response=await fetchFn('/api/archive?mode=memory-latest',{method:'GET',cache:'no-store',headers:headers(),signal:controller.signal});}
      finally {clearTimeout(timeout);}
      if(!response.ok)throw new Error(`MEMORY_RESTORE_HTTP_${response.status}`);
      const data=await response.json();
      if(data?.ok!==true)throw new Error('MEMORY_RESTORE_BAD_ACK');
      const personalActions=data?.snapshot?.recovered_personal_actions ?? data?.snapshot?.personal_actions;
      if(Array.isArray(personalActions)){
        const mod=await import('./rin_memory.js');
        await mod.mergeCloudPersonalActions(personalActions);
      }
      return true;
    } catch(error) {
      restorationAttempted=false;
      log('cloud action restore postponed: '+String(error?.message||error).slice(0,80));
      return false;
    }
  }
  async function sync() {
    if (running) return running;
    running=(async()=>{
      if(restoreActionLedger && !await restoreActions())throw new Error('ACTION_RESTORE_PENDING');
      const diary=await getDiary(); if(!diary) return {ok:false,code:'NO_DIARY'};
      // Only long-term content contributes to fingerprint. Mood/turn timestamps do not create duplicates.
      const snapshot=await prepareClientSnapshot({...diary,_updated_at:null});
      if(get(SYNC_HASH_KEY)===snapshot.snapshot_hash) return {ok:true,duplicate:true};
      const response=await request({action:'memory-snapshot',snapshot});
      if(!response.ok) throw new Error(`MEMORY_SNAPSHOT_HTTP_${response.status}`);
      const data=await response.json();
      if(!data?.ok||data.snapshotHash!==snapshot.snapshot_hash) throw new Error('MEMORY_SNAPSHOT_BAD_ACK');
      put(SYNC_HASH_KEY,snapshot.snapshot_hash);
      return {ok:true,inserted:!!data.inserted};
    })().catch(e=>{log('cloud memory sync postponed: '+String(e?.message||e).slice(0,100));return {ok:false};})
    .finally(()=>{running=null;});
    return running;
  }
  let backfillRunning=null;
  async function backfill({maxPages=3}={}) {
    if(backfillRunning) return backfillRunning;
    if(get(BACKFILL_DONE_KEY)==='1') return {ok:true,done:true};
    backfillRunning=(async()=>{
      let cursor;try{cursor=JSON.parse(get(BACKFILL_CURSOR_KEY)||'null');}catch{cursor=null;}
      for(let i=0;i<Math.max(1,Math.min(4,maxPages));i++) {
        const response=await request({action:'memory-backfill',cursor,limit:70});
        if(!response.ok) throw new Error(`MEMORY_BACKFILL_HTTP_${response.status}`);
        const data=await response.json();
        if(!data?.ok) throw new Error('MEMORY_BACKFILL_BAD_ACK');
        if(data.nextCursor) {cursor=data.nextCursor;put(BACKFILL_CURSOR_KEY,JSON.stringify(cursor));}
        if(!data.hasMore){put(BACKFILL_DONE_KEY,'1');return {ok:true,done:true};}
      }
      return {ok:true,done:false};
    })().catch(e=>{log('cloud memory backfill postponed: '+String(e?.message||e).slice(0,100));return {ok:false};})
    .finally(()=>{backfillRunning=null;});
    return backfillRunning;
  }
  return {sync,backfill};
}
