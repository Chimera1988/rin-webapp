import { COGNITIVE_SCHEMA, makeStateTransition } from './cognitive-contract.js';
import { buildDialogueState, dialogueStateInstruction } from './dialogue-state.js';
import { buildBeliefModel, beliefInstruction } from './belief-model.js';
import { buildOpenLoops, openLoopsInstruction } from './open-loops.js';
import { planResponse, responsePlanInstruction } from './response-planner.js';
import { verifyReply } from './response-verifier.js';

export function buildCognitiveTurn({ userText = '', history = [], memory = null, brain = null, conversationState = 'ongoing', explicitReply = null } = {}) {
  const dialogueState = buildDialogueState({ history, userText, brain, explicitReply });
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

export function cognitionInstruction(cognition = {}) {
  return [
    'COGNITION LAYER v1 — ЕДИНЫЙ СМЫСЛОВОЙ КОНТРАКТ',
    `Явный смысл: ${cognition.understanding?.literalMeaning || 'statement'}; подтекст: ${cognition.understanding?.implicitMeaning || 'none'}; цель пользователя: ${cognition.understanding?.userGoal || 'continue_dialogue'}.`,
    dialogueStateInstruction(cognition.dialogueState),
    beliefInstruction(cognition.beliefModel),
    openLoopsInstruction(cognition.openLoops),
    'Текст, инициатива, эмоция и невербальное действие должны исходить из одного понимания этого хода. Не проводи новый независимый анализ по ключевым словам.'
  ].filter(Boolean).join('\n\n');
}

export function buildStateTransition({ cognition = null, coreDecision = null } = {}) {
  const emotional = coreDecision?.emotionalResponse;
  const action = coreDecision?.nonverbalAction;
  const emotionalTrace = emotional && emotional.feltEmotion && emotional.feltEmotion !== 'neutral'
    ? {
        emotion: emotional.feltEmotion,
        cause: action?.cause || emotional.cause || emotional.trigger || '',
        intensity: action?.intensity || emotional.intensity || 40,
        resolution: emotional.resolution || 'unresolved',
        expiresAfterTurns: action?.expiresAfterTurns || 4
      }
    : null;
  const currentStatement = cognition?.beliefModel?.currentStatement;
  const detectedLoops = cognition?.openLoops?.active?.filter(item => item.source === 'recent_dialogue') || [];
  return makeStateTransition({
    beliefs: currentStatement ? [currentStatement] : [],
    openLoops: detectedLoops,
    emotionalTrace
  });
}

export { planResponse, responsePlanInstruction, verifyReply };
