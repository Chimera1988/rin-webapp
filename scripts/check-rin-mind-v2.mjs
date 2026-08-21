import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(process.argv[2] || process.cwd());
const syntaxFiles = [
  'api/chat.js',
  'lib/cognition/behavior-state.js',
  'lib/cognition/drive-state.js',
  'lib/cognition/turn-stabilizer.js',
  'lib/cognition/rin-mind.js',
  'lib/cognition/sticker-state.js',
  'public/js/app_bootstrap.js'
];

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

for (const file of syntaxFiles) run(['--check', file]);
run(['--test', '--test-concurrency=1', 'tests/rin-mind-v2.test.js', 'tests/rin-mind-v2-api.test.js']);
console.log('Rin Mind v2: targeted checks passed.');
