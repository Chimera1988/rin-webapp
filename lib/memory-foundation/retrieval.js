// Rin 2.6.18 — source-qualified retrospective retrieval from Neon.
// This is evidence for Rin Mind, never a decision owner or a write to personality.
// Explicit corrections take precedence over claims that they revise.
async function database() {
  const { archiveSql } = await import('../archive/database.js');
  return archiveSql();
}

const clean = (value, limit = 450) => String(value ?? '')
  .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
  .replace(/\s+/gu, ' ').trim().slice(0, limit);
const NORMAL = value => clean(value, 750).toLowerCase().replace(/ё/g, 'е');
const EXPLICIT_RECALL = /(?:помнишь|помни\b|вспомни|вспоминаешь|напомни\s+(?:мне\s+)?(?:о\s+чем|что\s+мы|какую\s+историю|что\s+ты|как\s+мы)|что\s+ты\s+тогда|рассказывала\s+мне|ты\s+говорила|мы\s+(?:тогда|раньше)|как\s+(?:было|произошло)\s+в\s+тот\s+раз)/iu;
const PAST_CONTEXT = /(?:вчера|позавчера|раньше|прошл(?:ый|ую|ом|ое)|в\s+тот\s+раз|в\s+тот\s+(?:день|вечер)|недавно|помнится|снова\s+про|тот\s+(?:раз|вечер|случай)|что\s+было\s+(?:потом|раньше)|(?:что|как|почему)\s+(?:ты|мы|я)?\s*(?:тогда|раньше))/iu;
const BIRTHDAY_QUESTION = /(?:(?:когда|какого\s+числа|чей|у\s+кого|напомни|помнишь).{0,75}(?:день\s+рождени|дата\s+рождени)|(?:день\s+рождени).{0,45}(?:когда|какого|чей|у\s+кого))/iu;
const MEMORY_REPAIR_CUE = /(?:не\s+помн|не\s+вспомн|не\s+восстанов|напомни|подскажи|зацепка|не\s+хочу\s+(?:выдумывать|сочинять)|не\s+знаю\s+(?:дальше|продолжени))/iu;
const STOP = new Set(`
  помни помнишь вспомни вспоминаешь вспоминала помнила помнит помню
  когда который которая которые которое как что почему где зачем было была были был буду будет бы
  кто ком тебе тебя вами нас ними ним нашим нашей наши ваше вашей с тобой
  мне тебя если просто очень тогда раньше потом вчера позавчера сейчас сегодня
  история рассказ разговор событие прошлый раз наша наш ваша этот эта этом эти те тех
  сама сам себе уже еще тоже именно про говорил говорила рассказала рассказывала
  сделала делала делали закончила закончил закончился завершила завершился
  спросил спросила ответил ответила сразу после перед истории
  были ли ведь разве какой какие такая такое хочу можно скажи расскажи напомни
  помнишь нечто вообще снова тот наши ты вы они она оно там тут тебя твои своих
`.split(/\s+/u).filter(Boolean));

// Small, inspectable alias families compensate for inflection and near-synonyms.
// They DO NOT infer that the alleged events took place.
const ALIASES = Object.freeze([
  { cue: /^(?:обед|пообед|поел|поела)/u, words: ['обед', 'пообедала', 'поела'] },
  { cue: /^(?:ужин|поужин|паста|пасту|готов)/u, words: ['ужин', 'паста', 'готовила'] },
  { cue: /^(?:завтрак|позавтрак|тост)/u, words: ['завтрак', 'позавтракала', 'тосты'] },
  { cue: /^(?:комеди|фильм|кино|смотрел|посмотрел)/u, words: ['комедия', 'смотрели', 'фильм'] },
  { cue: /^(?:перевод|перевел|перевел|редакт|правк|коммент|текст|абзац)/u, words: ['перевод', 'правки', 'комментарии', 'текст'] },
  { cue: /^(?:кицун|китсун|лисиц|хранител|сказк)/u, words: ['Китсуне', 'хранителя', 'лисица'] },
  { cue: /^(?:любов|любл|нежн|признан|призна|чувств|привязан)/u, words: ['любовь', 'нежность', 'привязанность'] },
  { cue: /^(?:поцел|обним|близост|границ|останови)/u, words: ['близость', 'поцелуев', 'остановиться'] },
  { cue: /^(?:музык|песн|баллад)/u, words: ['песня', 'музыка', 'баллада'] },
  { cue: /^(?:работ|сбор|офис|рабоч)/u, words: ['работа', 'рабочее', 'сборы'] },
  { cue: /^(?:рождени|праздник|именин)/u, words: ['рождения', 'день', 'праздник', 'дата'] },
  { cue: /^(?:истори|сказк|рассказ)/u, words: ['история', 'сказка', 'рассказала'] }
]);

