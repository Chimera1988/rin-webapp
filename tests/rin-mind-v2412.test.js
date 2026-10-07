import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildBehaviorState,
  extractVocativeAddresses,
  inspectVocativeRhythm
} from '../lib/cognition/behavior-state.js';
import { buildRinMindPrompt } from '../lib/cognition/rin-mind.js';
import { detectUserFutureCallback, futureCallbackOpenLoop, upsertUserFutureCommitment } from '../lib/cognition/future-callbacks.js';
import { buildDecisionStateTransition } from '../lib/cognition/turn-decision.js';

const profile = {
  prompt_profile: {
    identity: { full_name: 'Рин Акихара', name_japanese: '秋原 凛' },
    reference_character: { core: 'Живая взрослая женщина со своим мнением.', principles: [], imperfections: [] },
    voice: { description: 'Личная русская переписка.', principles: [] },
    relationship: { relationship_philosophy: { core: 'Связь ценна.', principles: [] } }
  },
  base_rules: 'Сохраняй характер Рин.'
};

function assistant(turnId, content) {
  return { id: `a-${turnId}-${content.length}`, role: 'assistant', turnId, content };
}

test('v2.4.12 detects direct affectionate and playful addresses without treating narrative nouns as vocatives', () => {
  assert.deepEqual(
    extractVocativeAddresses('Спасибо, мой внимательный мальчик...').map(item => [item.exact, item.semanticClass]),
    [['мой внимательный мальчик', 'boy_affection']]
  );
  assert.deepEqual(
    extractVocativeAddresses('Ну ты и хитрец)').map(item => [item.exact, item.semanticClass]),
    [['хитрец', 'playful_label']]
  );
  assert.deepEqual(
    extractVocativeAddresses('Вот и хорошо, мой хороший.').map(item => [item.exact, item.semanticClass]),
    [['мой хороший', 'tender_label']]
  );
  assert.equal(extractVocativeAddresses('В 14 лет я влюбилась в мальчика из параллели.').length, 0);
  assert.equal(extractVocativeAddresses('Я вчера говорила с Кириллом о тексте.').length, 0);
});

test('v2.4.12 split bubbles count as one semantic assistant turn for vocative density', () => {
  const history = [
    assistant('t1', 'Хитрец)'),
    assistant('t1', 'Ладно, на этот раз прощаю.'),
    assistant('t2', 'Иди сюда.')
  ];
  const state = inspectVocativeRhythm(history, 'Хорошо)');
  assert.equal(state.sampleTurns, 2);
  assert.equal(state.recentVocativeTurns, 1);
  assert.equal(state.recent6, 1);
  assert.equal(state.turnsSinceAny, 1);
});

test('v2.4.12 dense vocatives create strong avoidance instead of synonym rotation', () => {
  const history = [
    assistant('t1', 'Хитрец)'),
    assistant('t2', 'Хорошо, мой хороший.'),
    assistant('t3', 'Ну ты и хитрец)'),
    assistant('t4', 'Ладно, хороший мальчик.'),
    assistant('t5', 'Милый, я поняла.'),
    assistant('t6', 'Вот и всё, мой хороший.')
  ];
  const state = inspectVocativeRhythm(history, 'Ага)');
  assert.equal(state.recent6, 6);
  assert.equal(state.strongAvoid, true);
  assert.ok(state.pressure >= 68);
  assert.match(state.guidance, /БЕЗ обращения|синоним/iu);
});

test('v2.4.12 exact and semantic-class cooldowns remain visible after an address', () => {
  const history = [
    assistant('t1', 'Спокойно)'),
    assistant('t2', 'Хитрец)')
  ];
  const state = inspectVocativeRhythm(history, 'Что?)');
  assert.equal(state.lastExact, 'хитрец');
  assert.equal(state.lastClass, 'playful_label');
  assert.equal(state.anyGapRemaining, 1);
  assert.equal(state.classGapRemaining, 2);
  assert.equal(state.exactGapRemaining, 4);
});

