import test from 'node:test';
import assert from 'node:assert/strict';

import { CLOSENESS_MODES, CLOSENESS_FOCI, CLOSENESS_MOVES, normalizePrivateCloseness, recordPrivateCloseness } from '../lib/cognition/private-closeness.js';
import { normalizeDialogueState } from '../lib/cognition/cognitive-contract.js';
import { buildDialogueState } from '../lib/cognition/dialogue-state.js';
import { buildDecisionStateTransition, normalizeTurnDecision } from '../lib/cognition/turn-decision.js';
import { buildRinMindJsonSchema, buildRinMindPrompt, parseRinMind } from '../lib/cognition/rin-mind.js';

const mindChoice = (closenessMode, closenessFocus, closenessMove, extra = {}) => ({
  closenessMode, closenessFocus, closenessMove, contactStance: 'open', ...extra
});

const decision = normalizeTurnDecision({
  act: 'seek_closeness', focus: 'своя нежная инициатива', stance: 'тепло',
  question: { mode: 'none', reason: null }, replyLink: { targetEventId: null, reason: null },
  delivery: { responseDepth: 'short', messageShape: 'single', segments: [{ type: 'text', purpose: 'invite', stickerIntent: null, maxChars: 250 }] },
  intentTransition: { operation: 'none', goal: null, motive: null, target: null, nextMove: null, progress: null, commitment: null, reason: null },
  openLoops: { open: [], resolveIds: [] }, realityMode: 'grounded'
});

function commit(prior, mind, opts = {}) {
  return buildDecisionStateTransition({
    kernelState: {
      revision: opts.revision || 0,
      dialogueState: { privateCloseness: prior, recentActs: [], recentMotifs: [], sceneCommitments: [] },
      privateCloseness: prior,
      conversationState: opts.conversationState || 'ongoing',
      relationalIntegrity: { contactBoundary: { active: Boolean(opts.contactBoundary) } },
      scene: { type: 'everyday' }
    },
    affectiveTurn: null, decision,
    mind, userText: 'Нейтральный разговор', now: 1791900000000
  }).dialogueState.privateCloseness;
}

test('the mode is descriptive, not a numerical intimacy ladder', () => {
  assert.deepEqual(CLOSENESS_MODES, ['everyday', 'tender', 'private', 'quiet']);
  assert.ok(CLOSENESS_FOCI.includes('openness'));
  assert.ok(CLOSENESS_FOCI.includes('affection'));
  assert.ok(CLOSENESS_MOVES.includes('close'));
  assert.equal(normalizePrivateCloseness({ mode: 'unknown', focus: 'explicit_sex' }).mode, 'everyday');
  assert.equal(normalizePrivateCloseness({ mode: 'unknown', focus: 'explicit_sex' }).focus, 'none');
});

test('Rin can autonomously initiate tenderness from an everyday scene', () => {
  const starting = normalizePrivateCloseness();
  const next = commit(starting, mindChoice('tender', 'affection', 'initiate'), { revision: 14 });
  assert.equal(next.mode, 'tender');
  assert.equal(next.move, 'initiate');
  assert.equal(next.shiftedAtTurn, 15);
  assert.equal(next.turnsInMode, 1);
});

test('Rin can choose not to begin romantic closeness at all', () => {
  const next = commit(normalizePrivateCloseness(), mindChoice('everyday', 'none', 'none'));
  assert.equal(next.mode, 'everyday');
  assert.equal(next.move, 'none');
});

test('sensual affection can become openness then quiet presence without changing intent owner', () => {
  const tender = commit(null, mindChoice('tender', 'affection', 'initiate'));
  const intimate = commit(tender, mindChoice('private', 'openness', 'deepen'), { revision: 1 });
  const quiet = commit(intimate, mindChoice('quiet', 'presence', 'shift'), { revision: 2 });
  const ordinary = commit(quiet, mindChoice('everyday', 'none', 'close'), { revision: 3 });
  assert.deepEqual([tender.mode, intimate.mode, quiet.mode, ordinary.mode], ['tender', 'private', 'quiet', 'everyday']);
  assert.equal(intimate.focus, 'openness');
  assert.equal(quiet.move, 'shift');
  assert.equal(ordinary.move, 'close');
  assert.equal(ordinary.recentMoves.length, 4);
});

