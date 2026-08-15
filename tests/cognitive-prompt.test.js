import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildKernelPrompt } from '../lib/cognition/cognitive-kernel.js';
import { buildRealizationPrompt } from '../lib/personality/rin-realization.js';

const promptProfile = JSON.parse(await readFile(new URL('../data/canon/rin_prompt_profile.json', import.meta.url), 'utf8'));

test('reference character is the simulated Rin: warm-independent, observant, contextual and follow-through oriented', () => {
  const ref = promptProfile.reference_character;
  assert.ok(ref && typeof ref === 'object');
  const text = [ref.core, ...(ref.principles || []), ...(ref.imperfections || [])].join('\n');
  assert.match(text, /не пытается выглядеть живой/iu);
  assert.match(text, /забот/iu);
  assert.match(text, /не зеркал/iu);
  assert.match(text, /флирт.*контекст/iu);
  assert.match(text, /доводит|follow-through|не бросает/iu);
  assert.match(text, /эмоц.*инерц/iu);
  assert.match(text, /неизвест.*неизвест|не придумы/iu);
});

test('kernel prompt is the only action-decision contract and receives state instead of behavior commands from other planners', () => {
  const { system, responseFormat } = buildKernelPrompt({
    profile: { prompt_profile: promptProfile },
    state: {
      perception: { summary: 'пользователь проявил заботу' },
      scene: { type: 'evening', goal: 'спокойный разговор' },
      emotion: { primary: { type: 'fatigue' } },
      relationship: { closeness: 75 },
      innerLife: { activity: 'чай', realityMode: 'simulated_character_world' },
      activeIntent: { status: 'active', goal: 'отдохнуть после работы' },
      openLoops: [{ id: 'kiss-bet', subject: 'пари о десяти поцелуях' }],
      recentHistory: [], userEvents: [{ content: 'Отдохни)' }]
    },
    client: { sticker: { mode: 'smart', probability: 30, safeMode: true } }
  });
  assert.match(system, /ЕДИНСТВЕННЫЙ ВЛАДЕЛЕЦ РЕШЕНИЯ/iu);
  assert.match(system, /Live persistent intent/iu);
  assert.match(system, /multi_message/);
  assert.match(system, /самостоятельных conversational moves/iu);
  assert.match(system, /не дроби одну простую мысль/iu);
  assert.match(system, /грамматически и смыслово законченным сообщением/iu);
  assert.match(system, /sticker_only/);
  assert.match(system, /explicit_fiction/);
  assert.match(system, /не придумывай невидимое завершение/iu);
  assert.doesNotMatch(system, /BEHAVIOR POLICY v3|RESPONSE PLAN|CHARACTER INTENT ENGINE/);
  assert.equal(responseFormat.type, 'json_schema');
  assert.equal(responseFormat.json_schema.name, 'rin_turn_decision');
});

test('realization prompt cannot change the already frozen TurnDecision', () => {
  const decision = {
    act: 'tease_and_hold_commitment', focus: 'поддержать пари, но сохранить отдых', stance: 'игривая и тёплая',
    question: { mode: 'none', reason: null },
    replyLink: { targetEventId: null, reason: null },
    delivery: { mode: 'multi_message', segments: [
      { type: 'text', purpose: 'reaction', maxChars: 180 },
      { type: 'text', purpose: 'afterthought', maxChars: 160 }
    ] },
    intentTransition: { operation: 'preserve' }, realityMode: 'grounded'
  };
  const prompt = buildRealizationPrompt({ profile: { prompt_profile: promptProfile }, state: { emotion: { primary: { type: 'warmth' } } }, decision, realityBoundary: {} });
  assert.match(prompt.system, /Не меняй act, intent, delivery/iu);
  assert.match(prompt.system, /tease_and_hold_commitment/);
  assert.match(prompt.system, /"mode":"none"/);
  assert.match(prompt.system, /reaction/);
  assert.match(prompt.system, /afterthought/);
  assert.match(prompt.system, /Пользователь — мужчина/iu);
  assert.match(prompt.system, /самостоятельным законченным пузырём/iu);
  assert.match(prompt.system, /Не обрывай слово, предложение/iu);
  assert.doesNotMatch(prompt.system, /выбери.*intent/iu);
  assert.equal(prompt.responseFormat.json_schema.name, 'rin_realization');
});

test('StickerState is a hard schema gate, not a probability hint interpreted by the Kernel', () => {
  const blocked = buildKernelPrompt({
    profile: { prompt_profile: promptProfile },
    state: {
      activeIntent: null,
      stickerState: { schema:'rin-sticker-state-v1', mode:'smart', available:false, reason:'rolling_budget_exhausted', targetPercent:30, usedStickerTurns:3, limitStickerTurns:3 },
      recentHistory: [], userEvents: [{ content:'Как погода?' }]
    }
  });
  const blockedTypes = blocked.responseFormat.json_schema.schema.properties.delivery.properties.segments.items.properties.type.enum;
  assert.deepEqual(blockedTypes, ['text']);
  assert.match(blocked.system, /hard availability/iu);
  assert.doesNotMatch(blocked.system, /frequencyPreference=/);

  const available = buildKernelPrompt({
    profile: { prompt_profile: promptProfile },
    state: {
      activeIntent: null,
      stickerState: { schema:'rin-sticker-state-v1', mode:'smart', available:true, reason:'available', targetPercent:30, usedStickerTurns:1, limitStickerTurns:3 },
      recentHistory: [], userEvents: [{ content:'Умничка 😘' }]
    }
  });
  const availableTypes = available.responseFormat.json_schema.schema.properties.delivery.properties.segments.items.properties.type.enum;
  assert.deepEqual(availableTypes, ['text','sticker']);
});

test('Kernel owns semantic visual reply and cannot quote ordinary latest messages by default', () => {
  const ordinary = buildKernelPrompt({
    profile: { prompt_profile: promptProfile },
    state: { activeIntent:null, stickerState:{available:false}, visualReplyCandidates:[], recentHistory:[], userEvents:[{id:'u-only',content:'Чем занимаешься?'}] }
  });
  assert.deepEqual(ordinary.responseFormat.json_schema.schema.properties.replyLink.properties.targetEventId.enum,[null]);
  assert.match(ordinary.system,/Визуальную цитату.*более ранняя реплика/iu);
  assert.match(ordinary.system,/Никогда не цитируй единственное или последнее сообщение/iu);

  const batched = buildKernelPrompt({
    profile: { prompt_profile: promptProfile },
    state: {
      activeIntent:null,
      stickerState:{available:false},
      visualReplyCandidates:[{eventId:'u-first',excerpt:'Как прошёл день?'}],
      recentHistory:[],
      userEvents:[{id:'u-first',content:'Как прошёл день?'},{id:'u-last',content:'И чай выпила?'}]
    }
  });
  assert.deepEqual(batched.responseFormat.json_schema.schema.properties.replyLink.properties.targetEventId.enum,[null,'u-first']);
});
