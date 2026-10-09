const RE_TIME = /(?:который\s+час|сколько\s+(?:у\s+тебя\s+)?времени|которое\s+время|во\s+сколько\s+у\s+тебя|время\s+в\s+канадзаве)/iu;
const RE_WEATHER = /(?:какая[^?]*погода|что там с погодой|как[^?]*погода|сколько[^?]*градус|ид[её]т ли[^?]*(?:дождь|снег)|(?:холодно|тепло|жарко|дождь|снег)[^?]*у тебя)/iu;

export function environmentIntent(text = '') {
  const value = String(text || '').trim();
  if (RE_TIME.test(value)) return 'time';
  if (RE_WEATHER.test(value)) return 'weather';
  return null;
}

export function shouldRefreshEnvironment(text = '') {
  return environmentIntent(text) !== null;
}
