// Rin Stickers v4 — смысловая двухканальная система.
// Выбирает стикер как реакцию на пользователя или как выражение ответа Рин.

const STORE_KEY = 'rin-stickers-v4-stats';
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const low = s => String(s || '').toLowerCase();
const hasAny = (text, list=[]) => list.some(x => low(text).includes(low(x)));

function loadStats(){
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{"recent":[],"messagesSince":999,"sent":0,"turns":0}'); }
  catch { return { recent:[], messagesSince:999, sent:0, turns:0 }; }
}
function saveStats(s){ try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch {} }

export async function loadStickerConfig(url='/data/stickers-v4.json'){
  const r = await fetch(url, {cache:'no-store'});
  if(!r.ok) throw new Error(`Failed to load stickers-v4.json: ${r.status}`);
  const cfg = await r.json();
  if(cfg?._schema !== 'v4') throw new Error('Unexpected stickers schema');
  return cfg;
}

function signals(userText, replyText){
  const u=low(userText), r=low(replyText), both=`${u}\n${r}`;
  const farewell = hasAny(u,['пока','отойд','вернусь','до скорого','до завтра','спокойной ночи','не скучай']);
  const greeting = hasAny(u,['привет','доброе утро','добрый вечер','доброй ночи']);
  const kiss = hasAny(both,['целую','поцелуй','чмок','😘','💋']);
  const hug = hasAny(both,['обним','объят','🤗']);
  const flirt = hasAny(both,['красивая','милая','нравишься','люблю','соскуч','флирт','не скучай','❤️','😉','😘']);
  const praise = hasAny(u,['умница','молодец','горжусь','восхищаюсь','прекрасно','шикарно','красавица']);
  const thanks = hasAny(both,['спасибо','благодар']);
  const apology = hasAny(both,['прости','извини','виноват','сожалею']);
  const agreement = hasAny(both,['согласен','согласна','точно','верно','давай так','хорошо','ладно']);
  const tired = hasAny(both,['устал','устала','вымот','хочу спать','сонн','отдохну','перерыв']);
  const sad = hasAny(both,['груст','печаль','обидно','жаль','плохо','тяжело','больно','😔','😢']);
  const angry = hasAny(both,['злюсь','бесит','раздраж','надоело','достало']);
  const surprise = hasAny(both,['ого','ничего себе','вот это да','неожиданно','серьёзно?','правда?','😮']);
  const question = /\?/.test(userText) || /^(как|что|почему|зачем|когда|где|кто|можешь ли)\b/i.test(String(userText||'').trim());
  const memory = hasAny(u,['помнишь','вспомни','тогда','раньше','когда мы']);
  const dreamy = hasAny(both,['мечта','представляю','словно','будто','волшеб','атмосфер','ночами']);
  const shy = hasAny(r,['смуща','застесня','неловко','красне']);
  const jealousy = hasAny(u,['другая девушка','с другой девушкой','девушкой','бывшая','она красивее']) && flirt;
  const care = hasAny(u,['береги себя','отдохни','не переутомляйся','как ты себя','забочусь','рад что ты']);
  const informational = String(replyText||'').length > 130 && !flirt && !sad && !angry && !farewell;
  return {farewell,greeting,kiss,hug,flirt,praise,thanks,apology,agreement,tired,sad,angry,surprise,question,memory,dreamy,shy,jealousy,care,informational};
}

function relationshipTier(mood={}){
  const a=Number(mood.affection)||50, t=Number(mood.trust)||50;
  if(a>=75 && t>=65) return 'close';
  if(a>=50 && t>=40) return 'warm';
  return 'early';
}

