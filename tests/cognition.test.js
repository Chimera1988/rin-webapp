import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAffectiveTurn, buildCognitiveTurn, buildStateTransition, planResponse, verifyReply } from '../lib/cognition/index.js';
import { normalizeResponsePlan } from '../lib/cognition/cognitive-contract.js';
import { analyzeConversation } from '../lib/conversation-brain.js';
import { polishRinReply } from '../lib/personality/anti-gpt.js';
import { createChatMessage } from '../public/js/chat_store.js';

const closeMemory = {
  facts: { user: { name: 'Алексей', project: 'Rin' } },
  relationship: { trust: 82, closeness: 76, playfulness: 68 },
  openLoops: [
    { id: 'letter', text: 'Пользователь обещал показать письмо редактора', type: 'plan', importance: 8 }
  ]
};

test('correction becomes the active dialogue frame and response obligation', () => {
  const brain = {
    literalIntent: 'statement',
    hiddenIntent: { type: 'none', confidence: 35 },
    relation: { type: 'correction', confidence: 94 },
    activeScene: { type: 'everyday', topic: 'интонация перевода', confidence: 82 },
    referents: ['active_subject'],
    ambiguity: { shouldClarify: false },
    obligations: ['Прими исправление и перестрой понимание; не защищай прежнюю трактовку.'],
    responseFocus: 'Принять исправление пользователя.'
  };
  const history = [
    { role: 'assistant', kind: 'text', content: 'Там чувствуется настороженность.' },
    { role: 'user', kind: 'text', content: 'Нет, он просто очень устал.' }
  ];
  const cognition = buildCognitiveTurn({ userText: history[1].content, history, memory: closeMemory, brain });
  assert.equal(cognition.dialogueState.relationToPreviousTurn, 'correction');
  assert.match(cognition.dialogueState.corrections.at(-1), /очень устал/);
  assert.equal(cognition.beliefModel.correction.active, true);

  const plan = planResponse({ cognition, brain, memory: closeMemory, userText: history[1].content, history });
  assert.equal(plan.goal, 'принять исправление и продолжить уже в новой фактической рамке');
  assert.equal(plan.directness, 'direct_accountable');
  assert.equal(plan.shouldAskQuestion, false);
});

test('close relationship allows confident playful tone without forcing a question', () => {
  const brain = {
    literalIntent: 'statement',
    hiddenIntent: { type: 'none', confidence: 35 },
    relation: { type: 'continuation', confidence: 70 },
    activeScene: { type: 'playful_flirt', topic: 'лёгкий флирт', confidence: 86 },
    referents: ['rin', 'user'],
    ambiguity: { shouldClarify: false },
    obligations: [],
    responseFocus: 'Ответить на поддразнивание лично.'
  };
  const history = [
    { role: 'user', kind: 'text', content: 'Ты сегодня особенно красивая.' }
  ];
  const cognition = buildCognitiveTurn({ userText: history[0].content, history, memory: closeMemory, brain });
  const plan = planResponse({ cognition, brain, memory: closeMemory, userText: history[0].content, history, coreDecision: { mode: 'bold_playful' } });
  assert.equal(plan.tone, 'warm_bold_playful');
  assert.equal(plan.directness, 'confident_playful');
  assert.match(plan.stance, /подкол|настойчивость/);
});

test('remembered open loop is available but not forced into a direct question turn', () => {
  const brain = {
    literalIntent: 'question',
    hiddenIntent: { type: 'none', confidence: 35 },
    relation: { type: 'new_or_followup_question', confidence: 70 },
    activeScene: { type: 'everyday', topic: 'новый вопрос', confidence: 70 },
    referents: [],
    ambiguity: { shouldClarify: false },
    obligations: ['Сначала ответь на поставленный вопрос.'],
    responseFocus: 'Ответить на вопрос.'
  };
  const history = [{ role: 'user', kind: 'text', content: 'Ты ещё не спишь?' }];
  const cognition = buildCognitiveTurn({ userText: history[0].content, history, memory: closeMemory, brain });
  assert.equal(cognition.openLoops.active[0].id, 'letter');
  assert.equal(cognition.openLoops.callback, null);
  const plan = planResponse({ cognition, brain, memory: closeMemory, userText: history[0].content, history });
  assert.equal(plan.initiative, 'none');
});