test('v2.4.12 an explicit user request can relax repetition pressure for one requested address', () => {
  const history = [
    assistant('t1', 'Хитрец)'),
    assistant('t2', 'Мой хороший.'),
    assistant('t3', 'Хороший мальчик.'),
    assistant('t4', 'Хитрец)'),
    assistant('t5', 'Милый.'),
    assistant('t6', 'Мой хороший.')
  ];
  const ordinary = inspectVocativeRhythm(history, 'Продолжай)');
  const requested = inspectVocativeRhythm(history, 'Называй меня хорошим мальчиком)');
  assert.equal(ordinary.strongAvoid, true);
  assert.equal(requested.directRequest, true);
  assert.equal(requested.strongAvoid, false);
  assert.ok(requested.pressure < ordinary.pressure);
});

test('v2.4.12 behavior state and Rin Mind prompt expose vocative economy and live pressure', () => {
  const history = [
    assistant('t1', 'Хитрец)'),
    assistant('t2', 'Мой хороший.'),
    assistant('t3', 'Хороший мальчик.')
  ];
  const behaviorState = buildBehaviorState({ userText: 'Ага)', history });
  assert.ok(behaviorState.vocative);
  assert.ok(behaviorState.vocative.pressure > 0);

  const prompt = buildRinMindPrompt({
    profile,
    state: {
      behaviorState,
      driveState: {},
      sharedSymbolState: { candidates: [], recentUses: [], guidance: '' },
      recentHistory: []
    }
  });
  assert.match(prompt.stableSystem, /Vocative Economy/iu);
  assert.match(prompt.stableSystem, /не обходи repetition-pressure/iu);
  assert.match(prompt.dynamicSystem, /VOCATIVE RHYTHM/iu);
  assert.match(prompt.dynamicSystem, /strongAvoid=/iu);
});

test('v2.4.12 API and client debug expose vocative telemetry without a second model call', async () => {
  const api = await readFile(new URL('../api/chat.js', import.meta.url), 'utf8');
  const client = await readFile(new URL('../public/chat.js', import.meta.url), 'utf8');
  assert.match(api, /extractVocativeAddresses\(reply\)/u);
  assert.match(api, /vocativePressure/u);
  assert.match(api, /vocativeOverride/u);
  assert.match(api, /rin-mind-v2\.4\.12-dialogue-naturalness-continuity/u);
  assert.match(client, /vocPressure=/u);
  assert.match(client, /vocCooldown=/u);
  assert.match(client, /vocOverride=/u);
});


const baseDecision = {
  act: 'respond_personally',
  focus: 'ответить естественно',
  stance: 'лично и спокойно',
  question: { mode: 'none', reason: null },
  replyLink: { targetEventId: null, reason: null },
  delivery: { responseDepth: 'short', messageShape: 'single', segments: [{ type: 'text', purpose: 'message', stickerIntent: null, maxChars: 220 }] },
  intentTransition: { operation: 'none', goal: null, motive: null, target: null, nextMove: null, progress: null, commitment: null, reason: null },
  openLoops: { open: [], resolveIds: [] },
  realityMode: 'grounded'
};

const baseMind = {
  sceneMotif: 'direct_exchange', lifeDomain: 'none', lifeMotif: null, frameAlignment: 'aligned',
  sharedSymbolExpression: 'none', sharedSymbolId: null,
  commitmentAction: 'none', commitmentConflict: 'none', commitmentTargetId: null, commitmentSubject: null,
  commitmentOwner: 'none', commitmentStrength: 0, commitmentReason: null
};

