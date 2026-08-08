import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';

const root = process.cwd();
const publicRoot = path.join(root, 'public');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const chatBodies = [];
let failOnce = true;

function contentType(file) {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.webp': 'image/webp', '.ico': 'image/x-icon'
  })[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/login' && req.method === 'POST') {
      const body = await readBody(req);
      const pin = String(req.headers['x-rin-pin'] || body.pin || '');
      return pin === '1357' ? json(res, 200, { ok: true }) : json(res, 401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    if (url.pathname === '/api/weather') {
      return json(res, 200, { name: 'Kanazawa', weather: 'ясно', temp: 21, feels_like: 21, icon: '01d' });
    }
    if (url.pathname === '/api/memory' && req.method === 'POST') {
      await readBody(req);
      await sleep(300);
      return json(res, 200, {
        schemaVersion: 4,
        facts: [{ path: 'user.name', value: 'Алексей', confidence: 0.99 }],
        events: [], openLoops: [], resolvedLoops: [], sharedMoments: []
      });
    }
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const body = await readBody(req);
      chatBodies.push(body);
      const current = [...(body.history || [])].reverse().find(item => item.role === 'user')?.content || '';
      if (current === 'FAIL_ONCE' && failOnce) {
        failOnce = false;
        return json(res, 502, { error: 'Temporary failure', code: 'UPSTREAM_TIMEOUT', requestId: body.requestId });
      }
      const remembered = body.memory?.facts?.user?.name;
      const plannedTarget = current === 'RIN_REPLY_TARGET'
        ? (body.history || []).find(item => item.role === 'user' && String(item.content || '').includes('Мой проект называется Rin'))
        : null;
      const reply = body.trigger?.type === 'greeting'
        ? 'Я сама решила написать первой — просто захотелось.'
        : body.trigger?.type === 'scheduled'
          ? 'У меня появилась одна мысль, и я решила не откладывать её до завтра.'
          : current.includes('Как меня зовут')
        ? `Ты говорил, что тебя зовут ${remembered || 'неизвестно'}.`
        : current === 'RIN_REPLY_TARGET'
          ? 'К этому я и хотела вернуться: что в проекте сейчас самое живое для тебя?'
          : `Ответ на: ${current}`;
      return json(res, 200, {
        requestId: body.requestId,
        reply,
        finishReason: 'stop',
        long: false,
        responsePlan: body.trigger?.type ? { responseAct: body.trigger.type === 'greeting' ? 'proactive_greeting' : 'proactive_personal_share', questionBudget: 0, rinIntent: body.memory?.conversationState?.rinIntent || null } : plannedTarget ? {
          replyTarget: {
            messageId: plannedTarget.id,
            role: 'user',
            kind: plannedTarget.kind || 'text',
            excerpt: plannedTarget.content,
            reason: 'browser e2e callback',
            confidence: 0.9
          }
        } : null,
        coreDecision: { initiative: { mode: 'none' }, nonverbalAction: current.includes('Целую тебя') ? { preferredStickerId: 'kiss', emotion: 'kiss', cause: 'ответ на поцелуй пользователя', delivery: 'sticker_only', standalone: true, intensity: 90 } : null, emotionalResponse: { intensity: current.includes('Целую тебя') ? 90 : 40 } },
        delivery: current.includes('Целую тебя')
          ? { type: 'sticker', preferredStickerId: 'kiss', delivery: 'sticker_only', nonverbal: { preferredStickerId: 'kiss', emotion: 'kiss', cause: 'ответ на поцелуй пользователя', delivery: 'sticker_only', standalone: true, intensity: 90 }, reason: 'turn_decision' }
          : { type: 'text' },
        stateTransition: (() => {
          const previousRelationship = body.memory?.relationship || {};
          const jealousy = current.includes('Меня пригласила девушка');
          const reveal = current.includes('Это была шутка, хотел тебя проверить на ревность');
          const previousEmotion = body.memory?.conversationState?.emotionalState || null;
          const emotionalState = jealousy ? {
            schema: 'rin-affective-state-v1',
            primary: { type: 'jealousy', cause: 'пользователь упомянул возможную романтическую встречу с другой девушкой', target: 'relationship', intensity: 42, valence: -18, arousal: 58, startedAtTurn: 10, expiresAfterTurns: 4, remainingTurns: 4, resolution: 'unresolved', source: 'dialogue' },
            secondary: null, tension: 34, warmth: 58, vulnerability: 34,
            momentum: { direction: 'tense', strength: 42 },
            lastEvent: { type: 'romantic_rival', cause: 'пользователь упомянул возможную романтическую встречу с другой девушкой', turn: 10 }, updatedAtTurn: 10
          } : reveal ? {
            schema: 'rin-affective-state-v1',
            primary: { type: 'playful_irritation', cause: 'пользователь признался, что поддразнивал Рин и проверял её реакцию', target: 'user', intensity: 30, valence: 8, arousal: 62, startedAtTurn: 11, expiresAfterTurns: 3, remainingTurns: 3, resolution: 'unresolved', source: 'dialogue' },
            secondary: { type: 'relief', cause: 'романтическая угроза оказалась шуткой', target: 'relationship', intensity: 22, valence: 42, arousal: 30, startedAtTurn: 11, expiresAfterTurns: 2, remainingTurns: 2, resolution: 'softening', source: 'dialogue' },
            tension: 18, warmth: 61, vulnerability: 34,
            momentum: { direction: 'playful', strength: 30 },
            lastEvent: { type: 'tease_reveal', cause: 'пользователь признался, что поддразнивал Рин и проверял её реакцию', turn: 11 }, updatedAtTurn: 11
          } : previousEmotion;
          return {
            schema: 'rin-state-transition-v3',
            dialogueState: { scene: current.includes('Целую тебя') ? 'romance' : 'everyday', topic: current, relationToPreviousTurn: 'continuation' },
            beliefUpdates: [], openLoopUpdates: [], resolvedLoopIds: [],
            moodState: body.memory?.mood || { affection: 65, energy: 65 },
            relationshipState: {
              trust: previousRelationship.trust ?? 55, closeness: previousRelationship.closeness ?? 42, comfort: previousRelationship.comfort ?? 52, respect: previousRelationship.respect ?? 68,
              playfulness: previousRelationship.playfulness ?? 45, attraction: previousRelationship.attraction ?? 34, vulnerability: previousRelationship.vulnerability ?? 28,
              recentDynamic: { lastSignal: reveal ? 'playful' : jealousy ? 'neutral' : 'neutral', positiveStreak: 0, negativeStreak: 0, repairPending: false, lastCause: jealousy || reveal ? 'e2e affective state' : '', turn: reveal ? 11 : jealousy ? 10 : 0 },
              sharedMoments: previousRelationship.sharedMoments || []
            },
            emotionalState,
            rinIntent: reveal ? { schema:'rin-persistent-intent-v4', id:'intent-e2e-play', status:'active', goal:'продвинуть игровую линию', motive:'пользователь поддержал поддразнивание', target:'playful_tease', sceneBinding:{key:'playful_tease',kind:'playful',subject:'поддразнивание',anchor:'сам начал',source:'last_rin_action'}, scene:'playful_flirt', priority:82, commitment:82, progress:0.48, nextMove:'make_specific_teasing_move', completionCondition:'после нескольких конкретных ходов', abandonmentCondition:'явный отказ или farewell', startedAtTurn:11, updatedAtTurn:11, turnCount:1, minTurns:2, maxTurns:4, source:'character_intent' } : body.memory?.conversationState?.rinIntent || null,
            emotionalState, emotionalTrace: emotionalState?.primary ? { emotion: emotionalState.primary.type, cause: emotionalState.primary.cause, intensity: emotionalState.primary.intensity, resolution: emotionalState.primary.resolution, expiresAfterTurns: emotionalState.primary.expiresAfterTurns, remainingTurns: emotionalState.primary.remainingTurns } : null,
            moodDelta: { affection: 0, energy: 0 }, relationshipDelta: { trust: 0, closeness: 0, comfort: 0, respect: 0, playfulness: 0, attraction: 0, vulnerability: 0 }
          };
        })(),
        conversationBrain: { activeScene: { type: current.includes('Целую тебя') ? 'romance' : 'everyday' }, hiddenIntent: { type: current.includes('Ты чего') ? 'ask_about_previous_nonverbal' : 'none' } }
      });
    }
    if (url.pathname === '/api/tts') return json(res, 503, { error: 'disabled', code: 'TTS_NOT_CONFIGURED' });

    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    if (pathname === '/login') pathname = '/login.html';
    const file = path.resolve(publicRoot, `.${pathname}`);
    if (!file.startsWith(`${publicRoot}${path.sep}`) && file !== publicRoot) return json(res, 403, { error: 'Forbidden' });
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  } catch (error) {
    json(res, 500, { error: String(error?.message || error) });
  }
});

