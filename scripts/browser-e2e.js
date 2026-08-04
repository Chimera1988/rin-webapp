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
        schemaVersion: 3,
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
      const reply = current.includes('Как меня зовут')
        ? `Ты говорил, что тебя зовут ${remembered || 'неизвестно'}.`
        : `Ответ на: ${current}`;
      return json(res, 200, {
        requestId: body.requestId,
        reply,
        finishReason: 'stop',
        long: false,
        coreDecision: { initiative: { mode: 'none' } }
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
  async open() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
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
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const appPort = server.address().port;
  const debugPort = await freePort();
  profileDir = await mkdtemp(path.join(tmpdir(), 'rin-browser-e2e-'));
  chromium = spawn('/usr/bin/chromium', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--host-resolver-rules=MAP rin.test 127.0.0.1',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`, 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let version;
  for (let i = 0; i < 100 && !version; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (response.ok) version = await response.json();
    } catch {}
    if (!version) await sleep(50);
  }
  if (!version) throw new Error('Chromium DevTools endpoint did not start.');

  const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
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
    localStorage.setItem('rin-sticker-mode', 'off');
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
  const initialPeerStatus = await cdp.evaluate("document.querySelector('#peerStatus')?.textContent");
  assert(initialPeerStatus === 'офлайн', `presence must stay offline before the first user message, got ${initialPeerStatus}`);

  const longChatLayout = await cdp.evaluate(`(() => {
    const chat = document.querySelector('#chat');
    const form = document.querySelector('#form');
    const app = document.querySelector('.app');
    const temporary = [];
    for (let index = 0; index < 36; index += 1) {
      const row = document.createElement('div');
      row.className = 'row her viewport-e2e-row';
      row.innerHTML = '<span class="avatar small spacer"></span><div class="bubble her">Проверка длинной переписки ' + index + '</div>';
      chat.appendChild(row);
      temporary.push(row);
    }
    chat.scrollTop = chat.scrollHeight;
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const formRect = form.getBoundingClientRect();
    const appRect = app.getBoundingClientRect();
    const result = {
      chatScrollable: chat.scrollHeight > chat.clientHeight,
      composerVisible: formRect.top >= appRect.top && formRect.bottom <= viewportHeight + 1,
      documentLocked: document.documentElement.scrollHeight <= Math.ceil(viewportHeight) + 2,
      composerBelowMessages: formRect.top >= chat.getBoundingClientRect().bottom - 1
    };
    temporary.forEach(node => node.remove());
    return result;
  })()`);
  assert(longChatLayout.chatScrollable, 'a long conversation must scroll inside #chat');
  assert(longChatLayout.composerVisible, 'composer must remain inside the visible viewport');
  assert(longChatLayout.documentLocked, 'the document itself must not grow with chat history');
  assert(longChatLayout.composerBelowMessages, 'composer must occupy a separate grid row below messages');

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
  const completedUsers = count => `JSON.parse(localStorage.getItem('rin-history-v3') || '[]').filter(m => m.role === 'user' && m.status === 'complete').length >= ${count}`;

  await send('Меня зовут Алексей. Мой проект называется Rin.');
  await waitFor(cdp, completedUsers(1), 'first completed user turn');
  await send('Как меня зовут?');
  await waitFor(cdp, completedUsers(2), 'second completed user turn', 20_000);
  assert(chatBodies[1]?.memory?.facts?.user?.name === 'Алексей', 'semantic memory must enter the immediately following request');

  await Promise.all([send('Быстрый ход один'), send('Быстрый ход два')]);
  await waitFor(cdp, completedUsers(4), 'two rapid sends');
  const rapid = chatBodies.slice(-2).map(body => [...body.history].reverse().find(item => item.role === 'user')?.content);
  assert(rapid[0] === 'Быстрый ход один' && rapid[1] === 'Быстрый ход два', `rapid send order changed: ${rapid.join(' / ')}`);

  await send('FAIL_ONCE');
  await waitFor(cdp, "Boolean(document.querySelector('.message-retry'))", 'failed message retry control');
  const beforeRetry = chatBodies.length;
  await cdp.evaluate("document.querySelector('.message-retry').click(); true");
  await waitFor(cdp, completedUsers(5), 'retried user turn');
  assert(chatBodies.length === beforeRetry + 1, 'retry must issue exactly one new request');
  const retryBody = chatBodies.at(-1);
  assert([...retryBody.history].at(-1)?.content === 'FAIL_ONCE', 'retried turn must be the final current context item');

  const lifecycle = await cdp.evaluate(`(() => {
    const history = JSON.parse(localStorage.getItem('rin-history-v3') || '[]');
    return {
      allTyped: history.every(m => m.id && m.schemaVersion === 3 && m.kind && m.status),
      failed: history.filter(m => m.status === 'failed').length,
      pending: history.filter(m => ['pending','sent'].includes(m.status)).length,
      peer: document.querySelector('#peerStatus')?.textContent
    };
  })()`);
  assert(lifecycle.allTyped, 'all persisted chat events must use schema v3');
  assert(lifecycle.failed === 0 && lifecycle.pending === 0, 'successful retry must leave no failed/pending turn');
  assert(lifecycle.peer === 'онлайн', `unexpected operational status: ${lifecycle.peer}`);

  console.log(`Browser E2E OK: login, long-chat viewport, unified themes/settings, single greeting, memory-before-next-turn, rapid order, failure/retry; ${chatBodies.length} chat requests.`);
} catch (error) {
  if (error instanceof BrowserPolicyBlockedError) {
    console.log(`Browser E2E SKIPPED: ${error.message}`);
  } else {
    throw error;
  }
} finally {
  try { cdp?.close(); } catch {}
  try { chromium?.kill('SIGTERM'); } catch {}
  await new Promise(resolve => server.close(resolve));
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
}
