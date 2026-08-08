import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const chat = fs.readFileSync(new URL('../public/chat.js', import.meta.url), 'utf8');

function functionBody(name, nextName) {
  const start = chat.indexOf(`async function ${name}`);
  assert.ok(start >= 0, `missing ${name}`);
  const end = nextName ? chat.indexOf(`async function ${nextName}`, start + 1) : chat.length;
  assert.ok(end > start, `missing boundary after ${name}`);
  return chat.slice(start, end);
}

test('reactive turn materializes assistant delivery before semantic commit and has no undefined requestId alias', () => {
  const source = functionBody('processUserMessage', 'refreshRinEnv');
  const prepare = source.indexOf('preparedDelivery = await prepareAssistantDelivery');
  const commit = source.indexOf('await commitSuccessfulTurnState');
  const deliver = source.indexOf('await deliverCommittedAssistantTurn');
  assert.ok(prepare >= 0 && commit > prepare && deliver > commit, 'prepare -> commit -> delivery order must be explicit');
  assert.ok(!/requestId:\s*requestId\s*\|\|\s*userMessage/u.test(source), 'reactive scope must not reference an undeclared requestId');
  assert.match(source, /requestId:\s*userMessage\.requestId/u);
});

test('post-commit reactive failures cannot mark the user turn failed or create a retry bubble', () => {
  const source = functionBody('processUserMessage', 'refreshRinEnv');
  const guard = source.indexOf('if (stateCommitted)');
  const failedWrite = source.indexOf("status: 'failed'");
  assert.ok(guard >= 0 && failedWrite > guard, 'post-commit guard must precede failed/retry handling');
  const guarded = source.slice(guard, failedWrite);
  assert.match(guarded, /markUserMessageComplete\(userMessage\)/u);
  assert.match(guarded, /return;/u);
  assert.ok(!guarded.includes('renderFailedState'), 'post-commit branch must never render retry');
});

test('proactive turn validates/materializes delivery before commit and treats post-commit UI errors as success', () => {
  const source = functionBody('requestAssistantInitiative', 'tryInitiateBySchedule');
  const prepare = source.indexOf('const preparedDelivery = await prepareAssistantDelivery');
  const commit = source.indexOf('await commitSuccessfulTurnState');
  const deliver = source.indexOf('await deliverCommittedAssistantTurn');
  assert.ok(prepare >= 0 && commit > prepare && deliver > commit);
  assert.match(source, /if \(stateCommitted\)[\s\S]*return true;/u);
});

test('lore bookkeeping and sticker rendering are secondary to the authoritative state commit', () => {
  const commitStart = chat.indexOf('async function commitSuccessfulTurnState');
  const stickerStart = chat.indexOf('function createStickerChatMessage');
  const source = chat.slice(commitStart, stickerStart);
  assert.match(source, /try \{[\s\S]*commitLorePayload/u);
  assert.match(source, /post-commit lore bookkeeping failed/u);
  assert.match(chat, /function createStickerChatMessage[\s\S]*requestId:\s*requestId \|\| null/u);
  assert.match(chat, /post-commit sticker delivery failed/u);
});

test('assistant event is persisted before text or voice DOM rendering after commit', () => {
  const start = chat.indexOf('async function deliverCommittedAssistantTurn');
  const end = chat.indexOf('async function requestAssistantInitiative', start);
  const source = chat.slice(start, end);
  const persist = source.indexOf('persistAssistantMessageOnce(prepared.assistantMessage)');
  const textRender = source.indexOf("addBubble(prepared.reply", persist);
  const voiceRender = source.indexOf("addVoiceBubble(prepared.audioUrl", persist);
  assert.ok(persist >= 0);
  assert.ok(textRender > persist);
  assert.ok(voiceRender > persist);
});
