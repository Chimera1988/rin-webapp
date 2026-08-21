import { access, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const read = file => readFile(path.join(ROOT, file), 'utf8');
const exists = file => access(path.join(ROOT, file)).then(() => true, () => false);
const fail = message => { throw new Error(`[build-smoke] ${message}`); };

async function requireFiles(files) {
  const missing = [];
  for (const file of files) if (!await exists(file)) missing.push(file);
  if (missing.length) fail(`Missing required files: ${missing.join(', ')}`);
}

function requireText(source, patterns, owner) {
  for (const [pattern, message] of patterns) {
    if (!pattern.test(source)) fail(`${owner}: ${message}`);
  }
}

function forbidText(source, patterns, owner) {
  for (const [pattern, message] of patterns) {
    if (pattern.test(source)) fail(`${owner}: ${message}`);
  }
}

function runNode(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env
  });
  if (result.error) fail(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} failed with exit code ${result.status}`);
}

await requireFiles([
  'package.json',
  'vercel.json',
  'public/index.html',
  'public/login.html',
  'public/chat.js',
  'public/js/release.js',
  'public/js/app_bootstrap.js',
  'public/js/theme_bootstrap.js',
  'public/js/login.js',
  'api/chat.js',
  'lib/server/http.js',
  'lib/server/canonical-profile.js',
  'lib/server/canon-retrieval.js',
  'lib/cognition/behavior-state.js',
  'lib/cognition/drive-state.js',
  'lib/cognition/rin-mind.js',
  'lib/cognition/turn-stabilizer.js',
  'lib/cognition/sticker-state.js',
  'lib/cognition/sticker-candidates.js',
  'lib/cognition/sticker-catalog.js',
  'lib/cognition/sticker-selector.js',
  'lib/cognition/turn-decision.js',
  'lib/cognition/turn-validator.js',
  'lib/cognition/kernel-state.js',
  'lib/cognition/emotional-state.js',
  'lib/cognition/reality-boundary.js',
  'lib/conversation-brain.js',
  'data/canon/rin_prompt_profile.json',
  'data/canon/rin_backstory.json',
  'data/canon/rin_memories.json',
  'data/canon/rin_triggers.json',
  'public/data/rin_schedule.json',
  'public/data/stickers-v7.json',
  'scripts/check-syntax.js',
  'scripts/check-rin-mind-v2.mjs',
  'tests/rin-mind-v2.test.js',
  'tests/rin-mind-v2-api.test.js'
]);

// Keep the existing browser/release/security envelope intact.
const releaseSource = await read('public/js/release.js');
const release = releaseSource.match(/RIN_RELEASE_ID\s*=\s*['"]([^'"]+)['"]/)?.[1];
if (!release) fail('Release ID is missing.');

for (const htmlFile of ['public/index.html', 'public/login.html']) {
  const html = await read(htmlFile);
  if (!html.includes(`v=${release}`)) fail(`${htmlFile} does not use release ${release}.`);
  for (const match of html.matchAll(/(?:src|href)="(\/[^\"]+)"/g)) {
    const raw = match[1].split('?')[0];
    if (raw === '/' || raw.startsWith('/api/')) continue;
    const target = raw.startsWith('/public/') ? raw.slice(1) : `public${raw}`;
    if (!await exists(target)) fail(`${htmlFile} references missing ${target}.`);
  }
}

const index = await read('public/index.html');
if ((index.match(/app_bootstrap\.js/g) || []).length !== 1) fail('Index must load exactly one application bootstrap.');
if ((index.match(/theme_bootstrap\.js/g) || []).length !== 1) fail('Index must load exactly one theme bootstrap.');
if (!index.includes('id="chatViewportShell"') || !index.includes('class="chat-viewport-shell"')) fail('Index must keep the visual viewport shell.');
if (!index.includes('id="chatWallpaper"') || !index.includes('class="chat-wallpaper"')) fail('Index must keep the wallpaper layer.');
if (!index.includes('id="replyPreview"') || !index.includes('class="reply-preview"')) fail('Index must keep reply-to-selected UI.');
if (/chat\.js[^\n]*<\/script>/i.test(index)) fail('Index must not load chat.js outside authenticated bootstrap.');
if (/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(index)) fail('Strict CSP forbids inline scripts in public/index.html.');
if (/\son[a-z]+\s*=/i.test(index)) fail('Strict CSP forbids inline event handlers in public/index.html.');

const loginSource = await read('public/js/login.js');
if (!loginSource.includes("classList.add('login-ready')")) fail('Login readiness boundary is missing.');

const vercel = JSON.parse(await read('vercel.json'));
const headerText = JSON.stringify(vercel.headers || []);
if (!headerText.includes('/api/(.*)') || !headerText.includes('no-store')) fail('API no-store cache policy is missing.');
if (!headerText.includes('Content-Security-Policy') || !headerText.includes("default-src 'self'") || !headerText.includes("object-src 'none'")) {
  fail('Baseline browser security headers are missing.');
}
const csp = (vercel.headers || [])
  .flatMap(rule => Array.isArray(rule?.headers) ? rule.headers : [])
  .find(header => String(header?.key || '').toLowerCase() === 'content-security-policy')?.value || '';
if (!/script-src\s+'self'/.test(csp) || /script-src[^;]*'unsafe-inline'/.test(csp)) fail('Script CSP must stay self-only.');

for (const file of [
  'data/canon/rin_prompt_profile.json',
  'data/canon/rin_backstory.json',
  'data/canon/rin_memories.json',
  'data/canon/rin_triggers.json',
  'public/data/rin_schedule.json',
  'public/data/stickers-v7.json'
]) {
  const json = JSON.parse(await read(file));
  if (!json._schema) fail(`${file} has no _schema.`);
}

// Rin Mind v2 is the semantic owner. The old two-paid-stage gate must not be reintroduced.
const apiChat = await read('api/chat.js');
requireText(apiChat, [
  [/behavior-state\.js/, 'Behavior State is not wired into chat.'],
  [/drive-state\.js/, 'Drive State is not wired into chat.'],
  [/rin-mind\.js/, 'Rin Mind is not wired into chat.'],
  [/turn-stabilizer\.js/, 'Local turn stabilizer is not wired into chat.'],
  [/sticker-candidates\.js/, 'Contextual sticker candidates are not wired into chat.'],
  [/sticker-state\.js/, 'Sticker state is not wired into chat.'],
  [/canon-retrieval\.js/, 'Server-side canon retrieval is not wired into chat.'],
  [/OPENAI_MIND_MODEL/, 'OPENAI_MIND_MODEL routing is missing.'],
  [/buildRinMindPrompt\s*\(/, 'Rin Mind prompt construction is missing.'],
  [/parseRinMind\s*\(/, 'Rin Mind structured output parsing is missing.'],
  [/stabilizeTurn\s*\(/, 'Deterministic stabilization is missing.'],
  [/semanticRetries\s*:\s*0/, 'Semantic retry budget must remain zero.'],
  [/calls\s*:\s*\{\s*mind\s*:\s*1\s*,\s*kernel\s*:\s*0\s*,\s*realization\s*:\s*0/s, 'Token telemetry must expose one semantic call.'],
  [/retrieveCanonicalLore\(canonCue\)/, 'Canonical lore must be retrieved server-side.'],
  [/RETRYABLE_OPENAI_STATUSES/, 'Transport retry classification is missing.']
], 'api/chat.js');

const semanticCalls = (apiChat.match(/await\s+openaiChat\s*\(/g) || []).length;
if (semanticCalls !== 1) fail(`api/chat.js must contain exactly one semantic OpenAI invocation; found ${semanticCalls}.`);
forbidText(apiChat, [
  [/OPENAI_REALIZATION_MODEL/, 'Legacy realization model routing must not return.'],
  [/buildRealizationRetryPrompt/, 'Paid realization repair loop must not return.'],
  [/body\.lore/, 'Client-supplied lore must never become canonical input.']
], 'api/chat.js');

const mindSource = await read('lib/cognition/rin-mind.js');
requireText(mindSource, [
  [/name:\s*'rin_mind_turn_v2'/, 'Structured-output schema name is missing.'],
  [/СИЛЬНАЯ ГРАНИЦА/u, 'Explicit question/space boundary guidance is missing.'],
  [/question\.mode=none/u, 'No-question behavioral contract is missing.'],
  [/Стикер — невербальный жест Рин/u, 'Sticker volition contract is missing.'],
  [/removeQuestionSentences\s*\(/, 'Deterministic question-boundary recovery is missing.'],
  [/buildDeterministicConversationFallback/, 'Local model-output fallback is missing.']
], 'lib/cognition/rin-mind.js');

const behaviorSource = await read('lib/cognition/behavior-state.js');
requireText(behaviorSource, [
  [/strongNoQuestion/, 'Explicit no-question state is missing.'],
  [/fatigue/, 'Question fatigue tracking is missing.']
], 'lib/cognition/behavior-state.js');

const driveSource = await read('lib/cognition/drive-state.js');
requireText(driveSource, [
  [/curiosity/, 'Curiosity drive is missing.'],
  [/questionImpulse/, 'Question impulse drive is missing.']
], 'lib/cognition/drive-state.js');

const stickerStateSource = await read('lib/cognition/sticker-state.js');
requireText(stickerStateSource, [
  [/hardAvailable/, 'Hard sticker availability is missing.'],
  [/desireModifier/, 'Sticker desire modifier is missing.'],
  [/cooldownPressure/, 'Sticker cooldown must be represented as pressure.'],
  [/frequencyPressure/, 'Sticker frequency must be represented as pressure.']
], 'lib/cognition/sticker-state.js');

const stabilizerSource = await read('lib/cognition/turn-stabilizer.js');
requireText(stabilizerSource, [
  [/repairMaleUserAddress/, 'Local gender repair is missing.'],
  [/delivery_recovered_with_local_fallback/, 'Local delivery recovery is missing.'],
  [/sticker_removed_hard_unavailable/, 'Hard sticker safety recovery is missing.']
], 'lib/cognition/turn-stabilizer.js');

// Error rendering is allowed to be implemented in the authenticated bootstrap bridge
// or directly in chat.js, but repeated failures must not create fake Rin bubbles forever.
const bootstrapSource = await read('public/js/app_bootstrap.js');
const publicChat = await read('public/chat.js');
const hasBootstrapErrorBridge = /message-error-note/.test(bootstrapSource) && /MutationObserver/.test(bootstrapSource);
const hasDirectErrorNotice = /message-error-note/.test(publicChat) && !/addBubble\(userFacingError\(code\),\s*'assistant'\)/.test(publicChat);
if (!hasBootstrapErrorBridge && !hasDirectErrorNotice) fail('Retryable chat failures must update one user-message error notice instead of appending fake Rin bubbles.');

// Syntax validation covers every JS file in the repository, including files in this bundle.
runNode(['scripts/check-syntax.js'], 'repository syntax check');

console.log('Build smoke OK: Rin Mind v2, one semantic model call, sticker volition, browser/security envelope.');
