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
const EXPLICIT_RECALL = /(?:помнишь|помни\b|вспомни|вспоминаешь|что\s+ты\s+тогда|рассказывала\s+мне|ты\s+говорила|мы\s+(?:тогда|раньше)|как\s+(?:было|произошло)\s+в\s+тот\s+раз)/iu;
const PAST_CONTEXT = /(?:вчера|позавчера|тогда|раньше|прошл(?:ый|ую|ом|ое)|в\s+тот\s+раз|в\s+тот\s+(?:день|вечер)|недавно|помнится|снова\s+про|тот\s+(?:раз|вечер|случай)|что\s+было\s+(?:потом|раньше))/iu;
const STOP = new Set(`
  помни помнишь вспомни вспоминаешь вспоминала помнила помнит помню
  когда который которая которые которое как что почему где зачем было была были был буду будет бы
  кто ком тебе тебя вами нас ними ним нашим нашей наши ваше вашей с тобой
  мне тебя если просто очень тогда раньше потом вчера позавчера сейчас сегодня
  история рассказ разговор событие прошлый раз наша наш ваша этот эта этом эти те тех
  сама сам себе уже еще тоже именно про говорил говорила рассказала рассказывала
  сделала делала делали закончила закончил закончился завершила завершился
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
  { cue: /^(?:работ|сбор|офис|рабоч)/u, words: ['работа', 'рабочее', 'сборы'] }
]);

export function recallIntent(text = '') {
  const source = NORMAL(text);
  const explicit = EXPLICIT_RECALL.test(source);
  const past = PAST_CONTEXT.test(source);
  return { explicit, past, eligible: Boolean(explicit || past) };
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

const KINDS = new Set(['rin_action_reported_complete', 'rin_action_planned', 'rin_reflection', 'shared_moment', 'correction']);
const SCORES = Object.freeze({ correction: 9, rin_action_reported_complete: 4, shared_moment: 3, rin_reflection: 2, rin_action_planned: 0 });

export function selectAutobiography(rows = [], { limit = 3 } = {}) {
  const sorted = (Array.isArray(rows) ? rows : []).filter(r => KINDS.has(r?.kind) && ['candidate', 'verified'].includes(r.review_status) && r.source_message_id && r.statement)
    .map(r => ({
      ...r, relevance: Number(r.relevance) || 0,
      priority: (Number(r.relevance) || 0) * 100 + SCORES[r.kind],
    }))
    .sort((a, b) => b.priority - a.priority || Number(b.event_time_ms) - Number(a.event_time_ms));
  const picked = [];
  const seen = new Set();
  for (const r of sorted) {
    if (picked.length >= Math.min(Math.max(1, limit), 4)) break;
    if (seen.has(r.source_message_id)) continue;
    // Non-corrections do not crowd out the only available correction on the topic.
    seen.add(r.source_message_id);
    picked.push({
      text: clean(r.statement, 350),
      kind: r.kind,
      scope: clean(r.scope, 45),
      status: r.review_status,
      provenance: 'archived_rin_statement_not_independent_evidence',
      sourceMessageId: clean(r.source_message_id, 120),
      eventTimeMs: Number(r.event_time_ms) || null
    });
  }
  return picked;
}

export async function retrieveAutobiographicalMemory({ userText = '', history = [], sqlClient = null } = {}) {
  const intent = recallIntent(userText);
  if (!intent.eligible) return [];
  let topics = recallTopics(userText);
  // Resolve a short 'remember that?' using nearby prior user text only, not invented context.
  if (intent.explicit && !topics.length && Array.isArray(history)) {
    const earlier = history.filter(x => x?.role === 'user' && clean(x?.content, 500) !== clean(userText, 500)).slice(-3).reverse();
    topics = earlier.map(x => recallTopics(x.content)).find(x => x.length) || [];
  }
  if (!topics.length) return [];
  const sql = sqlClient || await database();
  // plainto_tsquery('russian') stems terms. Reparse the formatted lexemes with
  // 'simple' to avoid a second, destructive stemming step.
  const rows = await sql.query(`
    WITH query AS (
      SELECT to_tsquery('simple', REPLACE(plainto_tsquery('russian', $1)::text, ' & ', ' | ')) AS terms
    )
    SELECT r.record_id, r.kind, r.statement, r.source_message_id, r.event_time_ms,
      r.review_status, r.details->>'scope' AS scope,
      ts_rank_cd(to_tsvector('russian', r.statement), query.terms) AS relevance
    FROM rin_memory_records r
    JOIN rin_memory_observations o ON o.source_message_id = r.source_message_id
    CROSS JOIN query
    WHERE r.kind IN ('rin_action_reported_complete','rin_action_planned','rin_reflection','shared_moment','correction')
      AND r.review_status IN ('candidate','verified')
      AND to_tsvector('russian', r.statement) @@ query.terms
    ORDER BY relevance DESC, r.event_time_ms DESC NULLS LAST, r.record_id DESC
    LIMIT 18`, [topics.join(' ')]);
  return selectAutobiography(rows, { limit: 3 });
}
