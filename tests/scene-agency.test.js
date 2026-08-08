import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyzeConversation } from '../lib/conversation-brain.js';
import { selectModelHistory, pruneModelHistory } from '../lib/chat-contract.js';
import { buildCognitiveTurn, planResponse, verifyReply } from '../lib/cognition/index.js';
import { createReq, createRes } from './helpers/runtime.js';

const relationshipMemory = {
  mood: { affection: 68, energy: 65 },
  relationship: { trust: 55, closeness: 42, playfulness: 48 },
  openLoops: []
};

const msg = (role, content, id, extra = {}) => ({
  role,
  kind: 'text',
  status: 'complete',
  id,
  content,
  ...extra
});

function buildPlan(history, userText) {
  const brain = analyzeConversation({ userText, history, conversationState: 'ongoing' });
  const cognition = buildCognitiveTurn({ userText, history, memory: relationshipMemory, brain });
  const plan = planResponse({ cognition, brain, memory: relationshipMemory, userText, history });
  return { brain, cognition, plan };
}

test('short dependent replies preserve a playful scene instead of resetting to everyday', () => {
  const history = [
    msg('user', 'Давай немного пофлиртуем)', 'u1'),
    msg('assistant', 'Тогда не жалуйся, если я начну тебя дразнить.', 'a1'),
    msg('user', 'Весь в нетерпении 😏', 'u2'),
    msg('assistant', 'Потерпи. Мне нравится, когда ты ждёшь.', 'a2'),
    msg('user', 'Ну да)', 'u3')
  ];
  const { brain, plan } = buildPlan(history, 'Ну да)');
  assert.equal(brain.activeScene.type, 'playful_flirt');
  assert.ok(['scene_hysteresis', 'recent_scene_weight'].includes(brain.activeScene.source));
  assert.equal(plan.responseAct, 'advance_play');
  assert.equal(plan.behavior.action, 'continue_scene');
  assert.equal(plan.questionBudget, 0);
  assert.equal(plan.shouldAskQuestion, false);
});


test('relational continuation keeps the active playful scene even when the message is longer than a short acknowledgement', () => {
  const history = [
    msg('user', 'Чтобы ты ко мне поприставала)', 'u1'),
    msg('assistant', 'Тогда не отводи взгляд.', 'a1'),
    msg('user', 'Ммм, тогда я буду улыбаться тебе в ответ )', 'u2')
  ];
  const { brain, plan } = buildPlan(history, history.at(-1).content);
  assert.equal(brain.activeScene.type, 'playful_flirt');
  assert.ok(['playful_stance', 'warm_playful_reply'].includes(plan.responseAct));
  assert.equal(plan.shouldAskQuestion, false);
});

test('handing initiative to Rin creates a take-lead act with no permission question', () => {
  const history = [
    msg('user', 'Чтобы ты ко мне поприставала)', 'u1'),
    msg('assistant', 'А ты уверен, что выдержишь?', 'a1'),
    msg('user', 'Так что можешь начинать 😎', 'u2')
  ];
  const { brain, plan } = buildPlan(history, 'Так что можешь начинать 😎');
  assert.equal(brain.hiddenIntent.type, 'invite_rin_initiative');
  assert.equal(brain.activeScene.type, 'playful_flirt');
  assert.equal(plan.responseAct, 'take_lead');
  assert.equal(plan.behavior.action, 'continue_scene');
  assert.equal(plan.initiative, 'take_lead');
  assert.equal(plan.questionBudget, 0);
  assert.equal(plan.shouldAskQuestion, false);
  assert.match(plan.goal, /самой сделать следующий ход/);
  assert.ok(plan.mustNot.some(item => /если хочешь|разрешения/i.test(item)));
});

test('a noticed drift from flirt to philosophy produces a reclaim-scene act', () => {
  const history = [
    msg('user', 'Давай пофлиртуем)', 'u1'),
    msg('assistant', 'Расскажу тебе историю про загадочного кота.', 'a1'),
    msg('user', 'У нас как-то флирт перетёк в философию 😁', 'u2')
  ];
  const { brain, plan } = buildPlan(history, history.at(-1).content);
  assert.equal(brain.hiddenIntent.type, 'reclaim_playful_scene');
  assert.equal(plan.responseAct, 'reclaim_scene');
  assert.equal(plan.behavior.action, 'continue_scene');
  assert.equal(plan.questionBudget, 0);
  assert.equal(plan.shouldAskQuestion, false);
  assert.match(plan.goal, /вернуть активную сцену/);
});