test('verifier removes an unplanned generic trailing question', () => {
  const result = verifyReply('Я ещё не сплю. А ты?', {
    plan: { shouldAskQuestion: false, delivery: 'text' },
    brain: { literalIntent: 'statement', relation: { type: 'continuation' } },
    userText: 'Я только закончил работу.'
  });
  assert.equal(result.reply, 'Я ещё не сплю.');
  assert.ok(result.repairs.includes('removed_unplanned_generic_question'));
});

test('state transition preserves the canonical caused emotional state and recent open loop', () => {
  const cognition = {
    beliefModel: { currentStatement: null },
    openLoops: {
      active: [{ id: 'later', subject: 'Пользователь позже покажет письмо', source: 'recent_dialogue', importance: 70 }]
    }
  };
  const memory = {
    mood: { affection: 68, energy: 55 },
    relationship: { trust: 82, closeness: 76, comfort: 72, respect: 80, playfulness: 68, attraction: 58, vulnerability: 42 }
  };
  const affectiveTurn = buildAffectiveTurn({
    userText: 'Меня пригласила девушка на встречу вечером', memory,
    brain: { activeScene: { type: 'romance' }, hiddenIntent: { type: 'none' }, literalIntent: 'statement' }
  });
  const transition = buildStateTransition({ cognition, affectiveTurn });
  assert.equal(transition.schema, 'rin-state-transition-v2');
  assert.equal(transition.emotionalState.primary.type, 'jealousy');
  assert.match(transition.emotionalState.primary.cause, /другой девушк/);
  assert.equal(transition.emotionalState.momentum.direction, 'tense');
  // Legacy mirror remains for one release, but it is derived from the canonical state.
  assert.equal(transition.emotionalTrace.emotion, 'jealousy');
  assert.equal(transition.openLoopUpdates.length, 1);
});


test('verifier converts a meta-only nonverbal leak into a safe sticker recovery', () => {
  const result = verifyReply('[Невербальный жест Рин: кивок, подтверждающий согласие; причина: поддержка]', {
    plan: { shouldAskQuestion: false, delivery: 'text' },
    brain: { literalIntent: 'short_confirmation', relation: { type: 'acknowledges_previous_turn' } },
    userText: 'Ага)'
  });
  assert.equal(result.reply, 'Угу.');
  assert.equal(result.nonverbalLeak?.metaOnly, true);
  assert.equal(result.nonverbalLeak?.preferredStickerId, 'agreement');
  assert.ok(result.repairs.includes('replaced_meta_only_nonverbal_reply'));
  assert.doesNotMatch(result.reply, /Невербальный жест Рин/);
});

test('verifier removes an embedded nonverbal service block without deleting natural text', () => {
  const result = verifyReply('Поняла тебя. [Невербальный жест Рин: лёгкая улыбка; причина: поддержка]', {
    plan: { shouldAskQuestion: false, delivery: 'text' },
    brain: { literalIntent: 'statement', relation: { type: 'continuation' } },
    userText: 'Хорошо'
  });
  assert.equal(result.reply, 'Поняла тебя.');
  assert.equal(result.nonverbalLeak?.metaOnly, false);
  assert.ok(result.repairs.includes('removed_internal_nonverbal_meta'));
});


test('intentional silence is a first-class prior action on the next user turn', () => {
  const history = [
    { id: 'a-silence', role: 'assistant', kind: 'silence', status: 'complete', content: '', silence: { reason: 'не стала растягивать закрытую микросцену', scene: 'everyday' } },
    { id: 'u-after-silence', role: 'user', kind: 'text', status: 'sent', content: 'Обиделась?' }
  ];
  const brain = analyzeConversation({ userText: 'Обиделась?', history });
  assert.equal(brain.hiddenIntent.type, 'ask_about_previous_nonverbal');
  assert.match(brain.activeScene.topic, /промолчала/i);
  const cognition = buildCognitiveTurn({ userText: 'Обиделась?', history, memory: closeMemory, brain });
  assert.equal(cognition.dialogueState.lastRinAction.kind, 'silence');
  assert.match(cognition.dialogueState.lastRinAction.cause, /микросцен/i);
});