test('staying affectionate is permitted without automatic deepening', () => {
  let state = commit(null, mindChoice('tender', 'affection', 'initiate'));
  for (let i = 0; i < 12; i++) state = commit(state, mindChoice('tender', 'affection', 'stay'), { revision: i + 1 });
  assert.equal(state.mode, 'tender');
  assert.equal(state.move, 'stay');
  assert.equal(state.turnsInMode, 13);
  assert.equal(state.recentMoves.length, 6);
});

test('explicit farewell and contact boundary close intimate context but do not create new romance', () => {
  const state = commit(null, mindChoice('private', 'mixed', 'deepen'));
  const bye = commit(state, mindChoice('private', 'mixed', 'stay'), { conversationState: 'ending', revision: 4 });
  assert.equal(bye.mode, 'everyday');
  assert.equal(bye.move, 'close');
  const boundary = commit(state, mindChoice('private', 'mixed', 'stay'), { contactBoundary: true, revision: 4 });
  assert.equal(boundary.mode, 'everyday');
  const stance = commit(state, mindChoice('private', 'mixed', 'stay', { contactStance: 'boundary_without_withdrawal' }), { revision: 4 });
  assert.equal(stance.mode, 'everyday');
});

test('a technical fallback does not invent a relationship-mode transition', () => {
  const state = commit(null, mindChoice('private', 'openness', 'deepen'));
  assert.deepEqual(recordPrivateCloseness({ previous: state, mind: { socialIntent: 'stable_fallback' } }), state);
  assert.equal(recordPrivateCloseness({ previous: state, mind: { socialIntent: 'stable_fallback' }, conversationState: 'ending' }).mode, 'everyday');
  assert.equal(recordPrivateCloseness({ previous: state, mind: { socialIntent: 'stable_fallback' }, contactBoundary: true }).mode, 'everyday');
});

test('dialogue memory normalization and reconstruction retain the mode', () => {
  const previous = normalizeDialogueState({ privateCloseness: commit(null, mindChoice('tender', 'affection', 'initiate')) });
  const rebuilt = buildDialogueState({ previousState: previous, history: [], userText: 'Привет', brain: { activeScene: { type: 'everyday', topic: 'приветствие' } } });
  assert.equal(rebuilt.privateCloseness.mode, 'tender');
  assert.equal(rebuilt.privateCloseness.move, 'initiate');
});

test('strict structured output, parsing and prompt share the same modes', () => {
  const schema = buildRinMindJsonSchema().schema.properties.mind;
  for (const field of ['closenessMode','closenessFocus','closenessMove']) assert.ok(schema.required.includes(field));
  assert.deepEqual(schema.properties.closenessMode.enum, CLOSENESS_MODES);
  const turn = {
    act: 'share_self', focus: 'личное', stance: 'тихо', question: { mode: 'none', reason: null },
    replyLink: { targetEventId: null, reason: null },
    delivery: { responseDepth: 'short', messageShape: 'single', segments: [{ type: 'text', purpose: 'message', stickerIntent: null, maxChars: 220, text: 'Мне хочется сказать кое-что личное.' }] },
    intentTransition: { operation: 'none', goal: null, motive: null, target: null, nextMove: null, progress: null, commitment: null, reason: null },
    openLoops: { open: [], resolveIds: [] }, realityMode: 'grounded',
    mind: mindChoice('private', 'openness', 'initiate')
  };
  assert.equal(parseRinMind(turn).mind.closenessMode, 'private');
  const prompt = buildRinMindPrompt({ state: { privateCloseness: normalizePrivateCloseness() } });
  assert.match(prompt.stableSystem, /Private Closeness/);
  assert.match(prompt.stableSystem, /НЕ требуется романтический запрос пользователя/);
  assert.match(prompt.dynamicSystem, /PRIVATE CLOSENESS CONTINUITY/);
});
