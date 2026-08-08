import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const read = file => readFile(path.join(root, file), 'utf8');
const exists = file => access(path.join(root, file)).then(() => true, () => false);
const fail = message => { throw new Error(message); };

const releaseSource = await read('public/js/release.js');
const release = releaseSource.match(/RIN_RELEASE_ID\s*=\s*['"]([^'"]+)['"]/)?.[1];
if (!release) fail('Release ID is missing.');

for (const htmlFile of ['public/index.html', 'public/login.html']) {
  const html = await read(htmlFile);
  if (!html.includes(`v=${release}`)) fail(`${htmlFile} does not use release ${release}.`);
  for (const match of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
    const raw = match[1].split('?')[0];
    if (raw === '/' || raw.startsWith('/api/')) continue;
    const target = raw.startsWith('/public/') ? raw.slice(1) : `public${raw}`;
    if (!await exists(target)) fail(`${htmlFile} references missing ${target}.`);
  }
}

const index = await read('public/index.html');
if ((index.match(/app_bootstrap\.js/g) || []).length !== 1) fail('Index must load exactly one application bootstrap.');
if (!index.includes('id="chatViewportShell"') || !index.includes('class="chat-viewport-shell"')) fail('Index must provide the visual viewport shell.');
if (!index.includes('id="chatWallpaper"') || !index.includes('class="chat-wallpaper"')) fail('Index must provide a fixed wallpaper layer outside the chat scroller.');
if (!index.includes('id="replyPreview"') || !index.includes('class="reply-preview"')) fail('Index must provide the message reply preview inside the existing composer.');
if (/chat\.js[^\n]*<\/script>/i.test(index)) fail('Index must not load chat.js outside the authenticated bootstrap.');

const activeSources = [
  'package.json', 'vercel.json', 'api/login.js', 'api/chat.js', 'api/memory.js', 'api/tts.js', 'api/weather.js',
  'lib/server/http.js', 'lib/server/canonical-profile.js', 'lib/chat-contract.js', 'lib/affective-contract.js', 'lib/cognition/emotional-state.js', 'lib/cognition/initiative-handoff.js', 'lib/cognition/behavior-policy.js', 'lib/cognition/response-planner.js', 'lib/cognition/response-verifier.js', 'lib/core-personality.js', 'public/chat.js', 'public/js/login.js',
  'public/index.html', 'public/login.html', 'public/js/app_bootstrap.js',
  'public/js/chat_store.js', 'public/js/rin_memory.js', 'public/js/http_client.js', 'public/js/chat_viewport.js', 'public/lib/chat-contract.js', 'public/lib/affective-contract.js', 'public/lib/stickers-v6.js', 'public/lib/sticker-contract.js'
];
const forbidden = ['stickers-v4', 'stickers-v5.test', 'response_postprocessor', '/data/rin_persona.json', '/data/rin_mind.json', '/data/rin_reasoning.json', '/data/rin_speaking_habits.json'];
for (const file of activeSources) {
  const source = await read(file);
  for (const token of forbidden) if (source.includes(token)) fail(`${file} still references ${token}.`);
}

for (const file of ['public/data/rin_prompt_profile.json', 'public/data/rin_backstory.json', 'public/data/rin_memories.json', 'public/data/rin_phrases.json', 'public/data/rin_schedule.json', 'public/data/rin_triggers.json', 'public/data/stickers-v6.json']) {
  const json = JSON.parse(await read(file));
  if (!json._schema) fail(`${file} has no _schema.`);
}


const promptProfile = JSON.parse(await read('public/data/rin_prompt_profile.json'));
const promptProfileText = JSON.stringify(promptProfile);
if (/(Кирилл|kirill|Хикари)/i.test(promptProfileText)) fail('Canonical prompt profile must not hardcode a user identity.');
if (promptProfile.relationship?.user_identity_source !== 'memory.facts.user.name_or_generic') fail('Canonical user identity source is not explicit.');

const vercel = JSON.parse(await read('vercel.json'));
const headerText = JSON.stringify(vercel.headers || []);
if (!headerText.includes('/api/(.*)') || !headerText.includes('no-store')) fail('API no-store cache policy is missing.');
if (!headerText.includes('css|js') || !headerText.includes('must-revalidate')) fail('Client revalidation cache policy is missing.');