async function freePort() {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    };
  }
  async open(timeoutMs = 5_000) {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Chromium CDP WebSocket open timed out.')), timeoutMs);
      this.ws.onopen = () => { clearTimeout(timer); resolve(); };
      this.ws.onerror = error => { clearTimeout(timer); reject(error); };
    });
  }
  send(method, params = {}, timeoutMs = 3_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chromium CDP command timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); }
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
    return result.result?.value;
  }
  close() { this.ws.close(); }
}

class BrowserPolicyBlockedError extends Error {}

async function detectManagedNavigationBlock() {
  const policyFiles = [
    '/etc/chromium/policies/managed/000_policy_merge.json',
    '/etc/opt/chrome/policies/managed/000_policy_merge.json'
  ];
  for (const file of policyFiles) {
    try {
      const policy = JSON.parse(await readFile(file, 'utf8'));
      const blocked = Array.isArray(policy?.URLBlocklist) ? policy.URLBlocklist : [];
      const allowed = Array.isArray(policy?.URLAllowlist) ? policy.URLAllowlist : [];
      if (blocked.includes('*') && allowed.length === 0) {
        return `Chromium enterprise URLBlocklist blocks all navigations in this environment (${file}).`;
      }
    } catch {}
  }
  return null;
}

async function waitFor(cdp, expression, message, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await cdp.evaluate(expression)) return; } catch {}
    await sleep(50);
  }
  let diagnostic = '';
  try { diagnostic = await cdp.evaluate("JSON.stringify({href:location.href,ready:document.readyState,title:document.title,body:document.body?.innerText?.slice(0,300)})"); } catch {}
  if (/chrome-error:\/\/chromewebdata/.test(diagnostic) && /is blocked|doesn.t allow/i.test(diagnostic)) {
    throw new BrowserPolicyBlockedError('Chromium enterprise URLBlocklist blocks all navigations in this environment.');
  }
  throw new Error(`Browser E2E timeout: ${message}; ${diagnostic}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(`Browser E2E assertion failed: ${message}`);
}

let chromium;
let cdp;
let profileDir;
try {
  const managedNavigationBlock = await detectManagedNavigationBlock();
  if (managedNavigationBlock) throw new BrowserPolicyBlockedError(managedNavigationBlock);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const appPort = server.address().port;
  const debugPort = await freePort();
  profileDir = await mkdtemp(path.join(tmpdir(), 'rin-browser-e2e-'));
  chromium = spawn('/usr/bin/chromium', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--host-resolver-rules=MAP rin.test 127.0.0.1',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`, 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let version;
  const devtoolsDeadline = Date.now() + 8_000;
  while (!version && Date.now() < devtoolsDeadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(500) });
      if (response.ok) version = await response.json();
    } catch {}
    if (!version) await sleep(50);
  }
  if (!version) throw new Error('Chromium DevTools endpoint did not start.');

  const pagesResponse = await fetch(`http://127.0.0.1:${debugPort}/json/list`, { signal: AbortSignal.timeout(2_000) });
  if (!pagesResponse.ok) throw new Error(`Chromium DevTools page list failed: ${pagesResponse.status}`);
  const pages = await pagesResponse.json();
  cdp = new Cdp(pages[0].webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: `http://rin.test:${appPort}/login.html` });
  await waitFor(cdp, "Boolean(document.querySelector('#loginForm'))", 'login form');

  await cdp.evaluate(`(() => {
    localStorage.clear();
    document.querySelector('#pinInput').value = '0000';
    document.querySelector('#loginForm').requestSubmit();
    return true;
  })()`);
  await waitFor(cdp, "document.querySelector('#loginError')?.textContent.includes('Неверный PIN')", 'invalid PIN error');
  assert(await cdp.evaluate("localStorage.getItem('rin-pin') === null"), 'invalid PIN must not be saved');

  await cdp.evaluate(`(() => {
    localStorage.setItem('rin-sticker-mode', 'always');
    localStorage.setItem('rin-profile-v1', JSON.stringify({ initiation: { max_per_day: 0, windows: [] } }));
    document.querySelector('#pinInput').disabled = false;
    document.querySelector('#pinInput').value = '1357';
    document.querySelector('#loginForm').requestSubmit();
    return true;
  })()`);
  await waitFor(cdp, "location.pathname.includes('index') && document.documentElement.classList.contains('auth-ready')", 'authenticated app bootstrap', 20_000);
  await waitFor(cdp, "document.querySelectorAll('#chat .row.assistant').length >= 1", 'single greeting');
  await sleep(500);
  const initialAssistantCount = await cdp.evaluate("document.querySelectorAll('#chat .row.assistant').length");
  assert(initialAssistantCount === 1, `expected one greeting, got ${initialAssistantCount}`);
  assert(chatBodies[0]?.trigger?.type === 'greeting', 'initial greeting must go through /api/chat as a proactive trigger');
  assert(chatBodies[0]?.history?.length === 0, 'proactive greeting must not fabricate a user message');
  const initialPeerStatus = await cdp.evaluate("document.querySelector('#peerStatus')?.textContent");
  assert(initialPeerStatus === 'офлайн', `presence must stay offline before the first user message, got ${initialPeerStatus}`);

  const freshDefaults = await cdp.evaluate(`(() => ({
    dark: document.documentElement.classList.contains('theme-dark'),
    light: document.documentElement.classList.contains('theme-light'),
    storedTheme: localStorage.getItem('rin-theme'),
    debugEnabled: document.querySelector('#debugToggle')?.checked === true,
    storedDebug: localStorage.getItem('rin-debug-enabled'),
    debugLog: document.querySelector('#debugLog')?.textContent || ''
  }))()`);
  assert(freshDefaults.dark && !freshDefaults.light, 'fresh client must start with the dark theme');
  assert(freshDefaults.storedTheme === null, 'default dark theme must not masquerade as an explicit saved preference');
  assert(freshDefaults.debugEnabled, 'debug toggle must start enabled when no preference is stored');
  assert(freshDefaults.storedDebug === null, 'default debug-on must preserve absence of an explicit user preference');
  assert(/debug enabled/i.test(freshDefaults.debugLog), 'debug log must record that debug is enabled by default');

  const longChatLayout = await cdp.evaluate(`(() => {
    const chat = document.querySelector('#chat');
    const form = document.querySelector('#form');
    const app = document.querySelector('.app');
    const shell = document.querySelector('#chatViewportShell');
    const wallpaper = document.querySelector('#chatWallpaper');
    document.documentElement.style.setProperty('--wallpaper-url', 'linear-gradient(135deg, #123 0%, #789 100%)');
    const wallpaperRectBefore = wallpaper.getBoundingClientRect();
    const temporary = [];
    for (let index = 0; index < 36; index += 1) {
      const row = document.createElement('div');
      row.className = 'row her viewport-e2e-row';
      row.innerHTML = '<span class="avatar small spacer"></span><div class="bubble her">Проверка длинной переписки ' + index + '</div>';
      chat.appendChild(row);
      temporary.push(row);
    }
    chat.scrollTop = chat.scrollHeight;
    const wallpaperRectAfter = wallpaper.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportHeight = viewport?.height || window.innerHeight;
    const viewportWidth = viewport?.width || window.innerWidth;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportLeft = viewport?.offsetLeft || 0;
    const formRect = form.getBoundingClientRect();
    const appRect = app.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    const result = {
      chatScrollable: chat.scrollHeight > chat.clientHeight,
      composerVisible: formRect.top >= shellRect.top && formRect.bottom <= shellRect.bottom + 1,
      documentLocked: document.documentElement.scrollHeight <= Math.ceil(window.innerHeight) + 2,
      composerBelowMessages: formRect.top >= chat.getBoundingClientRect().bottom - 1,
      shellMatchesVisualViewport:
        Math.abs(shellRect.top - viewportTop) <= 1 &&
        Math.abs(shellRect.left - viewportLeft) <= 1 &&
        Math.abs(shellRect.height - viewportHeight) <= 1 &&
        Math.abs(shellRect.width - viewportWidth) <= 1,
      wallpaperOutsideScroller: wallpaper.parentElement === app && !chat.contains(wallpaper),
      wallpaperStationary:
        Math.abs(wallpaperRectBefore.top - wallpaperRectAfter.top) <= 1 &&
        Math.abs(wallpaperRectBefore.left - wallpaperRectAfter.left) <= 1 &&
        Math.abs(wallpaperRectBefore.width - wallpaperRectAfter.width) <= 1 &&
        Math.abs(wallpaperRectBefore.height - wallpaperRectAfter.height) <= 1
    };
    temporary.forEach(node => node.remove());
    return result;
  })()`);
  assert(longChatLayout.chatScrollable, 'a long conversation must scroll inside #chat');
  assert(longChatLayout.composerVisible, 'composer must remain inside the visible viewport');
  assert(longChatLayout.documentLocked, 'the document itself must not grow with chat history');
  assert(longChatLayout.composerBelowMessages, 'composer must occupy a separate grid row below messages');
  assert(longChatLayout.shellMatchesVisualViewport, 'chat shell must match visualViewport size and offsets');
  assert(longChatLayout.wallpaperOutsideScroller, 'wallpaper must be a sibling of the scrolling chat, not its child');
  assert(longChatLayout.wallpaperStationary, 'wallpaper layer geometry must not change when chat history scrolls');

  await cdp.evaluate("document.querySelector('#settingsToggle').click(); true");
  await waitFor(cdp, "document.querySelector('[data-settings-page=main]')?.classList.contains('is-active')", 'settings main page');
  const settingsContract = await cdp.evaluate(`(() => {
    const main = document.querySelector('[data-settings-page="main"]');
    const voiceEntry = main?.querySelector('[data-settings-target="voice"]');
    return {
      headerIconIsSvg: Boolean(document.querySelector('#settingsToggle svg')),
      switchInMain: Boolean(main?.querySelector('#voiceEnabled')),
      voiceChevron: Boolean(voiceEntry?.querySelector('.settings-chevron'))
    };
  })()`);
  assert(settingsContract.headerIconIsSvg, 'settings header action must use an SVG line icon');
  assert(!settingsContract.switchInMain && settingsContract.voiceChevron, 'voice main row must be a submenu link without a switch');

  await cdp.evaluate("document.querySelector('[data-settings-target=voice]').click(); true");
  await waitFor(cdp, "document.querySelector('[data-settings-page=voice]')?.classList.contains('is-active')", 'voice settings page');
  assert(await cdp.evaluate("Boolean(document.querySelector('[data-settings-page=voice] #voiceEnabled'))"), 'voice switch must be inside voice submenu');

  await cdp.evaluate("document.querySelector('[data-settings-page=voice] [data-settings-back]').click(); document.querySelector('[data-settings-target=general]').click(); true");
  await waitFor(cdp, "document.querySelector('[data-settings-page=general]')?.classList.contains('is-active')", 'general settings page');
  await cdp.evaluate("document.querySelector('[data-theme-choice=theme-light]').click(); true");
  assert(await cdp.evaluate("document.documentElement.classList.contains('theme-light') && document.querySelector('[data-theme-choice=theme-light]').classList.contains('is-active')"), 'light theme must apply to the whole app');
  await cdp.evaluate("document.querySelector('[data-theme-choice=theme-dark]').click(); true");
  assert(await cdp.evaluate("document.documentElement.classList.contains('theme-dark') && document.querySelector('[data-theme-choice=theme-dark]').classList.contains('is-active')"), 'dark theme must apply to the whole app');
  await cdp.evaluate("document.querySelector('#closeSettingsBtn').click(); true");

  const send = text => cdp.evaluate(`(() => {
    const input = document.querySelector('#input');
    input.value = ${JSON.stringify(text)};
    document.querySelector('#form').requestSubmit();
    return true;
  })()`);
  const completedUsers = count => `JSON.parse(localStorage.getItem('rin-history-v5') || '[]').filter(m => m.role === 'user' && m.status === 'complete').length >= ${count}`;

  await send('Меня зовут Алексей. Мой проект называется Rin.');
  await waitFor(cdp, completedUsers(1), 'first completed user turn');
  await send('Как меня зовут?');
  await waitFor(cdp, completedUsers(2), 'second completed user turn', 20_000);
  assert(chatBodies[1]?.memory?.facts?.user?.name === 'Алексей', 'semantic memory must enter the immediately following request');

  await Promise.all([send('Быстрый ход один'), send('Быстрый ход два')]);
  await waitFor(cdp, completedUsers(4), 'two rapid sends');
  const rapid = chatBodies.slice(-2).map(body => [...body.history].reverse().find(item => item.role === 'user')?.content);
  assert(rapid[0] === 'Быстрый ход один' && rapid[1] === 'Быстрый ход два', `rapid send order changed: ${rapid.join(' / ')}`);

  const beforeFailedTurnState = await cdp.evaluate(`(() => {
    const diary = JSON.parse(localStorage.getItem('rin-diary-v1') || '{}');
    return {
      revision: diary.conversationState?.revision || 0,
      interactionCount: diary.innerLife?.interactionCount || 0,
      affection: diary.mood?.affection,
      trust: diary.relationship?.trust
    };
  })()`);
  await send('FAIL_ONCE');
  await waitFor(cdp, "Boolean(document.querySelector('.message-retry'))", 'failed message retry control');
  const afterFailedTurnState = await cdp.evaluate(`(() => {
    const diary = JSON.parse(localStorage.getItem('rin-diary-v1') || '{}');
    return {
      revision: diary.conversationState?.revision || 0,
      interactionCount: diary.innerLife?.interactionCount || 0,
      affection: diary.mood?.affection,
      trust: diary.relationship?.trust
    };
  })()`);
  assert(JSON.stringify(afterFailedTurnState) === JSON.stringify(beforeFailedTurnState), 'failed request must not mutate committed conversation/persona state');
  const beforeRetry = chatBodies.length;
  await cdp.evaluate("document.querySelector('.message-retry').click(); true");
  await waitFor(cdp, completedUsers(5), 'retried user turn');
  assert(chatBodies.length === beforeRetry + 1, 'retry must issue exactly one new request');
  const retryBody = chatBodies.at(-1);
  assert([...retryBody.history].at(-1)?.content === 'FAIL_ONCE', 'retried turn must be the final current context item');

  await send('Целую тебя 💋');
  await waitFor(cdp, "JSON.parse(localStorage.getItem('rin-history-v5') || '[]').some(m => m.kind === 'sticker' && m.sticker?.id === 'kiss')", 'standalone kiss sticker');
  const kissTurn = await cdp.evaluate(`(() => {
    const history = JSON.parse(localStorage.getItem('rin-history-v5') || '[]');
    const sticker = history.find(m => m.kind === 'sticker' && m.sticker?.id === 'kiss');
    const rows = [...document.querySelectorAll('#chat .row')];
    return { sticker, lastHasText: rows.at(-1)?.querySelector('.bubble')?.textContent?.includes('Ответ на: Целую тебя') || false };
  })()`);
  assert(Boolean(kissTurn.sticker) && !kissTurn.lastHasText, 'kiss must be a sticker-only assistant turn');
  await send('Ты чего?');
  await waitFor(cdp, completedUsers(7), 'follow-up after sticker');
  assert(chatBodies.at(-1)?.history?.some(item => item.kind === 'sticker' && item.content.includes('поцел')), 'next request must include semantic sticker context');

  const selectedReply = await cdp.evaluate(`(() => {
    const rows = [...document.querySelectorAll('#chat .row.her[data-message-id]')];
    const row = rows.at(-1);
    const action = row?.querySelector('.message-reply-action');
    if (!row || !action) return null;
    const sourceId = row.dataset.messageId;
    action.click();
    return {
      sourceId,
      previewVisible: !document.querySelector('#replyPreview')?.hidden,
      previewAuthor: document.querySelector('#replyPreviewAuthor')?.textContent
    };
  })()`);
  assert(selectedReply?.previewVisible && selectedReply.previewAuthor === 'Рин', 'manual reply selection must open the composer preview');
  await send('Я отвечаю именно на эту реплику.');
  await waitFor(cdp, completedUsers(8), 'manual reply turn');
  const manualReply = chatBodies.at(-1)?.history?.at(-1);
  assert(manualReply?.inReplyTo === selectedReply.sourceId, 'manual reply must preserve inReplyTo in the API history');
  assert(manualReply?.replySnapshot?.role === 'assistant', 'manual reply must preserve a public snapshot of the selected assistant message');
  const manualUi = await cdp.evaluate(`(() => {
    const history = JSON.parse(localStorage.getItem('rin-history-v5') || '[]');
    const message = [...history].reverse().find(item => item.role === 'user' && item.content === 'Я отвечаю именно на эту реплику.');
    const row = message ? document.querySelector('[data-message-id="' + message.id + '"]') : null;
    return { linked: message?.inReplyTo || null, quoteVisible: Boolean(row?.querySelector('.reply-quote')) };
  })()`);
  assert(manualUi.linked === selectedReply.sourceId && manualUi.quoteVisible, 'manual reply must render the quote inside the existing user bubble');

  await send('RIN_REPLY_TARGET');
  await waitFor(cdp, completedUsers(9), 'planned Rin reply target');
  const rinReply = await cdp.evaluate(`(() => {
    const history = JSON.parse(localStorage.getItem('rin-history-v5') || '[]');
    const message = [...history].reverse().find(item => item.role === 'assistant' && item.replySnapshot);
    const row = message ? document.querySelector('[data-message-id="' + message.id + '"]') : null;
    return {
      targetContent: message?.replySnapshot?.excerpt || '',
      linked: message?.inReplyTo || null,
      quoteVisible: Boolean(row?.querySelector('.reply-quote'))
    };
  })()`);
  assert(rinReply.linked && /Мой проект называется Rin/.test(rinReply.targetContent) && rinReply.quoteVisible, 'Rin planned reply must quote a specific earlier user message');

  await send('Меня пригласила девушка на встречу вечером');
  await waitFor(cdp, completedUsers(10), 'affective jealousy commit');
  const jealousyState = await cdp.evaluate(`(() => {
    const diary = JSON.parse(localStorage.getItem('rin-diary-v1') || '{}');
    return { schema: diary._schema, emotion: diary.conversationState?.emotionalState?.primary?.type, cause: diary.conversationState?.emotionalState?.primary?.cause };
  })()`);
  assert(jealousyState.schema === 4 && jealousyState.emotion === 'jealousy' && /другой девушк/.test(jealousyState.cause || ''), 'canonical jealousy state must commit to diary v4');

  await send('Это была шутка, хотел тебя проверить на ревность 😁');
  await waitFor(cdp, completedUsers(11), 'affective reveal commit');
  assert(chatBodies.at(-1)?.memory?.conversationState?.emotionalState?.primary?.type === 'jealousy', 'next browser request must restore committed jealousy before server transition');
  const revealState = await cdp.evaluate(`(() => {
    const diary = JSON.parse(localStorage.getItem('rin-diary-v1') || '{}');
    return { primary: diary.conversationState?.emotionalState?.primary?.type, secondary: diary.conversationState?.emotionalState?.secondary?.type, momentum: diary.conversationState?.emotionalState?.momentum?.direction };
  })()`);
  assert(revealState.primary === 'playful_irritation' && revealState.secondary === 'relief' && revealState.momentum === 'playful', 'reveal transition must replace jealousy with playful irritation + relief');

  const revealIntent = await cdp.evaluate(`(() => JSON.parse(localStorage.getItem('rin-diary-v1') || '{}').conversationState?.rinIntent || null)()`);
  assert(revealIntent?.status === 'active' && revealIntent?.id === 'intent-e2e-play', 'reveal must commit the persistent Rin intent');
  await send('Да я и не собирался выкручиваться 😏');
  await waitFor(cdp, completedUsers(12), 'persistent intent next turn');
  assert(chatBodies.at(-1)?.memory?.conversationState?.rinIntent?.id === 'intent-e2e-play', 'next browser request must restore the committed persistent Rin intent');
  assert(chatBodies.at(-1)?.memory?.conversationState?.rinIntent?.sceneBinding?.key === 'playful_tease', 'next browser request must restore the concrete intent scene binding');

  const lifecycle = await cdp.evaluate(`(() => {
    const history = JSON.parse(localStorage.getItem('rin-history-v5') || '[]');
    return {
      allTyped: history.every(m => m.id && m.schemaVersion === 5 && m.kind && m.status),
      failed: history.filter(m => m.status === 'failed').length,
      pending: history.filter(m => ['pending','sent'].includes(m.status)).length,
      peer: document.querySelector('#peerStatus')?.textContent,
      conversationRevision: JSON.parse(localStorage.getItem('rin-diary-v1') || '{}').conversationState?.revision || 0
    };
  })()`);
  assert(lifecycle.allTyped, 'all persisted chat events must use schema v5');
  assert(lifecycle.failed === 0 && lifecycle.pending === 0, 'successful retry must leave no failed/pending turn');
  assert(lifecycle.peer === 'онлайн', `unexpected operational status: ${lifecycle.peer}`);
  assert(lifecycle.conversationRevision >= 12, `committed conversation state did not advance with successful turns: ${lifecycle.conversationRevision}`);

  console.log(`Browser E2E OK: login, iOS visual-viewport shell, long-chat viewport, unified themes/settings, single greeting, memory-before-next-turn, rapid order, failure/retry, standalone sticker, manual reply and planned Rin reply and affective + persistent-intent persistence; ${chatBodies.length} chat requests.`);
} catch (error) {
  if (error instanceof BrowserPolicyBlockedError) {
    console.log(`Browser E2E SKIPPED: ${error.message}`);
  } else {
    throw error;
  }
} finally {
  try { cdp?.close(); } catch {}
  if (chromium && chromium.exitCode === null && chromium.signalCode === null) {
    try { chromium.kill('SIGTERM'); } catch {}
    await Promise.race([
      new Promise(resolve => chromium.once('exit', resolve)),
      sleep(1_500)
    ]);
    if (chromium.exitCode === null && chromium.signalCode === null) {
      try { chromium.kill('SIGKILL'); } catch {}
      await Promise.race([
        new Promise(resolve => chromium.once('exit', resolve)),
        sleep(1_000)
      ]);
    }
  }
  try { server.closeIdleConnections?.(); } catch {}
  try { server.closeAllConnections?.(); } catch {}
  await Promise.race([
    new Promise(resolve => server.close(() => resolve())),
    sleep(2_000)
  ]);
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
}
