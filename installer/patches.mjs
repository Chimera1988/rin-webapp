export const BASE_RELEASE='2026-10-15-rin-mind-v2.6.16-causal-events-personality-depth';
export const NEXT_RELEASE='2026-10-15-rin-mind-v2.6.17-neon-autobiographical-memory';
// Blob hashes checked against connected GitHub main 2.6.16 (14 October commit e816cb5).
export const PATCHES=[
  {
    path:'api/archive.js',
    baseSha:'85d1eb1f49c62848e4295326d4e1ec389841bb64',
    changes:[
      ["import { writeExperienceCandidates } from '../lib/memory-foundation/experience-database.js';",
       "import { writeExperienceCandidates } from '../lib/memory-foundation/experience-database.js';\nimport { saveRinActionCandidates } from '../lib/memory-foundation/autobiography.js';\nimport { backfillRinActions } from '../lib/memory-foundation/backfill.js';\nimport { writeClientSnapshot, readLatestClientSnapshot } from '../lib/memory-foundation/snapshots.js';"],
      ["      if (body?.action!=='append') return res.status(400).json({code:'INVALID_ACTION'});",
       "      if (body?.action==='memory-snapshot') {\n        try {return res.status(200).json(await writeClientSnapshot(body.snapshot));}\n        catch(error) {console.error('Memory snapshot rejected:',error?.message);return res.status(400).json({code:'MEMORY_SNAPSHOT_REJECTED'});}\n      }\n      if (body?.action==='memory-backfill') {\n        const cursor=body.cursor && typeof body.cursor==='object' ? body.cursor : {};\n        return res.status(200).json(await backfillRinActions({afterTs:cursor.afterTs||0,afterId:cursor.afterId||'',limit:body.limit||70}));\n      }\n      if (body?.action!=='append') return res.status(400).json({code:'INVALID_ACTION'});"],
      ["      await writeExperienceCandidates(messages);",
       "      await writeExperienceCandidates(messages);\n      // New autobiographical indexing is optional; never block the immutable archive.\n      try {await saveRinActionCandidates(messages);}\n      catch(error) {console.error('Autobiographical indexing postponed:',error?.message||error);}"],
      ["    if (query.mode==='memory-status' || query.mode==='memory-recent') {",
       "    if (query.mode==='memory-latest') {\n      return res.status(200).json({ok:true,snapshot:await readLatestClientSnapshot()});\n    }\n    if (query.mode==='memory-status' || query.mode==='memory-recent') {"]
    ]
  },
  {
    path:'api/chat.js',
    baseSha:'b810af10d6037a3f9f400af772b5ee799db82d14',
    changes:[
      ["import { retrieveCanonicalLore } from '../lib/server/canon-retrieval.js';",
       "import { retrieveCanonicalLore } from '../lib/server/canon-retrieval.js';\nimport { recallRinAction } from '../lib/memory-foundation/autobiography.js';"],
      ["    const realityBoundary = buildRealityBoundary({ profile, memory, lore, userText: userTurn, history: fullHistory });",
       "    // Non-blocking, source-qualified autobiographical recall; not a directive to the Mind.\n    // Fail open when Neon is unavailable: Rin's existing local memory remains authoritative.\n    try {\n      const recalled=trigger ? [] : await recallRinAction(userTurn);\n      if (recalled.length) {\n        const previous=kernelState.relevantMemory || {};\n        kernelState.relevantMemory={...previous,\n          events:[...recalled,...(Array.isArray(previous.events)?previous.events:[])].slice(0,4),\n          suppressed:false,reason:'source_qualified_cloud_recall'};\n      }\n    } catch (error) {console.error('Autobiographical recall unavailable:',error?.message||error);}\n    const realityBoundary = buildRealityBoundary({ profile, memory, lore, userText: userTurn, history: fullHistory });"]
    ]
  },
  {
    path:'public/chat.js',
    baseSha:'ed19295efb46ec2f409a712c92be1ec9276bc500',
    changes:[
      ["import { createMemoryJobRunner, enqueueMemoryJob } from './js/memory_job_queue.js';",
       "import { createMemoryJobRunner, enqueueMemoryJob } from './js/memory_job_queue.js';\nimport { createCloudMemorySync } from './js/cloud_memory_sync.js';"],
      ["    return result?.applied === true || result?.duplicate === true;",
       "    if (result?.applied === true) void cloudMemorySync.sync();\n     return result?.applied === true || result?.duplicate === true;"],
      ["setInterval(() => { void memoryJobRunner.drain(); }, 30_000);",
       "setInterval(() => { void memoryJobRunner.drain(); }, 30_000);\n\n// Snapshot only stable memories and backfill archived first-person reports.\n// Neither operation wakes Rin, sends chat messages, or changes Cognitive Kernel state.\nconst cloudMemorySync=createCloudMemorySync({\n  getDiary:async()=>{const lib=await ensureMemoryReady();return lib?.loadDiary?.()||null;},\n  headers:()=>authenticatedHeaders({'Content-Type':'application/json'}),\n  storage:localStorage,log:msg=>dbg(msg)\n});\nsetTimeout(()=>{void cloudMemorySync.sync();void cloudMemorySync.backfill();},15_000);\nsetInterval(()=>{void cloudMemorySync.sync();void cloudMemorySync.backfill();},180_000);"],
      ["      enqueueMemoryJob({ id: requestId, userText: combinedUserText, assistantText: memoryText }, localStorage);",
       "      enqueueMemoryJob({ id: requestId, userText: combinedUserText, assistantText: memoryText }, localStorage);\n       void cloudMemorySync.sync();"]
    ]
  },
  {path:'public/js/release.js',baseSha:'f49191aac18540532f27a9343f823424842ee6f8',changes:[
    [BASE_RELEASE,NEXT_RELEASE]
  ]}
];
export const ADDED_FILES=[
  'db/migrations/004_autobiographical_memory.sql',
  'lib/memory-foundation/autobiography.js',
  'lib/memory-foundation/backfill.js',
  'lib/memory-foundation/snapshots.js',
  'public/js/cloud_memory_snapshot.js',
  'public/js/cloud_memory_sync.js',
  'tests/neon-memory-v2617.test.js'
];
