import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFile(path.join(root, file), 'utf8');
const exists = file => access(path.join(root, file)).then(() => true, () => false);

const REMOVED_DECISION_OWNERS = [
  'lib/cognition/behavior-policy.js',
  'lib/cognition/conversation-director.js',
  'lib/cognition/index.js',
  'lib/cognition/open-loops.js',
  'lib/cognition/persistent-intent.js',
  'lib/cognition/response-planner.js',
  'lib/cognition/response-verifier.js',
  'lib/cognition/turn-state-impact.js',
  'lib/core-personality.js',
  'lib/memory/conversation-threads.js',
  'lib/personality/anti-gpt.js',
  'lib/personality/assistant-voice.js',
  'lib/personality/character-intent-engine.js',
  'lib/personality/character.js',
  'lib/personality/continuity.js',
  'lib/personality/emotional-response.js',
  'lib/personality/habits.js',
  'lib/personality/humanizer.js',
  'lib/personality/initiative-controller.js',
  'lib/personality/inner-life.js',
  'lib/personality/micro-reactions.js',
  'lib/personality/mood.js',
  'lib/personality/relationship-engine.js',
  'lib/personality/relationship.js',
  'lib/personality/rhythm-controller.js',
  'lib/personality/speech.js',
  'lib/personality/utils.js',
  'lib/personality/voice-policy.js',
  'lib/stickers-v6.js',
  'public/lib/stickers-v6.js'
];

test('competing legacy decision owners are physically absent', async () => {
  for (const file of REMOVED_DECISION_OWNERS) {
    assert.equal(await exists(file), false, `${file} must remain deleted`);
  }
  assert.equal(await exists('public/data/rin_phrases.json'), false, 'client proactive phrase pool must remain deleted');
  for (const file of ['public/data/legacy/README.md', 'public/data/legacy/rin_mind.json', 'public/data/legacy/rin_persona.json', 'public/data/legacy/rin_reasoning.json', 'public/data/legacy/rin_speaking_habits.json']) {
    assert.equal(await exists(file), false, `${file} must remain deleted`);
  }
});

test('Perception describes evidence and never prescribes Rin action', async () => {
  const continuity = await read('lib/conversation-continuity.js');
  const perception = await read('lib/conversation-brain.js');
  const dialogue = await read('lib/cognition/dialogue-state.js');
  const state = await read('lib/cognition/kernel-state.js');
  assert.doesNotMatch(continuity, /SCENE_GOALS|sceneGoal|continuityInstruction/);
  assert.doesNotMatch(perception, /responseFocus|\bobligations\b|shouldClarify|ambiguity\.rule/);
  assert.doesNotMatch(dialogue, /sceneGoal|dialogueStateInstruction/);
  assert.doesNotMatch(state, /brain\?\.obligations|brain\?\.responseFocus|ambiguity[^\n]*rule/);
  assert.match(state, /direct_question_present/);
  assert.match(state, /user_handed_initiative/);
});

test('Cognitive Kernel is sole semantic decision owner in the chat API', async () => {
  const api = await read('api/chat.js');
  assert.match(api, /cognitive-kernel\.js/);
  assert.match(api, /buildKernelState/);
  assert.match(api, /buildKernelPrompt/);
  assert.match(api, /parseKernelDecision/);
  assert.match(api, /rin-realization\.js/);
  assert.match(api, /realizeDecision/);
  assert.doesNotMatch(api, /responsePlan|coreDecision|conversationBrain|compatibilityResponsePlan/);
  assert.doesNotMatch(api, /buildTurnDelivery|\n\s*delivery,/);
  assert.match(api, /validateDecisionResources/);
  assert.match(api, /isStickerIntentResolvable/);
  assert.doesNotMatch(api, /normalize\(input\.(?:hint|pool)|trigger\?\.(?:hint|pool)/);
  for (const file of REMOVED_DECISION_OWNERS) {
    assert.doesNotMatch(api, new RegExp(path.basename(file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('PersistentIntent and OpenLoops have one transition owner', async () => {
  const decision = await read('lib/cognition/turn-decision.js');
  const memory = await read('public/js/rin_memory.js');
  const intent = await read('public/lib/intent-contract.js');
  assert.match(decision, /applyIntentTransition/);
  assert.match(decision, /decisionOpenLoopUpdates/);
  assert.doesNotMatch(memory, /export\s+async\s+function\s+(?:addOpenLoop|resolveOpenLoop)/);
  assert.match(intent, /cognitive_kernel/);
  assert.match(intent, /status === 'completed' \|\| status === 'cancelled'/);
});

test('affective persistence has one snapshot writer path', async () => {
  const transition = await read('lib/cognition/cognitive-contract.js');
  const decision = await read('lib/cognition/turn-decision.js');
  const chat = await read('public/chat.js');
  const memory = await read('public/js/rin_memory.js');
  assert.doesNotMatch(transition, /moodDelta|relationshipDelta|emotionalTrace/);
  assert.doesNotMatch(decision, /moodDelta|relationshipDelta|emotionalTrace/);
  assert.doesNotMatch(chat, /moodDelta|relationshipDelta/);
  const commit = memory.slice(memory.indexOf('export async function commitTurnState'), memory.indexOf('export async function upsertFact'));
  assert.doesNotMatch(commit, /moodDelta|relationshipDelta|transition\.emotionalTrace/);
  assert.doesNotMatch(memory, /export\s+async\s+function\s+(?:rememberStickerEmotion|advanceStickerEmotion|resolveStickerEmotion)/);
});

test('sticker selection resolves assets but never invents semantic fallback', async () => {
  const selector = await read('lib/cognition/sticker-selector.js');
  const client = await read('public/lib/stickers-v7.js');
  assert.doesNotMatch(selector, /warm_smile[^\n]*fallback|fallback[^\n]*warm_smile/i);
  assert.match(selector, /return null/);
  assert.doesNotMatch(client, /decideSticker|decidePlannedSticker|deriveStickerSignals|Math\.random/);
});

test('client owns timing execution only and does not own proactive content or canon', async () => {
  const scheduler = await read('public/js/delivery_scheduler.js');
  const presence = await read('public/js/presence_controller.js');
  const lore = await read('public/js/rin_lore.js');
  const policy = await read('public/js/conversation_policy.js');
  assert.match(scheduler, /waitBeforeFirstSegment/);
  assert.doesNotMatch(presence, /readBeforeTyping|firstReturn|returnAfterIdle/);
  assert.doesNotMatch(lore, /rin_backstory|rin_memories|rin_triggers|rin_phrases|pickGreeting|pickInitiationPhrase|buildLorePayload/);
  assert.match(lore, /export async function getSchedule/);
  const chat = await read('public/chat.js');
  assert.doesNotMatch(chat, /loadLoreData/);
  assert.match(chat, /module\?\.getSchedule/);
  assert.doesNotMatch(policy, /chooseConfiguredStarter|starter/i);
});
