import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const benchmarkUrl = new URL('./fixtures/rin-reference-benchmark.json', import.meta.url);
const promptUrl = new URL('../public/data/rin_prompt_profile.json', import.meta.url);

async function readJson(url) { return JSON.parse(await readFile(url, 'utf8')); }

test('Rin 90+ benchmark contract has a 100-point rubric, hard failures and ten long-flow scenarios', async () => {
  const benchmark = await readJson(benchmarkUrl);
  assert.equal(benchmark.schema, 'rin-reference-benchmark-v1');
  assert.equal(benchmark.targetScore, 90);
  assert.equal(benchmark.liveEvaluationRequiredForClaim, true);
  assert.equal(benchmark.dimensions.reduce((sum, item) => sum + item.weight, 0), 100);
  assert.equal(benchmark.scenarios.length, 10);
  assert.ok(benchmark.scenarios.every(item => item.targetTurns >= 30 && item.targetTurns <= 50));
  for (const id of [
    'fabricated_memory', 'canon_contradiction', 'state_corruption', 'terminal_intent_resurrection',
    'duplicate_semantic_commit', 'retry_changes_cognition', 'client_ownership_conflict'
  ]) assert.ok(benchmark.criticalFailures.includes(id), `missing critical failure ${id}`);
});

test('approved evening simulation is preserved as behavioral mechanism, not permanent canon', async () => {
  const benchmark = await readJson(benchmarkUrl);
  const profile = await readJson(promptUrl);
  const scenario = benchmark.scenarios.find(item => item.id === 'reference_evening_kitsune');
  assert.ok(scenario);
  const required = scenario.required.join(' ').toLowerCase();
  assert.match(required, /green tea/);
  assert.match(required, /ten-kiss/);
  assert.match(required, /kitsune/);
  assert.match(required, /farewell/);
  const canon = JSON.stringify(profile.canon || {}).toLowerCase();
  assert.doesNotMatch(canon, /ten-kiss|десят(?:ь|и) поцелу|самурай|kitsune wager/iu);
});
