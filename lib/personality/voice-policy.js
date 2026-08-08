import { assistantTurns, averageRecentLength } from './utils.js';
import { cleanText } from '../cognition/cognitive-contract.js';

const GENERIC = [
  /это (?:очень )?(?:интересно|важно|приятно|здорово|прекрасно)/iu,
  /иногда (?:такие|простые|неожиданные|важно)/iu,
  /это созда[её]т (?:особую )?(?:атмосфер|связ|тепл)/iu,
  /главное —/iu,
  /настоящ(?:ая|ую) связь/iu,
  /может (?:помочь|быть) .* в жизни/iu,
  /мне приятно (?:это )?(?:слышать|знать)/iu,
  /надеюсь, у тебя тоже/iu
];
function recentGenericPhrases(history=[]){
  const recent=assistantTurns(history).slice(-8).map(x=>cleanText(x.content,1200));
  return GENERIC.filter(re=>recent.some(t=>re.test(t))).map(re=>re.source).slice(0,5);
}
export function deriveVoicePolicy({history=[],userText='',affectiveTurn=null,conversationBrain=null,isLong=false}={}){
  const scene=conversationBrain?.activeScene?.type||'everyday';
  const emotion=affectiveTurn?.emotionalState?.primary?.type||'neutral';
  const avg=averageRecentLength(history,4);
  return {
    version:'rin-voice-policy-v1',
    register:'private_chat', scene, emotion,
    brevity:isLong?'expanded':avg>360?'compact':'natural',
    warmth:Number(affectiveTurn?.emotionalState?.warmth)||0,
    avoidGeneric:recentGenericPhrases(history),
    userText:cleanText(userText,500),
    principles:[
      'сначала конкретная реакция или ответ, затем максимум одна дополнительная личная мысль',
      'говорить от первого лица Рин, а не формулировать универсальные правила жизни',
      'не хвалить пользователя автоматически и не оценивать сам разговор вместо участия в нём',
      'не повторять структуру предыдущих двух ответов',
      'в тёплой сцене лучше жест, выбор, маленькая реакция или конкретная деталь, чем объяснение ценности тепла',
      'если мысль закончена — остановиться; вопрос не является обязательным окончанием'
    ]
  };
}
export function voicePolicyInstruction(policy={},plan={}){
  return [
    'VOICE POLICY v1 — ЕДИНСТВЕННЫЙ АКТИВНЫЙ СТИЛЕВОЙ КОНТУР',
    `Регистр: личный чат; сцена: ${policy.scene||'everyday'}; длина: ${plan.length||policy.brevity||'short'}; бюджет вопросов: ${Number(plan.questionBudget)||0}.`,
    ...(policy.principles||[]).map(x=>`- ${x}`),
    policy.avoidGeneric?.length?'- В недавних ответах уже были шаблонные обобщения. Сейчас особенно избегай «это важно/приятно/интересно», «иногда такие моменты», «это создаёт особую атмосферу», если вместо этого можно сказать конкретно.':'',
    plan.responseAct==='state_personal_view'?'- Личная позиция должна быть конкретным «я думаю/я бы выбрала/мне не нравится», а не философским выводом.':'',
    plan.responseAct==='close_warmly'?'- Закрытие короткое: не открывай новую тему и не формулируй пожелание как сервисный шаблон.':'',
    Number(plan.questionBudget)===0?'- Вопросительных предложений нет.':'- Разрешён максимум один вопрос, и только по причине RESPONSE PLAN.'
  ].filter(Boolean).join('\n');
}
