// Light, read-only lexical diagnostics for long chat scenes. No text is rewritten.
// Repeated topics are allowed; only recurrent wording/rhetorical moves get guidance.
const WORD = /[\p{L}\p{N}]+/gu;
const COMMON = new Set('а и но не что это тебе меня она он они когда после если просто очень уже тут вот тогда да так ведь лишь сейчас только потом свой своё свои сам сама сами было быть буду будет тебе чтобы который которая которые который же бы ну ведь ещё всё все всего вообще можно всегда снова меня тебе твоё твой моя мой про для как где меня тебя тебя'.split(' '));
const clamp = n => Math.max(0, Math.min(100, Math.round(n)));
const words = s => (String(s || '').toLowerCase().match(WORD) || []).slice(0, 180);

function recentAssistantTurns(history = [], limit = 12) {
  const turns = [];
  for (const [index, msg] of (Array.isArray(history) ? history : []).entries()) {
    if (msg?.role !== 'assistant' || !['text', 'voice'].includes(msg?.kind || 'text')) continue;
    const content = String(msg.content || '').trim();
    if (!content) continue;
    const key = String(msg.turnId || msg.requestId || msg.id || `event-${index}`);
    if (turns.at(-1)?.key === key) turns.at(-1).text += ` ${content}`;
    else turns.push({ key, text: content });
  }
  return turns.slice(-limit).map(item => item.text);
}

function contentStems(text) {
  return new Set(words(text).filter(w => w.length >= 5 && !COMMON.has(w)).map(w => w.slice(0, Math.min(5, w.length))));
}
function similarity(a, b) {
  const x = contentStems(a), y = contentStems(b);
  if (x.size < 3 || y.size < 3) return 0;
  const intersection = [...x].filter(w => y.has(w)).length;
  return intersection / Math.max(x.size, y.size);
}
function normalizedOpening(text) {
  const first = words(text);
  return first.length >= 3 ? first.slice(0, 3).join(' ') : '';
}

// Classify a small set of rhetorical loops. Unlike topic similarity, these are
// repeated *claims/moves* (e.g. "I won't concede") across different wording.
export function rhetoricalMove(text = '') {
  const value = String(text || '').toLowerCase().replace(/ё/gu,'е');
  if (/(?:не\s+(?:уступ|сдам|сдаюсь|отдам\s+побед|признаю\s+поражен)|не\s+думаю[^.!?]{0,28}сдамся|сама\s+(?:решаю|выбираю|определю)|только\s+по\s+(?:своему|моему|собственному)\s+решению)/iu.test(value)) return 'defend_autonomy';
  if (/(?:побед[ауеы]|проигра|капитуляц|ничь[яю]|раунд)/iu.test(value)) return 'scorekeeping';
  if (/(?:приз|наград|аванс)/iu.test(value)) return 'reward_bargain';
  if (/(?:секрет|сюрприз|не\s+раскрою|не\s+скажу\s+заранее)/iu.test(value)) return 'withhold_surprise';
  return null;
}

export function inspectExpressionNovelty(history = [], { limit = 12 } = {}) {
  const turns = recentAssistantTurns(history, limit);
  if (turns.length < 4) return { pressure: 0, comparedTurns: turns.length, repeatedOpenings: [], repeatedPhrases: [], echoPairs: 0, repeatedMoves: [] };
  const openingCounts = new Map(), phraseTurns = new Map();
  for (const [index, text] of turns.entries()) {
    const opening = normalizedOpening(text);
    if (opening) openingCounts.set(opening, (openingCounts.get(opening) || 0) + 1);
    const tokens = words(text);
    const seen = new Set();
    for (let i = 0; i < tokens.length - 3; i += 1) {
      const slice = tokens.slice(i, i + 4);
      if (!slice.some(word => word.length >= 5 && !COMMON.has(word))) continue;
      seen.add(slice.join(' '));
    }
    for (const phrase of seen) {
      if (!phraseTurns.has(phrase)) phraseTurns.set(phrase, new Set());
      phraseTurns.get(phrase).add(index);
    }
  }
  const repeatedOpenings = [...openingCounts].filter(([, n]) => n >= 2).sort((a,b) => b[1]-a[1]).slice(0, 4).map(([text, count]) => ({ text, count }));
  const repeatedPhrases = [...phraseTurns].map(([text, indices])=>({ text, count:indices.size }))
    .filter(p=>p.count>=2).sort((a,b)=>b.count-a.count || b.text.length-a.text.length).slice(0,4);
  let echoPairs = 0;
  for (let i = 0; i < turns.length; i += 1) {
    // Near-identical content across distinct turns; contiguous split segments are grouped above.
    for (let j = Math.max(0, i - 5); j < i; j += 1) if (similarity(turns[i], turns[j]) >= .68) { echoPairs++; break; }
  }
  const moveCounts = new Map();
  for (const text of turns) {
    const move = rhetoricalMove(text);
    if (move) moveCounts.set(move, (moveCounts.get(move) || 0) + 1);
  }
  const repeatedMoves = [...moveCounts].filter(([,count])=>count >= 3)
    .map(([move,count])=>({move,count})).sort((a,b)=>b.count-a.count).slice(0,3);
  const pressure = clamp(repeatedOpenings.length*14 + repeatedPhrases.length*11 + echoPairs*18 +
    repeatedMoves.reduce((sum, item) => sum + Math.max(0, item.count - 2)*12, 0));
  return { pressure, comparedTurns: turns.length, repeatedOpenings, repeatedPhrases, echoPairs, repeatedMoves };
}

export function formatExpressionGuidance(snapshot = null, intentTurns = 0) {
  const pressure = Number(snapshot?.pressure || 0);
  const longScene = Number(intentTurns || 0) >= 8;
  if (pressure < 24 && !longScene) return '';
  const examples = [
    ...(snapshot?.repeatedOpenings || []).slice(0, 2).map(p => `начало «${p.text}» ×${p.count}`),
    ...(snapshot?.repeatedPhrases || []).slice(0, 2).map(p => `оборот «${p.text}» ×${p.count}`),
    ...(snapshot?.repeatedMoves || []).slice(0, 2).map(p => `один смысловой ход «${p.move}» ×${p.count}`)
  ];
  return `РЕЧЕВОЕ РАЗНООБРАЗИЕ: повторяемость=${pressure}/100, продолжительная сцена=${longScene ? 'да' : 'нет'}${examples.length ? `; замеченные повторы: ${examples.join('; ')}` : ''}. Не повторяй одну и ту же мысль, условие, шутку или позицию другими словами только ради очередного ответа. Сохраняй намерение, флирт и тему, но дай новый смысловой ход: конкретную эмоцию, действие, инициативу, самоиронию, маленькую новую деталь или короткую паузу. Если пользователь намеренно повторяет тему, отвечай по существу, не меняй её насильно. Не вставляй случайные синонимы и не перечисляй варианты только ради новизны.`;
}
