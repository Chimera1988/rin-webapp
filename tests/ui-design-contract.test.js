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

test('stickers preserve their original rounded-square geometry inside message bubbles', async () => {
  const css = await read('public/style.css');
  const stickerRule = css.match(/\.sticker\s*\{([^}]*)\}/)?.[1] || '';
  const stickerBubbleRule = css.match(/\.bubble\.sticker-only\s*\{([^}]*)\}/)?.[1] || '';

  assert.match(stickerRule, /width:\s*156px/);
  assert.match(stickerRule, /height:\s*156px/);
  assert.match(stickerRule, /border-radius:\s*16px/);
  assert.match(stickerRule, /-webkit-mask-image:\s*none/);
  assert.match(stickerRule, /mask-image:\s*none/);
  assert.doesNotMatch(stickerRule, /border-radius:\s*50%/);
  assert.match(stickerBubbleRule, /border-radius:\s*20px/);
});

test('fresh client defaults to dark theme and debug enabled while preserving explicit user choices', async () => {
  const [html, chat] = await Promise.all([
    read('public/index.html'),
    read('public/chat.js')
  ]);

  assert.match(html, /<html\s+lang="ru"\s+class="chat-root theme-dark">/);
  assert.doesNotMatch(html, /prefers-color-scheme/);
  assert.match(html, /t\s*=\s*t\s*===\s*['"]theme-light['"]\s*\?\s*['"]theme-light['"]\s*:\s*['"]theme-dark['"]/);

  assert.match(chat, /const\s+DEFAULT_DEBUG_ENABLED\s*=\s*true/);
  assert.match(chat, /safeLocalGet\(LS_DEBUG_ENABLED,\s*DEFAULT_DEBUG_ENABLED\s*\?\s*['"]1['"]\s*:\s*['"]0['"]\)\s*!==\s*['"]0['"]/);
  assert.match(chat, /safeLocalSet\(LS_DEBUG_ENABLED,\s*_debugOn\s*\?\s*['"]1['"]\s*:\s*['"]0['"]\)/);
});
