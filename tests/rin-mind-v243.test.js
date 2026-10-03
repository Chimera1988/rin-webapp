import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeConversation } from '../lib/conversation-brain.js';
import { buildBehaviorState } from '../lib/cognition/behavior-state.js';
import { buildDialogueState } from '../lib/cognition/dialogue-state.js';
import { buildRinMindJsonSchema, buildRinMindPrompt, LITERAL_CORRECTIONS, serializeCompactState } from '../lib/cognition/rin-mind.js';

const baseProfile = { prompt_profile: { identity: { full_name: 'Рин Акихара' } }, base_rules: '' };

function baseState(overrides = {}) {
  return {
    conversationState: 'ongoing',
    userText: 'Хорошо)',
    behaviorState: buildBehaviorState({ userText: 'Хорошо)' }),
    driveState: { curiosity: 35, connection: 70, playfulness: 60, autonomy: 60, selfRespect: 70, needForSpace: 0, questionImpulse: 0 },
    stickerState: { mode: 'smart', available: true, hardAvailable: true, propensity: 0.3, desireModifier: 1 },
    stickerCandidates: [{ id: 'tender_soft_smile', meaning: 'мягкая улыбка', family: 'tender' }],
    recentHistory: [],
    ...overrides
  };
}

test('Rin Mind Structured Output schema is byte-stable across dynamic turn conditions', () => {
  const noSticker = buildRinMindJsonSchema({
    activeIntent: null,
    conversationState: 'ongoing',
    allowStickers: false,
    replyCandidateIds: []
  });
  const liveIntent = buildRinMindJsonSchema({
    activeIntent: { status: 'active', kind: 'maintenance', goal: 'держать игру' },
    conversationState: 'ending',
    allowStickers: true,
    replyCandidateIds: ['u-1', 'u-2']
  });

  assert.equal(JSON.stringify(noSticker), JSON.stringify(liveIntent));
  const schema = noSticker.schema;
  assert.deepEqual(schema.properties.delivery.properties.segments.items.properties.type.enum, ['text', 'sticker']);
  assert.ok(schema.properties.intentTransition.properties.operation.enum.includes('activate'));
  assert.ok(schema.properties.intentTransition.properties.operation.enum.includes('complete'));
  assert.equal(schema.properties.replyLink.properties.targetEventId.enum, undefined);
  assert.deepEqual(schema.properties.mind.properties.literalCorrection.enum, [...LITERAL_CORRECTIONS]);
});

test('compact state keeps local history and continuity anchors under heavy optional context', () => {
  const huge = 'x'.repeat(6000);
  const correctionText = 'Так это же я про твое одеяло)';
  const serialized = serializeCompactState(baseState({
    userText: correctionText,
    behaviorState: buildBehaviorState({ userText: correctionText }),
    dialogueState: {
      relationToPreviousTurn: 'correction',
      corrections: ['Так это же я про твое одеяло)'],
      discourseAnchors: [{ referent: 'одеяло', label: 'одеяло', owner: 'rin', source: 'current_user', evidence: 'твое одеяло' }],
      lastRinAction: { kind: 'text', meaning: 'не сбежала обратно под одеяло', cause: '' }
    },
    recentHistory: [
      { role: 'assistant', kind: 'text', content: 'Выходной-то есть. Просто решила с утра разобрать один текст — пока не передумала и не сбежала обратно под одеяло.' },
      { role: 'user', kind: 'text', content: 'Под одеяло?) Звучит заманчиво.' },
      { role: 'assistant', kind: 'text', content: 'Если закончишь быстрее, я не буду против твоего возвращения под него.' },
      { role: 'user', kind: 'text', content: 'Так это же я про твое одеяло)' }
    ],
    relevantMemory: { facts: Array.from({ length: 4 }, (_, i) => ({ path: `p${i}`, text: huge })), events: [], sharedMoments: [], summaries: [] },
    lore: { canon: [huge], memories: [huge], backstory: [huge] },
    realityBoundary: { mode: 'grounded', canonicalText: huge, innerLifeText: huge }
  }), 6800);

  assert.ok(serialized.length <= 6800);
  const parsed = JSON.parse(serialized);
  assert.equal(parsed.userText, 'Так это же я про твое одеяло)');
  assert.ok(parsed.recentHistory.some(item => /сбежала обратно под одеяло/iu.test(item.content)));
  assert.equal(parsed.continuity.anchors.at(-1).referent, 'одеяло');
  assert.equal(parsed.continuity.anchors.at(-1).owner, 'rin');
});