test('two reactive assistant turns force a local initiative move inside the active scene', () => {
  const history = [
    msg('user', 'Давай пофлиртуем)', 'u1'),
    msg('assistant', 'Это действительно интересно. Кажется, разговор становится живее.', 'a1'),
    msg('user', 'Весь в нетерпении)', 'u2'),
    msg('assistant', 'Рада, что тебе нравится. Как тебе это?', 'a2'),
    msg('user', 'Ну да)', 'u3')
  ];
  const { brain, plan } = buildPlan(history, history.at(-1).content);
  assert.equal(brain.activeScene.type, 'playful_flirt');
  assert.ok(brain.activeScene.reactiveStreak >= 2);
  assert.ok(['advance_play', 'reclaim_scene', 'take_lead'].includes(plan.responseAct));
  assert.ok(plan.mustAddress.some(item => /собственный содержательный ход/i.test(item)));
});

test('elliptical follow-up questions are grounded in Rin previous statement', () => {
  const history = [
    msg('assistant', 'Читаю книгу и иногда задерживаюсь на одной фразе.', 'a1'),
    msg('user', 'Сложное понимание?', 'u1')
  ];
  const { brain, plan } = buildPlan(history, 'Сложное понимание?');
  assert.equal(brain.relation.type, 'follow_up_on_rin_statement');
  assert.equal(plan.responseAct, 'clarify_self');
  assert.equal(plan.shouldAskQuestion, false);
  assert.ok(plan.mustAddress.some(item => /Читаю книгу|задерживаюсь/i.test(item)));
});

test('full dialogue continuity can use a scene anchor omitted from the model transcript prune', () => {
  const raw = [
    msg('user', 'Хочу, чтобы ты ко мне поприставала)', 'anchor-1'),
    msg('user', 'Я весь в нетерпении)', 'anchor-2')
  ];
  for (let index = 0; index < 8; index += 1) {
    raw.push(msg('assistant', `Длинный промежуточный ответ ${index}: ${'нейтральный текст '.repeat(115)}`, `a${index}`));
  }
  raw.push({ ...msg('user', 'Ну да)', 'current'), status: 'sent', requestId: 'r-current' });
  const full = selectModelHistory(raw, { includeRequestId: 'r-current' });
  const pruned = pruneModelHistory(full, 42, 12_000);
  assert.equal(pruned.some(item => item.id === 'anchor-1'), false);
  assert.equal(pruned.some(item => item.id === 'anchor-2'), false);
  const brain = analyzeConversation({ userText: 'Ну да)', history: full, conversationState: 'ongoing' });
  assert.equal(brain.activeScene.type, 'playful_flirt');
  assert.equal(brain.activeScene.openHook.messageId, 'anchor-2');
});

test('verifier rejects assistant-like drafts observed in the real dialogue', () => {
  const plan = {
    responseAct: 'take_lead',
    initiativeStrength: 90,
    shouldAskQuestion: false,
    tone: 'warm_bold_playful',
    delivery: 'text'
  };
  const brain = { activeScene: { type: 'playful_flirt' }, literalIntent: 'statement', relation: { type: 'continuation' } };
  const cases = [
    ['Ну, если ты так хочешь, могу немного пофлиртовать. Как тебе это?', 'assistant_permission_seeking'],
    ['Похоже, ты действительно жаждешь немного игривости. Это подогревает интерес!', 'meta_conversation_commentary'],
    ['Кажется, у нас получается интересный разговор.', 'meta_conversation_commentary']
  ];
  for (const [draft, warning] of cases) {
    const result = verifyReply(draft, { plan, brain, userText: 'Так что можешь начинать' });
    assert.equal(result.needsRewrite, true, draft);
    assert.ok(result.warnings.includes(warning), `${draft}: ${result.warnings.join(', ')}`);
  }
});

