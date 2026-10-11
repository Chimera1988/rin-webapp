import { cleanText } from './cognitive-contract.js';

// Explicit agency/direction cues only. An invitation is not an accomplished action.
// Ambiguous ellipses, questions and hypothetical actions are left to the dialogue model.
const patterns = [
  { re: /(?:^|[.!?]\s*)(?:ну\s+)?(?:иди|подойди|подходи)\s+(?:же\s+)?(?:ко\s+мне|сюда)(?=$|[\s,.!…])/iu, action: 'invite_approach', actor: 'other', destination: 'speaker' },
  { re: /(?:^|[.!?]\s*)(?:ну\s+)?(?:садись|присядь|присаживайся)\s+(?:же\s+)?(?:ко\s+мне|рядом\s+со\s+мной|на\s+мой\s+подоконник)(?=$|[\s,.!…])/iu, action: 'invite_sit', actor: 'other', destination: 'speaker' },
  // A bare invitation needs the preceding dialogue to locate the seat.
  { re: /^(?:садись|присядь|присаживайся)(?=$|[\s,.!…])/iu, action: 'invite_sit', actor: 'other', destination: 'shared' },
  { re: /(?:^|[.!?]\s*)(?:я\s+)?(?:иду|подойду|пойду)\s+к\s+тебе(?=$|[\s,.!…])/iu, action: 'approach', actor: 'speaker', destination: 'other' },
  { re: /(?:^|[.!?]\s*)я\s+(?:сяду|сажусь|сел|села|устроюсь)\s+рядом\s+с\s+тобой(?=$|[\s,.!…])/iu, action: 'sit_near', actor: 'speaker', destination: 'other' },
  { re: /(?:^|[.!?]\s*)(?:давай\s+)?(?:обниму|обниму-ка)\s+тебя(?=$|[\s,.!…])/iu, action: 'embrace_offer', actor: 'speaker', destination: 'other' }
];

export function explicitSceneActions(text = '', role = 'user') {
  if (!['user','assistant'].includes(role)) return [];
  const input = cleanText(text, 1200);
  // Do not convert a question/hypothesis/negation into an actual movement.
  if (!input || /\b(?:если|а\s+если|может|не\s+(?:иди|садись|подходи))\b/iu.test(input)) return [];
  const head = input.replace(/^(?:нет|да|ага|ладно|ну|конечно)\s*[,!.]?\s*/iu,'');
  const speaker = role === 'user' ? 'user' : 'rin';
  const other = role === 'user' ? 'rin' : 'user';
  const matched = patterns.filter(p => p.re.test(head));
  const specificSit = matched.some(p => p.action === 'invite_sit' && p.destination !== 'shared');
  return matched.filter(p => !(specificSit && p.action === 'invite_sit' && p.destination === 'shared')).map(p => ({
    action: p.action,
    actor: p.actor === 'speaker' ? speaker : other,
    destination: p.destination === 'speaker' ? speaker : p.destination === 'shared' ? 'shared' : other,
    status: p.action.startsWith('invite_') || p.action.endsWith('_offer') ? 'proposed' : 'stated',
    evidence: input.slice(0, 200),
    role
  }));
}

export function recentSceneActions(history = [], userText = '', previousState = null, { sceneChanged = false } = {}) {
  const prior = !sceneChanged && Array.isArray(previousState?.sceneActions) ? previousState.sceneActions : [];
  const recent = (Array.isArray(history) ? history : []).filter(m => ['user','assistant'].includes(m?.role)).slice(sceneChanged ? -2 : -8);
  const observations = [...recent.flatMap(m=> explicitSceneActions(m?.content || '', m.role)), ...explicitSceneActions(userText, 'user')];
  // Recent evidence supersedes a same-action observation but not distinct actions.
  const candidates = [...prior, ...observations];
  const result = [];
  for (const item of candidates) {
    const key = [item.action,item.actor,item.destination].join('|');
    const priorIndex = result.findIndex(x => [x.action,x.actor,x.destination].join('|') === key);
    if (priorIndex >= 0) result.splice(priorIndex, 1);
    result.push(item);
  }
  return result.slice(-5);
}
