import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelMessageFromHistory } from '../api/chat.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('a structured sticker becomes a protected system event for the model', () => {
  const message = modelMessageFromHistory({
    role: 'assistant',
    kind: 'sticker',
    sticker: {
      id: 'mild_jealousy',
      meaning: 'лёгкая ревность',
      cause: 'упоминание другой девушки'
    }
  });
  assert.equal(message.role, 'system');
  assert.match(message.content, /ВНУТРЕННЕЕ СОБЫТИЕ ДИАЛОГА/);
  assert.match(message.content, /лёгкая ревность/);
  assert.match(message.content, /НЕ ЦИТИРОВАТЬ/);
  assert.doesNotMatch(message.content, /^\[/);
});

test('sticker UI inherits the message bubble border, surface and tail', async () => {
  const css = await read('public/style.css');
  assert.match(css, /\.bubble\.sticker-only\s*\{[^}]*border:\s*1px solid var\(--bubble-border\)/s);
  assert.match(css, /\.bubble\.sticker-only\s*\{[^}]*box-shadow:\s*var\(--shadow-soft\)/s);
  assert.match(css, /\.bubble::after\s*\{/);
  assert.doesNotMatch(css, /\.bubble:not\(\.sticker-only\)::after/);
  assert.match(css, /\.sticker\s*\{[^}]*box-shadow:\s*0 0 0 1px var\(--bubble-border\)/s);
});

test('client has a final leak barrier and forced sticker recovery', async () => {
  const chat = await read('public/chat.js');
  assert.match(chat, /isInternalNonverbalMetaText\(reply\)/);
  assert.match(chat, /responseMeta\?\.delivery\?\.type === 'sticker'/);
  assert.match(chat, /mode:\s*forcedDelivery \? 'always'/);
  assert.match(chat, /const sent = await commitStickerDecision\(stickerDecision\)/);
});