// Only continue a search when Rin has just asked for a memory clarification.
// Generic acknowledgements ("да", "хорошо") never generate cloud requests.
export function recallFollowUp(text = '', history = []) {
  const source = NORMAL(text);
  if (!/^(?:про|об|о)\s+.{4,125}$/u.test(source)) return false;
  const recent = (Array.isArray(history) ? history : []).filter(x =>
    ['user', 'assistant'].includes(x?.role) && clean(x?.content, 400)).slice(-12);
  const currentIndex = recent.findLastIndex(x => x.role === 'user' && NORMAL(x.content) === source);
  const context = currentIndex >= 0 ? recent.slice(0, currentIndex) : recent;
  const previousAssistant = [...context].reverse().find(x => x.role === 'assistant');
  if (!previousAssistant || !MEMORY_REPAIR_CUE.test(NORMAL(previousAssistant.content))) return false;
  return context.some(x => x.role === 'user' && (EXPLICIT_RECALL.test(NORMAL(x.content)) || PAST_CONTEXT.test(NORMAL(x.content))));
}

export function recallIntent(text = '', history = []) {
  const source = NORMAL(text);
  const explicit = EXPLICIT_RECALL.test(source) || BIRTHDAY_QUESTION.test(source);
  const past = PAST_CONTEXT.test(source);
  const followUp = !explicit && !past && recallFollowUp(text, history);
  return { explicit, past, followUp, eligible: Boolean(explicit || past || followUp) };
}

function recallQuestion(text = '', history = []) {
  const prompt = clean(text, 300);
  if (!recallFollowUp(text, history)) return prompt;
  const recent = history.filter(x => x?.role === 'user' && clean(x?.content)).slice(-7).reverse();
  const preceding = recent.find(x => NORMAL(x.content) !== NORMAL(text)
    && (EXPLICIT_RECALL.test(NORMAL(x.content)) || PAST_CONTEXT.test(NORMAL(x.content))));
  return preceding ? `${clean(preceding.content, 240)} ${prompt}` : prompt;
}

export function recallTopics(text = '') {
  const raw = NORMAL(text);
  const tokens = (raw.match(/[а-яa-z0-9]{4,}/gu) || [])
    .filter(token => !STOP.has(token) && !/^(?:этого|этому|свои|твоей|твоем|сегодня|позавчера|раньше|вечером|утром)$/.test(token));
  const key = [...new Set(tokens)].slice(0, 5);
  if (!key.length) return [];
  const expanded = [...key];
  for (const word of key) for (const alias of ALIASES) {
    if (alias.cue.test(word)) {
      for (const term of alias.words) if (!expanded.includes(term.toLowerCase())) expanded.push(term.toLowerCase());
    }
  }
  return expanded.slice(0, 14);
}

const KINDS = new Set(['rin_action_reported_complete', 'rin_action_planned', 'rin_reflection', 'shared_moment', 'correction', 'user_fact']);
const SCORES = Object.freeze({ correction: 5, user_fact: 5, rin_action_reported_complete: 3, shared_moment: 3, rin_reflection: 2, rin_action_planned: 1 });

function birthdaySubjectScore(statement, question) {
  if (!/(?:день\s+рождени|рождени|праздник|сюрприз)/iu.test(question)) return 0;
  const aboutRin = /(?:у\s+тебя|твой|тво[её]|рин|китсуне)/iu.test(question)
    && !/(?:мой|у\s+меня|моего|моей|любимого|любимой)/iu.test(question);
  const aboutUser = /(?:у\s+меня|мой|моего|моей|любимого|любимой|кирилл)/iu.test(question);
  if (aboutRin && /(?:день\s+рождения\s+рин|рин\s+.{0,24}12\s+октябр)/iu.test(statement)) return 45;
  if (aboutUser && /(?:день\s+рождения\s+пользовател|день\s+рождения\s+кирилл)/iu.test(statement)) return 45;
  if (aboutRin && /(?:день\s+рождения\s+пользовател|день\s+рождения\s+кирилл)/iu.test(statement)) return -40;
  if (aboutUser && /(?:день\s+рождения\s+рин)/iu.test(statement)) return -40;
  return 0;
}

// Interpret 'вчера' in Rin's civil timezone, not in the server's UTC midnight.
function civilDate(ms, timezone = 'Europe/Moscow') {
  if (!Number.isFinite(Number(ms)) || Number(ms) <= 0) return '';
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Number(ms))); }
  catch { return new Date(Number(ms)).toISOString().slice(0, 10); }
}

