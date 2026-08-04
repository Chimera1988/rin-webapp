import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('chat and settings share one dark/light design system', async () => {
  const [html, css, chat] = await Promise.all([
    read('public/index.html'),
    read('public/style.css'),
    read('public/chat.js')
  ]);

  assert.match(html, /<body class="chat-app">/);
  assert.match(css, /--app-background:/);
  assert.match(css, /\.tg-header[\s\S]*var\(--header-background\)/);
  assert.match(css, /\.bubble\.her[\s\S]*var\(--bubble-her\)/);
  assert.match(css, /\.settings__sheet[\s\S]*background: var\(--app-background\)/);
  assert.match(css, /\.chat-wallpaper::before[\s\S]*opacity: var\(--wallpaper-opacity\)/);
  assert.doesNotMatch(css, /\.chat::after\s*\{\s*display:\s*none/);

  assert.match(html, /data-theme-choice="theme-dark"/);
  assert.match(html, /data-theme-choice="theme-light"/);
  assert.match(chat, /function applyTheme\(/);
  assert.match(chat, /syncThemeChoices\(\)/);
});

test('header settings icon uses the same line-icon language as settings menu', async () => {
  const html = await read('public/index.html');
  const button = html.match(/<button id="settingsToggle"[\s\S]*?<\/button>/)?.[0] || '';
  assert.match(button, /class="tg-ico tg-ico--settings"/);
  assert.match(button, /<svg/);
  assert.match(button, /<circle cx="12" cy="12" r="3"/);
  assert.doesNotMatch(button, /⚙️/);
});

test('voice enable switch exists only inside the voice submenu', async () => {
  const html = await read('public/index.html');
  const mainPage = html.match(/data-settings-page="main"[\s\S]*?data-settings-page="general"/)?.[0] || '';
  const voicePage = html.match(/data-settings-page="voice"[\s\S]*?data-settings-page="debug"/)?.[0] || '';

  assert.match(mainPage, /data-settings-target="voice"[\s\S]*settings-chevron/);
  assert.doesNotMatch(mainPage, /id="voiceEnabled"/);
  assert.match(voicePage, /id="voiceEnabled"/);
  assert.match(voicePage, /id="voiceRateCard"/);
});
