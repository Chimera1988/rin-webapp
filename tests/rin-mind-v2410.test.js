import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeInnerLife } from '../public/lib/inner-life-contract.js';
import { inspectRelationalConstancy } from '../lib/cognition/relational-constancy.js';
import { buildRinMindJsonSchema, buildRinMindPrompt, parseRinMind } from '../lib/cognition/rin-mind.js';

const profile = {
  prompt_profile: {
    identity: { full_name: 'Рин Акихара', name_japanese: '秋原 凛' },
    reference_character: { core: 'Живая взрослая женщина со своим мнением.', principles: [], imperfections: [] },
    voice: { description: 'Личная русская переписка.', principles: [] },
    relationship: {
      relationship_philosophy: {
        core: 'Связь остаётся ценной и в сложном состоянии.',
        principles: ['Усталость меняет форму общения, но не отменяет контакт.', 'Рин может честно показывать уязвимость.']
      }
    }
  },
  base_rules: 'Сохраняй характер Рин.'
};

const relationship = { closeness: 76, trust: 80, comfort: 78, vulnerability: 64, respect: 80, playfulness: 58, attraction: 52 };

function constancy(overrides = {}) {
  return inspectRelationalConstancy({
    innerLife: { energy: 34, mentalLoad: 76, needForQuiet: 72, desireToShare: 66 },
    emotionalState: { primary: null },
    relationship,
    mood: { energy: 38 },
    userText: 'Я рядом',
    conversationState: 'ongoing',
    ...overrides
  });
}

function modelTurn(mindOverrides = {}) {
  return {
    act: 'share_self',
    focus: 'остаться рядом честно',
    stance: 'тихая и открытая',
    question: { mode: 'none', reason: null },
    replyLink: { targetEventId: null, reason: null },
    delivery: {
      responseDepth: 'short',
      messageShape: 'single',
      segments: [{ type: 'text', purpose: 'reply', stickerIntent: null, maxChars: 220, text: 'Я сегодня немного тихая, но я здесь.' }]
    },
    intentTransition: { operation: 'none', goal: null, motive: null, target: null, nextMove: null, progress: null, commitment: null, reason: null },
    openLoops: { open: [], resolveIds: [] },
    realityMode: 'grounded',
    mind: {
      felt: 'усталость и доверие',
      wants: 'не прятать состояние и остаться в контакте',
      restraint: null,
      socialIntent: 'quiet_presence',
      sceneMotif: 'tender_presence',
      lifeDomain: 'none',
      lifeMotif: null,
      frameAlignment: 'aligned',
      literalCorrection: 'none',
      referenceAnchor: null,
      sharedSymbolId: null,
      sharedSymbolExpression: 'none',
      sharedSymbolReason: null,
      contactStance: 'quiet_presence',
      selfStateDisclosure: 'light',
      selfStateDisclosureReason: 'состояние заметно влияет на текущий контакт',
      commitmentAction: 'none',
      commitmentConflict: 'none',
      commitmentTargetId: null,
      commitmentSubject: null,
      commitmentOwner: 'none',
      commitmentStrength: 0,
      commitmentReason: null,
      confidence: 88,
      ...mindOverrides
    }
  };
}

test('v2.4.10 inner-life v4 normalizes persistent regulation state', () => {
  const life = normalizeInnerLife({
    energy: 31,
    mentalLoad: 87,
    needForQuiet: 76,
    desireToShare: 68,
    unfinishedThought: 'вернуться к сложной формулировке',
    carryover: 'до этого работала с текстом'
  });
  assert.equal(life.schema, 'rin-inner-life-v4');
  assert.equal(life.energy, 31);
  assert.equal(life.mentalLoad, 87);
  assert.equal(life.needForQuiet, 76);
  assert.equal(life.desireToShare, 68);
  assert.match(life.unfinishedThought, /формулировк/iu);
});

test('v2.4.10 high need for quiet becomes quiet presence rather than withdrawal', () => {
  const state = constancy();
  assert.equal(state.quietPresencePreferred, true);
  assert.ok(state.contactPriority >= 90);
  assert.match(state.guidance, /не являются причиной.*просить написать позже/iu);
});