const chat = await read('public/chat.js');
if ((chat.match(/fetchWithTimeout\('\/api\/chat'/g) || []).length !== 1) fail('Chat must have exactly one model response endpoint call.');
if (!chat.includes('shouldRefreshEnvironment')) fail('Environment refresh must feed the unified chat pipeline.');
if (!chat.includes('await memoryJobRunner.drain();')) fail('The next request must wait for prior semantic-memory work.');
if (!chat.includes('function selectReplyMessage(') || !chat.includes('replyLinkFromResponsePlan(')) fail('Chat must support manual and planned message replies.');
if (!chat.includes('prepareInnerLife') || !chat.includes('commitSuccessfulTurnState')) fail('Chat must prepare state without mutation and commit it only after a successful response.');
if (chat.includes('analyzeUserMoodImpact')) fail('Browser must not own persistent mood/relationship semantics.');
if (chat.includes('stickersLib.decideSticker(STICKERS_CFG')) fail('Active chat must not run a second local semantic sticker classifier.');
if (chat.includes('loadPromptProfileForChat')) fail('Browser must not load or submit the canonical prompt profile.');
const apiChatSource = await read('api/chat.js');
if (!apiChatSource.includes('buildServerProfile(body.profile)')) fail('Chat API must reconstruct the canonical profile on the server.');
const canonicalProfileSource = await read('lib/server/canonical-profile.js');
if (!canonicalProfileSource.includes('rin_prompt_profile.json')) fail('Server canonical-profile loader must own the prompt profile source.');
const stickerSource = await read('public/lib/stickers-v6.js');
if (!stickerSource.includes('decidePlannedSticker')) fail('Client sticker renderer must execute the server nonverbal decision.');
const initiativeSource = await read('lib/personality/initiative-controller.js');
if (!initiativeSource.includes('@deprecated Dialogue Agency v1 compatibility shim') || !initiativeSource.includes("mode: 'none'")) fail('Legacy initiative controller must be an inert compatibility shim.');
const initiativeHandoffSource = await read('lib/cognition/initiative-handoff.js');
if (!initiativeHandoffSource.includes('detectInitiativeHandoff') || !initiativeHandoffSource.includes('follow_through')) fail('Canonical initiative-handoff classifier must own direct and follow-through initiative transfer semantics.');
for (const file of ['lib/conversation-brain.js', 'lib/conversation-continuity.js', 'lib/personality/character-intent-engine.js', 'lib/cognition/behavior-policy.js']) {
  const source = await read(file);
  if (!source.includes('detectInitiativeHandoff')) fail(`${file} must consume the canonical initiative-handoff classifier.`);
}
const behaviorPolicySource = await read('lib/cognition/behavior-policy.js');
if (!behaviorPolicySource.includes('deriveBehaviorPolicy') || !behaviorPolicySource.includes('questionBudget') || !behaviorPolicySource.includes('directConversation')) fail('Behavior policy must own dialogue action, initiative, question budget and director integration.');
const responsePlannerSource = await read('lib/cognition/response-planner.js');
if (!responsePlannerSource.includes("from './behavior-policy.js'") || /function\s+(?:responseActOf|initiativeOf|shouldAskQuestion)\b/.test(responsePlannerSource)) fail('Response planner must consume the canonical behavior policy instead of choosing behavior itself.');
const corePersonalitySource = await read('lib/core-personality.js');
if (corePersonalitySource.includes('initiative-controller.js') || corePersonalitySource.includes('chooseInitiative(')) fail('Personality core must not own conversational initiative.');
const speechSource = await read('lib/personality/speech.js');
if (speechSource.includes('ask_one_specific_question') || speechSource.includes('reply_with_question')) fail('Speech style must not own question decisions.');
const emotionalResponseSource = await read('lib/personality/emotional-response.js');
if (emotionalResponseSource.includes('allowQuestion')) fail('Emotional response must not own question decisions.');
const antiGptSource = await read('lib/personality/anti-gpt.js');
if (antiGptSource.includes('removeAutomaticQuestion')) fail('Anti-GPT polish must not own question policy.');
const verifierSource = await read('lib/cognition/response-verifier.js');
if (!verifierSource.includes('question_budget_exceeded') || !verifierSource.includes('questionBudget(plan)')) fail('Response verifier must enforce the canonical question budget.');
if (!verifierSource.includes('agency_deferred')) fail('Response verifier must reject promises to act when concrete agency is required.');
const assistantVoiceSource = await read('lib/personality/assistant-voice.js');
if (!assistantVoiceSource.includes('agencyDeferral') || !assistantVoiceSource.includes('concreteAgency')) fail('Voice guard must distinguish deferred agency from a concrete scene move.');
const legacyThreads = await read('lib/memory/conversation-threads.js');
if (!legacyThreads.includes('@deprecated Foundation v1 compatibility shim') || !legacyThreads.includes('return null')) fail('Legacy conversation threads must be isolated as an inert compatibility shim.');
const habitsSource = await read('lib/personality/habits.js');
const reactionsSource = await read('lib/personality/micro-reactions.js');
if (habitsSource.includes('Это приятно.') || reactionsSource.includes('Это приятно.')) fail('Upstream voice layers must not emit phrases rejected by the downstream voice policy.');
const weatherSource = await read('api/weather.js');
if (!weatherSource.includes("'no-store'") || weatherSource.includes('max-age=60')) fail('Weather API cache policy must agree with the API no-store contract.');
const browserE2e = await read('scripts/browser-e2e.js');
if (browserE2e.includes('rin-history-v4') || browserE2e.includes('schema v4') || !browserE2e.includes('rin-history-v5')) fail('Browser E2E must enforce chat schema v5.');
if (!index.includes('chat-root theme-dark') || index.includes('prefers-color-scheme')) fail('Fresh UI must deterministically default to dark theme while allowing an explicit saved light preference.');
if (!chat.includes('DEFAULT_DEBUG_ENABLED = true')) fail('Fresh UI must default debug mode to enabled.');
if (!browserE2e.includes('fresh client must start with the dark theme') || !browserE2e.includes('debug toggle must start enabled')) fail('Browser E2E must exercise the fresh theme/debug defaults.');
const packageJson = JSON.parse(await read('package.json'));
if (!String(packageJson.scripts?.check || '').includes('e2e:browser')) fail('npm run check must invoke browser E2E.');
const chatStore = await read('public/js/chat_store.js');
const sharedChatContract = await read('public/lib/chat-contract.js');
const serverChatContract = await read('lib/chat-contract.js');
if (!/CHAT_SCHEMA_VERSION\s*=\s*5/.test(sharedChatContract) || !sharedChatContract.includes('replySnapshot')) fail('Shared ChatEvent contract must use schema v5 reply snapshots.');
if (!serverChatContract.includes("export * from '../public/lib/chat-contract.js'")) fail('Server and browser must share one ChatEvent contract source.');
if (!chatStore.includes("from '../lib/chat-contract.js'")) fail('Chat store must consume the shared ChatEvent contract.');
if (await exists('public/js/response_postprocessor.js')) fail('Legacy response postprocessor must be removed.');
if (await exists('lib/stickers-v4.js') || await exists('public/lib/stickers-v4.js')) fail('Legacy stickers v4 entrypoint must be removed.');
if (!await exists('public/data/legacy/README.md')) fail('Legacy canon must be isolated and documented.');
const memorySource = await read('public/js/rin_memory.js');
if (!memorySource.includes('navigator?.locks')) fail('Diary writes must use a cross-tab lock when the browser supports Web Locks.');
if (!/DIARY_SCHEMA_VERSION\s*=\s*4/.test(memorySource) || !memorySource.includes('commitTurnState')) fail('Diary must use transactional affective conversation state schema v4.');
if (!memorySource.includes("from '../lib/affective-contract.js'")) fail('Browser diary must consume the shared affective contract.');
if (!memorySource.includes("from '../lib/intent-contract.js'") || !memorySource.includes("rin-conversation-state-v3") || !memorySource.includes('rinIntent')) fail('Browser diary must persist shared persistent intent state in conversation-state v3.');
const sharedAffective = await read('public/lib/affective-contract.js');
const serverAffective = await read('lib/affective-contract.js');
const affectiveEngine = await read('lib/cognition/emotional-state.js');
const impactShim = await read('lib/cognition/turn-state-impact.js');
if (!sharedAffective.includes("AFFECTIVE_STATE_SCHEMA = 'rin-affective-state-v1'") || !sharedAffective.includes("RELATIONSHIP_STATE_SCHEMA = 'rin-relationship-state-v2'")) fail('Shared affective contract schemas are missing.');
if (!serverAffective.includes("export * from '../public/lib/affective-contract.js'")) fail('Server and browser must share one affective contract source.');
const sharedIntent = await read('public/lib/intent-contract.js');
const serverIntent = await read('lib/intent-contract.js');
const persistentIntentEngine = await read('lib/cognition/persistent-intent.js');
if (!sharedIntent.includes("RIN_INTENT_SCHEMA = 'rin-persistent-intent-v1'") || !sharedIntent.includes('completionCondition') || !sharedIntent.includes('abandonmentCondition')) fail('Shared persistent intent contract is incomplete.');
if (!serverIntent.includes("export * from '../public/lib/intent-contract.js'")) fail('Server and browser must share one persistent intent contract source.');
if (!persistentIntentEngine.includes('advancePersistentIntent') || !persistentIntentEngine.includes('persistentIntentInstruction')) fail('Persistent intent engine must own intent lifecycle and prompt instruction.');
if (!affectiveEngine.includes('buildAffectiveTurn') || !affectiveEngine.includes('deriveRelationshipState')) fail('Canonical affective engine must own emotion and relationship transitions.');
if (!impactShim.includes('buildAffectiveTurn') || /романтическ|ревност|обнимаю|комплимент/iu.test(impactShim)) fail('Legacy turn-state impact module must be a semantic-free compatibility shim.');
const cognitionContract = await read('lib/cognition/cognitive-contract.js');
if (!cognitionContract.includes("rin-state-transition-v3") || !cognitionContract.includes('emotionalState') || !cognitionContract.includes('relationshipState') || !cognitionContract.includes('rinIntent')) fail('State transition v3 must carry affective and persistent intent state.');
if (!cognitionContract.includes('normalizeBehaviorPolicy') || !cognitionContract.includes('questionBudget')) fail('Response plan contract must carry canonical behavior and question budget.');
if (!browserE2e.includes("rin-state-transition-v3") || !browserE2e.includes('rin-affective-state-v1') || !browserE2e.includes('rin-persistent-intent-v1')) fail('Browser E2E must exercise affective and persistent-intent state contracts.');



const stickerContractUrl = pathToFileURL(path.join(root, 'public/lib/sticker-contract.js')).href;
const stickerContract = await import(`${stickerContractUrl}?build-smoke=${Date.now()}`);
const stickerConfig = JSON.parse(await read('public/data/stickers-v6.json'));
const { readdir } = await import('node:fs/promises');
const stickerAssets = new Set((await readdir(path.join(root, 'public/stickers'))).map(file => `/stickers/${file}`));
const stickerValidation = stickerContract.validateStickerConfig(stickerConfig, stickerAssets);
if (!stickerValidation.ok) fail(`Sticker manifest invalid: ${stickerValidation.errors.join('; ')}`);
if (stickerAssets.size !== 34) fail(`Expected 34 sticker assets, found ${stickerAssets.size}.`);

const httpModuleUrl = pathToFileURL(path.join(root, 'lib/server/http.js')).href;
const httpModule = await import(`${httpModuleUrl}?build-smoke=${Date.now()}`);
for (const name of ['readJsonBody', 'requestPin', 'requirePin', 'fetchWithTimeout', 'publicError']) {
  if (typeof httpModule[name] !== 'function') fail(`lib/server/http.js must export ${name}().`);
}

const viewportModuleUrl = pathToFileURL(path.join(root, 'public/js/chat_viewport.js')).href;
const viewportModule = await import(`${viewportModuleUrl}?build-smoke=${Date.now()}`);
for (const name of ['resolveViewportMetrics', 'resolveViewportHeight', 'isNearChatBottom', 'createChatViewportController']) {
  if (typeof viewportModule[name] !== 'function') fail(`public/js/chat_viewport.js must export ${name}().`);
}

for (const apiFile of ['login', 'chat', 'memory', 'tts', 'weather']) {
  const moduleUrl = pathToFileURL(path.join(root, `api/${apiFile}.js`)).href;
  const apiModule = await import(`${moduleUrl}?build-smoke=${Date.now()}`);
  if (typeof apiModule.default !== 'function') fail(`api/${apiFile}.js must export a default handler.`);
}

console.log(`Build smoke OK: release ${release}, authenticated bootstrap, API entrypoints, active assets and cache policy verified.`);
