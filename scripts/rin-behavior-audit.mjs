import { writeFileSync } from 'node:fs';
import { runAuditScenarios } from '../tests/fixtures/rin-audit-scenarios.mjs';
const result = await runAuditScenarios();
const output = process.argv[2];
if (output) writeFileSync(output, JSON.stringify(result, null, 2)+'\n');
console.log(`${result.mode}: ${result.passed}/${result.scenarioCount}`);
for (const s of result.results.filter(x=>x.status==='fail')) console.log(`${s.id}: ${s.detail}`);
process.exitCode = result.passed===result.scenarioCount?0:1;
