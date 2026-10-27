import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { detectExplicitVoiceRequest, selectRequestedVoiceSegment } from '../public/lib/voice-request.js';
import { inferRinDeclaredPersonalAction, applyPersonalActionDecision } from '../public/lib/action-lifecycle.js';
import { normalizeSceneCommitment } from '../lib/cognition/cognitive-contract.js';
import { annotateCommitmentPreparation, buildDecisionStateTransition } from '../lib/cognition/turn-decision.js';
import { requestDeadlineExceeded, fetchWithTimeout } from '../public/js/http_client.js';
import { buildRinMindPrompt } from '../lib/cognition/rin-mind.js';

const voice = text => detectExplicitVoiceRequest(text);
const assistant = text => ({ type: 'text', text });

test('explicit Japanese speech requests are voice intentions, not topic questions', () => {
  assert.deepEqual(voice('Рин, скажи мне что-нибудь на японском'), { requested: true, language: 'ja' });
  assert.deepEqual(voice('Я бы хотел послушать как твоя речь звучит на японском'), { requested: true, language: 'ja' });
  assert.equal(voice('Произнеси эту фразу вслух').requested, true);
  assert.deepEqual(voice('А можешь сказать пару слов на японском?'), { requested: true, language: 'ja' });
  assert.deepEqual(voice('Рин, прочитай японский стих'), { requested: true, language: 'ja' });
  assert.equal(voice('Скажи мне что-нибудь хорошее').requested, true);
  assert.equal(voice('Как-нибудь послушаю твою рекомендацию').requested, false);
  assert.equal(voice('Как у вас погода?').requested, false);
  assert.equal(voice('А что скажешь насчёт Free Flow Flava?').requested, false);
  assert.equal(voice('А может есть какой-нибудь стих на японском?').requested, false);
});

test('Japanese voice extracts only Japanese words and honors global master switch', () => {
  const request = voice('Скажи это по-японски голосом');
  const segments = [assistant('Тогда вот: 「そう言ってくれると、うれしい。」 — Мне приятно, что ты так говоришь.')];
  assert.deepEqual(selectRequestedVoiceSegment(segments, request, { enabled: true }), {
    index: 0, speech: 'そう言ってくれると、うれしい。', language: 'ja'
  });
  assert.equal(selectRequestedVoiceSegment(segments, request, { enabled: false }), null);
  assert.equal(selectRequestedVoiceSegment([assistant('Представь, что я говорю это на японском.')], request, { enabled: true }), null);
  assert.equal(selectRequestedVoiceSegment([assistant('あ'.repeat(210))], request, { enabled: true }), null);
});

test('explicit voice wins over rate, chooses at most one full text segment', () => {
  const request = voice('Скажи голосом, как прошёл день');
  const segments = [assistant('У меня всё хорошо.'), assistant('Расскажу позже.')];
  assert.deepEqual(selectRequestedVoiceSegment(segments, request, { enabled: true }), {
    index: 0, speech: 'У меня всё хорошо.', language: 'auto'
  });
  const veryLong = 'Очень долго '.repeat(19).trim();
  assert.equal(selectRequestedVoiceSegment([assistant(veryLong)], request, { enabled: true }), null);
});

test('home+meal plans preserve sequence but never falsely complete a second task', () => {
  const text = 'Хочу немного прибрать и потом уже спокойно выдохнуть — сегодня без продолжения рабочего дня. На ужин сделаю омлет с овощами, ничего торжественного. А потом, может, включу музыку и просто полежу рядом с тобой здесь.';
  const found = inferRinDeclaredPersonalAction(text, 'Какие планы на вечер?');
  assert.equal(found?.operation, 'start');
  assert.equal(found?.kind, 'home');
  assert.match(found.goal, /прибрать/);
  assert.match(found.motive, /На ужин сделаю омлет/);
  assert.match(found.motive, /не подтверждённое выполнением/);
  assert.doesNotMatch(found.motive, /может.*включу/);
  const now = Date.UTC(2026, 9, 27, 15, 16);
  const actions = applyPersonalActionDecision([], found, { now, requestId: 'r-home', innerLife: { workMode: 'off' } });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, 'home');
  const second = applyPersonalActionDecision(actions, inferRinDeclaredPersonalAction('На ужин сделаю омлет с овощами.'), { now: now + 60_000, requestId: 'r-meal' });
  assert.equal(second.length, 1);
});

