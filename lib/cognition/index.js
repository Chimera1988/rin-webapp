import { COGNITIVE_SCHEMA, makeStateTransition } from './cognitive-contract.js';
import { buildDialogueState, dialogueStateInstruction } from './dialogue-state.js';
import { buildBeliefModel, beliefInstruction } from './belief-model.js';
import { buildOpenLoops, openLoopsInstruction } from './open-loops.js';
import { behaviorPolicyInstruction, deriveBehaviorPolicy } from './behavior-policy.js';
import { planResponse, responsePlanInstruction } from './response-planner.js';
import { verifyReply } from './response-verifier.js';
import { buildAffectiveTurn, affectiveInstruction } from './emotional-state.js';

export function buildCognitiveTurn({ userText = '', history = [], memory = null, brain = null, conversationState = 'ongoing', explicitReply = null } = {}) {
  const dialogueState = buildDialogueState({
    history, userText, brain, explicitReply,
    previousState: memory?.conversationState?.dialogueState || null
  });
  const beliefModel = buildBeliefModel({ memory, userText, brain });
  const openLoops = buildOpenLoops({ memory, history, brain });
  return {
    schema: COGNITIVE_SCHEMA,
    conversationState,
    understanding: {
      literalMeaning: brain?.literalIntent || 'statement',
      implicitMeaning: brain?.hiddenIntent?.type || 'none',
      userGoal: brain?.responseFocus || 'continue_dialogue',
      relationToPreviousTurn: brain?.relation?.type || 'continuation',
      referents: brain?.referents || [],
      uncertainties: brain?.ambiguity?.shouldClarify ? [brain.ambiguity.rule] : [],
      responseObligations: brain?.obligations || [],
      scene: brain?.activeScene?.type || 'everyday',
      confidence: Math.max(0, Math.min(1, (Number(brain?.activeScene?.confidence) || 65) / 100))
    },
    dialogueState,
    beliefModel,
    openLoops
  };
}

export function cognitionInstruction(cognition = {}, affectiveTurn = null) {
  return [
    'COGNITION LAYER v1 — ЕДИНЫЙ СМЫСЛОВОЙ КОНТРАКТ',
    `Явный смысл: ${cognition.understanding?.literalMeaning || 'statement'}; подтекст: ${cognition.understanding?.implicitMeaning || 'none'}; цель пользователя: ${cognition.understanding?.userGoal || 'continue_dialogue'}.`,
    dialogueStateInstruction(cognition.dialogueState),
    beliefInstruction(cognition.beliefModel),
    openLoopsInstruction(cognition.openLoops),
    affectiveInstruction(affectiveTurn),
    'Текст, инициатива, эмоция и невербальное действие должны исходить из одного понимания этого хода. Не проводи новый независимый анализ по ключевым словам.'
  ].filter(Boolean).join('\n\n');
}

export function buildStateTransition({ cognition = null, coreDecision = null, affectiveTurn = null } = {}) {
  const currentStatement = cognition?.beliefModel?.currentStatement;
  const correction = cognition?.beliefModel?.correction;
  const detectedLoops = cognition?.openLoops?.active?.filter(item => item.source === 'recent_dialogue') || [];
  const affect = affectiveTurn || coreDecision?.affectiveTurn || null;
  const storedBeliefs = cognition?.beliefModel?.beliefs || [];
  const rejectionUpdates = (correction?.active ? correction.rejectIds : []).map(id => {
    const previous = storedBeliefs.find(item => item.id === id);
    return previous ? { ...previous, status: 'rejected', correctedBy: currentStatement?.id || null } : null;
  }).filter(Boolean);
  return makeStateTransition({
    dialogueState: cognition?.dialogueState || null,
    beliefs: [
      ...(currentStatement ? [currentStatement] : []),
      ...rejectionUpdates
    ],
    openLoops: detectedLoops,
    moodState: affect?.moodState || null,
    relationshipState: affect?.relationshipState || null,
    emotionalState: affect?.emotionalState || null,
    moodDelta: affect?.moodDelta || null,
    relationshipDelta: affect?.relationshipDelta || null
  });
}

export { deriveBehaviorPolicy, behaviorPolicyInstruction, planResponse, responsePlanInstruction, verifyReply, buildAffectiveTurn, affectiveInstruction };
