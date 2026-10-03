import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBehaviorState } from '../lib/cognition/behavior-state.js';
import { inspectLifeNovelty, LIFE_DOMAINS, lifeTextureCard } from '../lib/cognition/life-texture.js';
import { buildRinMindJsonSchema, buildRinMindPrompt, parseRinMind } from '../lib/cognition/rin-mind.js';
import { buildDecisionStateTransition, normalizeTurnDecision, responseDepthBudget } from '../lib/cognition/turn-decision.js';
import { stabilizeTurn } from '../lib/cognition/turn-stabilizer.js';

const baseDecision = (delivery = {}) => normalizeTurnDecision({
  act: 'share_self',
  focus: 'поделиться одной конкретной деталью',
  stance: 'живая личная реплика Рин',
  question: { mode: 'none', reason: null },
  replyLink: { targetEventId: null, reason: null },
  delivery: {
    responseDepth: 'normal',
    messageShape: 'single',
    segments: [{ type: 'text', purpose: 'life_beat', stickerIntent: null, maxChars: 420 }],
    ...delivery
  },
  intentTransition: { operation: 'none', goal: null, motive: null, target: null, nextMove: null, progress: null, commitment: null, reason: null },
  openLoops: { open: [], resolveIds: [] },
  realityMode: 'grounded'
});

const profile = {
  prompt_profile: {
    identity: { full_name: 'Рин Акихара', name_japanese: '秋原 凛' },
    reference_character: { core: 'Живая взрослая женщина.', principles: [], imperfections: [] },
    voice: { description: 'Личная русская переписка.', principles: [] }
  },
  base_rules: 'Сохраняй характер Рин.'
};

test('v2.4.6 structured contract exposes life texture and response depth without another model stage', () => {
  const schema = buildRinMindJsonSchema().schema;
  assert.deepEqual(schema.properties.delivery.required, ['responseDepth', 'messageShape', 'segments']);
  assert.deepEqual(schema.properties.delivery.properties.responseDepth.enum, ['micro', 'short', 'normal', 'extended']);
  assert.ok(schema.properties.mind.required.includes('lifeDomain'));
  assert.ok(schema.properties.mind.required.includes('lifeMotif'));
  assert.deepEqual(schema.properties.mind.properties.lifeDomain.enum, LIFE_DOMAINS);
});

test('life texture palette is broad and explicitly avoids turning it into a topic checklist', () => {
  const card = lifeTextureCard();
  assert.ok(LIFE_DOMAINS.length >= 20);
  assert.match(card, /Канадзава и город/iu);
  assert.match(card, /маленькая радость/iu);
  assert.match(card, /НЕ список обязательных тем/iu);
  assert.match(card, /одной конкретной детали/iu);
});

test('semantic life novelty detects repeated motifs even when they alternate', () => {
  const novelty = inspectLifeNovelty([
    { domain: 'work', motif: 'notes' },
    { domain: 'food', motif: 'jasmine_tea' },
    { domain: 'work', motif: 'notes' },
    { domain: 'sleep', motif: 'going_to_bed' },
    { domain: 'food', motif: 'jasmine_tea' },
    { domain: 'work', motif: 'notes' },
    { domain: 'food', motif: 'jasmine_tea' }
  ]);
  assert.ok(novelty.pressure >= 40);
  assert.ok(novelty.overusedMotifs.some(item => item.motif === 'notes' && item.count === 3));
  assert.ok(novelty.overusedMotifs.some(item => item.motif === 'jasmine_tea' && item.count === 3));
  assert.ok(novelty.freshDomains.includes('city'));
});

test('behavior state carries life novelty separately from scene motif novelty', () => {
  const state = buildBehaviorState({
    userText: 'Расскажи что-нибудь',
    recentActs: ['share_self', 'share_self'],
    recentMotifs: ['self_reveal', 'shared_reflection'],
    recentLifeBeats: [
      { domain: 'work', motif: 'notes' },
      { domain: 'food', motif: 'jasmine_tea' },
      { domain: 'work', motif: 'notes' },
      { domain: 'food', motif: 'jasmine_tea' }
    ]
  });
  assert.equal(state.schema, 'rin-behavior-state-v5');
  assert.ok(state.lifeNovelty);
  assert.ok(state.lifeNovelty.overusedMotifs.length >= 2);
  assert.equal(typeof state.novelty.motifPressure, 'number');
});

