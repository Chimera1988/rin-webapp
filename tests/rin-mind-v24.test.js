import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBehaviorState, inspectMotifNovelty } from '../lib/cognition/behavior-state.js';
import { buildRinMindJsonSchema, buildRinMindPrompt, FRAME_ALIGNMENTS, SCENE_MOTIFS } from '../lib/cognition/rin-mind.js';
import { buildDecisionStateTransition, normalizeTurnDecision } from '../lib/cognition/turn-decision.js';
import { stabilizePersistentIntent } from '../lib/cognition/intent-policy.js';

function baseDecision(overrides = {}) {
  return normalizeTurnDecision({
    act: 'playful_tease',
    focus: 'продолжить взаимную игру',
    stance: 'игривая',
    question: { mode: 'none', reason: null },
    replyLink: { targetEventId: null, reason: null },
    delivery: { segments: [{ type: 'text', purpose: 'reply', stickerIntent: null, maxChars: 320 }] },
    intentTransition: { operation: 'none', goal: null, motive: null, target: null, nextMove: null, progress: null, commitment: null, reason: null },
    openLoops: { open: [], resolveIds: [] },
    realityMode: 'grounded',
    ...overrides
  });
}

test('semantic motif repetition becomes strong while varied motifs stay low even with the same act', () => {
  const same = buildBehaviorState({
    recentActs: ['playful_tease', 'playful_tease', 'playful_tease', 'playful_tease', 'playful_tease'],
    recentMotifs: ['mystery', 'mystery', 'mystery', 'mystery', 'mystery']
  });
  const varied = buildBehaviorState({
    recentActs: ['playful_tease', 'playful_tease', 'playful_tease', 'playful_tease', 'playful_tease'],
    recentMotifs: ['mystery', 'challenge', 'playful_roleplay', 'mock_conflict', 'tender_presence']
  });
  assert.ok(same.novelty.motifPressure >= 90);
  assert.ok(same.novelty.pressure >= 90);
  assert.equal(varied.novelty.motifPressure, 0);
  assert.equal(varied.novelty.pressure, 0);
  assert.ok(varied.novelty.actionPressure > 0);
});

test('motif telemetry counts the current semantic streak deterministically', () => {
  const telemetry = inspectMotifNovelty(['mystery', 'challenge', 'challenge', 'challenge']);
  assert.equal(telemetry.repeatedMotif, 'challenge');
  assert.equal(telemetry.streak, 3);
  assert.equal(telemetry.appearances, 3);
  assert.equal(telemetry.pressure, 52);
});

test('playful roleplay wording is evidence, not a keyword-level misread verdict', () => {
  const state = buildBehaviorState({
    userText: 'Я тебя не понимаю) Суд присяжных, объясните мне, в чем я виновен? 😉',
    recentActs: ['flirt_softly', 'playful_tease'],
    recentMotifs: ['challenge', 'playful_roleplay']
  });
  assert.equal(state.frameEvidence.confusionCue, true);
  assert.equal(state.frameEvidence.playfulContext, true);
  assert.equal(state.frameEvidence.playfulMarker, true);
  assert.equal(state.frameEvidence.repairCue, false);
  assert.equal('risk' in state.frameEvidence, false);
});

test('Rin Mind schema asks the same semantic call for scene motif and contextual frame alignment', () => {
  const schema = buildRinMindJsonSchema().schema;
  assert.ok(schema.properties.mind.required.includes('sceneMotif'));
  assert.ok(schema.properties.mind.required.includes('frameAlignment'));
  assert.deepEqual(schema.properties.mind.properties.sceneMotif.enum, [...SCENE_MOTIFS]);
  assert.deepEqual(schema.properties.mind.properties.frameAlignment.enum, [...FRAME_ALIGNMENTS]);
});

