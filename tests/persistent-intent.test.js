import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePersistentIntent } from '../lib/cognition/persistent-intent.js';
import { normalizeRinIntent } from '../lib/intent-contract.js';
import { deriveBehaviorPolicy } from '../lib/cognition/behavior-policy.js';
import { verifyReply } from '../lib/cognition/response-verifier.js';

const playfulCandidate = {
  desire: 'continue_playful_tension',
  move: 'tease_or_advance',
  strength: 86,
  reason: 'игровая линия уже начата'
};
const playfulState = { scene: 'playful_flirt', lastRinAction: { kind: 'text', meaning: 'Не выкручивайся — сам начал.', cause: 'playful' }, reactiveStreak: 0, questionStreak: 0 };
const baseBrain = { literalIntent: 'statement', relation: { type: 'continuation' }, hiddenIntent: { type: 'none' }, activeScene: { type: 'playful_flirt' }, ambiguity: { shouldClarify: false } };

function memoryWith(intent = null, revision = 10) {
  return { conversationState: { revision, rinIntent: intent }, relationship: { trust: 75, closeness: 72, playfulness: 70 }, mood: { affection: 75 } };
}

test('playful candidate becomes a committed multi-turn Rin intent', () => {
  const first = advancePersistentIntent({ memory: memoryWith(null), characterIntent: playfulCandidate, dialogueState: playfulState, brain: baseBrain, userText: 'Ну и где?)' });
  assert.equal(first.status, 'active');
  assert.equal(first.turnCount, 1);
  assert.equal(first.minTurns, 2);
  assert.equal(first.maxTurns, 4);
  assert.match(first.goal, /поддразнивание|игров/iu);
  assert.equal(first.sceneBinding.key, 'playful_tease');
  assert.equal(first.nextMove, 'make_specific_teasing_move');
});

test('supportive user turn advances the same intent instead of replacing it', () => {
  const first = advancePersistentIntent({ memory: memoryWith(null), characterIntent: playfulCandidate, dialogueState: playfulState, brain: baseBrain, userText: 'Ну и где?)' });
  const second = advancePersistentIntent({ memory: memoryWith(first, 11), characterIntent: playfulCandidate, dialogueState: playfulState, brain: baseBrain, userText: 'Как же из таких объятий выкручиваться 😏' });
  assert.equal(second.id, first.id);
  assert.equal(second.status, 'active');
  assert.ok(second.progress > first.progress);
  assert.equal(second.turnCount, first.turnCount + 1);
});

test('direct question temporarily takes priority without deleting active intent', () => {
  const first = normalizeRinIntent({ ...advancePersistentIntent({ memory: memoryWith(null), characterIntent: playfulCandidate, dialogueState: playfulState, brain: baseBrain, userText: 'Ну и где?)' }), progress: 0.25 });
  const questionBrain = { ...baseBrain, literalIntent: 'question', relation: { type: 'new_or_followup_question' } };
  const next = advancePersistentIntent({ memory: memoryWith(first, 11), characterIntent: playfulCandidate, dialogueState: playfulState, brain: questionBrain, userText: 'А почему ты так сказала?' });
  assert.equal(next.id, first.id);
  assert.equal(next.status, 'active');
  assert.equal(next.nextMove, 'answer_obligation_then_resume');
});

test('explicit stop cancels the intent and farewell cannot resurrect it', () => {
  const first = advancePersistentIntent({ memory: memoryWith(null), characterIntent: playfulCandidate, dialogueState: playfulState, brain: baseBrain, userText: 'Ну и где?)' });
  const cancelled = advancePersistentIntent({ memory: memoryWith(first, 11), characterIntent: playfulCandidate, dialogueState: playfulState, brain: baseBrain, userText: 'Хватит, давай сменим тему' });
  assert.equal(cancelled.status, 'cancelled');
  const farewell = advancePersistentIntent({ memory: memoryWith(cancelled, 12), characterIntent: playfulCandidate, dialogueState: playfulState, brain: { ...baseBrain, literalIntent: 'farewell' }, userText: 'Спокойной ночи' });
  assert.equal(farewell, null);
});

