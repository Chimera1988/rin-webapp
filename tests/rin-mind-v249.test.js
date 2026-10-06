import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeMemoryResult } from '../api/memory.js';
import { inspectSharedSymbols } from '../lib/cognition/shared-symbols.js';
import { buildRinMindJsonSchema, buildRinMindPrompt, parseRinMind } from '../lib/cognition/rin-mind.js';
import { buildDecisionStateTransition, normalizeTurnDecision } from '../lib/cognition/turn-decision.js';

const kitsune = {
  id: 'kitsune',
  label: 'Китсуне',
  scope: 'relationship_private',
  privacy: 'private',
  origin: 'сон пользователя и их общая история',
  meaning: 'приватная грань Рин: мягкая хитрость, недосказанность и тёплая игровая близость',
  aliases: ['кицунэ', 'моя кицунэ', 'твоя кицунэ'],
  associations: ['взаимная игра', 'маленькие секреты', 'недосказанность', 'тёплый флирт'],
  fit_motifs: ['playful_roleplay', 'mystery', 'challenge', 'tender_presence'],
  fit_emotions: ['playfulness', 'tenderness', 'shyness'],
  fit_momentum: ['playful', 'warming'],
  manifestations: ['может стать чуть хитрее без буквального называния образа'],
  avoid: ['не превращать образ в режим или обязательную реакцию'],
  salience: 68,
  min_closeness: 48
};

const profile = {
  prompt_profile: {
    identity: { full_name: 'Рин Акихара', name_japanese: '秋原 凛' },
    relationship: { shared_symbols: [kitsune] },
    reference_character: { core: 'Живая взрослая женщина со своим мнением.', principles: [], imperfections: [] },
    voice: { description: 'Личная русская переписка.', principles: [] }
  },
  base_rules: 'Сохраняй характер Рин.'
};

const relationship = { closeness: 72, trust: 75, comfort: 74, playfulness: 68, attraction: 58, respect: 75 };

function inspect(overrides = {}) {
  return inspectSharedSymbols({
    profile,
    memory: { relationship },
    userText: 'Я рядом.',
    history: [],
    brain: { activeScene: { type: 'everyday', topic: 'обычный разговор' }, hiddenIntent: { type: 'none' } },
    affectiveTurn: { relationshipState: relationship, emotionalState: { primary: null, momentum: { direction: 'steady' } } },
    dialogueState: { recentMotifs: [], recentSharedSymbols: [] },
    activeIntent: null,
    ...overrides
  });
}

function decision() {
  return normalizeTurnDecision({
    act: 'playful_tease',
    focus: 'продолжить текущую игру',
    stance: 'лёгкая личная хитрость',
    question: { mode: 'none', reason: null },
    replyLink: { targetEventId: null, reason: null },
    delivery: { responseDepth: 'short', messageShape: 'single', segments: [{ type: 'text', purpose: 'reply', stickerIntent: null, maxChars: 220 }] },
    intentTransition: { operation: 'none', goal: null, motive: null, target: null, nextMove: null, progress: null, commitment: null, reason: null },
    openLoops: { open: [], resolveIds: [] },
    realityMode: 'grounded'
  });
}

function mind(overrides = {}) {
  return {
    sceneMotif: 'playful_roleplay',
    frameAlignment: 'aligned',
    lifeDomain: 'none',
    lifeMotif: null,
    sharedSymbolId: null,
    sharedSymbolExpression: 'none',
    sharedSymbolReason: null,
    commitmentAction: 'none',
    commitmentConflict: 'none',
    commitmentTargetId: null,
    commitmentSubject: null,
    commitmentOwner: 'none',
    commitmentStrength: 0,
    commitmentReason: null,
    ...overrides
  };
}

test('v2.4.9 keeps private symbols out of neutral scenes despite relationship closeness', () => {
  const state = inspect();
  assert.equal(state.candidates.length, 0);
});

test('v2.4.9 can surface Kitsune associatively without a literal Kitsune trigger', () => {
  const state = inspect({
    userText: 'Ты сейчас явно что-то задумала)',
    affectiveTurn: {
      relationshipState: relationship,
      emotionalState: { primary: { type: 'playfulness' }, momentum: { direction: 'playful' } }
    },
    dialogueState: { recentMotifs: ['mystery', 'challenge'], recentSharedSymbols: [] }
  });
  assert.equal(state.candidates[0]?.id, 'kitsune');
  assert.equal(state.candidates[0]?.directRecall, false);
  assert.ok(state.candidates[0]?.activation >= 40);
});

test('v2.4.9 literal mention raises availability but remains a candidate rather than a forced mode', () => {
  const state = inspect({ userText: 'Ну что, моя кицунэ?)' });
  assert.equal(state.candidates[0]?.id, 'kitsune');
  assert.equal(state.candidates[0]?.directRecall, true);
  assert.match(state.guidance, /не триггеры|не использовать/iu);
});

