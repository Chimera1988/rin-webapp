import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const client = await readFile(new URL('../public/chat.js', import.meta.url), 'utf8');
const localMemory = await readFile(new URL('../public/js/rin_memory.js', import.meta.url), 'utf8');
const chatApi = await readFile(new URL('../api/chat.js', import.meta.url), 'utf8');

test('клиент не допускает второй запрос и инициативу во время ответа', () => {
  assert.match(client, /if \(requestInFlight\) return;/u);
  assert.match(client, /if \(!profile \|\| requestInFlight\) return;/u);
  assert.match(client, /sendEl\.disabled = requestInFlight/u);
});

test('сравнение тишины использует реальные timestamps', () => {
  assert.match(client, /Date\.now\(\) - Number\(last\.ts/u);
  assert.doesNotMatch(client, /d - new Date\(last\.ts/u);
});

test('память хранится в IndexedDB и сервер получает релевантный срез', () => {
  assert.match(localMemory, /indexedDB\.open\(DB_NAME/u);
  assert.match(client, /buildRelevantMemory\(userText, history, 3\)/u);
  assert.match(chatApi, /items\.slice\(0, 3\)/u);
});

test('в активной архитектуре нет GPT-5 и дублирующих досье', () => {
  assert.doesNotMatch(`${client}\n${chatApi}`, /gpt-5|rin_mind|rin_reasoning|rin_speaking_habits/iu);
});