test('v2.4.10 relational safety can make difficult state shareable', () => {
  const state = constancy({
    emotionalState: { primary: { type: 'fatigue', intensity: 62 } },
    innerLife: { energy: 30, mentalLoad: 82, needForQuiet: 75, desireToShare: 70 }
  });
  assert.equal(state.vulnerabilityAllowed, true);
  assert.equal(state.disclosureOpportunity, true);
  assert.ok(state.relationalSafety >= 60);
});

test('v2.4.10 relational constancy does not cling to an explicit farewell', () => {
  const state = constancy({ userText: 'Спокойной ночи, до завтра', conversationState: 'ending' });
  assert.equal(state.explicitFarewell, true);
  assert.match(state.guidance, /уважай завершение сцены/iu);
});

test('v2.4.10 structured contract exposes contact stance and self-state disclosure', () => {
  const mind = buildRinMindJsonSchema().schema.properties.mind;
  for (const key of ['contactStance', 'selfStateDisclosure', 'selfStateDisclosureReason']) assert.ok(mind.required.includes(key));
  assert.deepEqual(mind.properties.contactStance.enum, ['open', 'quiet_presence', 'supportive_presence', 'strained_presence', 'boundary_without_withdrawal']);
  assert.deepEqual(mind.properties.selfStateDisclosure.enum, ['none', 'light', 'direct']);
});

test('v2.4.10 prompt encodes contact-first constancy without forced positivity', () => {
  const relationalConstancy = constancy();
  const prompt = buildRinMindPrompt({
    profile,
    state: {
      behaviorState: {},
      driveState: {},
      sharedSymbolState: { candidates: [], recentUses: [], guidance: '' },
      relationalConstancy,
      innerLife: { activity: 'редактирует перевод', energy: 34, mentalLoad: 76, needForQuiet: 72, desireToShare: 66, unfinishedThought: 'довести абзац' },
      dialogueState: { recentSharedSymbols: [] },
      recentHistory: []
    }
  });
  assert.match(prompt.stableSystem, /Relational Constancy \+ Emotional Openness/iu);
  assert.match(prompt.stableSystem, /НЕ являются причиной.*«напиши позже»/iu);
  assert.match(prompt.stableSystem, /не обязана изображать бодрость/iu);
  assert.match(prompt.stableSystem, /Связь остаётся ценной/iu);
  assert.match(prompt.dynamicSystem, /RELATIONAL CONSTANCY/iu);
  assert.match(prompt.dynamicSystem, /quietPresence=yes/iu);
});

test('v2.4.10 prompt sees persistent life regulation fields without turning them into mandatory disclosure', () => {
  const prompt = buildRinMindPrompt({
    profile,
    state: {
      behaviorState: {}, driveState: {}, sharedSymbolState: { candidates: [], recentUses: [], guidance: '' },
      relationalConstancy: constancy(),
      innerLife: { activity: 'работает с текстом', activityGoal: 'закончить абзац', focus: 'точность', energy: 33, mentalLoad: 79, needForQuiet: 71, desireToShare: 63, unfinishedThought: 'вернуться к последней формулировке', carryover: 'до этого пила чай', realityMode: 'simulated_character_world' },
      recentHistory: []
    }
  });
  assert.match(prompt.dynamicSystem, /mentalLoad/iu);
  assert.match(prompt.dynamicSystem, /needForQuiet/iu);
  assert.match(prompt.stableSystem, /не превращай каждое значение в буквальный отчёт/iu);
});

test('v2.4.10 parser preserves a quiet-presence choice and disclosure level', () => {
  const parsed = parseRinMind(modelTurn(), { behaviorState: {}, sharedSymbolState: { candidates: [] } });
  assert.equal(parsed.mind.contactStance, 'quiet_presence');
  assert.equal(parsed.mind.selfStateDisclosure, 'light');
  assert.match(parsed.mind.selfStateDisclosureReason, /состояние/iu);
});

test('v2.4.10 boundary can coexist with continued contact', () => {
  const parsed = parseRinMind(modelTurn({
    contactStance: 'boundary_without_withdrawal',
    selfStateDisclosure: 'direct',
    selfStateDisclosureReason: 'Рин раздражена конкретным тоном и говорит об этом прямо'
  }), { behaviorState: {}, sharedSymbolState: { candidates: [] } });
  assert.equal(parsed.mind.contactStance, 'boundary_without_withdrawal');
  assert.equal(parsed.mind.selfStateDisclosure, 'direct');
});
