import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { conversationEventText, normalizeChatMessage } from '../lib/chat-contract.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('a structured sticker stays a structured conversation event with semantic model text', () => {
  const event = normalizeChatMessage({
    role: 'assistant',
    kind: 'sticker',
    status: 'complete',
    sticker: {
      id: 'jealousy_mild',
      src: '/stickers/jealousy_mild.webp',
      meaning: 'лёгкая ревность',
      cause: 'упоминание другой девушки'
    }
  });
  assert.equal(event?.kind, 'sticker');
  const text = conversationEventText(event);
  assert.match(text, /Невербальный жест Рин/);
  assert.match(text, /лёгкая ревность/);
  assert.match(text, /упоминание другой девушки/);
  assert.doesNotMatch(text, /^\[/);
});

test('sticker UI inherits the message bubble border, surface and tail', async () => {
  const css = await read('public/style.css');
  assert.match(css, /\.bubble\.sticker-only\s*\{[^}]*border:\s*1px solid var\(--bubble-border\)/s);
  assert.match(css, /\.bubble\.sticker-only\s*\{[^}]*box-shadow:\s*var\(--shadow-soft\)/s);
  assert.match(css, /\.bubble::after\s*\{/);
  assert.doesNotMatch(css, /\.bubble:not\(\.sticker-only\)::after/);
  assert.match(css, /\.sticker\s*\{[^}]*box-shadow:\s*0 0 0 1px var\(--bubble-border\)/s);
});

test('client has a final leak barrier and executes the exact server-owned sticker segment', async () => {
  const chat = await read('public/chat.js');
  assert.match(chat, /isInternalNonverbalMetaText\(text\)/);
  assert.match(chat, /const plan = data\?\.deliveryPlan/);
  assert.match(chat, /segment\.type === 'sticker'/);
  assert.match(chat, /sticker:\s*\{[\s\S]*src:\s*sticker\.src/);
  assert.match(chat, /persistPreparedDeliveryOrThrow\(preparedDelivery\)/);
  assert.doesNotMatch(chat, /decidePlannedSticker/);
  assert.doesNotMatch(chat, /responseMeta\?\.delivery\?\.nonverbal/);
  assert.doesNotMatch(chat, /forcedDelivery/);
});
