import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBehaviorState } from '../lib/cognition/behavior-state.js';
import { buildRinMindJsonSchema, buildRinMindPrompt, parseRinMind } from '../lib/cognition/rin-mind.js';
import { buildDecisionStateTransition, normalizeTurnDecision } from '../lib/cognition/turn-decision.js';

const profile = {
  prompt_profile: {
    identity: { full_name: 'Рин Акихара', name_japanese: '秋原 凛' },
    reference_character: { core: 'Живая взрослая женщина со своим мнением.', principles: [], imperfections: [] },
    voice: { description: 'Личная русская переписка.', principles: [] }
  },
  base_rules: 'Сохраняй характер Рин.'
};

const decision = (delivery = {}) => normalizeTurnDecision({
  act: 'respond_personally',
  focus: 'ответить на текущую сцену',
  stance: 'личная позиция Рин',
  question: { mode: 'none', reason: null },
  replyLink: { targetEventId: null, reason: null },
  delivery: {
    responseDepth: 'normal',
    messageShape: 'single',
    segments: [{ type: 'text', purpose: 'reply', stickerIntent: null, maxChars: 320 }],
    ...delivery
  },
  intentTransition: { operation: 'none', goal: null, motive: null, target: null, nextMove: null, progress: null, commitment: null, reason: null },
  openLoops: { open: [], resolveIds: [] },
  realityMode: 'grounded'
});

const mind = (overrides = {}) => ({
  sceneMotif: 'direct_exchange',
  frameAlignment: 'aligned',
  lifeDomain: 'none',
  lifeMotif: null,
  commitmentAction: 'none',
  commitmentConflict: 'none',
  commitmentTargetId: null,
  commitmentSubject: null,
  commitmentOwner: 'none',
  commitmentStrength: 0,
  commitmentReason: null,
  ...overrides
});

test('v2.4.7 structured contract exposes autonomy-aware scene commitment fields', () => {
  const schema = buildRinMindJsonSchema().schema.properties.mind;
  for (const key of ['commitmentAction', 'commitmentConflict', 'commitmentTargetId', 'commitmentSubject', 'commitmentOwner', 'commitmentStrength', 'commitmentReason']) {
    assert.ok(schema.required.includes(key));
  }
  assert.ok(schema.properties.commitmentAction.enum.includes('honor'));
  assert.ok(schema.properties.commitmentAction.enum.includes('renegotiate'));
  assert.ok(schema.properties.commitmentAction.enum.includes('insist'));
  assert.ok(schema.properties.commitmentAction.enum.includes('break'));
  assert.deepEqual(schema.properties.commitmentConflict.enum, ['none', 'mild', 'strong']);
});

test('response rhythm detects short and single attractors without imposing a quota', () => {
  const state = buildBehaviorState({
    userText: 'Продолжай)',
    recentResponseDepths: ['short', 'short', 'short', 'short', 'short', 'short'],
    recentMessageShapes: ['single', 'single', 'single', 'single', 'single', 'single']
  });
  assert.ok(state.responseRhythm.shortLockPressure >= 45);
  assert.ok(state.responseRhythm.singleLockPressure >= 45);
  assert.match(state.responseRhythm.guidance, /не выбирай short по инерции|split допустим/iu);
});

test('response rhythm remains permissive when recent delivery is already varied', () => {
  const state = buildBehaviorState({
    userText: 'Хорошо',
    recentResponseDepths: ['micro', 'short', 'normal', 'short', 'normal'],
    recentMessageShapes: ['single', 'split', 'single', 'single', 'split']
  });
  assert.equal(state.responseRhythm.shortLockPressure, 0);
  assert.equal(state.responseRhythm.singleLockPressure, 0);
});

test('prompt treats commitments as remembered social facts rather than hard constraints', () => {
  const behaviorState = buildBehaviorState({
    recentResponseDepths: ['short', 'short', 'short', 'short'],
    recentMessageShapes: ['single', 'single', 'single', 'single']
  });
  const prompt = buildRinMindPrompt({
    profile,
    state: {
      behaviorState,
      driveState: { autonomy: 78, selfRespect: 70, connection: 65, curiosity: 50, playfulness: 40, needForSpace: 20, questionImpulse: 20 },
      dialogueState: {
        sceneCommitments: [{
          id: 'commit-day-off',
          subject: 'сегодня устроить выходной и не заниматься работой',
          owner: 'shared', status: 'active', strength: 78, lastAction: 'establish'
        }]
      },
      recentHistory: []
    }
  });
  assert.match(prompt.stableSystem, /НЕ жёсткие запреты/iu);
  assert.match(prompt.stableSystem, /renegotiate, compromise, insist/iu);
  assert.match(prompt.stableSystem, /молча снова начать работать/iu);
  assert.match(prompt.dynamicSystem, /RESPONSE RHYTHM/iu);
  assert.match(prompt.dynamicSystem, /shortLock=/u);
});