test('persistent intent expires after bounded number of turns instead of becoming obsessive', () => {
  let intent = advancePersistentIntent({ memory: memoryWith(null), characterIntent: playfulCandidate, dialogueState: playfulState, brain: baseBrain, userText: 'Давай)' });
  for (let revision = 11; revision <= 15 && intent?.status === 'active'; revision += 1) {
    intent = advancePersistentIntent({ memory: memoryWith(intent, revision), characterIntent: playfulCandidate, dialogueState: playfulState, brain: baseBrain, userText: 'Ага 😏' });
  }
  assert.equal(intent.status, 'cancelled');
  assert.match(intent.completionReason, /истекла без подтверждённого выполнения/iu);
});

test('behavior policy advances an active intent and keeps question budget at zero', () => {
  const intent = normalizeRinIntent({ goal: 'продвинуть уже начатую игровую линию собственным ходом Рин', motive: 'play', target: 'shared_playful_scene', scene: 'playful_flirt', priority: 86, commitment: 82, progress: .35, nextMove: 'tease_or_advance', startedAtTurn: 10, updatedAtTurn: 10, turnCount: 1, minTurns: 2, maxTurns: 4, status: 'active' });
  const policy = deriveBehaviorPolicy({
    cognition: { dialogueState: playfulState }, brain: baseBrain,
    coreDecision: { affectiveTurn: { emotionalState: { primary: { type: 'playfulness' }, momentum: { direction: 'steady' } }, relationshipState: { trust:75, closeness:72, playfulness:70 }, moodState: { affection:75 } } },
    memory: memoryWith(intent), userText: 'Да я и не собирался выкручиваться)', history: [{ role:'assistant', kind:'text', content:'Не выкручивайся — сам начал.' }, { role:'user', kind:'text', content:'Да я и не собирался выкручиваться)' }]
  });
  assert.ok(['advance_persistent_intent','playful_stance','carry_playful_tension','tease_and_advance','advance_play'].includes(policy.responseAct));
  assert.equal(policy.persistentIntent.status, 'active');
  assert.equal(policy.persistentIntent.id, intent.id);
  assert.ok(policy.persistentIntent.progress > intent.progress);
  assert.equal(policy.questionBudget, 0);
});

test('verifier rejects generic topic handoff while Rin has an unfinished goal', () => {
  const intent = normalizeRinIntent({ goal:'продвинуть игровую линию', scene:'playful_flirt', commitment:80, progress:.4, nextMove:'tease_or_advance', status:'active', startedAtTurn:2, updatedAtTurn:3, turnCount:1, minTurns:2, maxTurns:4 });
  const result = verifyReply('Давай просто поболтаем. О чём хочешь поговорить?', { plan: { responseAct:'advance_persistent_intent', questionBudget:0, rinIntent:intent }, brain: baseBrain, userText:'Ну хорошо)' });
  assert.equal(result.needsRewrite, true);
  assert.ok(result.warnings.includes('persistent_intent_abandoned'));
});


test('completed or cancelled intent does not immediately resurrect from the same scene candidate', () => {
  const completed = normalizeRinIntent({ goal:'продвинуть уже начатую игровую линию собственным ходом Рин', motive:'play', target:'shared_playful_scene', scene:'playful_flirt', priority:86, commitment:80, progress:.9, nextMove:'tease_or_advance', startedAtTurn:8, updatedAtTurn:10, turnCount:4, minTurns:2, maxTurns:4, status:'completed', completionReason:'done' });
  const next = advancePersistentIntent({ memory: memoryWith(completed, 10), characterIntent: playfulCandidate, dialogueState: playfulState, brain: baseBrain, userText:'Ага)' });
  assert.equal(next, null);
});

test('guessing-game promise becomes a concrete reveal nextMove after user guess', () => {
  const active = normalizeRinIntent({ goal:'продвинуть уже начатую игровую линию собственным ходом Рин', motive:'play', target:'shared_playful_scene', scene:'playful_flirt', priority:86, commitment:84, progress:.45, nextMove:'tease_or_advance', startedAtTurn:16, updatedAtTurn:17, turnCount:2, minTurns:2, maxTurns:4, status:'active', semanticKey:'continue_playful_tension|shared_playful_scene|playful_flirt' });
  const state = { ...playfulState, lastRinAction:{ kind:'text', meaning:'Я скажу тебе что-то особенное, если ты сможешь угадать, что именно.' } };
  const next = advancePersistentIntent({ memory:memoryWith(active, 18), characterIntent:playfulCandidate, dialogueState:state, brain:baseBrain, userText:'Наверное это про любовь? 🤔' });
  assert.equal(next.status, 'active');
  assert.equal(next.nextMove, 'reveal_promised_special_thing');
  assert.equal(next.progressState, 'guess_received');
  assert.match(next.completionCondition, /явно прозвучало обещанное/iu);
});