function candidateScore(sticker, sig, mood, channel){
  let score=0;
  const reasons=[];
  for(const rule of sticker.signals || []){
    if(sig[rule]) { score += 1; reasons.push(rule); }
  }
  if(channel === 'reaction_to_user' && sticker.modes?.includes('reaction_to_user')) score += .25;
  if(channel === 'expression_of_reply' && sticker.modes?.includes('expression_of_reply')) score += .25;
  if(sticker.forbidSignals?.some(x=>sig[x])) return null;
  if(sticker.requireSignals?.length && !sticker.requireSignals.some(x=>sig[x])) return null;
  const tier=relationshipTier(mood);
  const order={early:0,warm:1,close:2};
  if(order[tier] < order[sticker.minTier || 'early']) score -= .75;
  const energy=Number(mood.energy)||50, play=Number(mood.playfulness)||50;
  if(sticker.energyMax && energy>sticker.energyMax) score-=.35;
  if(sticker.playfulnessMin && play<sticker.playfulnessMin) score-=.35;
  score *= Number(sticker.weight || 1);
  return {sticker,score,reasons,tier};
}

export function decideSticker(cfg,{userText='',replyText='',mood={},mode='smart'}={}){
  const stats=loadStats();
  stats.turns=(stats.turns||0)+1;
  stats.messagesSince=(stats.messagesSince??999)+1;
  saveStats(stats);

  if(mode==='off') return {action:'none',reason:'mode_off'};
  const sig=signals(userText,replyText);
  if(sig.informational && !sig.surprise && !sig.question) return {action:'none',reason:'informational_reply',signals:sig};

  const channel = (sig.farewell||sig.kiss||sig.hug||sig.praise||sig.care||sig.surprise||sig.sad||sig.angry)
    ? 'reaction_to_user' : 'expression_of_reply';

  const minGap=Number(cfg.defaults?.minGapMessages ?? 2);
  const ratio=(stats.sent||0)/Math.max(1,stats.turns||1);
  if(mode!=='always' && stats.messagesSince<minGap) return {action:'none',reason:'global_cooldown',signals:sig};
  if(mode!=='always' && ratio>Number(cfg.defaults?.maxRatio ?? .32)) return {action:'none',reason:'ratio_gate',signals:sig};

  const recent=new Set((stats.recent||[]).slice(0,8));
  const scored=[];
  for(const s of cfg.stickers||[]){
    if(!s.modes?.includes(channel)) continue;
    const c=candidateScore(s,sig,mood,channel);
    if(!c || c.score<=0) continue;
    if(recent.has(s.src)) c.score-=.7;
    scored.push(c);
  }
  scored.sort((a,b)=>b.score-a.score);
  const best=scored[0];
  const threshold=mode==='always' ? .25 : Number(cfg.defaults?.threshold ?? 1.05);
  if(!best || best.score<threshold) return {action:'none',reason:'no_semantic_match',signals:sig,top:scored.slice(0,3).map(x=>({src:x.sticker.src,score:+x.score.toFixed(2)}))};
  if(scored[1] && Math.abs(best.score-scored[1].score)<.08 && best.sticker.family!==scored[1].sticker.family)
    return {action:'none',reason:'ambiguous_candidates',signals:sig,top:scored.slice(0,3).map(x=>({src:x.sticker.src,score:+x.score.toFixed(2)}))};

  const timing = channel==='reaction_to_user' && (sig.surprise||sig.kiss||sig.hug) ? 'before_reply' : 'after_reply';
  return {
    action:'send', mode:channel, timing,
    sticker:best.sticker,
    utterance:Array.isArray(best.sticker.utterances)&&best.sticker.utterances.length ? best.sticker.utterances[Math.floor(Math.random()*best.sticker.utterances.length)] : null,
    confidence:clamp(best.score/2.2,0,1),
    reason:best.reasons.join('+') || 'reply_expression',
    signals:sig
  };
}

export function markStickerSent(sticker){
  if(!sticker?.src) return;
  const s=loadStats();
  s.sent=(s.sent||0)+1; s.messagesSince=0;
  s.recent=[sticker.src,...(s.recent||[]).filter(x=>x!==sticker.src)].slice(0,12);
  saveStats(s);
}
