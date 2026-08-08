import { isTextTurn } from '../chat-contract.js';
import { normalizeInnerLife } from '../inner-life-contract.js';

function normalize(value,max=240){return String(value||'').replace(/\s+/g,' ').trim().slice(0,max);}

// Server-side Inner Life is READ ONLY. The persisted browser diary is the sole
// owner that advances activity/time. This module only exposes that committed
// state to generation; it never invents a fallback activity.
export function buildInnerLifeSnapshot(memory=null, env=null, userText='', history=[]) {
  const stored=normalizeInnerLife(memory?.innerLife || {});
  if (!stored.activity) return { ...stored, directQuestion:false, alreadyMentioned:false, spontaneousAllowed:false, activityAgeMinutes:null };
  const now=Date.now();
  const directQuestion=/(что ты (сейчас )?делаешь|чем (ты )?(сейчас )?занимаешься|как проходит твой день|что у тебя сейчас|как твой день|что читаешь|что за книг)/iu.test(String(userText||''));
  const recentAssistant=(Array.isArray(history)?history:[]).filter(x=>x?.role==='assistant'&&isTextTurn(x)).slice(-4).map(x=>String(x.content||'')).join(' ');
  const alreadyMentioned=stored.activity.split(/\s+/).filter(x=>x.length>5).some(word=>recentAssistant.toLowerCase().includes(word.toLowerCase()));
  const activityAgeMinutes=stored.startedAt?Math.max(0,Math.round((now-stored.startedAt)/60000)):null;
  return { ...stored, activityAgeMinutes, directQuestion, alreadyMentioned, spontaneousAllowed:!directQuestion&&!alreadyMentioned&&(!stored.lastSpontaneousAt||now-stored.lastSpontaneousAt>45*60000) };
}

export function innerLifeInstruction(snapshot={}) {
  if (!snapshot.activity) return 'ВНУТРЕННЯЯ ЖИЗНЬ РИН: сохранённого текущего занятия нет. Не придумывай занятие, книгу, место, событие или бытовую деталь ради живости.';
  return [
    'ВНУТРЕННЯЯ ЖИЗНЬ РИН — PERSISTED SOURCE OF TRUTH',
    `Текущее занятие: ${snapshot.activity}.`,
    snapshot.trace?`Текущий след: ${snapshot.trace}.`:'', snapshot.focus?`Фокус: ${snapshot.focus}.`:'', snapshot.activityGoal?`Локальная цель занятия: ${snapshot.activityGoal}.`:'',
    snapshot.thought?`Фоновая мысль: ${snapshot.thought}.`:'', snapshot.activityAgeMinutes!=null?`Состояние длится примерно ${snapshot.activityAgeMinutes} мин.; число не называй.`:'',
    snapshot.directQuestion?'Пользователь прямо спросил о занятии: ответь конкретно только из перечисленных деталей. Если он просит название/имя/место, которого здесь нет, прямо не выдумывай его.':snapshot.spontaneousAllowed?'Можно при естественной связи оставить один короткий след этого состояния; не вставляй его обязательно.':'Не упоминай занятие без причины.',
    'Нельзя конкретизировать сохранённую общую деятельность несуществующими именами: без переданного названия книга остаётся неназванной, без места прогулка не получает вымышленный адрес, без события не появляется случайная биографическая история.'
  ].filter(Boolean).join('\n');
}
