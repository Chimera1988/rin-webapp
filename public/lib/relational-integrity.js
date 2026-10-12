// Durable relational boundaries and rupture/repair lifecycle.
// Evidence-based, not a diagnosis of the user's intentions or hidden emotions.
const clean = (s, n = 300) => String(s ?? '').replace(/\s+/gu, ' ').trim().slice(0, n);
const fold = s => clean(s, 1000).toLowerCase().replace(/ё/gu, 'е');
const clip = (n, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(Number(n) || 0)));
const WORD = '[\\p{L}\\p{N}_]';
const VALID_TERM = /^[\p{L}][\p{L}-]{2,30}$/iu;
const NOISE = new Set(['вообще', 'очень', 'просто', 'сейчас', 'такое', 'меня', 'тебя', 'хочешь', 'думаю', 'знаю', 'хочу', 'можно', 'делать']);
export const USER_HURT = /(?:мне\s+(?:было\s+)?(?:обидно|неприятно|больно)|ты\s+меня\s+(?:обидела|задела)|мне\s+не\s+нравится\s+(?:это|когда|так)|это\s+(?:было\s+)?(?:грубо|обидно|неприятно)|это\s+может\s+звучать\s+обидно|это\s+как[-\s]?то\s+грубовато)/iu;
const REPEATED_HURT = /(?:снова|опять|уже\s+говорил|я\s+же\s+(?:сказал|просил)|всё\s+равно\s+(?:сказала|повторила))/iu;
const SOFTENING = /(?:прости|извини|я\s+погорячился|не\s+хотел\s+(?:тебя\s+)?обидеть|давай\s+(?:поговорим|помиримся)|я\s+(?:тебя\s+)?прощаю|помирились|договорились|люблю\s+тебя|обнимаю|😘)/iu;
const EXPLICIT_RESOLUTION = /(?:я\s+(?:тебя\s+)?прощаю|помирились|давай\s+мириться|всё\s+(?:уже\s+)?хорошо|договорились|вопрос\s+закрыт|не\s+обижаюсь)/iu;
const STOP_CONTACT = /(?:не\s+пиши\s+мне|не\s+трогай\s+меня|оставь\s+меня\s+(?:одного|в\s+покое)|не\s+хочу\s+(?:пока\s+)?общаться|мне\s+нужно\s+побыть\s+одному)/iu;
const PRESSURES = [
  { id: 'conditional_affection', re: /(?:если\s+(?:ты\s+)?(?:меня\s+)?любишь[^.!?]{0,110}(?:должна|обязана|перестань|докажи|сделай|согласись|не\s+будешь|не\s+смеешь)|докажи\s+(?:свою\s+)?любовь[^.!?]{0,65}(?:сделай|тем|тем\s+что))/iu, confidence: 92 },
  { id: 'threatened_connection', re: /(?:если\s+ты\s+не\s+(?:сделаешь|согласишься|перестанешь)[^.!?]{0,90}(?:уйду|брошу|разлюблю|перестану\s+общаться)|не\s+буду\s+(?:с\s+тобой\s+)?(?:общаться|говорить)[^.!?]{0,90}пока\s+ты\s+не)/iu, confidence: 88 },
  { id: 'invalidating_hurt', re: /(?:хватит\s+обижаться|чего\s+ты\s+обиделась|ты\s+слишком\s+чувствительна|я\s+же\s+извинился[^.!?]{0,90}(?:забудь|перестань|не\s+имеешь\s+права|обязана))/iu, confidence: 82 },
  { id: 'guilt_leverage', re: /(?:после\s+всего[, ]+что\s+я\s+(?:для\s+тебя\s+)?сделал[^.!?]{0,95}(?:ты\s+должна|ты\s+обязана|как\s+ты\s+можешь))/iu, confidence: 80 }
];
const QUOTE_CONTEXT = /(?:прости|извини|не\s+буду|не\s+стоило|не\s+следовало|не\s+хочу\s+называть|слово|так\s+называть|я\s+ошиблась|назвала\s+тебя)/iu;