export function contextualRecallScore(record = null, userText = '', { nowMs = Date.now(), timezone = 'Europe/Moscow' } = {}) {
  const question = NORMAL(userText);
  const evidence = NORMAL(record?.statement || '');
  if (!question || !evidence) return 0;
  let bonus = birthdaySubjectScore(evidence, question);
  const asksWhatWasSaid = /(?:что\s+(?:я|ты)\s+(?:спросил|спросила|ответил|ответила|сказал|сказала)|какой\s+вопрос|что\s+ты\s+мне\s+ответила)/u.test(question);
  const sourceDescribesExchange = /(?:спросил|спросила|задал\s+вопрос)/u.test(evidence)
    && /(?:ответила|ответил|ответ\s+рин)/u.test(evidence);
  if (asksWhatWasSaid && sourceDescribesExchange) bonus += 28;
  if (asksWhatWasSaid && /(?:после|сразу\s+после)/u.test(question)
      && /(?:после|затем|вслед\s+за)/u.test(evidence) && sourceDescribesExchange) bonus += 18;
  if (asksWhatWasSaid && sourceDescribesExchange && /«[^»]{1,170}\?»/u.test(evidence)) bonus += 17;

  // If the question is about the STORY itself, rank a story above peripheral
  // references to it. Never use this boost for 'what did I ask after the story?'.
  const storyQuestion = /(?:истори|сказк|рассказ)/u.test(question);
  if (storyQuestion && !asksWhatWasSaid) {
    if (/(?:истори|сказк|сюжет|рассказала)/u.test(evidence)) bonus += 20;
    if (/\b(?:oct\d+-)?(?:kitsune-story|story)\b/u.test(String(record?.episode_key || record?.episodeKey || ''))) bonus += 22;
  }
  // Explicit topic specificity beats a generic rank match on 'вчера/история'.
  if (/(?:хранител|кицун|китсун|лисиц|лис[ауеы])/u.test(question)) {
    if (/(?:хранител)/u.test(evidence) && /(?:кицун|китсун|лисиц|лис[ауеы])/u.test(evidence)) bonus += 22;
  }
  if (/\bвчера\b/u.test(question) && record?.event_time_ms) {
    const target = civilDate(Number(nowMs) - 86_400_000, timezone);
    if (target && civilDate(record.event_time_ms, timezone) === target) bonus += 35;
    else bonus -= 20;
  }
  return bonus;
}

export function selectAutobiography(rows = [], { limit = 3, userText = '', nowMs = Date.now(), timezone = 'Europe/Moscow' } = {}) {
  const sorted = (Array.isArray(rows) ? rows : []).filter(r => KINDS.has(r?.kind) && ['candidate', 'verified'].includes(r.review_status) && r.source_message_id && r.statement)
    .map(r => ({
      ...r, relevance: Number(r.relevance) || 0,
      priority: (Number(r.relevance) || 0) * 100 + SCORES[r.kind]
        + contextualRecallScore(r, userText, { nowMs, timezone })
    }))
    .sort((a, b) => b.priority - a.priority || Number(b.event_time_ms) - Number(a.event_time_ms));
  const picked = [];
  const seen = new Set();
  for (const r of sorted) {
    if (picked.length >= Math.min(Math.max(1, limit), 4)) break;
    if (seen.has(r.source_message_id)) continue;
    seen.add(r.source_message_id);
    picked.push({
      text: clean(r.statement, 550),
      kind: r.kind,
      scope: clean(r.scope, 45),
      status: r.review_status,
      provenance: r.source_kind === 'user_statement' ? 'archived_user_statement' : 'archived_rin_statement_not_independent_evidence',
      sourceMessageId: clean(r.source_message_id, 120),
      eventTimeMs: Number(r.event_time_ms) || null
    });
  }
  return picked;
}

export async function retrieveAutobiographicalMemory({ userText = '', history = [], sqlClient = null, nowMs = Date.now(), timezone = 'Europe/Moscow' } = {}) {
  const intent = recallIntent(userText, history);
  if (!intent.eligible) return [];
  const effectiveQuestion = recallQuestion(userText, history);
  let topics = recallTopics(effectiveQuestion);
  if (intent.explicit && !topics.length && Array.isArray(history)) {
    const earlier = history.filter(x => x?.role === 'user' && clean(x?.content, 500) !== clean(userText, 500)).slice(-3).reverse();
    topics = earlier.map(x => recallTopics(x.content)).find(x => x.length) || [];
  }
  if (!topics.length) return [];
  const sql = sqlClient || await database();
  // Postgres Russian text search provides recall candidates, but the final
  // decision uses topic, historical ordering and source-qualified episode data.
  const rows = await sql.query(`
    WITH query AS (
      SELECT to_tsquery('simple', REPLACE(plainto_tsquery('russian', $1)::text, ' & ', ' | ')) AS terms
    )
    SELECT r.record_id, r.kind, r.statement, r.source_message_id, r.source_kind,
      r.event_time_ms, r.review_status, r.details->>'scope' AS scope,
      r.details->>'episode_key' AS episode_key,
      ts_rank_cd(to_tsvector('russian', r.statement), query.terms) AS relevance
    FROM rin_memory_records r
    JOIN rin_memory_observations o ON o.source_message_id = r.source_message_id
    CROSS JOIN query
    WHERE r.kind IN ('rin_action_reported_complete','rin_action_planned','rin_reflection','shared_moment','correction','user_fact')
      AND r.review_status IN ('candidate','verified')
      AND to_tsvector('russian', r.statement) @@ query.terms
    ORDER BY relevance DESC, r.event_time_ms DESC NULLS LAST, r.record_id DESC
    LIMIT 60`, [topics.join(' ')]);
  return selectAutobiography(rows, { limit: 3, userText: effectiveQuestion, nowMs, timezone });
}
