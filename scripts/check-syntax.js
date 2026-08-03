import { readdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const SKIP = new Set(['.git', 'node_modules']);

async function collect(dir) {
  const out = [];
  for (const entry of await readdir(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    const info = await stat(full);
    if (info.isDirectory()) out.push(...await collect(full));
    else if (info.isFile() && full.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = (await collect(ROOT)).sort();
const failures = [];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) failures.push({ file: path.relative(ROOT, file), error: result.stderr || result.stdout });
}
if (failures.length) {
  for (const failure of failures) console.error(`\n${failure.file}\n${failure.error}`);
  process.exit(1);
}
console.log(`Syntax OK: ${files.length} JavaScript files.`);
