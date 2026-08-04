import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('chat shell has a definite viewport height and only messages scroll', async () => {
  const [html, css, chat] = await Promise.all([
    read('public/index.html'),
    read('public/style.css'),
    read('public/chat.js')
  ]);

  assert.match(html, /interactive-widget=resizes-content/);
  assert.match(css, /html\s*\{[\s\S]*height:\s*100%/);
  assert.match(css, /body\.chat-app\s*\{[\s\S]*overflow:\s*hidden/);
  assert.match(css, /body\.chat-app\s*\{[\s\S]*height:\s*var\(--rin-viewport-height, 100dvh\)[\s\S]*max-height:\s*var\(--rin-viewport-height, 100dvh\)/);
  assert.match(css, /\.app\s*\{[\s\S]*height:\s*100%[\s\S]*grid-template-rows:\s*minmax\(0, 1fr\) auto[\s\S]*contain:\s*size layout/);
  assert.match(css, /\.chat\s*\{[\s\S]*overflow-y:\s*auto[\s\S]*touch-action:\s*pan-y/);
  assert.match(css, /\.composer\s*\{[\s\S]*min-width:\s*0/);

  assert.match(chat, /createChatViewportController/);
  assert.match(chat, /chatViewport\.requestScrollToBottom/);
  assert.doesNotMatch(chat, /chatEl\.scrollTop\s*=/);
});

test('viewport controller is a real deployable module', async () => {
  const [moduleSource, smoke] = await Promise.all([
    read('public/js/chat_viewport.js'),
    read('scripts/build-smoke.js')
  ]);

  assert.match(moduleSource, /export function createChatViewportController/);
  assert.match(moduleSource, /--rin-viewport-height/);
  assert.match(moduleSource, /visualViewport/);
  assert.match(smoke, /public\/js\/chat_viewport\.js/);
});
