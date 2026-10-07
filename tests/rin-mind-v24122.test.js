import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildBehaviorState, inspectSceneClosure } from '../lib/cognition/behavior-state.js';
import { buildRinMindPrompt } from '../lib/cognition/rin-mind.js';
import { stabilizeTurn } from '../lib/cognition/turn-stabilizer.js';
import { detectConversationState } from '../api/chat.js';

const profile = {
  prompt_profile: {
    identity: { full_name: 'Рин Акихара', name_japanese: '秋原 凛' },
    reference_character: { core: 'Живая взрослая женщина со своим мнением.', principles: [], imperfections: [] },
    voice: { description: 'Личная русская переписка.', principles: [] },
    relationship: { relationship_philosophy: { core: 'Связь ценна.', principles: [] } }
  },
  base_rules: 'Сохраняй характер Рин.'
};

const assistant = (content, id = 'a1') => ({
  id, role: 'assistant', kind: 'text', status: 'complete', requestId: id, turnId: id, content, ts: 1
});
const user = (content, id = 'u1') => ({
  id, role: 'user', kind: 'text', status: 'sent', requestId: 'current', turnId: 'user-current', content, ts: 2
});

const textDecision = {
  act: 'say_goodbye',
  focus: 'ответить на прощание',
  stance: 'тепло',
  question: { mode: 'none', reason: null },
  replyLink: { targetEventId: null, reason: null },
  delivery: {
    responseDepth: 'micro',
    messageShape: 'single',
    segments: [{ type: 'text', purpose: 'farewell', stickerIntent: null, maxChars: 120 }]
  },
  intentTransition: {
    operation: 'none', goal: null, motive: null, target: null, nextMove: null,
    progress: null, commitment: null, reason: null
  },
  openLoops: { open: [], resolveIds: [] },
  realityMode: 'grounded'
};

test('v2.4.12.2 scene completion distinguishes first goodbye from redundant terminal echo', () => {
  const first = inspectSceneClosure([assistant('Мне хорошо с тобой.')], 'Спокойной ночи 😘');
  assert.equal(first.strong, false);
  assert.equal(first.soft, true);

  const redundant = inspectSceneClosure(
    [assistant('Спокойной ночи… утром снова найду тебя.')],
    'Спокойной ночи Китсуне'
  );
  assert.equal(redundant.priorClosed, true);
  assert.equal(redundant.strong, true);

  const ack = inspectSceneClosure(
    [assistant('Сладких снов. До утра.')],
    'И тебе ☺️'
  );
  assert.equal(ack.terminalAck, true);
  assert.equal(ack.strong, true);

  const newMeaning = inspectSceneClosure(
    [assistant('Спокойной ночи.')],
    'Спокойной ночи, завтра расскажу тебе, что произошло'
  );
  assert.equal(newMeaning.strong, false);
});

test('v2.4.12.2 redundant closing turn becomes real silence, not another farewell bubble', () => {
  const behaviorState = buildBehaviorState({
    userText: 'Спокойной ночи Китсуне',
    history: [assistant('Спокойной ночи… утром снова найду тебя.')]
  });
  assert.equal(behaviorState.sceneClosure.strong, true);

  const result = stabilizeTurn({
    decision: textDecision,
    realization: { segments: [{ type: 'text', purpose: 'farewell', text: 'И тебе сладких снов.' }] },
    behaviorState,
    conversationState: 'ending',
    fallbackText: 'Спокойной ночи.'
  });
  assert.equal(result.decision.delivery.mode, 'silence');
  assert.equal(result.decision.delivery.segments.length, 0);
  assert.equal(result.realization.segments.length, 0);
  assert.ok(result.warnings.includes('terminal_scene_silence_applied'));
});

test('v2.4.12.2 terminal acknowledgement after Rin already closed the scene is an ending state', () => {
  const history = [
    assistant('Спокойной ночи. Сладких снов.'),
    user('И тебе ☺️')
  ];
  assert.equal(detectConversationState(history), 'ending');
});

test('v2.4.12.2 prompt explicitly treats terminal closure as a silence opportunity', () => {
  const behaviorState = buildBehaviorState({
    userText: 'И тебе ☺️',
    history: [assistant('Сладких снов. До утра.')]
  });
  const prompt = buildRinMindPrompt({
    profile,
    state: {
      behaviorState,
      driveState: {},
      sharedSymbolState: { candidates: [], recentUses: [], guidance: '' },
      recentHistory: []
    }
  });
  assert.match(prompt.stableSystem, /Scene Completion/iu);
  assert.match(prompt.dynamicSystem, /SCENE COMPLETION: strong=yes/iu);
  assert.match(prompt.dynamicSystem, /delivery\.segments=\[\]/u);
});

test('v2.4.12.2 refreshes Rin clock every semantic turn while weather keeps its own TTL', async () => {
  const client = await readFile(new URL('../public/chat.js', import.meta.url), 'utf8');
  assert.match(client, /const envIntent = environmentIntent\(combinedUserText\)/u);
  assert.match(client, /await refreshRinEnv\(\{ refreshWeather: envIntent === 'weather' \|\| environmentIsStale\(schedule\) \}\)/u);
  assert.match(client, /const weatherTs = Number\(currentEnv\?\._weatherTs \|\| 0\)/u);
  assert.match(client, /weather: priorWeather/u);
  assert.match(client, /rinHuman: fmtRinHuman\(rin\)/u);
  assert.match(client, /env\._weatherTs = Date\.now\(\)/u);
});

test('v2.4.12.2 read receipts are separate from completion and move into the bubble corner', async () => {
  const [client, scheduler, contract, css] = await Promise.all([
    readFile(new URL('../public/chat.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/js/delivery_scheduler.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/lib/chat-contract.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/style.css', import.meta.url), 'utf8')
  ]);
  assert.match(scheduler, /onRead\(\);\s*onPresence\('typing'\)/u);
  assert.match(client, /onRead: \(\) => markUserBatchRead\(ids\)/u);
  assert.match(client, /receipt: \{ readAt: timestamp \}/u);
  assert.match(contract, /receipt: \{ readAt: readAtNumber \}/u);
  assert.match(css, /\.delivery-checks\s*\{[\s\S]*position:\s*absolute;[\s\S]*right:\s*8px;[\s\S]*bottom:\s*4px;[\s\S]*font-size:\s*9px;/u);
  assert.match(css, /\.message-row\[data-read="true"\] \.delivery-checks/u);
});
