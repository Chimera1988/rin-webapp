import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildSystemPrompt, formatPromptProfile } from '../api/chat.js';

const promptProfile = JSON.parse(await readFile(new URL('../public/data/rin_prompt_profile.json', import.meta.url), 'utf8'));

test('stable canon contains the final Rin character without national stereotypes', () => {
  const text = formatPromptProfile({ name: 'Рин Акихара', prompt_profile: promptProfile }, {});
  assert.match(text, /умная, тёплая, наблюдательная, самостоятельная, уверенная, немного хитрая и мягко дерзкая/);
  assert.match(text, /не определяет характер через стереотипы/);
  assert.match(text, /Лёгкая наглость Рин|лёгкая наглость/i);
  assert.match(text, /Инициатива Рин|короткая реплика пользователя часто оставляет Рин пространство/i);
  assert.match(text, /ревность.*по умолчанию показывает поведением|ревность.*показывает поведением/iu);
  assert.match(text, /вопрос — редкий инструмент/iu);
  assert.match(text, /не становится грубостью, унижением, давлением или контролем/);
});

test('system prompt has an explicit cognitive hierarchy and deterministic response plan', () => {
  const cognition = {
    understanding: { literalMeaning: 'statement', implicitMeaning: 'none', userGoal: 'continue_dialogue' },
    dialogueState: { topic: 'письмо', scene: 'everyday', relationToPreviousTurn: 'continuation', entities: [], corrections: [], unresolvedQuestions: [], lastRinAction: null },
    beliefModel: { factsToUse: [], factsToAvoid: [], unknownPolicy: 'Не выдумывать.', correction: { active: false } },
    openLoops: { active: [], callback: null }
  };
  const responsePlan = {
    goal: 'ответить на текущую реплику',
    mustAddress: ['Ответить по смыслу.'],
    factsToUse: [],
    factsToAvoid: [],
    stance: 'собственная позиция Рин',
    tone: 'calm_personal',
    directness: 'clear_personal',
    behavior: { action: 'react', responseAct: 'direct_response', initiative: 'none', initiativeStrength: 0, questionBudget: 0, emotionalExpression: 'natural', distance: 'stable', topicHold: 'hold_scene' },
    initiative: 'none',
    delivery: 'text',
    length: 'short',
    questionBudget: 0,
    shouldAskQuestion: false,
    uncertaintyPolicy: 'не выдумывать',
    confidence: 0.8
  };
  const text = buildSystemPrompt({
    profile: { name: 'Рин Акихара', prompt_profile: promptProfile },
    env: null,
    memory: null,
    lore: null,
    coreDecision: null,
    conversationState: 'ongoing',
    conversationBrain: null,
    cognition,
    responsePlan,
    history: [],
    userText: 'Поговорим?',
    client: {}
  }).text;

  assert.ok(text.indexOf('ФАКТИЧЕСКАЯ ТОЧНОСТЬ') < text.indexOf('СТАБИЛЬНЫЙ КАНОН'));
  assert.ok(text.indexOf('COGNITION LAYER') < text.indexOf('ПЛАН ОТВЕТА'));
  assert.match(text, /BEHAVIOR POLICY v3/);
  assert.match(text, /Бюджет вопросов: 0/);
  assert.match(text, /Вопросов в этой реплике быть не должно/);
  assert.doesNotMatch(text, /начало — .*; завершение —/);
});
