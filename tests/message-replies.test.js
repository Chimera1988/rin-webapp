import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CHAT_SCHEMA_VERSION as CLIENT_SCHEMA,
  CHAT_STORAGE_KEY,
  createChatMessage,
  createReplySnapshot,
  loadChatHistory,
  saveChatHistory,
  toApiHistory
} from '../public/js/chat_store.js';
import {
  CHAT_SCHEMA_VERSION as SERVER_SCHEMA,
  normalizeChatHistory,
  selectModelHistory
} from '../lib/chat-contract.js';
import { buildCognitiveTurn, planResponse, responsePlanInstruction } from '../lib/cognition/index.js';
import { MemoryStorage, createReq, createRes } from './helpers/runtime.js';

const brain = {
  literalIntent: 'statement',
  hiddenIntent: { type: 'none', confidence: 35 },
  relation: { type: 'continuation', confidence: 70 },
  activeScene: { type: 'everyday', topic: 'музыка и планы', confidence: 80 },
  referents: [],
  ambiguity: { shouldClarify: false },
  obligations: [],
  responseFocus: 'Ответить на текущую реплику.'
};

const memory = {
  relationship: { trust: 78, closeness: 72, playfulness: 60 },
  openLoops: []
};

test('reply snapshots survive schema v5 storage and API transport', () => {
  const storage = new MemoryStorage();
  const source = createChatMessage({
    role: 'assistant', kind: 'text', status: 'complete', id: 'a1', content: 'Я застряла на одной фразе.'
  });
  const reply = createChatMessage({
    role: 'user', kind: 'text', status: 'complete', requestId: 'r1', id: 'u1', content: 'На какой именно?',
    inReplyTo: source.id,
    replySnapshot: createReplySnapshot(source)
  });
  assert.equal(CLIENT_SCHEMA, 5);
  assert.equal(saveChatHistory([source, reply], storage), true);
  const loaded = loadChatHistory(storage);
  assert.equal(loaded[1].inReplyTo, 'a1');
  assert.deepEqual(loaded[1].replySnapshot, {
    role: 'assistant', kind: 'text', excerpt: 'Я застряла на одной фразе.', stickerSrc: null, stickerId: null
  });
  const api = toApiHistory(loaded, 'r1');
  assert.equal(api.at(-1).inReplyTo, 'a1');
  assert.equal(api.at(-1).replySnapshot.excerpt, 'Я застряла на одной фразе.');
  assert.ok(storage.getItem(CHAT_STORAGE_KEY));
});

test('sticker reply snapshot stays visual and does not expose semantic cause', () => {
  const sticker = createChatMessage({
    role: 'assistant', kind: 'sticker', status: 'complete', id: 's1', content: '[Невербальный жест Рин: ревность; причина: другая девушка]',
    sticker: { id: 'mild_jealousy', src: '/stickers/mild_jealousy.webp', meaning: 'лёгкая ревность', cause: 'другая девушка' }
  });
  const snapshot = createReplySnapshot(sticker);
  assert.deepEqual(snapshot, {
    role: 'assistant', kind: 'sticker', excerpt: 'Стикер', stickerSrc: '/stickers/mild_jealousy.webp', stickerId: 'mild_jealousy'
  });
  assert.doesNotMatch(JSON.stringify(snapshot), /ревност|другая девушка/iu);
});

test('server preserves explicit reply metadata through model history selection', () => {
  assert.equal(SERVER_SCHEMA, 5);
  const history = normalizeChatHistory([
    { role: 'assistant', kind: 'text', status: 'complete', id: 'a1', content: 'Скажи точнее.' },
    {
      role: 'user', kind: 'text', status: 'sent', requestId: 'r1', id: 'u1', content: 'Вот это и уточняю.',
      inReplyTo: 'a1',
      replySnapshot: { role: 'assistant', kind: 'text', excerpt: 'Скажи точнее.' }
    }
  ]);
  const selected = selectModelHistory(history, { includeRequestId: 'r1' });
  assert.equal(selected.at(-1).inReplyTo, 'a1');
  assert.equal(selected.at(-1).replySnapshot.excerpt, 'Скажи точнее.');
});

test('an explicit user reply becomes the primary cognitive frame', () => {
  const history = [
    { role: 'assistant', kind: 'text', status: 'complete', id: 'a1', content: 'Мне больше нравится первый вариант.' },
    { role: 'user', kind: 'text', status: 'sent', requestId: 'r1', id: 'u1', content: 'Почему?', inReplyTo: 'a1', replySnapshot: { role: 'assistant', kind: 'text', excerpt: 'Мне больше нравится первый вариант.' } }
  ];
  const explicitReply = { messageId: 'a1', role: 'assistant', kind: 'text', excerpt: 'Мне больше нравится первый вариант.', confidence: 1 };
  const cognition = buildCognitiveTurn({ userText: 'Почему?', history, memory, brain, explicitReply });
  const plan = planResponse({ cognition, brain, memory, userText: 'Почему?', history });
  assert.equal(cognition.dialogueState.explicitReplyTarget.messageId, 'a1');
  assert.equal(plan.inputReplyTarget.messageId, 'a1');
  assert.equal(plan.replyTarget, null);
  assert.match(plan.goal, /выбранное пользователем сообщение/);
  assert.match(responsePlanInstruction(plan), /вручную выбрал сообщение/);
});

