import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeConversation } from '../lib/conversation-brain.js';
import { detectAffectiveSignal } from '../lib/cognition/emotional-state.js';
import { buildRinMindPrompt } from '../lib/cognition/rin-mind.js';
import { buildDecisionStateTransition, normalizeTurnDecision } from '../lib/cognition/turn-decision.js';

const profile = {
  prompt_profile: {
    identity: { full_name: 'Рин Акихара', name_japanese: '秋原 凛' },
    reference_character: { core: 'Живая взрослая женщина со своим мнением.', principles: [], imperfections: [] },
    voice: { description: 'Личная русская переписка.', principles: [] }
  },
  base_rules: 'Сохраняй характер Рин.'
};

const decision = (overrides = {}) => normalizeTurnDecision({
  act: 'respond_personally',
  focus: 'ответить на текущую сцену',
  stance: 'личная позиция Рин',
  question: { mode: 'none', reason: null },
  replyLink: { targetEventId: null, reason: null },
  delivery: {
    responseDepth: 'short',
    messageShape: 'single',
    segments: [{ type: 'text', purpose: 'reply', stickerIntent: null, maxChars: 220 }]
  },
  intentTransition: { operation: 'none', goal: null, motive: null, target: null, nextMove: null, progress: null, commitment: null, reason: null },
  openLoops: { open: [], resolveIds: [] },
  realityMode: 'grounded',
  ...overrides
});

