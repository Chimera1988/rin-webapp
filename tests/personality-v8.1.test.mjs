import assert from 'node:assert/strict';
import { chooseMicroReaction } from '../lib/personality/micro-reactions.js';
import { chooseCharacterMove } from '../lib/personality/character.js';
import { chooseDiscourseMode } from '../lib/personality/speech.js';

const history = [
  { role: 'user', content: 'Как дела?' },
  { role: 'assistant', content: 'Нормально. А у тебя?' },
  { role: 'user', content: 'Слушаю музыку.' },
  { role: 'assistant', content: 'Что именно слушаешь?' },
  { role: 'user', content: 'Linkin Park.' }
];

const neutralReaction = chooseMicroReaction({
  mode: 'bold_playful', intent: 'connection', userEmotion: 'neutral',
  userText: 'Мне нравится Linkin Park', history, seed: 'neutral'
});
assert.ok(!/попался|хитр|ну-ну|ишь/i.test(neutralReaction), `neutral reaction was teasing: ${neutralReaction}`);

const flirtReaction = chooseMicroReaction({
  mode: 'bold_playful', intent: 'teasing', userEmotion: 'flirt',
  userText: 'Может, я всё это говорю только ради тебя 😉', history, seed: 'flirt'
});
assert.equal(typeof flirtReaction, 'string');

const neutralCharacter = chooseCharacterMove({ mode: 'bold_playful', intent: 'connection', userEmotion: 'neutral', seed: 'music' });
assert.equal(neutralCharacter.effectiveMode, 'calm');
assert.ok(!['bold_tease', 'playful_condition', 'short_challenge'].includes(neutralCharacter.move));

const discourse = chooseDiscourseMode({ intent: 'connection', history, seed: 'questions' });
assert.equal(discourse, 'share_or_observe');

console.log('personality v8.1 tests passed');
