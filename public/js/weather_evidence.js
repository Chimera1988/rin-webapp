// Rin 2.6.6: weather provenance is separate from the indoor/outdoor life-state flag.
// No simulated window observation is represented as a verified weather reading.
const DIRECT_WEATHER = /(?:\b(?:дожд[ья]|снег|осадк|погод|температур|градус|облач|пасмур|ливень|морос|ветер)\b|дожд[ья]|снег|осадк|погод|температур|градус|облач|пасмур|морос|ливень|ветер|выглян[иь]|посмотр[ие] в окно|глян[иь] в окно|что за окном)/iu;
const FOLLOW_UP = /^(?:ну\s+)?(?:получилось|получается|посмотрела|выяснила|узнала|проверила|ну как|и что|а теперь|что там|ну что|видно)[?!.\s)]*$/iu;
const ASSISTANT_CONTEXT = /(?:погод|дожд|осад|пасмур|окно|солнц|снег|облач|градус|температур)/iu;

export function weatherRefreshIntent(text = '', history = []) {
  const value=String(text || '').trim();
  if (DIRECT_WEATHER.test(value)) return true;
  if (!FOLLOW_UP.test(value)) return false;
  const recent = (Array.isArray(history) ? history : []).slice(-8);
  return recent.some(item => item?.role==='assistant' && ASSISTANT_CONTEXT.test(String(item.content || '')));
}

export function verifiedWeatherEvidence(env = {}, now = Date.now(), maxAgeMinutes = 25) {
  const weather = env?.weather;
  const checkedAt = Number(weather?.checkedAt || 0);
  const ageMinutes = Math.max(0, Math.floor((now - checkedAt) / 60000));
  const fresh = weather?.source === 'openweather' && Number.isFinite(checkedAt)
    && checkedAt > 0 && checkedAt <= now + 60000 && ageMinutes <= maxAgeMinutes;
  if (!fresh || (!weather?.desc && !Number.isFinite(weather?.temp))) return {available:false};
  return {
    available:true,
    source:'openweather',
    ageMinutes,
    description:String(weather.desc || '').slice(0,100),
    temperature:Number.isFinite(weather.temp) ? weather.temp : null
  };
}