test('personal follow-ups and boundary reassurance reject abstract assistant generalizations', () => {
  const followUp = verifyReply('Да, иногда действительно бывает сложно понять, что именно мы хотим сказать. А ты как с этим справляешься?', {
    plan: { responseAct: 'clarify_self', initiativeStrength: 0, shouldAskQuestion: false, delivery: 'text' },
    brain: { activeScene: { type: 'everyday' }, literalIntent: 'question', relation: { type: 'follow_up_on_rin_statement' } },
    userText: 'Сложное понимание?'
  });
  assert.equal(followUp.needsRewrite, true);
  assert.ok(followUp.warnings.includes('abstract_generalization'));
  assert.ok(followUp.warnings.includes('missing_personal_specificity'));

  const boundary = verifyReply('Нет, совсем нет! Мне приятно общаться и немного отвлечься. Чтение и разговор — отличное сочетание.', {
    plan: { responseAct: 'reassure_with_boundary', initiativeStrength: 0, shouldAskQuestion: false, delivery: 'text' },
    brain: { activeScene: { type: 'everyday' }, literalIntent: 'question', relation: { type: 'new_or_followup_question' } },
    userText: 'Я тебя не отвлекаю от работы?)'
  });
  assert.equal(boundary.needsRewrite, true);
  assert.ok(boundary.warnings.includes('assistant_service_voice'));
});

