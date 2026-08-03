import { readdir, readFile, stat } from 'node:fs/promises';
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
    else if (info.isFile() && full.endsWith('.json')) out.push(full);
  }
  return out;
}

const files = (await collect(ROOT)).sort();
const failures = [];
for (const file of files) {
  try { JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { failures.push({ file: path.relative(ROOT, file), error: error.message }); }
}
if (failures.length) {
  for (const failure of failures) console.error(`${failure.file}: ${failure.error}`);
  process.exit(1);
}
console.log(`JSON OK: ${files.length} files.`);
