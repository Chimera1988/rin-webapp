/** Observed daily-life continuity. No invented completed events or unearned biographical facts. */
import { normalizeLifeDomain, normalizeLifeMotif } from '../life-texture.js';

const clean=(x,max=330)=>String(x??'').replace(/\s+/gu,' ').trim().slice(0,max);
const lower=x=>clean(x,2000).toLowerCase().replace(/ё/gu,'е');
const DOMAINS=[
  ['reading',/(?:чит|книг|роман|рассказ|литератур|чтен|текст для себя)/u,'personal_reading'],
  ['weather',/(?:погод|дожд|осен|солнц|ветер|снег|холод|жар)/u,'seasonal_weather'],
  ['city',/(?:прогуля|прогул|вышла|гулял|улиц|город|парк|пешком)/u,'local_walk'],
  ['work',/(?:редакт|перевод|издател|правк|работ|дедлайн)/u,'editorial_work'],
  ['food',/(?:ужин|обед|завтрак|кухн|поел|готовил|кофе|чай)/u,'everyday_food'],
  ['music',/(?:музык|песн|слуша(?:ю|ет|ешь|ем)\s+(?:музык|песн)|альбом)/u,'music_evening'],
  ['sleep',/(?:сон|спала|поспал|засып|проснул|отдохнула)/u,'sleep_rhythm'],
  ['plans',/(?:план|собира|завтра|хочешь пойти|хотела бы)/u,'plans_today']
];
function fromText(text='') {
  const normalized=lower(text);
  return DOMAINS.find(([,rx])=>rx.test(normalized))||null;
}

const OUTDOOR_REFERENT = /(?:(?:^|[^\p{L}])(?:ты|тебе|у\s+тебя)(?![\p{L}])[^.!?]{0,110}(?:гуля|прогул|вышл|выйт|выход|улиц|на\s+улице|снаруж|парк)|(?:гуляешь|гуляла|погуляла|прогулялась|вышла\s+на\s+улицу|собираешься\s+(?:гуля|выйт)|пойдешь\s+гуля|пойдёшь\s+гуля|выйдешь\s+на\s+улицу)|(?:как\s+там\s+(?:у\s+тебя\s+)?на\s+улице)|(?:(?:твоя|твоей)\s+прогулк)|(?:(?:можешь|хочешь|будешь|решила|планируешь)\s+(?:еще\s+|ещё\s+)?(?:выйти|выходить|гулять|прогуляться)))/iu;
function outdoorWeather(env={}) {
  const source=env.weather||{};
  const desc=clean(source.desc,130).toLowerCase();
  const temp=source.temp===null||source.temp===undefined?null:Number(source.temp);
  const wind=source.wind==null?null:Number(source.wind);
  const valid=Boolean(desc)||(temp!==null&&Number.isFinite(temp))||(wind!==null&&Number.isFinite(wind));
  if (!env.weatherFresh || !valid) return {status:'unavailable',kind:'unknown',outdoor:'unknown',desc:null,temp:null};
  const severe=/(?:гроза|шторм|ураган|ливень|сильн.{0,12}дожд|thunder|storm|heavy rain)/iu.test(desc)||(wind!==null&&Number.isFinite(wind)&&wind>=18);
  const precip=/(?:дожд|морос|снег|метел|rain|drizzle|snow)/iu.test(desc);
  const kind=severe?'severe':precip?'precipitation':wind!==null&&Number.isFinite(wind)&&wind>=10?'windy':temp!==null&&temp>=32?'hot':temp!==null&&temp<=0?'cold':'mild';
  return {status:'fresh',kind,outdoor:severe?'avoid':(precip||kind==='hot'||kind==='cold')?'adapt':'normal',
    desc:desc||null,temp:Number.isFinite(temp)?temp:null,windMs:Number.isFinite(wind)?wind:null};
}
function inspectOutdoorQuestion(question='',life={},environment={}) {
  const addressed=OUTDOOR_REFERENT.test(question);
  const isOutside=['outdoor','mixed'].includes(String(life.activitySetting||''));
  const weather=outdoorWeather(environment);
  if (!addressed) return {asked:false,currentSetting:life.activitySetting||'unknown',weatherStatus:weather.status};
  const retrospective=/(?:уже|успела|вчера|раньше|сходила|ходила|гуляла|погуляла|прогулялась|получилось)/iu.test(question);
  return {asked:true,retrospective,currentSetting:life.activitySetting||'unknown',currentlyOutside:isOutside,
    currentActivity:clean(life.activity,200)||null,weatherStatus:weather.status,weatherKind:weather.kind,
    outdoorSuitability:weather.outdoor,weatherDescription:weather.desc,temperatureC:weather.temp,windMs:weather.windMs??null,
    guidance:weather.status!=='fresh'
      ?'Свежих подтверждённых данных о погоде в Канадзаве нет. Не придумывай температуру, осадки или погоду за окном. Если речь о текущей прогулке — опирайся на установленное занятие; если о прошлой — только на доказанное событие.'
      :retrospective
        ?'Текущая погода относится только к текущему моменту и не доказывает, какой была погода во время прошлой прогулки. Не придумывай завершённый выход и маршрут.'
        :weather.outdoor==='avoid'
          ?'Подтверждена серьёзная непогода. При планировании выхода учитывай опасность и естественную возможность отказаться/перенести. Если Рин уже на улице по фактам состояния, не отрицай выход задним числом — можно искать укрытие или сокращать прогулку без заявления о произошедшем возвращении.'
          :weather.outdoor==='adapt'
            ?'Подтверждены условия, требующие адаптации прогулки. Учитывай их естественно, если отвечаешь о выходе Рин, но не выдавай предложение/план за случившийся выход.'
            :'Погода подтверждена и не требует особого ограничения прогулки. Не утверждай, что Рин уже выходила, если это не подтверждено состоянием.'};
}

