import { access, readFile, readdir } from 'node:fs/promises';
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
  for (const match of html.matchAll(/(?:src|href)="(\/[^\"]+)"/g)) {
    const raw = match[1].split('?')[0];
    if (raw === '/' || raw.startsWith('/api/')) continue;
    const target = raw.startsWith('/public/') ? raw.slice(1) : `public${raw}`;
    if (!await exists(target)) fail(`${htmlFile} references missing ${target}.`);
  }
}

const index = await read('public/index.html');
if ((index.match(/app_bootstrap\.js/g) || []).length !== 1) fail('Index must load exactly one application bootstrap.');
if (!index.includes('id="chatViewportShell"') || !index.includes('class="chat-viewport-shell"')) fail('Index must keep the visual viewport shell.');
if (!index.includes('id="chatWallpaper"') || !index.includes('class="chat-wallpaper"')) fail('Index must keep the wallpaper layer.');
if (!index.includes('id="replyPreview"') || !index.includes('class="reply-preview"')) fail('Index must keep reply-to-selected UI.');
const loginSource = await read('public/js/login.js');
if (!loginSource.includes("classList.add('login-ready')")) fail('Login must expose an explicit bootstrap readiness boundary.');
if (!/id=\"peerStatus\"[^>]*>не в сети<\/div>/.test(index)) fail('Initial peer status must be «не в сети».');
if (/chat\.js[^\n]*<\/script>/i.test(index)) fail('Index must not load chat.js outside authenticated bootstrap.');

const activeSources = [
  'api/chat.js', 'api/memory.js', 'api/tts.js', 'api/weather.js',
  'lib/server/http.js', 'lib/server/canonical-profile.js', 'lib/server/canon-retrieval.js',
  'lib/cognition/kernel-state.js', 'lib/cognition/cognitive-kernel.js', 'lib/cognition/turn-decision.js',
  'lib/cognition/turn-validator.js', 'lib/cognition/sticker-catalog.js', 'lib/cognition/sticker-state.js', 'lib/cognition/sticker-intents.js', 'lib/cognition/sticker-selector.js', 'lib/cognition/emotional-state.js',
  'lib/conversation-brain.js', 'lib/conversation-continuity.js', 'lib/cognition/dialogue-state.js',
  'lib/cognition/memory-retrieval.js', 'lib/cognition/reality-boundary.js', 'lib/personality/rin-realization.js',
  'public/chat.js', 'public/js/chat_store.js', 'public/js/delivery_scheduler.js', 'public/js/presence_controller.js',
  'public/js/storage.js', 'public/js/initiation_state.js', 'public/js/conversation_policy.js', 'public/js/persona_ui.js', 'public/js/wallpaper_store.js',
  'public/js/rin_memory.js', 'public/js/rin_lore.js', 'public/lib/chat-contract.js', 'public/lib/inner-life-contract.js',
  'public/lib/intent-contract.js', 'public/lib/sticker-contract.js', 'public/lib/stickers-v7.js'
];
const forbidden = ['stickers-v4', 'response_postprocessor', '/data/rin_persona.json', '/data/rin_mind.json', '/data/rin_reasoning.json', '/data/rin_speaking_habits.json'];
for (const file of activeSources) {
  const source = await read(file);
  for (const token of forbidden) if (source.includes(token)) fail(`${file} still references obsolete active source ${token}.`);
}

for (const file of ['data/canon/rin_prompt_profile.json', 'data/canon/rin_backstory.json', 'data/canon/rin_memories.json', 'public/data/rin_schedule.json', 'data/canon/rin_triggers.json', 'public/data/stickers-v7.json']) {
  const json = JSON.parse(await read(file));
  if (!json._schema) fail(`${file} has no _schema.`);
}

const promptProfile = JSON.parse(await read('data/canon/rin_prompt_profile.json'));
const activePromptText = JSON.stringify({ reference_character: promptProfile.reference_character, voice: promptProfile.voice, cognitive_policy: promptProfile.cognitive_policy, guardrails: promptProfile.guardrails });
if (promptProfile.version !== 'prompt-profile-v9-reference-character-kernel') fail('Reference-character prompt profile version is not active.');
if (!promptProfile.reference_character?.core?.includes('не пытается выглядеть живой')) fail('Reference Rin core is missing.');
if (!Array.isArray(promptProfile.reference_dialogue_examples) || promptProfile.reference_dialogue_examples.length < 5) fail('Reference dialogue examples are incomplete.');
if (/behavior policy|RESPONSE PLAN/iu.test(activePromptText)) fail('Active reference prompt still delegates decisions to a legacy behavior planner.');
if (promptProfile.relationship?.private_name !== 'Хикари Ринсей') fail('Shared private name must be canonical Хикари Ринсей.');
const canonText = `${await read('data/canon/rin_backstory.json')}\n${await read('data/canon/rin_memories.json')}`;
if (/собеседник\s*\(光\)|собеседник\s*[—-]\s*свет/iu.test(canonText)) fail('Obsolete placeholder/光 etymology remains in canon.');
const benchmark = JSON.parse(await read('tests/fixtures/rin-reference-benchmark.json'));
if (benchmark.targetScore !== 90 || benchmark.liveEvaluationRequiredForClaim !== true) fail('Reference benchmark target/claim policy is invalid.');
if ((benchmark.dimensions || []).reduce((sum, item) => sum + Number(item.weight || 0), 0) !== 100 || (benchmark.scenarios || []).length !== 10) fail('Reference benchmark rubric/scenario set is incomplete.');

const vercel = JSON.parse(await read('vercel.json'));
const headerText = JSON.stringify(vercel.headers || []);
if (!headerText.includes('/api/(.*)') || !headerText.includes('no-store')) fail('API no-store cache policy is missing.');
if (!headerText.includes('css|js') || !headerText.includes('must-revalidate')) fail('Client revalidation cache policy is missing.');
if (!headerText.includes('Content-Security-Policy') || !headerText.includes("default-src 'self'") || !headerText.includes("object-src 'none'")) fail('Baseline browser security headers are missing.');
const csp = (vercel.headers || []).flatMap(rule => Array.isArray(rule?.headers) ? rule.headers : [])
  .find(header => String(header?.key || '').toLowerCase() === 'content-security-policy')?.value || '';
if (!/script-src\s+'self'/.test(csp) || /script-src[^;]*'unsafe-inline'/.test(csp)) fail('Script CSP must stay strict and self-only.');
if (/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(index)) fail('Strict script CSP forbids inline scripts in public/index.html.');
if (/\son[a-z]+\s*=/i.test(index)) fail('Strict script CSP forbids inline event handlers in public/index.html.');
if ((index.match(/theme_bootstrap\.js/g) || []).length !== 1 || !await exists('public/js/theme_bootstrap.js')) fail('Theme bootstrap must be one external CSP-compatible script.');

const apiChat = await read('api/chat.js');
for (const required of ['cognitive-kernel.js', 'kernel-state.js', 'turn-decision.js', 'turn-validator.js', 'sticker-state.js', 'sticker-selector.js', 'rin-realization.js', 'canon-retrieval.js']) {
  if (!apiChat.includes(required)) fail(`Chat API must use ${required}.`);
}
const removedDecisionOwners = [
  'lib/cognition/behavior-policy.js', 'lib/cognition/conversation-director.js', 'lib/cognition/index.js',
  'lib/cognition/open-loops.js', 'lib/cognition/persistent-intent.js', 'lib/cognition/response-planner.js',
  'lib/cognition/response-verifier.js', 'lib/cognition/turn-state-impact.js', 'lib/core-personality.js',
  'lib/memory/conversation-threads.js', 'lib/personality/anti-gpt.js', 'lib/personality/assistant-voice.js',
  'lib/personality/character-intent-engine.js', 'lib/personality/character.js', 'lib/personality/continuity.js',
  'lib/personality/emotional-response.js', 'lib/personality/habits.js', 'lib/personality/humanizer.js',
  'lib/personality/initiative-controller.js', 'lib/personality/inner-life.js', 'lib/personality/micro-reactions.js',
  'lib/personality/mood.js', 'lib/personality/relationship-engine.js', 'lib/personality/relationship.js',
  'lib/personality/rhythm-controller.js', 'lib/personality/speech.js', 'lib/personality/utils.js',
  'lib/personality/voice-policy.js', 'lib/stickers-v6.js', 'public/lib/stickers-v6.js'
];
for (const file of removedDecisionOwners) if (await exists(file)) fail(`Competing legacy owner must be physically absent: ${file}.`);
for (const legacyOwner of removedDecisionOwners.map(file => path.basename(file))) {
  if (apiChat.includes(legacyOwner)) fail(`Chat API still imports competing decision owner ${legacyOwner}.`);
}
if (/gpt-4o-mini/.test(apiChat)) fail('User-facing chat cognition must not route by short-model gpt-4o-mini.');
if (/normalize\(input\.(?:hint|pool)|trigger\?\.(?:hint|pool)/.test(apiChat)) fail('Proactive trigger must carry event metadata only; content hints/pools are forbidden.');
if (!apiChat.includes('OPENAI_DECISION_MODEL') || !apiChat.includes('OPENAI_REALIZATION_MODEL')) fail('Chat must route models by cognitive role.');
if (!apiChat.includes("'gpt-4.1'") || /OPENAI_LONG_MODEL|['"]gpt-4o['"]/.test(apiChat)) fail('Chat model defaults must use the current explicit role fallback without deprecated compatibility aliases.');
if (!apiChat.includes('retrieveCanonicalLore(canonCue)') || /body\.lore/.test(apiChat)) fail('Canonical lore must be server-retrieved and client lore must not be trusted.');
if (!apiChat.includes('validateTurnDecisionConstraints') || !apiChat.includes('validateRealization')) fail('Deterministic decision/realization validation is missing.');
if (!apiChat.includes('buildRealizationRetryInstruction')) fail('Realization retry must be constraint-aware.');
const realizationSource = await read('lib/personality/rin-realization.js');
if (/text:\s*clean\(raw\[index\]\?\.text,\s*plan\.maxChars/.test(realizationSource) || /raw\[index\]\?\.text[\s\S]{0,100}\.slice\(0,\s*plan\.maxChars/.test(realizationSource)) fail('Voice Realization must not mechanically clip model text to maxChars.');
if (!realizationSource.includes('Пользователь — мужчина') || !realizationSource.includes('buildRealizationRetryInstruction')) fail('Realization gender/completeness contract is missing.');
if (!realizationSource.includes('Недавние реплики Рин') || !realizationSource.includes('не воспроизводи уже сказанную Рин реплику')) fail('Realization must receive and avoid recent Rin wording.');
const validatorSource = await read('lib/cognition/turn-validator.js');
if (!validatorSource.includes('user_feminine_address') || !validatorSource.includes('segment_${index}_too_long')) fail('Realization validator must enforce gender and raw length before delivery.');
if (!validatorSource.includes('recent_assistant_duplicate') || !validatorSource.includes('recent_assistant_near_duplicate') || !validatorSource.includes('duplicate_text_segments')) fail('Realization validator must reject substantial repeated wording before delivery.');
if (!apiChat.includes('recentHistory: state?.recentHistory') || !apiChat.includes('currentUserText: state?.userText')) fail('Chat API must validate Realization against current user text and recent dialogue.');
const kernelSource = await read('lib/cognition/cognitive-kernel.js');
if (!kernelSource.includes('самостоятельных conversational moves') || !kernelSource.includes('не дроби одну простую мысль')) fail('Kernel multi-message completeness contract is missing.');
if (!kernelSource.includes('Встречный интерес — часть живого личного разговора') || !kernelSource.includes('oneSidedQuestionPattern=true') || !kernelSource.includes('не счётчик «каждые N ходов»')) fail('Kernel reciprocal-curiosity contract is missing or has become a scheduled-question rule.');
if (/responsePlan|coreDecision|conversationBrain|compatibilityResponsePlan/.test(apiChat)) fail('Chat API must not emit or reconstruct legacy decision-plan compatibility fields.');
if (/buildTurnDelivery|\n\s*delivery,/.test(apiChat)) fail('DeliveryPlan must be the only server delivery representation.');
if (/latestUserTarget|\breplyTarget\s*=\s*latestUserTarget/.test(apiChat)) fail('Chat API must not auto-project the latest user message into a visual reply link.');
if (!apiChat.includes('visualReplyFromDecision') || !apiChat.includes('visualReply,')) fail('Chat API must materialize visual replies only from the Cognitive Kernel decision.');
if (!apiChat.includes('isStickerIntentResolvable') || !apiChat.includes('validateDecisionResources')) fail('Sticker resource validation must reject unresolved semantic intents before realization.');
const transitionContract = await read('lib/cognition/cognitive-contract.js');
const turnDecisionSource = await read('lib/cognition/turn-decision.js');
if (/moodDelta|relationshipDelta|emotionalTrace/.test(transitionContract)) fail('StateTransition contract must expose canonical state snapshots only.');
if (/moodDelta|relationshipDelta|emotionalTrace/.test(turnDecisionSource)) fail('TurnDecision transition projection must not recreate legacy affective delta/trace writers.');

const kernel = await read('lib/cognition/cognitive-kernel.js');
if (!kernel.includes('ЕДИНСТВЕННЫЙ ВЛАДЕЛЕЦ РЕШЕНИЯ') || !kernel.includes('multi_message') || !kernel.includes('explicit_fiction')) fail('Cognitive Kernel contract is incomplete.');
if (!kernel.includes('Terminal intent tombstone')) fail('Kernel must explicitly protect terminal intents from resurrection.');
const kernelState = await read('lib/cognition/kernel-state.js');
if (kernelState.includes('brain?.obligations') || kernelState.includes('brain?.responseFocus')) fail('Active Perception must not forward legacy behavioral directives into the Kernel.');
if (!kernelState.includes('user_handed_initiative') || !kernelState.includes('direct_question_present')) fail('Active Perception semantic signals are incomplete.');
if (!kernelState.includes('visualReplyCandidatesFromEvents') || !kernelState.includes('events.slice(0, -1)')) fail('KernelState must expose only earlier current-batch events as semantic visual-reply candidates.');
if (!kernelState.includes('reciprocitySnapshot') || !kernelState.includes('oneSidedQuestionPattern')) fail('KernelState must expose observational question reciprocity without a new decision owner.');
const perception = await read('lib/conversation-brain.js');
if (/responseFocus|obligations|shouldClarify|ambiguity\.rule|activeScene[^\n]*goal/.test(perception)) fail('Conversation Perception must describe signals only, never prescribe response behavior.');
const continuity = await read('lib/conversation-continuity.js');
if (/SCENE_GOALS|sceneGoal|continuityInstruction/.test(continuity)) fail('Conversation continuity must not own response goals/instructions.');
const dialogueState = await read('lib/cognition/dialogue-state.js');
if (/sceneGoal|dialogueStateInstruction/.test(dialogueState)) fail('DialogueState must remain descriptive state only.');
if (/scene:\s*\{[\s\S]{0,400}goal:/.test(kernelState) || /ambiguity[^\n]*rule/.test(kernelState)) fail('KernelState must not receive prescriptive scene/ambiguity rules.');
const realization = await read('lib/personality/rin-realization.js');
if (!realization.includes('ТОЛЬКО ФОРМУЛИРОВКА УЖЕ ПРИНЯТОГО РЕШЕНИЯ') || !realization.includes('Не меняй act, intent, delivery')) fail('Realization must be subordinate to frozen TurnDecision.');
if (!realization.includes('canonicalContext: state?.lore')) fail('Realization must receive the same retrieved canonical context as the Kernel.');
const turnDecision = await read('lib/cognition/turn-decision.js');
if (!turnDecision.includes("TURN_DECISION_SCHEMA = 'rin-turn-decision-v1'") || !turnDecision.includes('applyIntentTransition') || !turnDecision.includes('decisionOpenLoopUpdates')) fail('TurnDecision must own intent/open-loop transitions.');
if (!turnDecision.includes('Normalization is deliberately non-semantic') || /purpose:\s*'afterthought'/.test(turnDecision)) fail('TurnDecision normalization must not synthesize conversational beats.');
const validator = await read('lib/cognition/turn-validator.js');
if (/replacementDecision|fallbackDecision/.test(validator)) fail('Validator must not replan behavior.');
const stickerSelector = await read('lib/cognition/sticker-selector.js');
if (!stickerSelector.includes('if (!sticker) return null')) fail('Sticker selector must return unresolved for unknown semantic intent.');
if (/\|\|\s*\(config\.stickers[^\n]+warm_smile|fallbackSticker|defaultSticker/.test(stickerSelector)) fail('Sticker selector must not invent a semantic fallback asset.');
if (!stickerSelector.includes('Delivery semantics belong to TurnDecision')) fail('Sticker selector ownership contract is not explicit.');
const canonRetriever = await read('lib/server/canon-retrieval.js');
if (!canonRetriever.includes('rin_backstory.json') || !canonRetriever.includes('rin_memories.json') || !canonRetriever.includes('rin_prompt_profile.json') || !canonRetriever.includes("source: 'server_canon_store'")) fail('Server Canon Store retrieval is incomplete.');
const realityBoundary = await read('lib/cognition/reality-boundary.js');
if (/collect\(profile\?\.prompt_profile\|\|\{\}\)/.test(realityBoundary)) fail('Reality boundary must not treat the whole prompt profile/reference dialogue as canonical provenance.');
if (!realityBoundary.includes('Reference dialogue, voice/personality rules')) fail('Reality boundary must explicitly separate behavior guidance from biography.');

const memoryApi = await read('api/memory.js');
if (!memoryApi.includes("'gpt-4o-mini'")) fail('Durable memory extraction should keep the auxiliary mini model.');
if (/result\.openLoops|result\.resolvedLoops|openLoops:\s*\[|resolvedLoops:\s*\[/.test(memoryApi)) fail('Durable memory API must not own conversational open loops.');

const chat = await read('public/chat.js');
if (/moodDelta|relationshipDelta/.test(chat)) fail('Client turn boundary must not pass affective deltas beside StateTransition snapshots.');
if ((chat.match(/fetchWithTimeout\('\/api\/chat'/g) || []).length !== 1 || !chat.includes('requestChatTurn')) fail('Reactive and proactive chat must share one request helper.');
if (!chat.includes('createInputAggregator') || !chat.includes('humanDeliveryScheduler')) fail('Human input aggregation/delivery scheduler is missing.');
if (!chat.includes('prepareAssistantDelivery') || !chat.includes('persistPreparedDeliveryOrThrow') || !chat.includes('deliverCommittedAssistantTurn')) fail('Prepared multi-segment delivery lifecycle is missing.');
if (!chat.includes('inputEpoch') || !chat.includes('requeueInterruptedBatch')) fail('Prepared turns must be cancellable before commit.');
if (chat.includes('decidePlannedSticker') || chat.includes('stickersLib.decideSticker(STICKERS_CFG')) fail('Client must not make a second semantic sticker decision.');
if (/data\?\.delivery\?/.test(chat)) fail('Client must execute DeliveryPlan directly, not a parallel legacy delivery projection.');
if (chat.includes('lorePayloadForApi') || /\blore:\s*lore/.test(chat)) fail('Client must not be a canon writer for the model.');
if (!chat.includes('isInternalNonverbalMetaText(text)')) fail('Final text delivery leak barrier is missing.');
if (!chat.includes('resumePendingAssistantDeliveries') || !chat.includes('reconcilePendingAssistantDeliveryCommitState')) fail('Pending committed delivery must reconcile semantic commit and recover after reload.');
if (!chat.includes('await memoryJobRunner.drain();')) fail('Next request must wait for pending semantic-memory work.');
if (chat.includes('analyzeUserMoodImpact')) fail('Browser must not own persistent mood/relationship semantics.');

const reactiveStart = chat.indexOf('async function processUserBatch');
const reactiveEnd = chat.indexOf('async function refreshRinEnv');
const reactive = chat.slice(reactiveStart, reactiveEnd);
for (const token of ['preparedDelivery = await prepareAssistantDelivery', 'waitBeforeFirstSegment', 'persistPreparedDeliveryOrThrow(preparedDelivery)', 'await commitSuccessfulTurnState', 'await deliverCommittedAssistantTurn']) {
  if (!reactive.includes(token)) fail(`Reactive lifecycle missing ${token}.`);
}
if (!(reactive.indexOf('waitBeforeFirstSegment') < reactive.indexOf('persistPreparedDeliveryOrThrow(preparedDelivery)') && reactive.indexOf('persistPreparedDeliveryOrThrow(preparedDelivery)') < reactive.indexOf('await commitSuccessfulTurnState') && reactive.indexOf('await commitSuccessfulTurnState') < reactive.indexOf('await deliverCommittedAssistantTurn'))) fail('Reactive lifecycle order must be human wait -> invisible delivery journal -> semantic commit -> delivery.');
if (!reactive.includes('if (stateCommitted)') || !reactive.includes('markUserBatchComplete(ids)')) fail('Post-commit client errors must not make the user batch semantically retriable.');

const proactive = chat.slice(chat.indexOf('async function requestAssistantInitiative'), chat.indexOf('async function tryInitiateBySchedule'));
if (!(proactive.indexOf('prepareAssistantDelivery') < proactive.indexOf('waitBeforeFirstSegment') && proactive.indexOf('waitBeforeFirstSegment') < proactive.indexOf('persistPreparedDeliveryOrThrow(preparedDelivery)') && proactive.indexOf('persistPreparedDeliveryOrThrow(preparedDelivery)') < proactive.indexOf('await commitSuccessfulTurnState'))) fail('Proactive turn must use the same journal-before-commit boundary.');

const presence = await read('public/js/presence_controller.js');
if (!presence.includes("offline: 'не в сети'") || !presence.includes("typing: 'печатает…'")) fail('Presence labels are not canonical.');
if (/readBeforeTyping|firstReturn|returnAfterIdle/.test(presence)) fail('Presence controller must not own human read/compose timing.');
const scheduler = await read('public/js/delivery_scheduler.js');
if (!/USER_AGGREGATION_WINDOW_MS\s*=\s*1250/.test(scheduler) || !scheduler.includes('waitBeforeFirstSegment') || !scheduler.includes('waitBetweenSegments') || !scheduler.includes('waitBeforeSilence')) fail('HumanDeliveryScheduler contract is incomplete.');

const sharedChat = await read('public/lib/chat-contract.js');
const serverChat = await read('lib/chat-contract.js');
const chatStore = await read('public/js/chat_store.js');
if (!/CHAT_SCHEMA_VERSION\s*=\s*6/.test(sharedChat) || !sharedChat.includes('turnId') || !sharedChat.includes('segmentId') || !sharedChat.includes('segmentIndex')) fail('Shared ChatEvent contract must use schema v6 segment metadata.');
if (!serverChat.includes("export * from '../public/lib/chat-contract.js'")) fail('Server/browser must share one ChatEvent contract source.');
if (!chatStore.includes("CHAT_STORAGE_KEY = 'rin-history-v6'")) fail('Chat history storage must migrate to v6.');
if (!chatStore.includes('reconcilePendingDeliveryHistory')) fail('Chat store must reconcile pending delivery journal against semantic commit id.');

const memorySource = await read('public/js/rin_memory.js');
if (!memorySource.includes('navigator?.locks') || !memorySource.includes('commitTurnState')) fail('Diary transactional write boundary is missing.');
if (!memorySource.includes("from '../lib/inner-life-contract.js'")) fail('Browser diary must use shared InnerLife contract.');
if (!memorySource.includes("realityMode:'simulated_character_world'") && !memorySource.includes("realityMode: 'simulated_character_world'")) fail('InnerLife must carry simulated-character-world provenance.');
if (/export\s+async\s+function\s+(?:addOpenLoop|resolveOpenLoop|updateMood|updateRelationship|advanceInnerLife|rememberStickerEmotion|advanceStickerEmotion|resolveStickerEmotion)|buildSystemPrompt/.test(memorySource)) fail('Browser diary must not expose alternate semantic writers/prompt owners.');
const commitTurnSource = memorySource.slice(memorySource.indexOf('export async function commitTurnState'), memorySource.indexOf('export async function upsertFact'));
if (/moodDelta|relationshipDelta|transition\.emotionalTrace/.test(commitTurnSource)) fail('commitTurnState must persist canonical snapshots only, never legacy deltas/traces.');
if (/\bopenLoops\s*:\s*\[\]/.test(memorySource.split('function emptyDiary')[1]?.split('function')[0] || '')) fail('Top-level diary openLoops must not exist beside ConversationState.openLoops.');
const intentContract = await read('public/lib/intent-contract.js');
if (!intentContract.includes("source: clean(input.source, 100) || 'cognitive_kernel'")) fail('PersistentIntent default provenance must be Cognitive Kernel.');
if (!intentContract.includes("status === 'completed' || status === 'cancelled'")) fail('Only completed/cancelled intents may receive terminal tombstones.');
const clientStickers = await read('public/lib/stickers-v7.js');
if (/decideSticker|decidePlannedSticker|deriveStickerSignals|Math\.random/.test(clientStickers)) fail('Client sticker module must execute/telemetry only, never decide semantics/probability.');
const clientLore = await read('public/js/rin_lore.js');
if (/rin_backstory|rin_memories|rin_triggers|rin_phrases|pickGreeting|pickInitiationPhrase|buildLorePayload|lorePayloadForApi|commitLorePayload/.test(clientLore)) fail('Client lore module must own schedule metadata only, not canon or proactive content.');
if (!clientLore.includes('export async function getSchedule')) fail('Client lore schedule-only API is missing.');
if (/loadLoreData/.test(chat)) fail('Chat client must not call removed legacy lore API loadLoreData.');
if (!chat.includes('module?.getSchedule')) fail('Chat client must validate the schedule-only lore API.');
if (!chat.includes('replyLinkFromTarget(data?.visualReply)')) fail('Client must render only explicit semantic visualReply metadata from the server.');
if (/defaultInReplyTo|replyLinkFromTarget\(data\?\.replyTarget\)/.test(chat)) fail('Client must not auto-quote the latest user message.');
const stickerIntentContract = await read('lib/cognition/sticker-intents.js');
if (!stickerIntentContract.includes('STICKER_INTENT_VALUES') || !stickerIntentContract.includes('tender_kiss')) fail('Finite semantic sticker vocabulary is missing.');
const stickerStateSource = await read('lib/cognition/sticker-state.js');
if (!stickerStateSource.includes('rollingWindowTurns') || !stickerStateSource.includes('rolling_budget_exhausted') || !stickerStateSource.includes('recentAssetIds')) fail('StickerState rolling frequency contract is incomplete.');
if (/Math\.random|selectStickerForIntent/.test(stickerStateSource)) fail('StickerState may constrain availability but must not select concrete assets or use random vetoes.');
const stickerCatalogSource = await read('lib/cognition/sticker-catalog.js');
if (!stickerCatalogSource.includes('stickerCatalogDefaults') || !stickerCatalogSource.includes('stickerCatalogItems')) fail('Neutral sticker catalog owner is missing.');
const stickerSelectorSource = await read('lib/cognition/sticker-selector.js');
if (!stickerSelectorSource.includes('semantic_rank_with_recent_rotation') || !stickerSelectorSource.includes('recentStickerIds')) fail('Sticker selector must rotate semantically equivalent assets using recent history.');
if (/Math\.random/.test(stickerSelectorSource)) fail('Sticker asset rotation must be deterministic, not random.');
if (!kernel.includes('stickerState?.available === true') || /frequencyPreference=/.test(kernel)) fail('Kernel must consume hard StickerState availability rather than interpret probability as a prompt preference.');
if (!kernelState.includes('stickerState: state.stickerState')) fail('Compact KernelState must expose StickerState for live diagnostics.');
if (!apiChat.includes('buildStickerState') || !apiChat.includes('recentStickerIds: stickerState?.recentAssetIds')) fail('Chat API must derive StickerState from server history and pass recent assets to selector.');
if (!chat.includes("raw === '' ? true : raw === '1'")) fail('Fresh sticker safe-mode must default to enabled.');
const turnDecisionContract = await read('lib/cognition/turn-decision.js');
if (!turnDecisionContract.includes('buildTurnDecisionJsonSchema') || !turnDecisionContract.includes('deriveDeliveryMode')) fail('TurnDecision must use state-constrained schema and structural delivery projection.');
if (!turnDecisionContract.includes('replyLink') || !turnDecisionContract.includes('replyCandidateIds')) fail('TurnDecision must own semantic visual-reply selection inside a constrained candidate set.');
if (!kernel.includes('visualReplyCandidates') || !kernel.includes('Никогда не цитируй единственное или последнее сообщение')) fail('Cognitive Kernel visual-reply policy is missing.');
if (await exists('public/data/rin_phrases.json')) fail('Legacy proactive phrase pool must be physically absent; Cognitive Kernel owns proactive content.');
const initiationPolicy = await read('public/js/conversation_policy.js');
if (/chooseConfiguredStarter|starter/i.test(initiationPolicy)) fail('InitiationPolicy must decide timing only, not proactive content.');
const innerLife = await read('public/lib/inner-life-contract.js');
if (!innerLife.includes('rin-inner-life-v3') || !innerLife.includes('activityGoal') || !innerLife.includes('recentActivities') || !innerLife.includes('realityMode') || !innerLife.includes('source')) fail('InnerLife v3 active contract is incomplete.');
if (/privateThought|continuityKey|recentThoughts|lastSpontaneousAt/.test(innerLife)) fail('InnerLife contract still exposes inactive legacy fields.');

const weather = await read('api/weather.js');
if (!weather.includes("'no-store'") || weather.includes('max-age=60')) fail('Weather API cache policy must remain no-store.');
if (!index.includes('chat-root theme-dark') || index.includes('prefers-color-scheme')) fail('Fresh UI must deterministically default to dark theme.');
if (!chat.includes('DEFAULT_DEBUG_ENABLED = true')) fail('Fresh UI must default debug mode to enabled.');

if (await exists('public/js/response_postprocessor.js')) fail('Legacy response postprocessor must remain removed.');
if (await exists('lib/stickers-v4.js') || await exists('public/lib/stickers-v4.js')) fail('Legacy sticker v4 entrypoints must remain removed.');
for (const file of ['public/data/legacy/README.md', 'public/data/legacy/rin_mind.json', 'public/data/legacy/rin_persona.json', 'public/data/legacy/rin_reasoning.json', 'public/data/legacy/rin_speaking_habits.json']) {
  if (await exists(file)) fail(`Obsolete legacy canon artifact must be physically absent: ${file}.`);
}

const stickerContractUrl = pathToFileURL(path.join(root, 'public/lib/sticker-contract.js')).href;
const stickerContract = await import(`${stickerContractUrl}?build-smoke=${Date.now()}`);
const stickerConfig = JSON.parse(await read('public/data/stickers-v7.json'));
const stickerAssets = new Set((await readdir(path.join(root, 'public/stickers'))).map(file => `/stickers/${file}`));
const stickerValidation = stickerContract.validateStickerConfig(stickerConfig, stickerAssets);
if (!stickerValidation.ok) fail(`Sticker manifest invalid: ${stickerValidation.errors.join('; ')}`);
if (stickerAssets.size !== 54) fail(`Expected 54 sticker assets, found ${stickerAssets.size}.`);
if (Number(stickerConfig.defaults?.rollingWindowTurns) !== 10 || Number(stickerConfig.defaults?.minGapAssistantTurns) !== 2) fail('Sticker manifest rolling frequency defaults are not canonical.');
if (stickerConfig.defaults?.semanticContract !== 'sticker-emotion-v2') fail('Sticker manifest semantic contract must be sticker-emotion-v2.');

const scheduleConfig = JSON.parse(await read('public/data/rin_schedule.json'));
if (scheduleConfig._schema !== 'rin-schedule-v2' || scheduleConfig.probability_semantics !== 'one_draw_per_window_when_eligible') fail('Schedule v2 must define one-draw-per-window probability semantics.');
if (!Array.isArray(scheduleConfig.windows) || scheduleConfig.windows.length !== 3 || !scheduleConfig.windows.every(item => item.id && Number.isFinite(Number(item.probability)))) fail('Schedule v2 windows are incomplete.');
if (!Number.isFinite(Number(scheduleConfig.location?.lat)) || !Number.isFinite(Number(scheduleConfig.location?.lon))) fail('Schedule location coordinates must be canonical runtime metadata.');
if (!chat.includes('createInitiationStateStore') || !chat.includes('recordAttempt(dateKey, windowKey)') || !chat.includes('initiationPolicy.pollIntervalMs')) fail('Client initiative execution must persist a single draw per schedule window.');
if (/RIN_TZ|RIN_CITY|RIN_COUNTRY|rin-init-count/.test(chat)) fail('Client chat still contains a competing schedule/timezone/initiation source.');
if (!chat.includes('persistChatHistoryMutation') || !chat.includes('HISTORY_STORAGE_FAILED')) fail('Outbound user turns must be blocked unless chat state is durably persisted.');
const wallpaperStore = await read('public/js/wallpaper_store.js');
if (!wallpaperStore.includes('indexedDBRef') || !wallpaperStore.includes("rin-media-v1")) fail('Large wallpaper media must use the IndexedDB media store.');
if (chat.includes("'rin-wallpaper-data'") || chat.includes('LS_WP_DATA')) fail('Chat runtime must not store wallpaper binary data in localStorage.');
if (!chat.includes('fetchRinWeather(schedule.location)') || !chat.includes('/api/weather?lat=')) fail('Client weather must use schedule coordinates.');
if (/query\.q|Kanazawa/.test(weather)) fail('Weather API must not use deprecated city-name geocoding.');

const personaUi = await read('public/js/persona_ui.js');
const memoryProfileSource = await read('public/js/rin_memory.js');
for (const legacyField of ['pName', 'pInstrBase', 'pStarters', 'pInitMax', 'pWin1', 'pWin2']) if (index.includes(`id="${legacyField}"`) || personaUi.includes(legacyField)) fail(`Non-executable persona control must be absent: ${legacyField}.`);
for (const liveField of ['pDesc', 'pInstrExtra', 'pKnowledge']) if (!index.includes(`id="${liveField}"`)) fail(`Executable persona control is missing: ${liveField}.`);
if (/name:\s*profile\.name|starters:|initiation:/.test(chat)) fail('Chat must send only server-supported profile overrides.');
if (/BASE_RULES|starters:|initiation:/.test(memoryProfileSource)) fail('Browser profile storage still owns canonical or non-executable fields.');

for (const name of ['rin_prompt_profile.json', 'rin_backstory.json', 'rin_memories.json', 'rin_triggers.json']) {
  if (!await exists(`data/canon/${name}`)) fail(`Server canon is missing: data/canon/${name}.`);
  if (await exists(`public/data/${name}`)) fail(`Server-only canon is still public: public/data/${name}.`);
}
for (const obsolete of ['public/lib/stickers-v6.js', 'public/data/stickers-v6.json']) if (await exists(obsolete)) fail(`Obsolete sticker v6 artifact must be physically absent: ${obsolete}.`);
if (!await exists('public/lib/stickers-v7.js') || !await exists('public/data/stickers-v7.json')) fail('Sticker v7 runtime and manifest must both exist.');

for (const [file, token] of [
  ['lib/cognition/belief-model.js', 'beliefInstruction'],
  ['lib/cognition/memory-retrieval.js', 'memoryRetrievalInstruction'],
  ['lib/cognition/reality-boundary.js', 'realityBoundaryInstruction'],
  ['lib/cognition/emotional-state.js', 'affectiveInstruction'],
  ['api/chat.js', 'modelMessageFromHistory']
]) if ((await read(file)).includes(token)) fail(`Dead compatibility helper remains active: ${file}:${token}.`);

const browserE2E = await read('scripts/browser-e2e.js');
if (!browserE2E.includes('RIN_ALLOW_BROWSER_E2E_SKIP') || !browserE2E.includes('cannot be counted as passing')) fail('Browser E2E must fail closed unless skip is explicitly opted in.');

for (const [file, exports] of [
  ['lib/server/http.js', ['readJsonBody', 'requestPin', 'requirePin', 'requireMethod', 'fetchWithTimeout', 'publicError']],
  ['public/js/chat_viewport.js', ['resolveViewportMetrics', 'resolveViewportHeight', 'isNearChatBottom', 'createChatViewportController']],
  ['public/js/delivery_scheduler.js', ['computeHumanReadDelay', 'computeHumanComposeDelay', 'computeInterSegmentDelay', 'createHumanDeliveryScheduler', 'createInputAggregator']],
  ['lib/server/canon-retrieval.js', ['retrieveCanonicalLore']]
]) {
  const moduleUrl = pathToFileURL(path.join(root, file)).href;
  const mod = await import(`${moduleUrl}?build-smoke=${Date.now()}`);
  for (const name of exports) if (typeof mod[name] !== 'function') fail(`${file} must export ${name}().`);
}

for (const apiFile of ['login', 'chat', 'memory', 'tts', 'weather']) {
  const moduleUrl = pathToFileURL(path.join(root, `api/${apiFile}.js`)).href;
  const apiModule = await import(`${moduleUrl}?build-smoke=${Date.now()}`);
  if (typeof apiModule.default !== 'function') fail(`api/${apiFile}.js must export a default handler.`);
}

console.log(`Build smoke OK: release ${release}; Cognitive Kernel ownership, server canon, human delivery, schema v6, assets and API entrypoints verified.`);
