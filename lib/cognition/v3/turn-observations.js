/** Read-only observational facade. No behavioral output, instruction or pressure policy. */
import { inspectSceneClosure, inspectVocativeRhythm, inspectMotifNovelty } from '../behavior-state.js';
import { inspectLifeNovelty } from '../life-texture.js';

export function observeTurn({userText='',history=[],brain=null,memory=null}={}){
  const text=String(userText||'');
  const dialogue=memory?.conversationState?.dialogueState||{};
  const {guidance:unusedSceneGuidance,...sceneClosure}=inspectSceneClosure(history,text,brain);
  const explicitNoQuestions=/(?:не\s+(?:надо|нужно|хочу|задавай|спрашивай|расспрашивай)[^.!?]{0,30}(?:вопрос|спрашив|расспрашив)|без\s+вопросов|не\s+задавай\s+вопросов)/iu.test(text);
  const explicitSpace=/(?:оставь\s+меня\s+в\s+покое|не\s+пиши\s+мне|дай\s+мне\s+побыть\s+одному|мне\s+нужно\s+побыть\s+одному)/iu.test(text);
  const recentMotifs=inspectMotifNovelty(dialogue.recentMotifs||[]);
  const lifeNovelty=inspectLifeNovelty(dialogue.recentLifeBeats||[]);
  const {guidance:unusedVocativeGuidance,...vocative}=inspectVocativeRhythm(history,text);
  return {schema:'rin-turn-observations-v3',sceneClosure,
    question:{strongNoQuestion:explicitNoQuestions},
    space:{strongBoundary:explicitSpace},
    novelty:{pressure:Number(recentMotifs.pressure)||0},
    lifeNovelty:{pressure:Number(lifeNovelty.pressure)||0},
    vocative,literalCorrection:{explicit:brain?.relation?.type==='correction'},
    frameAlignment:'aligned'};
}
