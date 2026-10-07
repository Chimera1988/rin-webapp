import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeScheduleConfig } from '../public/js/rin_lore.js';
import { resolveDailyRhythm } from '../public/js/daily_rhythm.js';
import { buildBehaviorState, inspectSceneClosure } from '../lib/cognition/behavior-state.js';
import { stabilizeTurn, stripMessengerAsteriskMarkup } from '../lib/cognition/turn-stabilizer.js';
import { buildRinMindPrompt } from '../lib/cognition/rin-mind.js';
import { computeHumanComposeDelay, computeHumanReadDelay } from '../public/js/delivery_scheduler.js';

const rawSchedule = JSON.parse(await readFile(new URL('../public/data/rin_schedule.json', import.meta.url), 'utf8'));
const schedule = normalizeScheduleConfig(rawSchedule);
const policy = schedule.innerLife;
const epoch = jst => Date.parse(jst.replace(' ', 'T') + '+09:00');

const assistant = (content, id = 'a1') => ({
  id, role: 'assistant', kind: 'text', status: 'complete', requestId: id, turnId: id, content, ts: 1
});

const textDecision = {
  act: 'accept_closeness',
  focus: 'остаться рядом',
  stance: 'тихо и тепло',
  question: { mode: 'none', reason: null },
  replyLink: { targetEventId: null, reason: null },
  delivery: {
    responseDepth: 'micro',
    messageShape: 'single',
    segments: [{ type: 'text', purpose: 'reaction', stickerIntent: null, maxChars: 180 }]
  },
  intentTransition: {
    operation: 'none', goal: null, motive: null, target: null, nextMove: null,
    progress: null, commitment: null, reason: null
  },
  openLoops: { open: [], resolveIds: [] },
  realityMode: 'grounded'
};

const profile = {
  prompt_profile: {
    identity: { full_name: 'Рин Акихара', name_japanese: '秋原 凛' },
    reference_character: { core: 'Живая взрослая женщина со своим мнением.', principles: [], imperfections: [] },
    voice: { description: 'Личная русская переписка.', principles: [] },
    relationship: { relationship_philosophy: { core: 'Связь ценна.', principles: [] } }
  },
  base_rules: 'Сохраняй характер Рин.'
};

test('v2.5 repeated night wake updates lateConversationMinutes on the first interrupted turn', () => {
  const now = epoch('2026-10-08 05:02');
  const current = {
    sleepCycle: '2026-10-08',
    sleepPhase: 'interrupted_sleep',
    lastUserAt: now - 50 * 60_000,
    sleepStartedAt: epoch('2026-10-08 00:25'),
    lastWakeAt: now - 50 * 60_000,
    sleepInterruptions: 1,
    lateConversationMinutes: 234,
    wakeReason: 'kirill_message'
  };
  const rhythm = resolveDailyRhythm({ rinHuman: '2026-10-08 05:02' }, policy, current, now, true);
  assert.equal(rhythm.sleep.phase, 'interrupted_sleep');
  assert.equal(rhythm.sleep.interruptions, 2);
  assert.ok(rhythm.sleep.lateConversationMinutes > 234, `expected fresh lateChat, got ${rhythm.sleep.lateConversationMinutes}`);
});

test('v2.5 recognizes sleep settling plus “Я рядом” as a semantic terminal beat', () => {
  const closure = inspectSceneClosure([
    assistant('Мм… слышу тебя. Чуть крепче прижимаюсь и с сонной улыбкой закрываю глаза. Побудь так рядом…')
  ], 'Я рядом…');
  assert.equal(closure.strong, true);
  assert.equal(closure.kind, 'sleep');
  assert.equal(closure.presenceAck, true);
});

test('v2.5 sleep closure does not silence ordinary emotional support just because user says “Я рядом”', () => {
  const closure = inspectSceneClosure([
    assistant('Мне сейчас тревожно. Побудь рядом со мной, пожалуйста.')
  ], 'Я рядом…');
  assert.equal(closure.strong, false);
  assert.equal(closure.kind, 'none');
});