test('context-dependent ambiguity can request clarification, while an explicit reply target resolves it', () => {
  const prior = [
    { id: 'u1', role: 'user', kind: 'text', status: 'complete', content: 'Редактор прислал письмо.' },
    { id: 'a1', role: 'assistant', kind: 'text', status: 'complete', content: 'Ты ещё упоминал коллегу.' },
    { id: 'u2', role: 'user', kind: 'text', status: 'complete', content: 'И переводчик был недоволен.' },
    { id: 'a2', role: 'assistant', kind: 'text', status: 'complete', content: 'Там уже три разные линии.' }
  ];
  const ambiguousTurn = { id: 'u3', role: 'user', kind: 'text', status: 'sent', content: 'Это связано с ним.' };
  const ambiguous = analyzeConversation({ userText: ambiguousTurn.content, history: [...prior, ambiguousTurn] });
  assert.ok(ambiguous.referents.includes('context_dependent_reference'));
  assert.equal(ambiguous.ambiguity.shouldClarify, true);
  assert.ok(ambiguous.ambiguity.level >= 75);

  const explicitTurn = {
    ...ambiguousTurn, id: 'u4', inReplyTo: 'a1',
    replySnapshot: { messageId: 'a1', role: 'assistant', kind: 'text', excerpt: 'Ты ещё упоминал коллегу.' }
  };
  const resolved = analyzeConversation({ userText: explicitTurn.content, history: [...prior, explicitTurn] });
  assert.equal(resolved.ambiguity.shouldClarify, false);
  assert.equal(resolved.ambiguity.level, 18);
});

test('long reply paragraphs survive polish, verification and chat persistence', () => {
  const source = 'Я сначала отвечу на сам вопрос. Здесь есть две части, и обе важны.\n\nВо второй части я бы оставила именно эту формулировку. Она точнее сохраняет интонацию.';
  const polished = polishRinReply(source, { replyStyle: 'direct', intent: 'connection' });
  assert.match(polished, /важны\.\n\nВо второй/);
  const verified = verifyReply(polished, {
    plan: { shouldAskQuestion: false, delivery: 'text', length: 'long' },
    brain: { literalIntent: 'statement', relation: { type: 'continuation' } },
    userText: 'Расскажи подробнее.'
  });
  assert.match(verified.reply, /важны\.\n\nВо второй/);
  const stored = createChatMessage({ role: 'assistant', kind: 'text', status: 'complete', content: verified.reply });
  assert.match(stored.content, /важны\.\n\nВо второй/);
});

test('response plan preserves exact nonverbal delivery instead of collapsing it to text', () => {
  assert.equal(normalizeResponsePlan({ delivery: 'sticker_only' }).delivery, 'sticker_only');
  assert.equal(normalizeResponsePlan({ delivery: 'before_text' }).delivery, 'before_text');
  assert.equal(normalizeResponsePlan({ delivery: 'after_text' }).delivery, 'after_text');
});