test('canonical open loop can target an earlier meaningful user message for a callback', () => {
  const history = [
    { role: 'user', kind: 'text', status: 'complete', id: 'u-music', content: 'Иногда я слушаю Linkin Park, когда нужно освободить голову.' },
    { role: 'assistant', kind: 'text', status: 'complete', id: 'a-music', content: 'Понимаю этот ритм.' },
    { role: 'user', kind: 'text', status: 'complete', id: 'u-now', content: 'А вечером снова займусь проектом.' }
  ];
  const cognition = buildCognitiveTurn({ userText: history.at(-1).content, history, memory, brain });
  cognition.openLoops.callback = { id: 'loop-music', subject: 'музыка Linkin Park', text: 'музыка Linkin Park', importance: 75, confidence: 0.9 };
  cognition.dialogueState.reactiveStreak = 2;
  const plan = planResponse({
    cognition,
    brain,
    memory,
    userText: history.at(-1).content,
    history,
    coreDecision: { mode: 'calm', initiative: { mode: 'callback' } }
  });
  assert.equal(plan.initiative, 'return_to_open_loop');
  assert.equal(plan.replyTarget.messageId, 'u-music');
  assert.match(plan.replyTarget.reason, /незавершённой детали/);
});

test('dialogue state remembers when Rin replied to a selected earlier message', () => {
  const history = [
    { role: 'user', kind: 'text', status: 'complete', id: 'u-source', content: 'Иногда я слушаю Linkin Park, когда нужно освободить голову.' },
    {
      role: 'assistant', kind: 'text', status: 'complete', id: 'a-linked',
      content: 'Какая песня у тебя обычно первая?',
      inReplyTo: 'u-source',
      replySnapshot: { role: 'user', kind: 'text', excerpt: 'Иногда я слушаю Linkin Park, когда нужно освободить голову.' }
    },
    { role: 'user', kind: 'text', status: 'sent', requestId: 'r-next', id: 'u-next', content: 'Наверное, Numb.' }
  ];
  const cognition = buildCognitiveTurn({ userText: history.at(-1).content, history, memory, brain });
  assert.equal(cognition.dialogueState.lastRinAction.kind, 'text');
  assert.match(cognition.dialogueState.lastRinAction.cause, /ответ на выбранное сообщение пользователя/);
  assert.match(cognition.dialogueState.lastRinAction.cause, /Linkin Park/);
});

test('reply UI uses the existing composer and bubble design tokens', async () => {
  const [html, css, chat] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/style.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/chat.js', import.meta.url), 'utf8')
  ]);
  assert.match(html, /id="replyPreview" class="reply-preview"/);
  assert.match(html, /id="replyCancel"/);
  assert.match(css, /\.reply-preview[\s\S]*var\(--surface\)/);
  assert.match(css, /\.reply-quote[\s\S]*var\(--accent\)/);
  assert.match(css, /\.reply-source-flash \.bubble/);
  assert.match(chat, /function selectReplyMessage\(/);
  assert.match(chat, /reply-swipe-active/);
  assert.match(chat, /scrollToMessage\(/);
  assert.match(chat, /replyLinkFromResponsePlan\(/);
});


test('chat API grounds a manual reply in the selected source message', async () => {
  const oldPin = process.env.ACCESS_PIN;
  const oldKey = process.env.OPENAI_API_KEY;
  const oldFetch = globalThis.fetch;
  process.env.ACCESS_PIN = '2468';
  process.env.OPENAI_API_KEY = 'test-key';
  let sentBody = null;
  globalThis.fetch = async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'Потому что в нём ритм живее.' }, finish_reason: 'stop' }],
      usage: {}
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const chat = await import(`../api/chat.js?reply-test=${Date.now()}`);
    const req = createReq({
      headers: { 'x-rin-pin': '2468' },
      body: {
        requestId: 'r-reply',
        history: [
          { role: 'assistant', kind: 'text', status: 'complete', id: 'a-source', content: 'Мне больше нравится первый вариант.' },
          {
            role: 'user', kind: 'text', status: 'sent', requestId: 'r-reply', id: 'u-reply', content: 'Почему?',
            inReplyTo: 'a-source',
            replySnapshot: { role: 'assistant', kind: 'text', excerpt: 'Мне больше нравится первый вариант.' }
          }
        ]
      }
    });
    const res = createRes();
    await chat.default(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.cognition.dialogueState.explicitReplyTarget.messageId, 'a-source');
    assert.equal(res.body.responsePlan.inputReplyTarget.messageId, 'a-source');
    assert.match(sentBody.messages[0].content, /Мне больше нравится первый вариант/);
    assert.match(sentBody.messages[0].content, /вручную выбрал сообщение/);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldPin === undefined) delete process.env.ACCESS_PIN; else process.env.ACCESS_PIN = oldPin;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
  }
});
