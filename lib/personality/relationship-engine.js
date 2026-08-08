import { clamp } from '../cognition/cognitive-contract.js';
import { normalizeRelationshipState } from '../affective-contract.js';

export function deriveRelationshipIntent({ memory = null, history = [], dialogueState = null, affectiveTurn = null } = {}) {
  const rel = normalizeRelationshipState(affectiveTurn?.relationshipState || memory?.relationship || {});
  const affection = Number(affectiveTurn?.moodState?.affection ?? memory?.mood?.affection) || 0;
  const trust = Number(rel.trust) || 0;
  const closeness = Number(rel.closeness) || 0;
  const playfulness = Number(rel.playfulness) || 0;
  const comfort = Number(rel.comfort) || 0;
  const attraction = Number(rel.attraction) || 0;
  const vulnerability = Number(rel.vulnerability) || 0;
  const affect = affectiveTurn?.emotionalState || memory?.conversationState?.emotionalState || null;
  const level = closeness >= 65 && trust >= 60 ? 'intimate'
    : closeness >= 45 && trust >= 48 ? 'close'
      : trust >= 32 ? 'familiar' : 'forming';
  const playfulMomentum = affect?.momentum?.direction === 'playful';
  const tenseMomentum = ['tense', 'cooling'].includes(affect?.momentum?.direction);

  return {
    version: 'rin-relationship-engine-v2-hysteresis',
    level,
    trust: clamp(trust, 0, 100, 0),
    closeness: clamp(closeness, 0, 100, 0),
    playfulness: clamp(playfulness, 0, 100, 0),
    comfort: clamp(comfort, 0, 100, 0),
    attraction: clamp(attraction, 0, 100, 0),
    vulnerability: clamp(vulnerability, 0, 100, 0),
    affection: clamp(affection, 0, 100, 0),
    dynamic: rel.recentDynamic || null,
    permission: {
      tease: level !== 'forming' && (playfulMomentum || playfulness >= 35 || affection >= 64),
      disagree: trust >= 38,
      initiateCloseness: (level === 'close' || level === 'intimate') && !tenseMomentum,
      flirt: attraction >= 34 && comfort >= 38 && !tenseMomentum,
      beVulnerable: trust >= 52 && vulnerability >= 30,
      useCallback: false
    },
    instruction: [
      `ОТНОШЕНИЯ: уровень ${level}; текущая динамика ${rel.recentDynamic?.lastSignal || 'neutral'}.`,
      tenseMomentum ? 'Между ними есть активное напряжение: не изображай безусловную близость до разрешения причины.' : '',
      playfulMomentum ? 'Игровая динамика уже начата: Рин может уверенно продолжить её без нового разрешения.' : '',
      trust >= 38 ? 'Рин может спокойно возразить и иметь собственную позицию.' : 'Прямоту дозируй.',
      'Отношения меняются медленно: одна реплика не должна превращать знакомство в любовь или полностью разрушать накопленное доверие.'
    ].filter(Boolean).join(' ')
  };
}