function priorAssistantStatements(history=[]){
  return (Array.isArray(history)?history:[]).filter(item=>item?.role==='assistant' && item?.kind!=='silence' && item?.kind!=='sticker')
    .map(item=>clean(item.content,650)).filter(Boolean).slice(-8);
}
export function inspectGroundedLife({kernelState={},userText=''}={}){
  const life=kernelState.innerLife||{};
  const question=clean(userText||kernelState.userText,1300);
  const current=clean(life.activity,240);
  const trace=clean(life.trace,260);
  const focus=clean(life.focus||life.activityGoal,260);
  const carryover=clean(life.carryover,300);
  const statements=priorAssistantStatements(kernelState.recentHistory);
  const topic=fromText(question)||fromText(current)||fromText(statements.at(-1))||null;
  const domain=normalizeLifeDomain(topic?.[0]||'none');
  const motif=domain==='none'?null:normalizeLifeMotif(topic?.[2]);
  const pastWalkQuestion=/(?:получилось|успела|уже|сходила|ходила|погуляла|прогулялась|выбиралась)/u.test(lower(question))
    && /(прогуля|погуля|гуля|выйти|вышла|прошл|выбирал)/u.test(lower(question));
  const pastReadingDetail=/(?:про что|о чем|что за|какую|название|автор|сюжет)/u.test(lower(question))
    && /(чит|книг|роман|рассказ)/u.test(lower(question));
  const pastWalkEvidence=[...statements,carryover,...(life.recentActivities||[]).slice(-5).map(x=>clean(x,220))]
    .filter(x=>/(?:прогуля|погуля|гуляла|вышла.*(?:город|улиц|парк)|прошлась)/u.test(lower(x)));
  const completedWalkEvidence=pastWalkEvidence.filter(x=>!/(?:хочется|собиралась|хотела|планирую|можно|предлагаю|пошла бы|выйти бы)/u.test(lower(x)));
  // current activity may establish she is outdoors, but it is not evidence that the outing is over.
  const knownPastWalk=completedWalkEvidence.length>0;
  const knownReadingDetails=statements.filter(x=>/(?:чит|книг|роман)/u.test(lower(x)) &&
    /(?:называется|автор|рассказ о|книга о|это история|про [а-яё]{4})/iu.test(x)).slice(-2);
  const outdoor=inspectOutdoorQuestion(question,life,kernelState.environment||{});
  const askingWhetherAlreadyOutside=/(?:уже\s+вышла|сейчас\s+(?:на\s+улице|гуляешь)|ты\s+вышла\s+на\s+улицу)/iu.test(question)
    && !/(?:погуляла|прогулялась|сходила|успела\s+погулять)/iu.test(question);
  const currentOutdoorObserved=['outdoor','mixed'].includes(String(life.activitySetting||''));
  const guard=pastWalkQuestion&&!knownPastWalk&&!(currentOutdoorObserved&&askingWhetherAlreadyOutside)?'past_walk_unconfirmed':
    pastReadingDetail&&!knownReadingDetails.length?'reading_content_unspecified':'none';
  return {
    schema:'rin-life-continuity-v3.0.1',domain,motif,
    activity:current||null,trace:trace||null,focus:focus||null,carryover:carryover||null,
    previousClaims:statements.slice(-4),outdoor,
    evidence:{walk:knownPastWalk?completedWalkEvidence.slice(-2):[],reading:knownReadingDetails},
    guard,
    guidance:guard==='past_walk_unconfirmed'
      ?'Подтверждения завершённой прогулки нет. Не говори «да, гуляла» и не придумывай маршрут. Можно сказать, что ещё не успела/не уверена, и выразить желание прогуляться.'
      :guard==='reading_content_unspecified'
        ?'Ранее упоминалось чтение, но книга, автор и сюжет не установлены. Прямо ответь, что конкретное название/тема не назывались, и скажи о предпочтении или впечатлении без выдуманного сюжета. Не повторяй общую фразу «читаю ради удовольствия».'
        :'Сохраняй реальные, уже установленные детали текущего занятия; не выдавай мысли и планы за случившиеся события.'
  };
}