test('additional first-person phrases and no phantom reading from считать', () => {
  assert.equal(inferRinDeclaredPersonalAction('На ужин сделаю омлет с овощами.')?.kind, 'meal');
  assert.equal(inferRinDeclaredPersonalAction('Тогда, пожалуй, поставлю что-нибудь у Ólafur Arnalds.')?.kind, 'music');
  assert.equal(inferRinDeclaredPersonalAction('Хочу спокойно почитать «Дневник одного гения» хотя бы сегодня.')?.kind, 'reading');
  assert.equal(inferRinDeclaredPersonalAction('Буду считать, что похвала заслуженная)'), null);
  assert.equal(inferRinDeclaredPersonalAction('Если бы я хотела почитать, я бы сказала.'), null);
  assert.equal(inferRinDeclaredPersonalAction('Я не хочу читать сегодня.'), null);
  assert.equal(inferRinDeclaredPersonalAction('Я не собираюсь готовить ужин.'), null);
  assert.equal(inferRinDeclaredPersonalAction('А потом, может, включу музыку.'), null);
});

test('finished surprise preparation is linked to promise but not marked fulfilled', () => {
  const commitment = normalizeSceneCommitment({
    id: 'commit-surprise', subject: 'приготовить Кириллу что-нибудь особенное к его дню рождения 20 октября',
    owner: 'rin', status: 'active', rationale: 'личный подарок'
  });
  const completed = { id: 'rinact-surprise-1', kind: 'creative', status: 'completed',
    goal: 'подготовить сюрприз для Кирилла к вечернему вручению',
    outcome: { source: 'simulated_character_world', summary: 'подготовка завершена' }
  };
  const [linked] = annotateCommitmentPreparation([commitment], [completed], 1416);
  assert.equal(linked.status, 'active');
  assert.equal(linked.lastAction, commitment.lastAction);
  assert.equal(linked.linkedPersonalAction.id, completed.id);
  assert.equal(linked.rationale, commitment.rationale);
  const [onceMore] = annotateCommitmentPreparation([linked], [completed], 1417);
  assert.deepEqual(onceMore, linked);
  const [unrelated] = annotateCommitmentPreparation([commitment], [{ ...completed, goal: 'написать рассказ о лисе' }], 1416);
  assert.equal(unrelated.linkedPersonalAction, null);
  const [noCompletion] = annotateCommitmentPreparation([commitment], [{ ...completed, status: 'planned' }], 1416);
  assert.equal(noCompletion.linkedPersonalAction, null);
});

test('gift promise cannot self-complete before acknowledgement, but can complete when received', () => {
  const commitment = normalizeSceneCommitment({
    subject:'приготовить Кириллу что-нибудь особенное к его дню рождения 20 октября',
    owner:'rin', status:'active'
  });
  const state = { revision:1400, scene:{type:'everyday'}, dialogueState:{sceneCommitments:[commitment]}, innerLife:{personalActions:[]} };
  const mind = { commitmentAction:'fulfill', commitmentSubject:commitment.subject, commitmentOwner:'rin', commitmentStrength:70 };
  const proposed = buildDecisionStateTransition({ kernelState:state, mind, userText:'Ну как там сюрприз?' });
  assert.equal(proposed.dialogueState.sceneCommitments[0].status, 'active');
  const received = buildDecisionStateTransition({ kernelState:state, mind, userText:'Спасибо за сюрприз!' });
  assert.equal(received.dialogueState.sceneCommitments[0].status, 'fulfilled');
});

test('timed-out responses are rejected on resume, no client-side retry side effects', async () => {
  assert.equal(requestDeadlineExceeded(1000, 52000, 53001), true);
  assert.equal(requestDeadlineExceeded(1000, 52000, 52999), false);
  const savedFetch = globalThis.fetch;
  const savedNow = Date.now;
  let now = 1000;
  try {
    Date.now = () => now;
    globalThis.fetch = async () => { now += 80_000; return { status: 200 }; };
    await assert.rejects(fetchWithTimeout('/api/chat', { method: 'POST' }, 52000), { name: 'AbortError' });
  } finally { globalThis.fetch = savedFetch; Date.now = savedNow; }
});

test('model sees explicit speech and factual-origin uncertainty rules', () => {
  const prompt = buildRinMindPrompt({
    profile: { prompt_profile: {} },
    state: { userText: 'Рин, скажи что-нибудь по-японски', recentHistory: [], innerLife: {}, dialogueState: {} },
    client: { voice: { enabled: true } }
  });
  assert.match(prompt.stableSystem, /FACTUAL CALIBRATION/);
  assert.match(prompt.dynamicSystem, /ПОЛЬЗОВАТЕЛЬ ПРОСИТ УСЛЫШАТЬ ГОЛОС/);
  assert.match(prompt.dynamicSystem, /реальная японская речь/);
});

test('no user-request gate from auto-initiations and unchanged probabilistic ordinary voice', async () => {
  const source = await readFile(new URL('../public/chat.js', import.meta.url), 'utf8');
  const userHandler = source.split('async function processUserBatch(')[1] || '';
  assert.doesNotMatch(userHandler, /if\s*\(!autoInitiationsEnabled\)\s*return false/);
  assert.match(source, /function shouldVoiceFor\(text\)/);
  assert.match(source, /Math\.random\(\) > lsSpeakRate\(\)/);
  assert.match(source, /selectedVoice\?\.index === index/);
});