test('literal correction detector catches the two observed continuity failures', () => {
  for (const userText of [
    'Я спрашивал про выбор текста)',
    'Так это же я про твое одеяло) Я вроде бы туда не собираюсь)'
  ]) {
    const brain = analyzeConversation({
      userText,
      history: [
        { role: 'assistant', kind: 'text', status: 'complete', content: 'Предыдущая трактовка Рин.' },
        { role: 'user', kind: 'text', status: 'sent', content: userText }
      ],
      conversationState: 'ongoing'
    });
    const behavior = buildBehaviorState({ userText, brain });
    assert.equal(brain.relation.type, 'correction');
    assert.equal(behavior.literalCorrection.explicit, true);
  }
});

test('dialogue state records explicit ownership anchors from user and Rin perspectives', () => {
  const history = [
    { id: 'a1', role: 'assistant', kind: 'text', status: 'complete', content: 'Моё одеяло сегодня явно пытается победить планы.' },
    { id: 'u1', role: 'user', kind: 'text', status: 'sent', content: 'Так это же я про твое одеяло)' }
  ];
  const state = buildDialogueState({
    history,
    userText: 'Так это же я про твое одеяло)',
    brain: { relation: { type: 'correction' }, activeScene: { type: 'playful_flirt', topic: 'одеяло', continuityStrength: 0.9 } }
  });
  const blanket = state.discourseAnchors.find(item => item.referent === 'одеяло');
  assert.ok(blanket);
  assert.equal(blanket.owner, 'rin');
});

test('prompt separates social frame alignment from literal correction and prioritizes referents', () => {
  const userText = 'Так это же я про твое одеяло) Конечно если не в компании с тобой)';
  const brain = analyzeConversation({
    userText,
    history: [
      { role: 'assistant', kind: 'text', status: 'complete', content: 'Выходной есть, просто не сбежала обратно под одеяло.' },
      { role: 'user', kind: 'text', status: 'sent', content: userText }
    ]
  });
  const behaviorState = buildBehaviorState({ userText, brain });
  const { stableSystem, dynamicSystem } = buildRinMindPrompt({
    profile: baseProfile,
    state: baseState({
      userText,
      behaviorState,
      dialogueState: {
        relationToPreviousTurn: 'correction',
        corrections: [userText],
        discourseAnchors: [{ referent: 'одеяло', label: 'одеяло', owner: 'rin', evidence: 'твое одеяло' }]
      },
      recentHistory: [{ role: 'assistant', kind: 'text', content: 'Я не сбежала обратно под одеяло.' }]
    })
  });

  assert.match(stableSystem, /отдельное измерение от frameAlignment/iu);
  assert.match(stableSystem, /не превращай исправление пользователя в «ты быстро переобулся»/iu);
  assert.match(stableSystem, /continuity\.anchors/iu);
  assert.match(dynamicSystem, /явную буквальную коррекцию/iu);
  assert.match(dynamicSystem, /"referent":"одеяло"/u);
  assert.match(dynamicSystem, /"owner":"rin"/u);
});

test('emoji behavior marks direct mirroring as a risk without creating a hard quota', () => {
  const behavior = buildBehaviorState({
    userText: 'Договорились 😁',
    history: [
      { role: 'assistant', kind: 'text', content: 'Хорошо 🙂' },
      { role: 'assistant', kind: 'text', content: 'Ладно 😁' }
    ]
  });
  assert.equal(behavior.emoji.mirrorRisk, true);
  assert.ok(behavior.emoji.userEmojis.includes('😁'));
  assert.ok(behavior.emoji.recentRinEmojis.includes('😁'));
  assert.ok(behavior.emoji.pressure > 0);

  const { dynamicSystem } = buildRinMindPrompt({ profile: baseProfile, state: baseState({ userText: 'Договорились 😁', behaviorState: behavior }) });
  assert.match(dynamicSystem, /Не копируй их автоматически/iu);
});
