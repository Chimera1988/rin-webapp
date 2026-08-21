const clamp = (value, min = 0, max = 100, fallback = 50) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
};
const lower = value => String(value ?? '').toLowerCase().trim();

function emotionType(affectiveTurn = null, state = null) {
  return lower(
    affectiveTurn?.emotionalState?.primary?.type
      || state?.emotion?.primary?.type
      || state?.emotion?.type
      || ''
  );
}

export function buildDriveState({ state = null, affectiveTurn = null, behaviorState = null, brain = null } = {}) {
  const relationship = affectiveTurn?.relationshipState || state?.relationship || {};
  const mood = affectiveTurn?.moodState || state?.mood || {};
  const emotion = affectiveTurn?.emotionalState || state?.emotion || {};
  const primary = emotionType(affectiveTurn, state);
  const scene = lower(brain?.activeScene?.type || state?.scene?.type || 'everyday');
  const hidden = lower(brain?.hiddenIntent?.type || '');

  const closeness = clamp(relationship.closeness, 0, 100, 45);
  const comfort = clamp(relationship.comfort, 0, 100, 50);
  const respect = clamp(relationship.respect, 0, 100, 60);
  const playfulnessRel = clamp(relationship.playfulness, 0, 100, 45);
  const attraction = clamp(relationship.attraction, 0, 100, 35);
  const affection = clamp(mood.affection, 0, 100, 60);
  const energy = clamp(mood.energy, 0, 100, 60);
  const tension = clamp(emotion.tension, 0, 100, 0);
  const warmth = clamp(emotion.warmth, 0, 100, affection);
  const questionRestraint = clamp(behaviorState?.question?.restraint, 0, 100, 0);
  const spacePressure = clamp(behaviorState?.space?.pressure, 0, 100, 0);

  let curiosity = 54 + energy * 0.14 + closeness * 0.08;
  if (['reflective', 'playful_flirt', 'romance'].includes(scene)) curiosity += 7;
  if (['user_distress', 'hurt', 'irritation', 'jealousy'].includes(primary)) curiosity -= 5;
  // Restraint does not erase curiosity; it suppresses turning curiosity into questions.
  curiosity = clamp(curiosity, 0, 100, 58);

  let connection = 28 + closeness * 0.30 + comfort * 0.18 + warmth * 0.18;
  if (['seek_closeness', 'relationship_reassurance', 'bid_for_reassurance'].includes(hidden)) connection += 10;
  connection = clamp(connection, 0, 100, 58);

  let playfulness = playfulnessRel * 0.58 + attraction * 0.12 + energy * 0.12 + 8;
  if (['playfulness', 'playful_irritation', 'shyness'].includes(primary) || scene === 'playful_flirt') playfulness += 16;
  if (tension > 55 && !['playful_irritation', 'jealousy'].includes(primary)) playfulness -= 18;
  playfulness = clamp(playfulness, 0, 100, 48);

  let selfRespect = 42 + respect * 0.40 + tension * 0.12;
  if (['hurt', 'irritation', 'disappointment'].includes(primary)) selfRespect += 13;
  selfRespect = clamp(selfRespect, 0, 100, 68);

  let autonomy = 48 + energy * 0.12 + (state?.activeIntent?.status === 'active' ? 15 : 0);
  if (hidden === 'invite_rin_initiative') autonomy += 18;
  autonomy = clamp(autonomy, 0, 100, 58);

  const needForSpace = clamp(Math.max(spacePressure, tension * 0.65 + (primary === 'hurt' ? 18 : 0)), 0, 100, 10);
  const expression = clamp(32 + energy * 0.24 + Math.abs(Number(emotion?.primary?.intensity || 0)) * 0.28 + playfulness * 0.12, 0, 100, 55);
  const questionImpulse = clamp(curiosity * 0.72 + connection * 0.18 - questionRestraint * 0.92 - spacePressure * 0.55, 0, 100, 35);

  return {
    schema: 'rin-drive-state-v1',
    curiosity,
    connection,
    playfulness,
    selfRespect,
    autonomy,
    needForSpace,
    expression,
    questionImpulse,
    questionRestraint,
    note: behaviorState?.question?.strongNoQuestion
      ? 'Любопытство может оставаться высоким, но граница пользователя блокирует превращение его в расспрос.'
      : null
  };
}