test('canonical cognition open loop can drive callback initiative without legacy thread heuristics', () => {
  const brain = {
    literalIntent: 'statement', hiddenIntent: { type: 'none', confidence: 35 }, relation: { type: 'continuation', confidence: 60 },
    activeScene: { type: 'everyday', topic: 'вечер', confidence: 75 }, ambiguity: { shouldClarify: false }, obligations: [], responseFocus: 'Продолжить разговор.'
  };
  const history = [
    { role: 'assistant', kind: 'text', content: 'Один.' }, { role: 'user', kind: 'text', content: 'Да.' },
    { role: 'assistant', kind: 'text', content: 'Два.' }, { role: 'user', kind: 'text', content: 'Угу.' },
    { role: 'assistant', kind: 'text', content: 'Три.' }, { role: 'user', kind: 'text', content: 'Я потом покажу письмо редактора.' }
  ];
  const cognition = {
    dialogueState: { scene: 'everyday', reactiveStreak: 2, questionStreak: 0, continuityStrength: 0.8 },
    beliefModel: { factsToUse: [], factsToAvoid: [] },
    openLoops: { active: [{ id: 'letter', subject: 'Я потом покажу письмо редактора.', importance: 80, confidence: 0.9 }], callback: { id: 'letter', subject: 'Я потом покажу письмо редактора.', importance: 80, confidence: 0.9 } }
  };
  const plan = planResponse({ cognition, brain, coreDecision: { initiative: { mode: 'none' }, mode: 'calm' }, memory: closeMemory, userText: 'Я наконец освободился.', history });
  assert.equal(plan.initiative, 'return_to_open_loop');
});

test('state transition owns full persistent affective and relationship state on the server side', () => {
  const memory = {
    mood: { affection: 65, energy: 55 },
    relationship: { trust: 82, closeness: 76, comfort: 70, respect: 80, playfulness: 68, attraction: 55, vulnerability: 42 }
  };
  const affectiveTurn = buildAffectiveTurn({
    userText: 'Спасибо, я доверяю тебе и обнимаю.', memory,
    brain: { activeScene: { type: 'romance' }, hiddenIntent: { type: 'seek_closeness' }, literalIntent: 'affection' }
  });
  const transition = buildStateTransition({ cognition: { beliefModel: {}, openLoops: { active: [] }, dialogueState: null }, affectiveTurn });
  assert.equal(transition.moodState.affection, 66);
  assert.equal(transition.relationshipState.closeness, 77);
  assert.equal(transition.relationshipState.comfort, 71);
  assert.equal(transition.relationshipState.attraction, 56);
  assert.equal(transition.emotionalState.primary.type, 'tenderness');
  assert.equal(transition.emotionalState.secondary.type, 'shyness');
  // Deltas are compatibility telemetry only and remain intentionally small.
  assert.ok(transition.relationshipDelta.closeness <= 1);
  assert.ok(transition.relationshipDelta.attraction <= 1);
});


test('persisted dialogue snapshot restores continuity fields when recent history is pruned', () => {
  const previousState = {
    topic: 'письмо редактору',
    scene: 'practical_task',
    sceneAnchor: { messageId: 'u-old', role: 'user', kind: 'text', excerpt: 'Я отправлю письмо вечером.' },
    openHook: { messageId: 'u-hook', role: 'user', kind: 'text', excerpt: 'Потом покажу ответ редактора.' },
    entities: ['редактор', 'письмо'],
    corrections: ['Нет, отправлю именно вечером.'],
    lastRinAction: { kind: 'silence', meaning: 'Рин осознанно промолчала', cause: 'дала пользователю закончить задачу' }
  };
  const memory = { ...closeMemory, conversationState: { dialogueState: previousState, beliefs: [], openLoops: [] } };
  const history = [{ id: 'u-new', role: 'user', kind: 'text', status: 'sent', content: 'Ну вот, готово.' }];
  const brain = {
    literalIntent: 'statement', hiddenIntent: { type: 'none' }, relation: { type: 'continuation' },
    activeScene: { type: 'practical_task', topic: 'письмо редактору', confidence: 80 }, referents: [],
    ambiguity: { shouldClarify: false }, obligations: [], responseFocus: 'Продолжить.'
  };
  const cognition = buildCognitiveTurn({ userText: 'Ну вот, готово.', history, memory, brain });
  assert.equal(cognition.dialogueState.sceneAnchor.messageId, 'u-old');
  assert.equal(cognition.dialogueState.openHook.messageId, 'u-hook');
  assert.ok(cognition.dialogueState.entities.includes('редактор'));
  assert.match(cognition.dialogueState.corrections.at(-1), /вечером/);
  assert.equal(cognition.dialogueState.lastRinAction.kind, 'silence');
});
