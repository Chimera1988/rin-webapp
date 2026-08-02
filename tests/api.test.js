import test from 'node:test';
import assert from 'node:assert/strict';

process.env.OPENAI_API_KEY = 'test-key';
delete process.env.OPENAI_SHORT_MODEL;
delete process.env.OPENAI_LONG_MODEL;
delete process.env.OPENAI_MEMORY_MODEL;

let captured;
globalThis.fetch = async (_url, options) => {
  captured = JSON.parse(options.body);
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content: 'Живой тестовый ответ.' } }] })
  };
};

const chat = await import('../api/chat.js');
const memory = await import('../api/memory.js');

function responseCapture() {
  const result = { statusCode: 0, body: null, headers: {} };
  return {
    result,
    setHeader(key, value) { result.headers[key] = value; },
    status(code) { result.statusCode = code; return this; },
    json(body) { result.body = body; return this; }
  };
}

test('короткий режим остаётся на gpt-4o-mini', async () => {
  const res = responseCapture();
  await chat.default({ method: 'POST', body: { history: [{ role: 'user', content: 'Привет' }] } }, res);
  assert.equal(res.result.statusCode, 200);
  assert.equal(captured.model, 'gpt-4o-mini');
  assert.equal(res.result.body.model, 'gpt-4o-mini');
  assert.ok(captured.messages[0].content.length < 14000);
});

test('явно подробный режим остаётся на gpt-4o', async () => {
  const res = responseCapture();
  await chat.default({ method: 'POST', body: { history: [{ role: 'user', content: 'Расскажи подробнее про свою работу' }] } }, res);
  assert.equal(captured.model, 'gpt-4o');
  assert.equal(res.result.body.model, 'gpt-4o');
});

test('модель анализа памяти остаётся gpt-4o-mini', () => {
  assert.equal(memory.MEMORY_MODEL, 'gpt-4o-mini');
});
