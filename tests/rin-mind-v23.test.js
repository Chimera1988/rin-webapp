import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRinIntent } from '../public/lib/intent-contract.js';
import { buildBehaviorState } from '../lib/cognition/behavior-state.js';
import { buildKernelState } from '../lib/cognition/kernel-state.js';
import { buildRinMindPrompt } from '../lib/cognition/rin-mind.js';
import { applyIntentTransition, normalizeTurnDecision } from '../lib/cognition/turn-decision.js';

function decision(overrides = {}) {
  return normalizeTurnDecision({
    act: 'playful_tease',
    focus: 'продолжить игру',
    stance: 'игривая',
    question: { mode: 'none', reason: null },
    replyLink: { targetEventId: null, reason: null },
    delivery: { segments: [{ type: 'text', purpose: 'reply', stickerIntent: null, maxChars: 320 }] },
    intentTransition: {
      operation: 'preserve', goal: null, motive: null, target: null,
      nextMove: null, progress: null, commitment: null, reason: null,
      kind: 'maintenance', phase: 'sustain', engagement: 82, saturation: 26
    },
    openLoops: { open: [], resolveIds: [] },
    realityMode: 'grounded',
    ...overrides
  });
}

test('legacy closeness intent migrates to maintenance semantics instead of a fake progress bar', () => {
  const intent = normalizeRinIntent({
    schema: 'rin-persistent-intent-v4', status: 'active',
    goal: 'оставаться в тёплой близости и позволить моменту развиваться естественно',
    target: 'emotional_closeness', progress: 0.08, turnCount: 6, maxTurns: 8,
    commitment: 78
  });
  assert.equal(intent.schema, 'rin-persistent-intent-v5');
  assert.equal(intent.kind, 'maintenance');
  assert.equal(intent.progress, null);
  assert.ok(intent.maxTurns >= 14);
  assert.equal(intent.phase, 'sustain');
});

test('maintenance transition stores phase, engagement and saturation while leaving progress null', () => {
  const current = normalizeRinIntent({
    schema: 'rin-persistent-intent-v5', status: 'active', kind: 'maintenance', phase: 'sustain',
    goal: 'сохранять взаимную игровую близость', target: 'playful_closeness',
    commitment: 80, engagement: 80, saturation: 12, progress: null,
    startedAtTurn: 2, updatedAtTurn: 2, turnCount: 2, maxTurns: 16
  });
  const next = applyIntentTransition(current, decision(), { revision: 2, scene: 'playful_flirt' });
  assert.equal(next.kind, 'maintenance');
  assert.equal(next.phase, 'sustain');
  assert.equal(next.progress, null);
  assert.equal(next.engagement, 82);
  assert.equal(next.saturation, 26);
  assert.equal(next.turnCount, 3);
});

test('playful confusion is exposed as evidence without being hard-classified as a social misread', () => {
  const state = buildBehaviorState({
    userText: 'Как показать то? Не понимаю 😅',
    recentActs: ['accept_closeness', 'playful_tease']
  });
  assert.equal(state.frameEvidence.playfulContext, true);
  assert.equal(state.frameEvidence.confusionCue, true);
  assert.equal(state.frameEvidence.playfulMarker, true);
  assert.match(state.frameEvidence.guidance, /не готовый диагноз|полному смыслу/iu);
});

test('ordinary non-playful clarification remains only lexical evidence for the semantic frame classifier', () => {
  const state = buildBehaviorState({
    userText: 'Не понимаю, как работает этот параметр',
    recentActs: ['answer_directly']
  });
  assert.equal(state.frameEvidence.playfulContext, false);
  assert.equal(state.frameEvidence.confusionCue, true);
  assert.equal(state.frameEvidence.repairCue, false);
});

test('kernel preserves Rin-local timezone and prompt gives current environment precedence over stale daypart history', () => {
  const behaviorState = buildBehaviorState({
    userText: 'Как показать то? Не понимаю 😅',
    recentActs: ['playful_tease']
  });
  const kernel = buildKernelState({
    requestId: 'v23-time',
    userText: 'Как показать то? Не понимаю 😅',
    history: [{ role: 'user', kind: 'text', status: 'sent', id: 'u1', requestId: 'v23-time', content: 'Как показать то? Не понимаю 😅' }],
    memory: { conversationState: { revision: 3, openLoops: [] } },
    brain: { activeScene: { type: 'playful_flirt', topic: 'игра' } },
    affectiveTurn: null,
    env: { rinTz: 'Asia/Tokyo', rinHuman: '2026-09-13 18:05', partOfDay: 'вечер', season: 'осень' },
    conversationState: 'ongoing'
  });
  assert.equal(kernel.environment.rinTz, 'Asia/Tokyo');
  const { system } = buildRinMindPrompt({
    profile: { prompt_profile: { identity: { full_name: 'Рин Акихара' } }, base_rules: '' },
    state: {
      ...kernel,
      behaviorState,
      driveState: { curiosity: 50, connection: 75, playfulness: 80, autonomy: 60, selfRespect: 70, needForSpace: 0, questionImpulse: 20 },
      stickerState: { mode: 'smart', available: false, hardAvailable: true, propensity: 0.3, desireModifier: 1 },
      stickerCandidates: []
    }
  });
  assert.match(system, /2026-09-13 18:05/u);
  assert.match(system, /Asia\/Tokyo/u);
  assert.match(system, /время на устройстве пользователя/u);
  assert.match(system, /frameAlignment/u);
  assert.match(system, /maintenance/u);
  assert.match(system, /progress=null/u);
  assert.match(system, /canonical = факты canon\/lore/u);
});
