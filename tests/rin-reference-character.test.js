import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { retrieveCanonicalLore } from '../lib/server/canon-retrieval.js';

const readJson = async file => JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
const profile = await readJson('public/data/rin_prompt_profile.json');
const backstory = await readJson('public/data/rin_backstory.json');
const memories = await readJson('public/data/rin_memories.json');

test('reference profile encodes the simulated Rin mechanism rather than fixed romantic catchphrases', () => {
  const refText = JSON.stringify(profile.reference_character);
  assert.match(refText, /не пытается выглядеть живой/iu);
  assert.match(refText, /забот/iu);
  assert.match(refText, /не зеркал/iu);
  assert.match(refText, /флирт контекст/iu);
  assert.match(refText, /эмоции имеют причину и инерцию/iu);
  assert.match(refText, /доводит/iu);
  assert.ok(Array.isArray(profile.reference_dialogue_examples) && profile.reference_dialogue_examples.length >= 5);
  const activeVoice = JSON.stringify({ voice: profile.voice, cognitive_policy: profile.cognitive_policy, guardrails: profile.guardrails });
  assert.doesNotMatch(activeVoice, /behavior policy|RESPONSE PLAN/iu);
});

test('shared private name is canonical Hikari Rinsei with no unsupported 光 etymology', () => {
  const all = `${JSON.stringify(backstory)}\n${JSON.stringify(memories)}\n${JSON.stringify(profile.relationship)}`;
  assert.match(all, /Хикари Ринсей/u);
  assert.doesNotMatch(all, /собеседник\s*\(光\)|собеседник\s*[—-]\s*свет/iu);
  assert.doesNotMatch(all, /Ринсей[^.]{0,40}(?:звезд|star)/iu);
  assert.equal(profile.relationship.private_name, 'Хикари Ринсей');
});

test('server canon retrieval is the source of relevant biography and returns no unrelated private payload', async () => {
  const sister = await retrieveCanonicalLore('Как зовут твою сестру?', { fresh: true });
  assert.equal(sister.source, 'server_canon_store');
  assert.ok([...sister.memories, ...sister.backstory].some(item => /Нацуми/u.test(item.text)));
  assert.ok(![...sister.memories, ...sister.backstory].some(item => /Хикари Ринсей/u.test(item.text)), 'a sister question must not retrieve the user private-name line');

  const privateName = await retrieveCanonicalLore('Как ты меня называешь?');
  assert.ok([...privateName.memories, ...privateName.backstory].some(item => /Хикари Ринсей/u.test(item.text)));
});

test('reference dialogue is behavior guidance and never enters the reality-boundary canonical corpus', async () => {
  const { buildRealityBoundary } = await import('../lib/cognition/reality-boundary.js');
  const boundary = buildRealityBoundary({ profile: { prompt_profile: profile }, memory: null, lore: null, userText: 'Привет', history: [] });
  assert.match(boundary.canonicalText, /рин акихара/iu);
  assert.doesNotMatch(boundary.canonicalText, /десят(?:ь|и) поцелу|пари|кицун|самура/iu);
});

test('server canon retrieval supplies prompt-profile facts only when the query makes them relevant', async () => {
  const work = await retrieveCanonicalLore('Кем ты работаешь?');
  assert.ok(work.canon.some(item => item.section === 'canon.occupation' && /редактор|перевод/iu.test(item.text)));
  const likes = await retrieveCanonicalLore('Что ты любишь?');
  assert.ok(likes.canon.some(item => item.section === 'canon.likes'));
  const unrelated = await retrieveCanonicalLore('Как зовут твою сестру?');
  assert.ok(!unrelated.canon.some(item => item.section === 'relationship.private_name'));
});
