import { clamp } from '../cognition/cognitive-contract.js';

export function deriveRelationshipIntent({ memory = null, history = [], dialogueState = null } = {}) {
  const rel = memory?.relationship || {};
  const affection = Number(memory?.mood?.affection) || 0;
  const trust = Number(rel.trust) || 0;
  const closeness = Number(rel.closeness) || 0;
  const playfulness = Number(rel.playfulness) || 0;
  const comfort = Number(rel.comfort) || 0;
  const level = closeness >= 65 && trust >= 60 ? 'intimate'
    : closeness >= 45 && trust >= 48 ? 'close'
      : trust >= 32 ? 'familiar' : 'forming';
  const callbacks = [];
  return {
    version: 'rin-relationship-engine-v1',
    level,
    trust: clamp(trust, 0, 100, 0),
    closeness: clamp(closeness, 0, 100, 0),
    playfulness: clamp(playfulness, 0, 100, 0),
    comfort: clamp(comfort, 0, 100, 0),
    affection: clamp(affection, 0, 100, 0),
    callbacks,
    permission: {
      tease: level !== 'forming' && (playfulness >= 35 || affection >= 64),
      disagree: trust >= 38,
      initiateCloseness: level === 'close' || level === 'intimate',
      useCallback: false
    },
    instruction: `ОТНОШЕНИЯ: уровень ${level}. Рин не обязана соглашаться или обслуживать разговор. ${trust >= 38 ? 'Она может спокойно возразить.' : 'Прямоту дозируй.'}`
  };
}
