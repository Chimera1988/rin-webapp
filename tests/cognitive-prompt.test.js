import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildKernelPrompt } from '../lib/cognition/cognitive-kernel.js';
import { buildRealizationPrompt } from '../lib/personality/rin-realization.js';

const promptProfile = JSON.parse(await readFile(new URL('../public/data/rin_prompt_profile.json', import.meta.url), 'utf8'));

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
  assert.doesNotMatch(prompt.system, /выбери.*intent/iu);
  assert.equal(prompt.responseFormat.json_schema.name, 'rin_realization');
});
