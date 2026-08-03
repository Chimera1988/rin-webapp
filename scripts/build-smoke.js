import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const read = file => readFile(path.join(root, file), 'utf8');
const exists = file => access(path.join(root, file)).then(() => true, () => false);
const fail = message => { throw new Error(message); };

const releaseSource = await read('public/js/release.js');
const release = releaseSource.match(/RIN_RELEASE_ID\s*=\s*['"]([^'"]+)['"]/)?.[1];
if (!release) fail('Release ID is missing.');

for (const htmlFile of ['public/index.html', 'public/login.html']) {
  const html = await read(htmlFile);
  if (!html.includes(`v=${release}`)) fail(`${htmlFile} does not use release ${release}.`);
  for (const match of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
    const raw = match[1].split('?')[0];
    if (raw === '/' || raw.startsWith('/api/')) continue;
    const target = raw.startsWith('/public/') ? raw.slice(1) : `public${raw}`;
    if (!await exists(target)) fail(`${htmlFile} references missing ${target}.`);
  }
}

const index = await read('public/index.html');
if ((index.match(/app_bootstrap\.js/g) || []).length !== 1) fail('Index must load exactly one application bootstrap.');
if (/chat\.js[^\n]*<\/script>/i.test(index)) fail('Index must not load chat.js outside the authenticated bootstrap.');

const activeSources = [
  'package.json', 'vercel.json', 'api/chat.js', 'public/chat.js',
  'public/index.html', 'public/login.html', 'public/js/app_bootstrap.js',
  'public/js/chat_store.js', 'public/js/rin_memory.js', 'public/js/http_client.js'
];
const forbidden = ['stickers-v4', 'stickers-v5.test', 'response_postprocessor', '/data/rin_persona.json', '/data/rin_mind.json', '/data/rin_reasoning.json', '/data/rin_speaking_habits.json'];
for (const file of activeSources) {
  const source = await read(file);
  for (const token of forbidden) if (source.includes(token)) fail(`${file} still references ${token}.`);
}

for (const file of ['public/data/rin_prompt_profile.json', 'public/data/rin_backstory.json', 'public/data/rin_memories.json', 'public/data/rin_phrases.json', 'public/data/rin_schedule.json', 'public/data/rin_triggers.json', 'public/data/stickers-v6.json']) {
  const json = JSON.parse(await read(file));
  if (!json._schema) fail(`${file} has no _schema.`);
}


const promptProfile = JSON.parse(await read('public/data/rin_prompt_profile.json'));
const promptProfileText = JSON.stringify(promptProfile);
if (/(Кирилл|kirill|Хикари)/i.test(promptProfileText)) fail('Canonical prompt profile must not hardcode a user identity.');
if (promptProfile.relationship?.user_identity_source !== 'memory.facts.user.name_or_generic') fail('Canonical user identity source is not explicit.');

const vercel = JSON.parse(await read('vercel.json'));
const headerText = JSON.stringify(vercel.headers || []);
if (!headerText.includes('/api/(.*)') || !headerText.includes('no-store')) fail('API no-store cache policy is missing.');
if (!headerText.includes('css|js') || !headerText.includes('must-revalidate')) fail('Client revalidation cache policy is missing.');

const chat = await read('public/chat.js');
if ((chat.match(/fetchWithTimeout\('\/api\/chat'/g) || []).length !== 1) fail('Chat must have exactly one model response endpoint call.');
if (!chat.includes('shouldRefreshEnvironment')) fail('Environment refresh must feed the unified chat pipeline.');
if (!chat.includes('await memoryJobRunner.drain();')) fail('The next request must wait for prior semantic-memory work.');
if (await exists('public/js/response_postprocessor.js')) fail('Legacy response postprocessor must be removed.');
if (!await exists('public/data/legacy/README.md')) fail('Legacy canon must be isolated and documented.');
const memorySource = await read('public/js/rin_memory.js');
if (!memorySource.includes('navigator?.locks')) fail('Diary writes must use a cross-tab lock when the browser supports Web Locks.');

console.log(`Build smoke OK: release ${release}, authenticated bootstrap, active assets and cache policy verified.`);
