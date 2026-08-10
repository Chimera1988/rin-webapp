import { cleanText } from './cognitive-contract.js';

function collect(value,out=[]){
 if(value==null)return out;
 if(typeof value==='string'||typeof value==='number'||typeof value==='boolean'){const t=cleanText(value,1200);if(t)out.push(t);return out;}
 if(Array.isArray(value)){for(const x of value.slice(0,80))collect(x,out);return out;}
 if(typeof value==='object'){for(const x of Object.values(value))collect(x,out);}
 return out;
}
function norm(v=''){return cleanText(v,3000).toLowerCase();}

// Only facts that are actual provenance may enter the reality corpus. Reference
// dialogues, voice rules and character behavior are guidance, never biography.
export function canonicalProfileFacts(profile=null){
 const prompt=profile?.prompt_profile||{};
 const identity=prompt.identity||{};
 return [
   identity.full_name, identity.name_japanese, identity.location, identity.birthplace, identity.nationality
 ].map(x=>cleanText(x,500)).filter(Boolean);
}

export function buildRealityBoundary({profile=null,memory=null,lore=null,userText='',history=[]}={}){
 const canonical=[
   ...canonicalProfileFacts(profile),
   ...collect(memory?.facts?.self||{}),
   ...collect(memory?.facts?.world||{}),
   ...collect(lore?.canon||{}),
   ...collect(lore?.memories||{}),
   ...collect(lore?.backstory||{})
 ];
 const currentInner=memory?.innerLife&&typeof memory.innerLife==='object'?memory.innerLife:{};
 const inner=[currentInner.activity,currentInner.trace,currentInner.focus,currentInner.activityGoal,currentInner.privateThought].map(x=>cleanText(x,300)).filter(Boolean);
 const recentUser=(Array.isArray(history)?history:[]).filter(x=>x?.role==='user').slice(-4).map(x=>cleanText(x.content,500));
 const imagination=/(представь|если бы|вообраз|фантаз|в другом мире|волшебн|таинственн.*мир|как будто мы|могли бы)/iu.test(`${userText} ${recentUser.join(' ')}`);
 return {
   version:'rin-reality-boundary-v2',
   mode:imagination?'shared_imagination':'reality',
   canonicalText:norm(canonical.join(' | ')),
   innerLifeText:norm(inner.join(' | ')),
   rules:[
     'Reference dialogue, voice/personality rules и прошлые ответы Рин не являются доказательством её биографии.',
     'Конкретное имя, название книги/фильма, адрес, родственник, клиент, поездка или прошлое событие Рин допустимы только если присутствуют в реально переданном canon/memory/lore.',
     'Inner Life можно описывать только с переданными деталями; общую деятельность нельзя конкретизировать новым собственным именем.',
     'Shared imagination должна оставаться маркированной как представление/условность и не переносится в биографические факты.'
   ]
 };
}
export function realityBoundaryInstruction(boundary={}){
 return [
   'REALITY BOUNDARY v2 — КАНОН / ПАМЯТЬ / ВООБРАЖЕНИЕ',
   `Режим текущей сцены: ${boundary.mode||'reality'}.`,
   ...(boundary.rules||[]).map(x=>`- ${x}`),
   boundary.mode==='shared_imagination'?'- Можно свободно совместно фантазировать, но используй условные маркеры «я бы», «представляю», «там могло бы быть» и не выдавай фантазию за реальное прошлое Рин.':'- Реальные автобиографические детали Рин должны иметь источник. Если конкретики нет — не заполняй пробел красивой выдумкой.'
 ].join('\n');
}
export function unsupportedAutobiographicalClaim(reply='',boundary={}){
 const text=cleanText(reply,4000); const lower=text.toLowerCase(); const corpus=`${boundary.canonicalText||''} ${boundary.innerLifeText||''}`;
 const title=[...text.matchAll(/[«"]([^»"]{3,80})[»"]/gu)].map(m=>m[1].toLowerCase());
 for(const value of title){ if(/(?:книг|роман|фильм|песн|истори|читаю|читала|смотрю|смотрела|слушаю|слушала)/iu.test(lower) && !corpus.includes(value)) return {type:'unsupported_named_self_detail',detail:value}; }
 const autobiographical=/(?:однажды я|когда я (?:была|жила|училась|ездила|шла)|я (?:села не|поехала|нашла парк|встретила|познакомилась|работала с|жила в)|у меня (?:был|была|были)\s+(?:клиент|друг|подруга|учитель|сосед))/iu.test(text);
 if(autobiographical){
   const distinctive=norm(text).split(/[^\p{L}\p{N}]+/u).filter(x=>x.length>=6).slice(0,10);
   const overlap=distinctive.filter(x=>corpus.includes(x)).length;
   if(overlap<3) return {type:'unsupported_rin_autobiographical_claim',detail:'past_event_without_source'};
 }
 if(boundary.mode!=='shared_imagination' && /(?:я жила|я родилась|моя сестра|мой брат|мои родители|мой клиент)/iu.test(text)) {
   const key=norm(text).split(/[^\p{L}\p{N}]+/u).filter(x=>x.length>=5).find(x=>corpus.includes(x));
   if(!key) return {type:'unsupported_rin_autobiographical_claim',detail:'identity_without_source'};
 }
 return null;
}
