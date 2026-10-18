import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStickerCandidates } from '../lib/cognition/sticker-candidates.js';
import { stickerCatalogItems } from '../lib/cognition/sticker-catalog.js';

function romanceContext(userText, emotion = 'tenderness') {
  return {
    userText,
    state: {
      scene: { type: 'romance' },
      emotion: { primary: { type: emotion } },
      stickerState: { recentAssetIds: [], recentFamilies: [], explicitGesture: false }
    },
    brain: { activeScene: { type: 'romance' }, hiddenIntent: { type: 'seek_closeness' }, literalIntent: 'statement' }
  };
}

const topFamily = input => buildStickerCandidates(input)[0]?.family;

test('an immediate curious beat outranks a lingering romantic backdrop', () => {
  assert.equal(topFamily(romanceContext('Интересно, почему именно так получилось?')), 'curiosity');
});

test('an actual joyful event can be expressed without automatically choosing a romantic gesture', () => {
  assert.equal(topFamily(romanceContext('Ура, получилось! Это победа!')), 'joy');
});

test('a reflective turn receives thoughtful candidates despite affection in the scene', () => {
  assert.equal(topFamily(romanceContext('Хм, надо это обдумать.')), 'thoughtful');
});

test('an explicit kiss or hug still retrieves its exact emotional family first', () => {
  assert.equal(topFamily(romanceContext('Целую тебя 😘', 'curiosity')), 'kiss');
  assert.equal(topFamily(romanceContext('Обнимаю тебя 🤗', 'curiosity')), 'hug');
});

test('Rin waking tired may show sleepiness without borrowing the users own fatigue', () => {
  const state = { scene: { type: 'everyday' }, innerLife: { sleepPhase: 'drowsy', energy: 21 }, stickerState: { recentAssetIds: [], recentFamilies: [] } };
  assert.equal(topFamily({ userText: 'Побудем немного рядом', state }), 'sleepy');
  assert.equal(topFamily({ userText: 'Я устал, тяжёлый был день', state: { scene: { type: 'everyday' }, stickerState: { recentAssetIds: [] } } }), 'care');
});

test('a broad romance scene includes everyday expressions rather than only romance', () => {
  const candidates = buildStickerCandidates({
    userText: 'Слушаю тебя)',
    state: { scene: { type: 'romance' }, stickerState: { recentAssetIds: [] } },
    brain: { activeScene: { type: 'romance' }, hiddenIntent: { type: 'seek_closeness' } }
  });
  assert.ok(candidates.slice(0, 8).some(item => ['curiosity', 'presence', 'thoughtful'].includes(item.family)));
});

test('repetition discourages one exact asset without replacing the semantic gesture with an unrelated one', () => {
  const candidates = buildStickerCandidates({
    ...romanceContext('Целую тебя 😘', 'tenderness'),
    state: {
      ...romanceContext('Целую тебя 😘').state,
      stickerState: { recentAssetIds: ['kiss_soft_tender'], recentFamilies: ['kiss'], explicitGesture: true }
    }
  });
  assert.equal(candidates[0].family, 'kiss');
  assert.notEqual(candidates[0].id, 'kiss_soft_tender');
});

test('candidate retrieval uses only existing manifest IDs, never creates stickers or extra decisions', () => {
  const manifestIds = new Set(stickerCatalogItems().map(item => item.id));
  const cases = [
    romanceContext('Интересно!'),
    romanceContext('Целую тебя 😘'),
    romanceContext('Ура, получилось!'),
    romanceContext('Хм, надо подумать'),
    { userText: 'привет', state: { scene: { type: 'everyday' }, stickerState: {} } }
  ];
  for (const input of cases) {
    const once = buildStickerCandidates(input);
    assert.deepEqual(once, buildStickerCandidates(input));
    assert.equal(once.length, 12);
    assert.ok(once.every(item => manifestIds.has(item.id)));
  }
});

test('common Russian substrings do not masquerade as romance, surprise or farewell', () => {
  const curious = buildStickerCandidates(romanceContext('Мне любопытно, что ты об этом думаешь'));
  assert.equal(curious[0].family, 'curiosity');
  const ordinary = buildStickerCandidates({ userText: 'Побудем немного рядом', state: { innerLife: { sleepPhase: 'drowsy' }, stickerState: { recentAssetIds: [] } } });
  assert.equal(ordinary[0].family, 'sleepy');
  const showing = buildStickerCandidates({ userText: 'Можешь показать пример?', state: { stickerState: { recentAssetIds: [] } } });
  assert.ok(showing.some(item => item.family === 'presence'));
});
