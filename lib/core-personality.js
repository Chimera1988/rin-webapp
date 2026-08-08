import { detectUserEmotion, deriveMood, chooseMoodMode } from './personality/mood.js';
import { chooseIntent } from './personality/speech.js';
import { deriveEmotionalResponse } from './personality/emotional-response.js';
import { buildAffectiveTurn } from './cognition/emotional-state.js';
import { deriveVoicePolicy } from './personality/voice-policy.js';

// Personality Core no longer composes several independent style engines. It owns
// only transient character colour + nonverbal affect. Conversation action comes
// from BehaviorPolicy; final wording comes from the single VoicePolicy.
export function buildCoreDecision({ userText='', history=[], memory=null, conversationState='ongoing', isLong=false, conversationBrain=null, affectiveTurn=null }={}) {
  const userEmotion=detectUserEmotion(userText);
  const effectiveAffectiveTurn=affectiveTurn || buildAffectiveTurn({userText,history,memory,brain:conversationBrain});
  const state=deriveMood({memory,userEmotion,history,affectiveTurn:effectiveAffectiveTurn});
  const mode=chooseMoodMode(state,userEmotion);
  const intent=chooseIntent(userText,userEmotion,state,conversationState,conversationBrain);
  const emotionalResponse=deriveEmotionalResponse({userText,userEmotion,intent,state,history,conversationBrain,affectiveTurn:effectiveAffectiveTurn});
  const voicePolicy=deriveVoicePolicy({history,userText,affectiveTurn:effectiveAffectiveTurn,conversationBrain,isLong});
  return {
    version:'vNext-unified-voice', userEmotion, state, mode, intent,
    replyStyle:isLong?'expanded':voicePolicy.brevity, deliveryStyle:'voice_policy', discourseMode:'response_plan_owned',
    habits:{legacyInactive:true}, character:{legacyInactive:true}, microReaction:null, humanizer:{legacyInactive:true}, recentRhythm:{legacyInactive:true},
    adviceGuard:{legacyInactive:true}, foreignGuard:{legacyInactive:true},
    affectiveTurn:effectiveAffectiveTurn, emotionalResponse, nonverbalAction:emotionalResponse.nonverbalAction||null,
    voicePolicy, habit:null, targetLength:isLong?'развёрнуто':'обычно 1–3 предложения', conversationBrain,
    reason:`единый VoicePolicy; emotion=${effectiveAffectiveTurn?.emotionalState?.primary?.type||'none'}; mode=${mode}`,
    prompt:'PERSONALITY CORE vNext: действие и инициатива принадлежат RESPONSE PLAN; формулировка принадлежит VOICE POLICY. Старые habits/micro/humanizer/rhythm не являются активными источниками решения.'
  };
}