test('v2.4.9 repetition pressure suppresses self-initiated symbol callbacks', () => {
  const fresh = inspect({
    affectiveTurn: { relationshipState: relationship, emotionalState: { primary: { type: 'playfulness' }, momentum: { direction: 'playful' } } },
    dialogueState: { recentMotifs: ['mystery', 'challenge'], recentSharedSymbols: [] }
  });
  const repeated = inspect({
    affectiveTurn: { relationshipState: relationship, emotionalState: { primary: { type: 'playfulness' }, momentum: { direction: 'playful' } } },
    dialogueState: {
      recentMotifs: ['mystery', 'challenge'],
      recentSharedSymbols: Array.from({ length: 6 }, () => ({ id: 'kitsune', expression: 'explicit' }))
    }
  });
  assert.equal(fresh.candidates[0]?.id, 'kitsune');
  assert.equal(repeated.candidates.length, 0);
});

test('v2.4.9 structured contract makes symbol use an explicit optional decision', () => {
  const schema = buildRinMindJsonSchema().schema.properties.mind;
  for (const key of ['sharedSymbolId', 'sharedSymbolExpression', 'sharedSymbolReason']) assert.ok(schema.required.includes(key));
  assert.deepEqual(schema.properties.sharedSymbolExpression.enum, ['none', 'subtle', 'explicit', 'evolve']);
});

test('v2.4.9 prompt explicitly forbids trigger-response Kitsune behavior', () => {
  const symbolState = inspect({
    affectiveTurn: { relationshipState: relationship, emotionalState: { primary: { type: 'playfulness' }, momentum: { direction: 'playful' } } },
    dialogueState: { recentMotifs: ['mystery'], recentSharedSymbols: [] }
  });
  const prompt = buildRinMindPrompt({
    profile,
    state: {
      behaviorState: {},
      driveState: {},
      sharedSymbolState: symbolState,
      dialogueState: { recentSharedSymbols: [] },
      recentHistory: []
    }
  });
  assert.match(prompt.stableSystem, /НЕ команды и НЕ персонажи-режимы/iu);
  assert.match(prompt.stableSystem, /Самостоятельный callback допустим/iu);
  assert.match(prompt.stableSystem, /repetitionPressure/iu);
  assert.match(prompt.dynamicSystem, /kitsune activation=/iu);
  assert.match(prompt.dynamicSystem, /НЕ ОБЯЗАТЕЛЬНА/iu);
});

test('v2.4.9 records only actually expressed shared symbols in dialogue state', () => {
  const used = buildDecisionStateTransition({
    kernelState: { revision: 4, scene: { type: 'playful_flirt' }, dialogueState: { recentSharedSymbols: [] } },
    decision: decision(),
    mind: mind({ sharedSymbolId: 'kitsune', sharedSymbolExpression: 'subtle', sharedSymbolReason: 'сцена сама пришла к мягкой хитрости' })
  });
  assert.deepEqual(used.dialogueState.recentSharedSymbols, [{ id: 'kitsune', expression: 'subtle' }]);

  const unused = buildDecisionStateTransition({
    kernelState: { revision: 5, scene: { type: 'everyday' }, dialogueState: used.dialogueState },
    decision: decision(),
    mind: mind()
  });
  assert.deepEqual(unused.dialogueState.recentSharedSymbols, [{ id: 'kitsune', expression: 'subtle' }]);
});

test('v2.4.9 memory extractor sanitizes a relationship-private shared symbol', () => {
  const result = sanitizeMemoryResult({
    sharedSymbols: [{
      id: 'kitsune', label: 'Китсуне', origin: 'их общий образ', meaning: 'личная игровая метафора',
      aliases: ['кицунэ'], associations: ['недосказанность'], manifestations: ['мягкая хитрость'],
      avoid: ['не режим'], salience: 72, minCloseness: 50, importance: 8
    }]
  });
  assert.equal(result.schemaVersion, 5);
  assert.equal(result.sharedSymbols[0].id, 'kitsune');
  assert.equal(result.sharedSymbols[0].scope, 'relationship_private');
  assert.equal(result.sharedSymbols[0].privacy, 'private');
});

test('v2.4.9 parser rejects a hallucinated symbol id that was not offered as a candidate', () => {
  const parsed = parseRinMind({
    act: 'playful_tease',
    focus: 'ответить',
    stance: 'игривая',
    question: { mode: 'none', reason: null },
    replyLink: { targetEventId: null, reason: null },
    delivery: { responseDepth: 'short', messageShape: 'single', segments: [{ type: 'text', purpose: 'reply', stickerIntent: null, maxChars: 220, text: 'Может быть)' }] },
    intentTransition: { operation: 'none', goal: null, motive: null, target: null, nextMove: null, progress: null, commitment: null, reason: null },
    openLoops: { open: [], resolveIds: [] },
    realityMode: 'grounded',
    mind: {
      felt: 'игривость', wants: 'подразнить', restraint: null, socialIntent: 'playful_tease',
      sceneMotif: 'mystery', lifeDomain: 'none', lifeMotif: null, frameAlignment: 'aligned', literalCorrection: 'none', referenceAnchor: null,
      sharedSymbolId: 'dragon_mode', sharedSymbolExpression: 'explicit', sharedSymbolReason: 'придумала сама',
      commitmentAction: 'none', commitmentConflict: 'none', commitmentTargetId: null, commitmentSubject: null, commitmentOwner: 'none', commitmentStrength: 0, commitmentReason: null,
      confidence: 90
    }
  }, {
    sharedSymbolState: { candidates: [{ id: 'kitsune' }] }
  });
  assert.equal(parsed.mind.sharedSymbolId, null);
  assert.equal(parsed.mind.sharedSymbolExpression, 'none');
});