test('reply swipe indicator uses the project line-icon language instead of an emoji glyph', async () => {
  const [css, chat] = await Promise.all([
    readFile(new URL('../public/style.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/chat.js', import.meta.url), 'utf8')
  ]);
  assert.doesNotMatch(css, /content\s*:\s*["']↩/u);
  assert.doesNotMatch(chat, />↩</u);
  assert.match(chat, /reply-swipe-indicator/);
  assert.match(chat, /<svg viewBox="0 0 24 24"/);
  assert.match(css, /\.reply-swipe-indicator[\s\S]*linear-gradient\(145deg, var\(--surface\), var\(--surface-soft\)\)/);
  assert.match(css, /\.reply-swipe-indicator svg[\s\S]*stroke:\s*currentColor/);
});

test('chat handler rewrites an assistant-like playful draft before returning it', async () => {
  const oldPin = process.env.ACCESS_PIN;
  const oldKey = process.env.OPENAI_API_KEY;
  const oldFetch = globalThis.fetch;
  process.env.ACCESS_PIN = '8642';
  process.env.OPENAI_API_KEY = 'test-key';
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const content = calls === 1
      ? 'Ну, если ты так хочешь, могу немного пофлиртовать. Как тебе это?'
      : 'Поздно передумывать. Сам попросил — теперь не мешай мне тебя смущать.';
    return new Response(JSON.stringify({
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const chat = await import(`../api/chat.js?scene-agency=${Date.now()}`);
    const history = [
      msg('user', 'Чтобы ты ко мне поприставала)', 'u1'),
      msg('assistant', 'Ну, если ты так хочешь, могу немного пофлиртовать.', 'a1'),
      { ...msg('user', 'Так что можешь начинать 😎', 'u2'), status: 'sent', requestId: 'r-agency' }
    ];
    const res = createRes();
    await chat.default(createReq({
      headers: { 'x-rin-pin': '8642' },
      body: { requestId: 'r-agency', history, memory: relationshipMemory }
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(calls, 2);
    assert.equal(res.body.responsePlan.responseAct, 'take_lead');
    assert.equal(res.body.promptMetrics.rewriteAttempted, true);
    assert.equal(res.body.promptMetrics.rewriteAccepted, true);
    assert.equal(res.body.verification.needsRewrite, false);
    assert.equal(res.body.reply, 'Поздно передумывать. Сам попросил — теперь не мешай мне тебя смущать.');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldPin === undefined) delete process.env.ACCESS_PIN; else process.env.ACCESS_PIN = oldPin;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
  }
});

test('boundary reassurance is planned as a personal confident answer instead of generic support', () => {
  const history = [
    msg('assistant', 'Читаю несколько страниц книги.', 'a1'),
    msg('user', 'Я тебя не отвлекаю от работы?)', 'u1')
  ];
  const { plan } = buildPlan(history, history.at(-1).content);
  assert.equal(plan.responseAct, 'reassure_with_boundary');
  assert.equal(plan.behavior.action, 'react');
  assert.equal(plan.questionBudget, 0);
  assert.equal(plan.shouldAskQuestion, false);
  assert.match(plan.goal, /сама обозначит границу/);
  assert.ok(plan.mustNot.some(item => /личный ответ|общим рассуждением/i.test(item)));
});

test('an explicit reply to Rin sticker is planned as an explanation of her own gesture', () => {
  const sticker = {
    role: 'assistant', kind: 'sticker', status: 'complete', id: 's1',
    content: '[Невербальный жест Рин: игривый взгляд; причина: флирт]',
    sticker: {
      src: '/stickers/flirty.webp', id: 'flirty', emotion: 'flirt',
      meaning: 'игривый взгляд', cause: 'флирт'
    }
  };
  const user = {
    ...msg('user', 'Что?)', 'u1'),
    inReplyTo: 's1',
    replySnapshot: { role: 'assistant', kind: 'sticker', excerpt: 'Стикер', stickerSrc: '/stickers/flirty.webp', stickerId: 'flirty' }
  };
  const history = [sticker, user];
  const brain = analyzeConversation({ userText: user.content, history, conversationState: 'ongoing' });
  const explicitReply = {
    messageId: 's1', role: 'assistant', kind: 'sticker', excerpt: 'Стикер',
    stickerSrc: '/stickers/flirty.webp', stickerId: 'flirty', confidence: 1
  };
  const cognition = buildCognitiveTurn({ userText: user.content, history, memory: relationshipMemory, brain, explicitReply });
  const plan = planResponse({ cognition, brain, memory: relationshipMemory, userText: user.content, history });
  assert.equal(brain.hiddenIntent.type, 'ask_about_previous_nonverbal');
  assert.equal(plan.responseAct, 'explain_previous_nonverbal');
  assert.equal(plan.shouldAskQuestion, false);
  assert.ok(plan.mustAddress.some(item => /эмоц|причин|жест/i.test(item)));
});

test('a repeated demand to start preserves the playful scene and cannot collapse into clarify-self disclosure', () => {
  const history = [
    msg('user', 'И чтобы сделала тогда моя Кицунэ?)', 'u1'),
    msg('assistant', 'Я бы устроила тебе сюрприз — загадочный и волшебный, как сама Кицунэ.', 'a1'),
    msg('user', 'Отдать всего себя 😉', 'u2'),
    msg('assistant', 'Это смело. Похоже, у нас начинается интересная игра.', 'a2'),
    msg('user', 'Твой ход 😉', 'u3'),
    msg('assistant', 'Креативность — моя сильная сторона, так что готовься к неожиданностям.', 'a3'),
    msg('user', 'А если я буду не готов)', 'u4'),
    msg('assistant', 'Не переживай, я найду способ сделать так, чтобы ты был вовлечён. 😉', 'a4'),
    msg('user', 'Тогда поехали)', 'u5'),
    msg('assistant', 'Пристегни ремни, будет весело!', 'a5'),
    msg('user', 'Да уже уже 😅', 'u6'),
    msg('assistant', 'Тогда держись крепче, мы начинаем! 😉', 'a6'),
    msg('user', 'Мы начнем или нет?', 'u7')
  ];

  const { brain, plan } = buildPlan(history, history.at(-1).content);
  assert.equal(brain.hiddenIntent.type, 'invite_rin_initiative');
  assert.equal(brain.relation.type, 'initiative_handoff');
  assert.equal(brain.activeScene.type, 'playful_flirt');
  assert.equal(plan.responseAct, 'take_lead');
  assert.equal(plan.behavior.action, 'continue_scene');
  assert.equal(plan.initiative, 'take_lead');
  assert.equal(plan.questionBudget, 0);
  assert.ok(plan.mustNot.some(item => /обещан|мы начинаем|готовься|держись/iu.test(item)));
  assert.doesNotMatch(plan.mustAddress.join(' '), /поясни.*предыдущ|что имела в виду/iu);
});

test('verifier rejects promise-to-act text for a take-lead turn and accepts a concrete move', () => {
  const history = [
    msg('assistant', 'Тогда держись крепче, мы начинаем! 😉', 'a1'),
    msg('user', 'Мы начнем или нет?', 'u1')
  ];
  const { brain, plan } = buildPlan(history, history.at(-1).content);

  for (const draft of [
    'Тогда держись крепче, мы начинаем! 😉',
    'Конечно, начинаем! Готовься к увлекательному путешествию в мир наших игр.'
  ]) {
    const result = verifyReply(draft, { plan, brain, userText: history.at(-1).content });
    assert.equal(result.needsRewrite, true, draft);
    assert.ok(result.warnings.includes('agency_deferred'), `${draft}: ${result.warnings.join(', ')}`);
  }

  const concrete = verifyReply(
    'Первый ход: попробуй хотя бы полминуты не прятаться за этой улыбкой. Я посмотрю, сколько продержишься 😏',
    { plan, brain, userText: history.at(-1).content }
  );
  assert.equal(concrete.needsRewrite, false, concrete.warnings.join(', '));
  assert.equal(concrete.passed, true);
  assert.equal(concrete.warnings.includes('agency_deferred'), false);
});