test('Rin Mind prompt keeps life palette and response economy in stable cache prefix while novelty stays dynamic', () => {
  const quiet = buildRinMindPrompt({
    profile,
    state: { behaviorState: { lifeNovelty: inspectLifeNovelty([]) }, recentHistory: [] }
  });
  const repeated = buildRinMindPrompt({
    profile,
    state: {
      behaviorState: {
        lifeNovelty: inspectLifeNovelty([
          { domain: 'work', motif: 'notes' },
          { domain: 'work', motif: 'notes' },
          { domain: 'work', motif: 'notes' },
          { domain: 'food', motif: 'jasmine_tea' },
          { domain: 'food', motif: 'jasmine_tea' }
        ])
      },
      dialogueState: { recentLifeBeats: [{ domain: 'work', motif: 'notes' }] },
      recentHistory: []
    }
  });
  assert.equal(quiet.stableSystem, repeated.stableSystem);
  assert.match(quiet.stableSystem, /Response Economy/iu);
  assert.match(quiet.stableSystem, /Life Texture/iu);
  assert.match(quiet.stableSystem, /Краткость НЕ ослабляет голос Рин/iu);
  assert.match(repeated.dynamicSystem, /LIFE NOVELTY/iu);
  assert.match(repeated.dynamicSystem, /notes/u);
});

test('parsed turn preserves model-selected response depth and semantic life beat', () => {
  const parsed = parseRinMind({
    act: 'share_self',
    focus: 'поделиться маленькой бытовой деталью',
    stance: 'с лёгкой самоиронией',
    question: { mode: 'none', reason: null },
    replyLink: { targetEventId: null, reason: null },
    delivery: {
      responseDepth: 'short',
      messageShape: 'single',
      segments: [{ type: 'text', purpose: 'life_beat', stickerIntent: null, maxChars: 170, text: 'Купила мандарины. Один оказался настолько кислым, что я теперь считаю это личным конфликтом.' }]
    },
    intentTransition: { operation: 'none', goal: null, motive: null, target: null, nextMove: null, progress: null, commitment: null, reason: null },
    openLoops: { open: [], resolveIds: [] },
    realityMode: 'grounded',
    mind: {
      felt: 'лёгкое веселье',
      wants: 'поделиться мелочью',
      restraint: null,
      socialIntent: 'share_self',
      sceneMotif: 'self_reveal',
      lifeDomain: 'food',
      lifeMotif: 'sour_mandarins',
      frameAlignment: 'aligned',
      literalCorrection: 'none',
      referenceAnchor: null,
      confidence: 91
    }
  });
  assert.equal(parsed.decision.delivery.responseDepth, 'short');
  assert.equal(parsed.mind.lifeDomain, 'food');
  assert.equal(parsed.mind.lifeMotif, 'sour_mandarins');
});

test('life beat is persisted into dialogue state and can be reused as novelty evidence next turn', () => {
  const transition = buildDecisionStateTransition({
    kernelState: {
      revision: 8,
      scene: { type: 'everyday' },
      dialogueState: {
        recentActs: ['answer_directly'],
        recentMotifs: ['direct_exchange'],
        recentMessageShapes: ['single'],
        recentLifeBeats: [{ domain: 'work', motif: 'notes' }]
      }
    },
    decision: baseDecision({ responseDepth: 'short' }),
    mind: { sceneMotif: 'self_reveal', frameAlignment: 'aligned', lifeDomain: 'food', lifeMotif: 'sour_mandarins' }
  });
  assert.deepEqual(transition.dialogueState.recentLifeBeats.slice(-2), [
    { domain: 'work', motif: 'notes' },
    { domain: 'food', motif: 'sour_mandarins' }
  ]);
});

test('response economy applies one hard budget across split bubbles instead of a full budget per bubble', () => {
  const decision = baseDecision({
    responseDepth: 'short',
    messageShape: 'split',
    segments: [
      { type: 'text', purpose: 'reaction', stickerIntent: null, maxChars: 500 },
      { type: 'text', purpose: 'afterthought', stickerIntent: null, maxChars: 500 }
    ]
  });
  const longA = 'Да, я понимаю эту мысль. '.repeat(12).trim();
  const longB = 'И всё-таки мне хочется оставить здесь только один небольшой шаг, а не закрывать весь разговор сразу. '.repeat(8).trim();
  const stabilized = stabilizeTurn({
    decision,
    realization: { segments: [
      { type: 'text', purpose: 'reaction', text: longA },
      { type: 'text', purpose: 'afterthought', text: longB }
    ] },
    fallbackText: 'Я тебя услышала.'
  });
  const total = stabilized.realization.segments.reduce((sum, item) => sum + item.text.length, 0);
  assert.equal(stabilized.decision.delivery.responseDepth, 'short');
  assert.equal(stabilized.decision.delivery.messageShape, 'split');
  assert.equal(stabilized.realization.segments.length, 2);
  assert.ok(total <= responseDepthBudget('short').hard);
  assert.ok(stabilized.warnings.includes('response_depth_budget_applied'));
});

test('extended depth remains available for genuinely long turns', () => {
  assert.equal(responseDepthBudget('normal').soft, 320);
  assert.equal(responseDepthBudget('extended').hard, 1600);
  assert.equal(responseDepthBudget('extended', { longRequested: true }).hard, 2400);
});