test('v2.5 semantic sleep closure becomes true silence deterministically', () => {
  const behaviorState = buildBehaviorState({
    userText: 'Я рядом…',
    history: [assistant('Мм… я уже почти засыпаю. Снова закрываю глаза.')]
  });
  const result = stabilizeTurn({
    decision: textDecision,
    realization: { segments: [{ type: 'text', purpose: 'reaction', text: 'Знаю… *сонно прижимаюсь и закрываю глаза*' }] },
    behaviorState,
    conversationState: 'ending',
    fallbackText: 'Мм.'
  });
  assert.equal(behaviorState.sceneClosure.kind, 'sleep');
  assert.equal(result.decision.delivery.mode, 'silence');
  assert.equal(result.realization.segments.length, 0);
  assert.ok(result.warnings.includes('terminal_scene_silence_applied'));
});

test('v2.5 strips asterisk roleplay/markdown while preserving the actual words', () => {
  assert.equal(
    stripMessengerAsteriskMarkup('*тихо прижимаюсь к тебе* Мм… **вот так хорошо**.'),
    'тихо прижимаюсь к тебе Мм… вот так хорошо.'
  );
  const behaviorState = buildBehaviorState({ userText: 'Обнимаю тебя', history: [] });
  const result = stabilizeTurn({
    decision: textDecision,
    realization: { segments: [{ type: 'text', purpose: 'reaction', text: '*сонно целую тебя в ответ* Мм…' }] },
    behaviorState,
    conversationState: 'ongoing',
    fallbackText: 'Мм.'
  });
  assert.equal(result.realization.segments[0].text, 'сонно целую тебя в ответ Мм…');
  assert.ok(result.warnings.includes('asterisk_chat_markup_removed'));
});

test('v2.5 prompt explicitly asks for plain messenger prose without star roleplay markup', () => {
  const prompt = buildRinMindPrompt({
    profile,
    state: { behaviorState: {}, driveState: {}, sharedSymbolState: { candidates: [], recentUses: [], guidance: '' }, recentHistory: [] }
  });
  assert.match(prompt.stableSystem, /не оформляй действия, жесты или эмоции как \*roleplay в звёздочках\*/iu);
  assert.match(prompt.stableSystem, /не используй Markdown-выделение/iu);
});

test('v2.5 dense conversation shortens human read/compose simulation without removing it', () => {
  const random = () => 0.5;
  const normalRead = computeHumanReadDelay({ userChars: 120, denseConversation: false, random });
  const denseRead = computeHumanReadDelay({ userChars: 120, denseConversation: true, random });
  const normalCompose = computeHumanComposeDelay({ chars: 180, denseConversation: false, random });
  const denseCompose = computeHumanComposeDelay({ chars: 180, denseConversation: true, random });
  assert.ok(denseRead < normalRead);
  assert.ok(denseRead >= 260);
  assert.ok(denseCompose < normalCompose);
  assert.ok(denseCompose >= 500);
});

test('v2.5 exposes model/server/client latency diagnostics and lets server timeout report before client abort', async () => {
  const [api, client] = await Promise.all([
    readFile(new URL('../api/chat.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/chat.js', import.meta.url), 'utf8')
  ]);
  assert.match(api, /serverMs:\s*Date\.now\(\) - handlerStartedAt/u);
  assert.match(api, /modelMs:\s*Number\(modelDurationMs \|\| 0\)/u);
  assert.match(api, /mapped\.body\.diagnostics\s*=\s*\{/u);
  assert.match(client, /\}, 52_000\);/u);
  assert.match(client, /requestMs=\$\{requestMs\}/u);
  assert.match(client, /readDelayMs=\$\{Number\(waitResult\?\.readDelay \|\| 0\)\}/u);
  assert.match(client, /denseTiming=\$\{denseConversation \? 'yes' : 'no'\}/u);
  assert.match(client, /serverDiagnostics/u);
});
