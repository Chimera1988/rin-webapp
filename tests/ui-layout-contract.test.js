import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('chat uses a dedicated visual-viewport shell and only messages scroll', async () => {
  const [html, css, chat] = await Promise.all([
    read('public/index.html'),
    read('public/style.css'),
    read('public/chat.js')
  ]);

  assert.match(html, /<html[^>]*class="[^"]*\bchat-root\b[^"]*"/);
  assert.match(html, /interactive-widget=resizes-content/);
  assert.match(html, /id="chatViewportShell"\s+class="chat-viewport-shell"/);
  assert.match(html, /<main class="app">[\s\S]*id="chatWallpaper"\s+class="chat-wallpaper"[\s\S]*<section id="chat" class="chat"/);
  assert.match(css, /html\.chat-root,[\s\S]*body\.chat-app[\s\S]*overflow:\s*hidden/);
  assert.match(css, /\.chat-viewport-shell\s*\{[\s\S]*position:\s*fixed[\s\S]*width:\s*var\(--rin-viewport-width[\s\S]*height:\s*var\(--rin-viewport-height[\s\S]*translate3d\([\s\S]*--rin-viewport-offset-top/);
  const bodyBlock = css.match(/body\.chat-app\s*\{([^}]*)\}/)?.[1] || '';
  assert.doesNotMatch(bodyBlock, /height:\s*var\(--rin-viewport-height/);
  assert.match(css, /\.app\s*\{[\s\S]*height:\s*100%[\s\S]*grid-template-rows:\s*minmax\(0, 1fr\) auto[\s\S]*contain:\s*size layout/);
  assert.match(css, /\.chat-wallpaper\s*\{[\s\S]*position:\s*absolute[\s\S]*inset:\s*0[\s\S]*pointer-events:\s*none/);
  assert.match(css, /\.chat-wallpaper::before[\s\S]*background-image:\s*var\(--wallpaper-url\)/);
  assert.doesNotMatch(css, /\.chat::before[\s\S]*--wallpaper-url/);
  assert.match(css, /\.chat\s*\{[\s\S]*overflow-y:\s*auto[\s\S]*touch-action:\s*pan-y/);
  assert.match(css, /\.composer\s*\{[\s\S]*min-width:\s*0/);

  assert.match(chat, /createChatViewportController/);
  assert.match(chat, /chatViewport\.requestScrollToBottom/);
  assert.doesNotMatch(chat, /chatEl\.scrollTop\s*=/);
});

test('viewport controller is a deployable module with iOS pan compensation', async () => {
  const [moduleSource, smoke] = await Promise.all([
    read('public/js/chat_viewport.js'),
    read('scripts/build-smoke.js')
  ]);

  assert.match(moduleSource, /export function resolveViewportMetrics/);
  assert.match(moduleSource, /offsetTop/);
  assert.match(moduleSource, /--rin-viewport-offset-top/);
  assert.match(moduleSource, /KEYBOARD_RESYNC_DELAYS/);
  assert.match(smoke, /public\/js\/chat_viewport\.js/);
  assert.match(smoke, /chatViewportShell/);
});