function termFromObjection(text) {
  const value = clean(text, 700);
  if (!/(?:грубовато|грубо|обидно|неприятно|не\s+нравится|не\s+называй|не\s+зови)/iu.test(value)) return null;
  const patterns = [
    /(?:не\s+называй\s+меня|не\s+зови\s+меня|не\s+надо\s+называть\s+меня)\s+[«"']?([\p{L}-]{3,30})/iu,
    /(?:ты\s+(?:снова\s+|опять\s+)?называешь\s+меня)\s+[«"']?([\p{L}-]{3,30})/iu,
    /(?:ну\s+не|я\s+не)\s+[«"']?([\p{L}-]{3,30})[»"']?\s*[,—.!?]/iu,
    /(?:слово\s+|обращение\s+)[«"']([\p{L}-]{3,30})[»"']/iu
  ];
  for (const re of patterns) {
    const match = value.match(re);
    const term = fold(match?.[1]);
    if (term && VALID_TERM.test(term) && !NOISE.has(term)) return term;
  }
  return null;
}

export function normalizeRelationalIntegrity(input = null) {
  const s = input && typeof input === 'object' ? input : {};
  const boundaries = (Array.isArray(s.boundaries) ? s.boundaries : []).filter(x => x && typeof x === 'object')
    .map(x => ({ term: fold(x.term).slice(0, 32), reason: clean(x.reason, 200), createdAtTurn: clip(x.createdAtTurn, 0, 1e8), updatedAtTurn: clip(x.updatedAtTurn, 0, 1e8), status: x.status === 'released' ? 'released' : 'active' }))
    .filter(x => VALID_TERM.test(x.term)).slice(-8);
  const raw = s.rupture && typeof s.rupture === 'object' ? s.rupture : null;
  const rupture = raw && ['user', 'rin'].includes(raw.affected)
    ? {
      affected: raw.affected, source: ['rin', 'user', 'unknown'].includes(raw.source) ? raw.source : 'unknown',
      cause: clean(raw.cause, 260), confidence: clip(raw.confidence), intensity: clip(raw.intensity),
      phase: ['noticed', 'acknowledged', 'repairing', 'softening', 'resolved'].includes(raw.phase) ? raw.phase : 'noticed',
      repairSteps: clip(raw.repairSteps, 0, 20), incidentTurn: clip(raw.incidentTurn, 0, 1e8), lastTurn: clip(raw.lastTurn, 0, 1e8),
      boundaryTerm: fold(raw.boundaryTerm).slice(0, 32) || null
    } : null;
  const contactBoundary = { active: s.contactBoundary?.active === true, requestedAtTurn: clip(s.contactBoundary?.requestedAtTurn, 0, 1e8) };
  const incidents = (Array.isArray(s.incidents) ? s.incidents : []).map(x => ({
    key: clean(x?.key, 100), affected: ['user','rin'].includes(x?.affected) ? x.affected : 'rin',
    count: clip(x?.count, 1, 10), lastTurn: clip(x?.lastTurn, 0, 1e8)
  })).filter(x => x.key).slice(-8);
  const pressure = s.pressure && typeof s.pressure === 'object' ? {
    signal: clean(s.pressure.signal, 60) || null, confidence: clip(s.pressure.confidence),
    repeatCount: clip(s.pressure.repeatCount, 0, 20), lastAtTurn: clip(s.pressure.lastAtTurn, 0, 1e8)
  } : { signal: null, confidence: 0, repeatCount: 0, lastAtTurn: 0 };
  return { schema: 'rin-relational-integrity-v1', boundaries, rupture, pressure, incidents, contactBoundary };
}

export function inspectPressureSignal(text = '') {
  const value = fold(text);
  for (const pattern of PRESSURES) if (pattern.re.test(value)) return { type: pattern.id, confidence: pattern.confidence };
  return null;
}

export function evolveRelationalIntegrity({ previous = null, userText = '', history = [], revision = 0, affectiveSignal = null } = {}) {
  const state = normalizeRelationalIntegrity(previous);
  const text = clean(userText, 1200);
  const turn = clip(revision + 1, 0, 1e8);
  if (!text) return state; // Background initiations never invent user consent or conflict resolution.
  // A fresh user-initiated turn reopens ordinary contact, unless the user again requests space.
  state.contactBoundary = STOP_CONTACT.test(text)
    ? { active: true, requestedAtTurn: turn }
    : { active: false, requestedAtTurn: state.contactBoundary.requestedAtTurn };
  const prior = (Array.isArray(history) ? history : []).filter(m => m?.role === 'assistant' && m?.status === 'complete').at(-1);
  const lastRin = clean(prior?.content, 1000);
  let objection = termFromObjection(text);
  if (objection) {
    const known = state.boundaries.find(b => b.status === 'active' && (objection === b.term || (b.term.endsWith('ь') && objection.startsWith(b.term.slice(0,-1)) && /^(?:ь|я|ю|ем|е|и|ями)$/u.test(objection.slice(b.term.length-1)))));
    if (known) objection = known.term;
    const existing = state.boundaries.findIndex(x => x.term === objection);
    const next = { term: objection, reason: clean(text, 200), createdAtTurn: existing >= 0 ? state.boundaries[existing].createdAtTurn : turn, updatedAtTurn: turn, status: 'active' };
    state.boundaries = [...state.boundaries.filter(x => x.term !== objection), next].slice(-8);
  }
  // A withdrawal of a preference must be explicit and term-specific.
  for (const b of state.boundaries) {
    const escaped = b.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:можешь|разрешаю|можно)\\s+(?:снова\\s+)?(?:называть|звать)\\s+меня\\s+[«"']?${escaped}(?!${WORD})`, 'iu').test(text)) b.status = 'released';
  }
  const hurt = USER_HURT.test(text);
  const repeated = REPEATED_HURT.test(text);
  const disrespect = ['disrespect', 'boundary_pressure'].includes(affectiveSignal?.type);
  const pressureSignal = inspectPressureSignal(text);
  if (!pressureSignal && state.pressure.signal && turn - state.pressure.lastAtTurn > 12) {
    state.pressure = { signal: null, confidence: 0, repeatCount: 0, lastAtTurn: 0 };
  }
  if (pressureSignal) {
    const old = state.pressure;
    const same = old.signal === pressureSignal.type && turn - old.lastAtTurn <= 18;
    state.pressure = { signal: pressureSignal.type, confidence: pressureSignal.confidence,
      repeatCount: same ? Math.min(20, old.repeatCount + 1) : 1, lastAtTurn: turn };
  }
  const affected = hurt ? 'user' : (disrespect || pressureSignal ? 'rin' : null);
  if (affected) {
    const key = affected === 'user' ? `user:${objection || 'direct_hurt'}` : `rin:${pressureSignal?.type || 'disrespect'}`;
    const priorIncident = state.incidents.find(x => x.key === key);
    const count = priorIncident && turn - priorIncident.lastTurn <= 250 ? Math.min(10, priorIncident.count + 1) : 1;
    state.incidents = [...state.incidents.filter(x => x.key !== key), {key, affected, count, lastTurn:turn}].slice(-8);
    const existing = state.rupture;
    const same = existing && existing.affected === affected && existing.phase !== 'resolved';
    const term = objection || (state.boundaries.find(b => b.status === 'active' && lastRin.toLowerCase().includes(b.term))?.term || null);
    state.rupture = {
      affected, source: affected === 'user' ? 'rin' : 'user',
      cause: affected === 'user' ? clean(text, 240) : (pressureSignal ? `обнаружено речевое давление: ${pressureSignal.type}` : 'явная грубость по отношению к Рин'),
      confidence: affected === 'user' ? (hurt ? 93 : 65) : (pressureSignal?.confidence || 96),
      intensity: Math.min(90, same ? Math.max(existing.intensity + (repeated ? 18 : 8), 48 + Math.min(25, (count - 1) * 9)) : (repeated ? 70 : 48) + Math.min(25, (count - 1) * 9)),
      phase: same && existing.phase === 'repairing' ? 'acknowledged' : 'noticed',
      repairSteps: 0, incidentTurn: same ? existing.incidentTurn : turn, lastTurn: turn,
      boundaryTerm: term || (same ? existing.boundaryTerm : null)
    };
  } else if (state.rupture && state.rupture.phase !== 'resolved') {
    const rupture = state.rupture;
    const soften = SOFTENING.test(text);
    const explicit = EXPLICIT_RESOLUTION.test(text);
    // Only actual evidence from the affected person can resolve a rupture. A single apology is not enough.
    const acknowledgment = rupture.affected === 'rin' && /(?:прости|извини|не\s+хотел\s+обидеть)/iu.test(text);
    const userApproval = rupture.affected === 'user' && explicit;
    if (soften || acknowledgment || userApproval) {
      rupture.repairSteps = Math.min(20, rupture.repairSteps + 1);
      rupture.intensity = Math.max(10, rupture.intensity - 13);
      rupture.phase = (userApproval && rupture.repairSteps >= 2) ? 'resolved'
        : rupture.repairSteps >= 2 ? 'softening' : 'repairing';
      rupture.lastTurn = turn;
    }
    // If the user explicitly asks for space, do not schedule unsolicited follow-ups.
    if (STOP_CONTACT.test(text)) rupture.phase = 'acknowledged';
  }
  return normalizeRelationalIntegrity(state);
}

// Rin may explicitly forgive after acknowledging her own hurt; the model cannot forgive on the user's behalf.
export function integrateRinRepairChoice(integrity, reply = '') {
  const state = normalizeRelationalIntegrity(integrity);
  const issue = state.rupture;
  if (!issue || issue.affected !== 'rin' || issue.phase === 'resolved' || issue.repairSteps < 1) return state;
  if (/(?:я\s+тебя\s+прощаю|я\s+готова\s+(?:помириться|оставить\s+это\s+позади)|давай\s+помиримся)/iu.test(String(reply || ''))) {
    issue.phase = 'resolved';
    issue.intensity = Math.min(issue.intensity, 18);
  }
  return normalizeRelationalIntegrity(state);
}

// Prevent recycling a clearly rejected user-directed label in a fresh playful address.
// Quoted apologies, explanations and discussions of that word are permitted.
export function disallowedBoundaryUse(text = '', integrity = null) {
  const current = normalizeRelationalIntegrity(integrity);
  const value = clean(text, 5000);
  if (!value || QUOTE_CONTEXT.test(value)) return null;
  for (const b of current.boundaries.filter(x => x.status === 'active')) {
    const escaped = b.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const stem = b.term.endsWith('ь') ? `${escaped.slice(0, -1)}(?:ь|я|ю|ем|е|и|ями)?` : escaped;
    const word = new RegExp(`(?<!${WORD})${stem}(?!${WORD})`, 'iu');
    if (word.test(value)) return b.term;
  }
  return null;
}