test('promised reveal cannot complete from turn count or progress alone', () => {
  const active = normalizeRinIntent({ goal:'завершить обещанную игру', target:'shared_playful_scene', scene:'playful_flirt', commitment:90, progress:.95, nextMove:'reveal_promised_special_thing', progressState:'guess_received', expectedOutcome:'раскрыть обещанное', completionCondition:'явное раскрытие', startedAtTurn:10, updatedAtTurn:12, turnCount:3, minTurns:1, maxTurns:5, status:'active', semanticKey:'guessing_reveal|shared_playful_scene' });
  const next = advancePersistentIntent({ memory:memoryWith(active, 12), characterIntent:playfulCandidate, dialogueState:playfulState, brain:baseBrain, userText:'Ну так что это было?' });
  assert.equal(next.status, 'active');
});

test('verifier rejects another question instead of promised reveal', () => {
  const intent = normalizeRinIntent({ goal:'завершить обещанную игру', target:'shared_playful_scene', scene:'playful_flirt', commitment:90, progress:.7, nextMove:'reveal_promised_special_thing', progressState:'guess_received', expectedOutcome:'раскрыть обещанное', completionCondition:'явное раскрытие', startedAtTurn:10, updatedAtTurn:11, turnCount:2, status:'active', semanticKey:'guessing_reveal|shared_playful_scene' });
  const result = verifyReply('Может быть, это и правда про любовь… 😉 Но что ты думаешь об этом?', { plan:{ responseAct:'advance_persistent_intent', questionBudget:0, rinIntent:intent }, brain:baseBrain, userText:'Наверное это про любовь?' });
  assert.equal(result.needsRewrite, true);
  assert.ok(result.warnings.includes('persistent_intent_next_move_not_fulfilled'));
});

test('post-reply evidence completes promised reveal only after Rin actually reveals it', async () => {
  const { finalizePersistentIntentAfterReply } = await import('../lib/cognition/persistent-intent.js');
  const intent = normalizeRinIntent({ goal:'завершить обещанную игру', target:'shared_playful_scene', scene:'playful_flirt', commitment:90, progress:.7, nextMove:'reveal_promised_special_thing', progressState:'guess_received', expectedOutcome:'раскрыть обещанное', completionCondition:'явное раскрытие', startedAtTurn:10, updatedAtTurn:11, turnCount:2, status:'active', semanticKey:'guessing_reveal|shared_playful_scene' });
  assert.equal(finalizePersistentIntentAfterReply(intent, 'Может быть… а как ты думаешь?').status, 'active');
  const done = finalizePersistentIntentAfterReply(intent, 'Да. Я хотела сказать, что мне очень нравится эта близость между нами.');
  assert.equal(done.status, 'completed');
  assert.equal(done.progressState, 'fulfilled');
  assert.ok(done.completionEvidence);
});

test('semantic cooldown blocks same completed intent for eight turns', () => {
  const completed = normalizeRinIntent({ goal:'продвинуть уже начатую игровую линию собственным ходом Рин', target:'shared_playful_scene', scene:'playful_flirt', commitment:80, progress:1, nextMove:'tease_or_advance', startedAtTurn:8, updatedAtTurn:10, turnCount:3, status:'completed', semanticKey:'continue_playful_tension|shared_playful_scene|playful_flirt', completionReason:'fulfilled' });
  const next = advancePersistentIntent({ memory:memoryWith(completed, 15), characterIntent:playfulCandidate, dialogueState:playfulState, brain:baseBrain, userText:'Ага)' });
  assert.equal(next, null);
});