const mind = (overrides = {}) => ({
  sceneMotif: 'tender_presence',
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

function transitionFrom(commitments, mindTurn, { revision = 10, userText = '', scene = 'everyday', act = 'respond_personally' } = {}) {
  return buildDecisionStateTransition({
    kernelState: {
      revision,
      userText,
      conversationState: 'ongoing',
      scene: { type: scene },
      dialogueState: { sceneCommitments: commitments }
    },
    decision: decision({ act }),
    mind: mindTurn,
    userText
  });
}

test('v2.4.8 infers an until_sleep horizon for a time-bounded agreement', () => {
  const subject = 'До сна не заниматься заметками и просто побыть вместе.';
  const transition = transitionFrom([], mind({
    commitmentAction: 'establish',
    commitmentSubject: subject,
    commitmentOwner: 'shared',
    commitmentStrength: 82,
    commitmentReason: 'Рин согласилась оставить заметки до завтра'
  }), { revision: 3 });
  const commitment = transition.dialogueState.sceneCommitments.at(-1);
  assert.equal(commitment.status, 'active');
  assert.equal(commitment.horizon, 'until_sleep');
  assert.equal(commitment.lastAction, 'establish');
});

test('v2.4.8 compromise keeps the parent commitment active', () => {
  const current = {
    id: 'commit-notes',
    subject: 'До сна не заниматься заметками и просто побыть вместе.',
    owner: 'shared',
    status: 'active',
    horizon: 'until_sleep',
    strength: 82,
    lastAction: 'honor',
    createdAtTurn: 4,
    updatedAtTurn: 9
  };
  const transition = transitionFrom([current], mind({
    commitmentAction: 'compromise',
    commitmentConflict: 'mild',
    commitmentTargetId: 'commit-notes',
    commitmentSubject: current.subject,
    commitmentOwner: 'shared',
    commitmentStrength: 82,
    commitmentReason: 'записать только одно-два слова и сразу закрыть заметки'
  }));
  const commitment = transition.dialogueState.sceneCommitments.at(-1);
  assert.equal(commitment.status, 'active');
  assert.equal(commitment.lastAction, 'compromise');
  assert.equal(commitment.horizon, 'until_sleep');
});

test('v2.4.8 rejects premature parent fulfill when only a compromise step finished', () => {
  const current = {
    id: 'commit-notes',
    subject: 'До сна не заниматься заметками и просто побыть вместе.',
    owner: 'shared',
    status: 'active',
    horizon: 'until_sleep',
    strength: 82,
    lastAction: 'compromise',
    createdAtTurn: 4,
    updatedAtTurn: 10
  };
  const transition = transitionFrom([current], mind({
    commitmentAction: 'fulfill',
    commitmentTargetId: 'commit-notes',
    commitmentSubject: current.subject,
    commitmentOwner: 'shared',
    commitmentStrength: 82,
    commitmentReason: 'два слова уже записаны'
  }), { userText: 'Записала: «дождь» и «рядом». Всё, заметки закрыты — возвращаюсь к тебе.' });
  const commitment = transition.dialogueState.sceneCommitments.at(-1);
  assert.equal(commitment.status, 'active');
  assert.equal(commitment.lastAction, 'honor');
  assert.equal(commitment.terminalAtTurn, null);
});

test('v2.4.8 fulfills until_sleep commitment on the actual goodnight boundary even if model only honors it', () => {
  const current = {
    id: 'commit-notes',
    subject: 'До сна не заниматься заметками и просто побыть вместе.',
    owner: 'shared',
    status: 'active',
    horizon: 'until_sleep',
    strength: 82,
    lastAction: 'honor',
    createdAtTurn: 4,
    updatedAtTurn: 23
  };
  const transition = transitionFrom([current], mind({
    sceneMotif: 'farewell',
    commitmentAction: 'honor',
    commitmentTargetId: 'commit-notes',
    commitmentSubject: current.subject,
    commitmentOwner: 'shared',
    commitmentStrength: 82
  }), {
    revision: 23,
    userText: 'Иду. А теперь под одеяло, без «ещё минутку». Спокойной ночи, мой хороший.',
    scene: 'farewell',
    act: 'say_goodbye'
  });
  const commitment = transition.dialogueState.sceneCommitments.at(-1);
  assert.equal(commitment.status, 'fulfilled');
  assert.equal(commitment.lastAction, 'fulfill');
  assert.equal(commitment.terminalReason, 'horizon_reached:until_sleep');
  assert.equal(commitment.terminalAtTurn, 24);
});

test('v2.4.8 terminal commitment cannot be silently resurrected by honor', () => {
  const current = {
    id: 'commit-notes',
    subject: 'До сна не заниматься заметками и просто побыть вместе.',
    owner: 'shared',
    status: 'fulfilled',
    horizon: 'until_sleep',
    strength: 82,
    lastAction: 'fulfill',
    terminalReason: 'horizon_reached:until_sleep',
    terminalAtTurn: 24,
    createdAtTurn: 4,
    updatedAtTurn: 24
  };
  const transition = transitionFrom([current], mind({
    commitmentAction: 'honor',
    commitmentTargetId: 'commit-notes',
    commitmentSubject: current.subject,
    commitmentOwner: 'shared',
    commitmentStrength: 82
  }), { revision: 24, userText: 'Я рядом.' });
  const commitment = transition.dialogueState.sceneCommitments.at(-1);
  assert.equal(commitment.status, 'fulfilled');
  assert.equal(commitment.lastAction, 'fulfill');
  assert.equal(commitment.updatedAtTurn, 24);
});

test('v2.4.8 prompt exposes only live commitments and explains residual scope', () => {
  const prompt = buildRinMindPrompt({
    profile,
    state: {
      behaviorState: {},
      driveState: {},
      dialogueState: {
        sceneCommitments: [
          { id: 'done', subject: 'вчера лечь пораньше', owner: 'shared', status: 'fulfilled', lastAction: 'fulfill' },
          { id: 'live', subject: 'До сна не заниматься заметками', owner: 'shared', status: 'active', horizon: 'until_sleep', lastAction: 'honor' }
        ]
      },
      recentHistory: []
    }
  });
  assert.match(prompt.stableSystem, /compromise\/renegotiate НЕ завершают/iu);
  assert.match(prompt.stableSystem, /fulfill означает, что выполнена ВСЯ договорённость/iu);
  assert.match(prompt.stableSystem, /НЕ являются relationship repair/iu);
  assert.match(prompt.dynamicSystem, /До сна не заниматься заметками/iu);
  assert.doesNotMatch(prompt.dynamicSystem, /вчера лечь пораньше/iu);
});

test('v2.4.8 does not treat «простил» as an apology or conflict repair', () => {
  const userText = 'Ну вот, два слова я тебе простил) Иди сюда 😏';
  const brain = analyzeConversation({ userText, history: [] });
  assert.notEqual(brain.literalIntent, 'apology');
  assert.notEqual(brain.activeScene.type, 'conflict_repair');
  assert.notEqual(brain.emotionalDirection, 'repair');
  const signal = detectAffectiveSignal({ userText, brain, relationship: { closeness: 60, attraction: 55, playfulness: 65 } });
  assert.notEqual(signal.type, 'repair');
});
