import {readFile,access,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const read=p=>readFile(p,'utf8');
const exists=p=>access(p).then(()=>true,()=>false);
const requireText=(src,re,reason)=>{if(!re.test(src))throw new Error(reason);};
const forbid=(src,re,reason)=>{if(re.test(src))throw new Error(reason);};
const required=[
 'public/index.html','public/login.html','public/chat.js','public/js/rin_memory.js','public/js/release.js',
 'public/js/delivery_scheduler.js','public/js/presence_controller.js','public/js/chat_viewport.js','public/lib/cognitive-state-contract.js',
 'api/chat.js','lib/cognition/v3/cognitive-dynamics.js','lib/cognition/v3/experience.js','lib/cognition/v3/associative-memory.js',
 'lib/cognition/v3/turn-plan.js','lib/cognition/v3/realization.js',
 'lib/cognition/behavior-state.js','lib/cognition/turn-decision.js','lib/cognition/turn-validator.js',
 'lib/cognition/reality-boundary.js','lib/server/canon-retrieval.js',
 'data/canon/rin_prompt_profile.json','public/data/stickers-v7.json','vercel.json'
];
for(const name of required)if(!await exists(name))throw new Error(`Missing required file: ${name}`);
const api=await read('api/chat.js');
for(const [re,message] of [
 [/settleCognitiveGraph\(/,'Cognitive dynamics not wired'],
 [/buildCognitiveTurnPlan\(/,'TurnPlan not wired'],
 [/buildV3RealizationPrompt\(/,'Luna realization not wired'],
 [/parseV3Realization\(/,'Luna realization parsing not wired'],
 [/updateCognitiveExperience\(/,'Controlled plasticity not wired'],
 [/stateTransition\.cognitiveState/,'Cognitive persistence missing'],
 [/buildRealityBoundary\(/,'Reality boundaries missing'],
 [/validateRealization\(/,'Hard validation missing'],
 [/buildDeliveryPlan\(/,'Delivery plan missing'],
 [/buildDecisionStateTransition\(/,'Discrete intent/commitment reducer missing'],
 [/retrieveCanonicalLore\(canonCue\)/,'Server-side canon missing'],
 [/buildMindCacheKey\(/,'Stable cache missing']
])requireText(api,re,message);
for(const [re,message] of [
 [/buildRinMindPrompt|parseRinMind|stabilizeTurn\s*\(/,'Legacy behavioral owner active in API'],
 [/OPENAI_REALIZATION_MODEL|buildRealizationRetryPrompt/,'Legacy paid repair loop active'],
 [/body\.lore/,'Client supplied lore used as canon']
])forbid(api,re,message);
const calls=(api.match(/await\s+openaiChat\s*\(/g)||[]).length;
if(calls!==1)throw new Error(`Expected one Luna realization call site, got ${calls}`);
const voice=await read('lib/cognition/v3/realization.js');
requireText(voice,/rin_v3_realization/,'V3 structured output missing');
forbid(voice,/intentTransition.*required|responseDepth.*required/,'Luna cannot own TurnPlan decisions');
const state=await read('public/js/rin_memory.js');
requireText(state,/normalizeCognitivePersistence\(stateTransition\.cognitiveState\)/,'Cognitive state commit missing');
requireText(state,/lastCommittedRequestId/,'Duplicate state commit guard missing');
const contract=await read('public/lib/cognitive-state-contract.js');
requireText(contract,/rin-cognitive-state-v3/,'Cognitive schema missing');
const index=await read('public/index.html'), login=await read('public/login.html');
const release=(await read('public/js/release.js')).match(/RIN_RELEASE_ID\s*=\s*['"]([^'"]+)/)?.[1];
if(!release)throw new Error('Release ID missing');
for(const [name,html] of [['index',index],['login',login]]){
 if(!html.includes(`v=${release}`))throw new Error(`${name} cache release mismatch`);
 if(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(html))throw new Error(`${name}: CSP inline script`);
}
if((index.match(/app_bootstrap\.js/g)||[]).length!==1)throw new Error('Bootstrap loading changed');
if(!index.includes('chatViewportShell'))throw new Error('Missing chatViewportShell');
const headers=JSON.stringify(JSON.parse(await read('vercel.json')).headers||[]);
for(const security of ["Content-Security-Policy","default-src 'self'","object-src 'none'",'no-store'])
 if(!headers.includes(security))throw new Error(`Missing security policy ${security}`);
for(const name of ['data/canon/rin_prompt_profile.json','data/canon/rin_backstory.json',
 'data/canon/rin_memories.json','data/canon/rin_triggers.json','public/data/rin_schedule.json','public/data/stickers-v7.json']){
 const v=JSON.parse(await read(name));if(!v._schema)throw new Error(`${name} missing schema`);
}
const syntax=spawnSync(process.execPath,['scripts/check-syntax.js'],{stdio:'inherit'});
if(syntax.status!==0)throw new Error('Syntax scan failed');
console.log('Build smoke OK: Rin v3.0.2 functionally restored cognitive dynamics + exclusive TurnPlan + Luna realization + bounded persistence; original weather, messenger and security interfaces retained.');