test('intent binds to the concrete secret request instead of generic playful scene', () => {
  const state = { scene:'playful_flirt', openHook:{excerpt:'Можешь раскрыть один?'}, lastRinAction:{kind:'text',meaning:'У нас с тобой есть свои хитрости.'}, reactiveStreak:0, questionStreak:0 };
  const intent = advancePersistentIntent({ memory:memoryWith(null), characterIntent:playfulCandidate, dialogueState:state, brain:baseBrain, userText:'Можешь раскрыть один?' });
  assert.equal(intent.sceneBinding.key, 'personal_secret_reveal');
  assert.equal(intent.nextMove, 'reveal_specific_personal_secret');
  assert.match(intent.goal, /секрет|фантази/iu);
  assert.doesNotMatch(intent.goal, /игровую линию/iu);
});

test('scene-bound intent transforms in place when the shared fantasy acquires a concrete world', () => {
  const secretState = { scene:'playful_flirt', openHook:{excerpt:'Можешь раскрыть один?'}, lastRinAction:{kind:'text',meaning:'Иногда я люблю фантазировать о таинственных мирах.'} };
  const secret = advancePersistentIntent({ memory:memoryWith(null), characterIntent:playfulCandidate, dialogueState:secretState, brain:baseBrain, userText:'Расскажешь?' });
  const worldState = { scene:'playful_flirt', openHook:{excerpt:'Представь мир, где цветы светятся в ночи, а реки текут с песнями.'}, lastRinAction:{kind:'text',meaning:'В таком месте кицунэ могли бы быть стражами.'} };
  const world = advancePersistentIntent({ memory:memoryWith(secret, 11), characterIntent:playfulCandidate, dialogueState:worldState, brain:baseBrain, userText:'Да, чтобы чужаки не испортили эту красоту.' });
  assert.equal(world.id, secret.id);
  assert.equal(world.sceneBinding.key, 'shared_imagined_world');
  assert.equal(world.nextMove, 'add_specific_shared_world_detail');
  assert.match(world.goal, /общий мир|воображаем/iu);
});

test('verifier rejects generic warmth when a concrete kitsune binding must advance', () => {
  const intent = normalizeRinIntent({ goal:'развить именно общую линию про кицунэ', target:'shared_kitsune_identity', sceneBinding:{key:'shared_kitsune_identity',kind:'shared_fantasy',subject:'кицунэ',anchor:'Да, я иногда представляю, что ты кицунэ'}, scene:'playful_flirt', commitment:82, progress:.3, nextMove:'advance_kitsune_thread', expectedOutcome:'добавить конкретную деталь про кицунэ', startedAtTurn:2, updatedAtTurn:2, turnCount:1, minTurns:1, maxTurns:4, status:'active' });
  const generic = verifyReply('Мне нравится, когда у нас появляются такие уютные моменты.', { plan:{responseAct:'advance_persistent_intent',questionBudget:0,rinIntent:intent}, brain:baseBrain, userText:'И очарование тоже' });
  assert.equal(generic.needsRewrite, true);
  assert.ok(generic.warnings.includes('persistent_intent_scene_binding_missed'));
  const specific = verifyReply('Тогда считай, что хвост я пока спрятала — но хитрость кицунэ оставила при себе 😏', { plan:{responseAct:'advance_persistent_intent',questionBudget:0,rinIntent:intent}, brain:baseBrain, userText:'И очарование тоже' });
  assert.ok(!specific.warnings.includes('persistent_intent_scene_binding_missed'));
});

test('post-reply evidence completes concrete scene targets, not generic engagement', async () => {
  const { finalizePersistentIntentAfterReply } = await import('../lib/cognition/persistent-intent.js');
  const secret = normalizeRinIntent({ goal:'раскрыть секрет', target:'personal_secret_reveal', sceneBinding:{key:'personal_secret_reveal',kind:'personal_disclosure',subject:'секрет'}, scene:'everyday', commitment:80, nextMove:'reveal_specific_personal_secret', startedAtTurn:1, updatedAtTurn:1, turnCount:1, status:'active' });
  assert.equal(finalizePersistentIntentAfterReply(secret, 'Секреты всегда добавляют немного интриги.').status, 'active');
  assert.equal(finalizePersistentIntentAfterReply(secret, 'Иногда я представляю ночной сад, где можно спрятаться от всего шума.').status, 'completed');
});
