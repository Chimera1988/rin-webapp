import test from 'node:test';
import assert from 'node:assert/strict';
import { readTtsConfig, buildTtsInput } from '../api/tts.js';
import { readFile } from 'node:fs/promises';

test('TTS selects ElevenLabs voice, model and key from server environment', () => {
  const result = readTtsConfig({ ELEVENLABS_API_KEY:'test-secret', ELEVENLABS_VOICE_ID:'voice-sample', ELEVENLABS_MODEL_ID:'model-sample' });
  assert.deepEqual(result, { apiKey:'test-secret', voiceId:'voice-sample', modelId:'model-sample' });
});

test('TTS never defaults silently to an obsolete voice or model', () => {
  const noModel = readTtsConfig({ELEVENLABS_API_KEY:'test',ELEVENLABS_VOICE_ID:'voice-sample'});
  assert.equal(noModel.modelId,'');
  assert.equal(readTtsConfig({}).voiceId,'');
  assert.equal(readTtsConfig({}).apiKey,'');
});

test('TTS configuration trims whitespace without changing values', () => {
  assert.deepEqual(readTtsConfig({ELEVENLABS_API_KEY:' k ',ELEVENLABS_VOICE_ID:' v ',ELEVENLABS_MODEL_ID:' m '}),
    {apiKey:'k',voiceId:'v',modelId:'m'});
});

test('TTS emotion tagging and short-message budget are unchanged', () => {
  assert.equal(buildTtsInput('Очень рада быть рядом с тобой сегодня!',{type:'tenderness',intensity:65}),
    '[softly] Очень рада быть рядом с тобой сегодня!');
  assert.equal(buildTtsInput('Привет!',{type:'tenderness',intensity:85}),'Привет!');
  assert.ok(buildTtsInput('a'.repeat(200)).length<=180);
});

test('TTS handler never contains a hardcoded voice ID or model ID', async () => {
  const source = await readFile(new URL('../api/tts.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source,/const\s+VOICE_ID\s*=\s*['"]|const\s+MODEL_ID\s*=\s*['"]/);
  assert.doesNotMatch(source,/CtE8XlupyJQIq6Bru1R3|DVPkntDpTzVmeJMlAI7a|NxfO5zydfqwpYnWQJ7jJ/);
});