test('new shared agreement is persisted as a scene commitment', () => {
  const transition = buildDecisionStateTransition({
    kernelState: { revision: 4, scene: { type: 'everyday' }, dialogueState: {} },
    decision: decision({ responseDepth: 'short' }),
    mind: mind({
      commitmentAction: 'establish',
      commitmentSubject: 'сегодня устроить выходной и не заниматься работой',
      commitmentOwner: 'shared',
      commitmentStrength: 82,
      commitmentReason: 'Рин согласилась на совместный выходной'
    })
  });
  assert.equal(transition.dialogueState.sceneCommitments.length, 1);
  const commitment = transition.dialogueState.sceneCommitments[0];
  assert.equal(commitment.status, 'active');
  assert.equal(commitment.owner, 'shared');
  assert.equal(commitment.strength, 82);
  assert.equal(commitment.lastAction, 'establish');
  assert.match(commitment.subject, /выходной/iu);
});

test('Rin can consciously contest an agreement instead of silently forgetting it', () => {
  const current = {
    id: 'commit-day-off',
    subject: 'сегодня устроить выходной и не заниматься работой',
    owner: 'shared',
    status: 'active',
    strength: 80,
    source: 'rin_mind_v2',
    lastAction: 'establish',
    createdAtTurn: 3,
    updatedAtTurn: 3
  };
  const transition = buildDecisionStateTransition({
    kernelState: {
      revision: 7,
      scene: { type: 'everyday' },
      dialogueState: { sceneCommitments: [current], recentResponseDepths: ['short', 'short'] }
    },
    decision: decision({ responseDepth: 'normal' }),
    mind: mind({
      commitmentAction: 'insist',
      commitmentConflict: 'strong',
      commitmentTargetId: 'commit-day-off',
      commitmentSubject: current.subject,
      commitmentOwner: 'shared',
      commitmentStrength: 80,
      commitmentReason: 'текст действительно срочный, Рин хочет сначала закончить его'
    })
  });
  const commitment = transition.dialogueState.sceneCommitments.at(-1);
  assert.equal(commitment.id, 'commit-day-off');
  assert.equal(commitment.status, 'contested');
  assert.equal(commitment.lastAction, 'insist');
  assert.match(commitment.rationale, /срочн/iu);
});

test('honoring a commitment keeps it active while response depth history records real model choices', () => {
  const current = {
    id: 'commit-walk', subject: 'после обеда пойти вместе гулять', owner: 'shared', status: 'active', strength: 74,
    lastAction: 'establish', createdAtTurn: 2, updatedAtTurn: 2
  };
  const transition = buildDecisionStateTransition({
    kernelState: {
      revision: 5,
      scene: { type: 'everyday' },
      dialogueState: {
        sceneCommitments: [current],
        recentResponseDepths: ['short', 'short', 'normal'],
        recentMessageShapes: ['single', 'single', 'split']
      }
    },
    decision: decision({ responseDepth: 'micro', messageShape: 'single' }),
    mind: mind({
      commitmentAction: 'honor', commitmentTargetId: 'commit-walk', commitmentSubject: current.subject,
      commitmentOwner: 'shared', commitmentStrength: 74, commitmentReason: 'план остаётся в силе'
    })
  });
  assert.deepEqual(transition.dialogueState.recentResponseDepths.slice(-4), ['short', 'short', 'normal', 'micro']);
  assert.equal(transition.dialogueState.sceneCommitments.at(-1).status, 'active');
  assert.equal(transition.dialogueState.sceneCommitments.at(-1).lastAction, 'honor');
});

test('parsed Rin Mind turn normalizes commitment metadata without adding a second semantic stage', () => {
  const parsed = parseRinMind({
    act: 'offer_compromise',
    focus: 'не забыть договорённость и предложить компромисс',
    stance: 'Рин не хочет отказываться от важного дела, но помнит общий план',
    question: { mode: 'none', reason: null },
    replyLink: { targetEventId: null, reason: null },
    delivery: {
      responseDepth: 'normal', messageShape: 'split',
      segments: [
        { type: 'text', purpose: 'acknowledge', stickerIntent: null, maxChars: 150, text: 'Я помню, что обещала выходной.' },
        { type: 'text', purpose: 'compromise', stickerIntent: null, maxChars: 240, text: 'Но этот текст правда не отпускает. Дай мне час — и потом никаких ноутбуков.' }
      ]
    },
    intentTransition: { operation: 'none', goal: null, motive: null, target: null, nextMove: null, progress: null, commitment: null, reason: null },
    openLoops: { open: [], resolveIds: [] },
    realityMode: 'grounded',
    mind: {
      felt: 'упрямство и тепло', wants: 'закончить важный текст и не обесценить общий план', restraint: 'не делать вид, будто договорённости не было',
      socialIntent: 'offer_compromise', sceneMotif: 'shared_reflection', lifeDomain: 'work', lifeMotif: 'urgent_text',
      frameAlignment: 'aligned', literalCorrection: 'none', referenceAnchor: 'сегодняшний совместный выходной',
      commitmentAction: 'compromise', commitmentConflict: 'strong', commitmentTargetId: 'commit-day-off',
      commitmentSubject: 'сегодня устроить выходной и не заниматься работой', commitmentOwner: 'shared', commitmentStrength: 80,
      commitmentReason: 'важный текст хочется закончить до отдыха', confidence: 91
    }
  });
  assert.equal(parsed.mind.commitmentAction, 'compromise');
  assert.equal(parsed.mind.commitmentConflict, 'strong');
  assert.equal(parsed.decision.delivery.responseDepth, 'normal');
  assert.equal(parsed.decision.delivery.messageShape, 'split');
  assert.equal(parsed.realization.segments.length, 2);
});
