import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalSettings } from '../public/js/local_settings.js';
import { MemoryStorage } from './helpers/runtime.js';

test('bound local settings persist and read through the same Storage object', () => {
  const storage = new MemoryStorage();
  const settings = createLocalSettings(storage);
  assert.equal(settings.get('rin-sticker-mode', 'smart'), 'smart');
  assert.equal(settings.set('rin-sticker-mode', 'always'), true);
  assert.equal(storage.getItem('rin-sticker-mode'), 'always');
  assert.equal(settings.get('rin-sticker-mode', 'smart'), 'always');
  assert.equal(settings.set('rin-sticker-prob', 30), true);
  assert.equal(settings.get('rin-sticker-prob'), '30');
});

test('bound local settings fail closed when persistence cannot be verified', () => {
  const storage = {
    value: null,
    getItem() { return this.value; },
    setItem() { /* deliberately drop the write */ }
  };
  const settings = createLocalSettings(storage);
  assert.equal(settings.set('rin-sticker-mode', 'always'), false);
  assert.equal(settings.get('rin-sticker-mode', 'smart'), 'smart');
});

test('local settings constructor rejects non-storage objects', () => {
  assert.throws(() => createLocalSettings(null), /Web Storage-compatible/);
  assert.throws(() => createLocalSettings({ getItem() {} }), /Web Storage-compatible/);
});