function kernelForCallback({ revision = 60, userText = '', openLoops = [], commitments = [] } = {}) {
  return {
    revision,
    userText,
    conversationState: 'ongoing',
    scene: { type: 'everyday' },
    beliefModel: { currentStatement: null, correction: null, beliefs: [] },
    activeIntent: null,
    openLoops,
    dialogueState: {
      recentActs: [], recentMotifs: [], recentMessageShapes: [], recentResponseDepths: [], recentLifeBeats: [], recentSharedSymbols: [],
      sceneCommitments: commitments, lastFrameAlignment: 'aligned'
    }
  };
}

test('v2.4.12 explicit future promise becomes a deterministic callback while hedged intent does not', () => {
  const callback = detectUserFutureCallback('Вечером расскажу)');
  assert.ok(callback);
  assert.equal(callback.cue, 'evening');
  assert.equal(callback.action, 'tell');
  assert.equal(callback.horizon, 'until_event');
  assert.match(callback.subject, /Вечером расскажу/iu);

  assert.equal(detectUserFutureCallback('Может вечером расскажу)'), null);
  assert.equal(detectUserFutureCallback('Если не забуду, вечером расскажу)'), null);
});

test('v2.4.12 user future promise persists as waiting callback and owner=user commitment even if model emits none', () => {
  const transition = buildDecisionStateTransition({
    kernelState: kernelForCallback({ userText: 'Вечером расскажу тебе, что там случилось)' }),
    affectiveTurn: null,
    decision: baseDecision,
    mind: baseMind,
    userText: 'Вечером расскажу тебе, что там случилось)',
    now: 123456789
  });
  const loop = transition.openLoopUpdates.find(item => item.type === 'future_callback');
  assert.ok(loop);
  assert.equal(loop.status, 'waiting_for_user');
  assert.equal(loop.waitingFor, 'user');
  assert.equal(loop.temporalCue, 'evening');
  assert.equal(loop.source, 'user_future_callback');

  const commitment = transition.dialogueState.sceneCommitments.find(item => item.owner === 'user' && item.source === 'user_future_callback');
  assert.ok(commitment);
  assert.equal(commitment.status, 'active');
  assert.equal(commitment.lastAction, 'establish');
  assert.equal(commitment.horizon, 'until_event');
});

test('v2.4.12 explicit fulfillment resolves the stored future callback and fulfills its formal user commitment', () => {
  const callback = detectUserFutureCallback('Вечером расскажу)');
  const loop = futureCallbackOpenLoop(callback, 1000);
  const commitments = upsertUserFutureCommitment([], callback, { turn: 60 });
  const transition = buildDecisionStateTransition({
    kernelState: kernelForCallback({ revision: 61, userText: 'Как и обещал, вот рассказываю, что произошло.', openLoops: [loop], commitments }),
    affectiveTurn: null,
    decision: baseDecision,
    mind: baseMind,
    userText: 'Как и обещал, вот рассказываю, что произошло.',
    now: 2000
  });
  assert.ok(transition.resolvedLoopIds.includes(loop.id));
  const commitment = transition.dialogueState.sceneCommitments.find(item => item.id === callback.id);
  assert.ok(commitment);
  assert.equal(commitment.status, 'fulfilled');
  assert.equal(commitment.lastAction, 'fulfill');
  assert.equal(commitment.terminalReason, 'user_returned_to_promised_callback');
});

test('v2.4.12 Rin Mind treats future callbacks as remembered social facts without nagging', () => {
  const callback = detectUserFutureCallback('Завтра покажу)');
  const loop = futureCallbackOpenLoop(callback, 1000);
  const prompt = buildRinMindPrompt({
    profile,
    state: {
      behaviorState: {}, driveState: {}, sharedSymbolState: { candidates: [], recentUses: [], guidance: '' },
      openLoops: [loop], recentHistory: []
    }
  });
  assert.match(prompt.stableSystem, /Future Callback Continuity/iu);
  assert.match(prompt.stableSystem, /не превращай это в контроль/iu);
  assert.match(prompt.dynamicSystem, /FUTURE CALLBACK ACTIVE/iu);
  assert.match(prompt.dynamicSystem, /tomorrow/iu);
});