test('prompt explicitly distinguishes aligned playful confusion from real repair seeking', () => {
  const behaviorState = buildBehaviorState({
    userText: 'Я тебя не понимаю) Суд присяжных, объясните мне, в чем я виновен? 😉',
    recentActs: ['playful_tease'],
    recentMotifs: ['challenge', 'playful_roleplay', 'mystery', 'mystery']
  });
  const { system } = buildRinMindPrompt({
    profile: { prompt_profile: { identity: { full_name: 'Рин Акихара' } }, base_rules: '' },
    state: {
      conversationState: 'ongoing',
      userText: 'Я тебя не понимаю) Суд присяжных, объясните мне, в чем я виновен? 😉',
      behaviorState,
      driveState: { curiosity: 50, connection: 70, playfulness: 80, autonomy: 60, selfRespect: 70, needForSpace: 0, questionImpulse: 10 },
      stickerState: { mode: 'smart', available: false, hardAvailable: true },
      stickerCandidates: [],
      recentHistory: []
    }
  });
  assert.match(system, /sceneMotif/u);
  assert.match(system, /frameAlignment/u);
  assert.match(system, /Суд присяжных/u);
  assert.match(system, /aligned/u);
  assert.match(system, /не классифицируй по ключевым словам/iu);
});

test('state transition persists scene motifs and last frame alignment for the next turn', () => {
  const kernelState = {
    revision: 8,
    scene: { type: 'playful_flirt' },
    dialogueState: {
      topic: 'игра', scene: 'playful_flirt', recentActs: ['flirt_softly'],
      recentMotifs: ['mystery', 'challenge'], lastFrameAlignment: 'aligned'
    },
    beliefModel: { beliefs: [] }
  };
  const transition = buildDecisionStateTransition({
    kernelState,
    decision: baseDecision(),
    mind: { sceneMotif: 'playful_roleplay', frameAlignment: 'aligned' }
  });
  assert.deepEqual(transition.dialogueState.recentMotifs.slice(-3), ['mystery', 'challenge', 'playful_roleplay']);
  assert.equal(transition.dialogueState.lastFrameAlignment, 'aligned');
});


test('maintenance lifecycle consumes semantic frame alignment instead of a keyword risk score', () => {
  const activeIntent = {
    schema: 'rin-persistent-intent-v5', status: 'active', kind: 'maintenance', phase: 'sustain',
    goal: 'бережно развивать взаимный флирт без давления и форсирования близости',
    target: 'mutual_flirt', commitment: 75, engagement: 75, saturation: 12,
    progress: null, turnCount: 4, minTurns: 2, maxTurns: 18
  };
  const decision = baseDecision({ act: 'flirt_softly' });
  const aligned = stabilizePersistentIntent({
    transition: decision.intentTransition, decision, activeIntent, revision: 4,
    recentActs: ['flirt_softly'], behaviorState: { novelty: { pressure: 0 }, space: { strong: false }, frameAlignment: 'aligned' },
    driveState: { playfulness: 78 }, scene: { type: 'playful_flirt' }
  });
  const repairing = stabilizePersistentIntent({
    transition: decision.intentTransition, decision, activeIntent, revision: 4,
    recentActs: ['flirt_softly'], behaviorState: { novelty: { pressure: 0 }, space: { strong: false }, frameAlignment: 'repair_seeking' },
    driveState: { playfulness: 78 }, scene: { type: 'playful_flirt' }
  });
  assert.ok(Number(repairing.engagement) < Number(aligned.engagement));
});

test('reply-complete telemetry uses the same committed snapshot as the state-commit log', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../public/chat.js', import.meta.url), 'utf8');
  const committedAssignments = source.match(/const committedState = await commitSuccessfulTurnState/g) || [];
  assert.equal(committedAssignments.length, 2);
  assert.match(source, /reply complete:[\s\S]{0,500}stickerDebugSummary\(data, committedState\)/u);
  assert.match(source, /proactive complete:[\s\S]{0,500}stickerDebugSummary\(data, committedState\)/u);
  assert.match(source, /function buildTurnDebugSnapshot\(data = null, committed = null\)/u);
});
