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
   ...collect(lore?.backstory||{}),
   ...collect((Array.isArray(memory?.establishedLifeChoices) ? memory.establishedLifeChoices : []).map(x=>x.text||''))
 ];
 const currentInner=memory?.innerLife&&typeof memory.innerLife==='object'?memory.innerLife:{};
 const inner=[currentInner.activity,currentInner.trace,currentInner.focus,currentInner.activityGoal,currentInner.sleepPhase,currentInner.sleepCarryover,currentInner.weatherContext].map(x=>cleanText(x,360)).filter(Boolean);
 const recentUser=(Array.isArray(history)?history:[]).filter(x=>x?.role==='user').slice(-4).map(x=>cleanText(x.content,500));
 const recentSelfChoices=(Array.isArray(history)?history:[]).filter(x=>x?.role==='assistant')
   .slice(-12).map(x=>cleanText(x.content,800))
   .filter(x=>/(?:выбрала|начала|начинаю|решила|читаю|слушаю|смотрю).{0,90}[«"][^»"]{3,80}[»"]/iu.test(x));
 const imagination=/(представь|если бы|вообраз|фантаз|в другом мире|волшебн|таинственн.*мир|как будто мы|могли бы)/iu.test(`${userText} ${recentUser.join(' ')}`);
 return {
   version:'rin-reality-boundary-v2',
   mode:imagination?'shared_imagination':'reality',
   canonicalText:norm(canonical.join(' | ')),
   innerLifeText:norm([...inner, ...recentSelfChoices].join(' | ')),
   rules:[
     'Reference dialogue, voice/personality rules и прошлые ответы Рин не являются доказательством её биографии.',
     'Конкретная биография, адрес, родственники, клиенты, прошлые поездки/события требуют источника. Новую реальную книгу, фильм или музыку Рин может выбрать в настоящем впервые сама, не приписывая себе прежний опыт.',
     'Inner Life допускает новый конкретный текущий выбор, но уже установленное занятие нельзя без объяснения переименовать задним числом. Не приписывай завершённые действия без следа в истории.',
     'Shared imagination должна оставаться маркированной как представление/условность и не переносится в биографические факты.'
   ]
 };
}
export function unsupportedAutobiographicalClaim(reply='',boundary={}){
 const text=cleanText(reply,4000); const corpus=`${boundary.canonicalText||''} ${boundary.innerLifeText||''}`;
  // New real titles selected in the present are not biographical inventions.
  // An ungrounded assertion of having consumed a named work in the past remains guarded.
  const pastNamedMedia = [...text.matchAll(/(?:^|[^\p{L}])(?:я\s+)?(?:читала|прочитала|смотрела|посмотрела|слушала|послушала)\s+(?:(?:книгу|роман|фильм|песню|песни|альбом|этот|эту)\s+){0,3}[«"]([^»"]{3,80})[»"]/giu)]
    .map(match => match[1].toLowerCase());
  for (const value of pastNamedMedia) if (!corpus.includes(value))
    return { type:'unsupported_named_self_detail', detail:value };
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
