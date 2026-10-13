import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createVoicePlayer, voiceWaveHeights, voiceTime } from '../public/js/voice_player.js';

const file = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

class Element {
  constructor() {
    this.hidden = false;
    this.disabled = false;
    this.dataset = {};
    this.textContent = '';
    this.innerHTML = '';
    this.style = {};
    this.attributes = {};
    this.events = new Map();
    this.children = [];
    const values = new Set();
    this.classList = { toggle(n,on) { if(on) values.add(n); else values.delete(n); }, contains(n){ return values.has(n); } };
    this.ownerDocument = { createElement: () => new Element() };
  }
  setAttribute(k,v){ this.attributes[k] = v; }
  appendChild(c){ this.children.push(c); }
  addEventListener(name,fn){ const list = this.events.get(name)||[];list.push(fn);this.events.set(name,list); }
  emit(name){ for(const fn of this.events.get(name)||[])fn(); }
  click(){ this.emit('click'); }
  querySelector(selector){ return this.controls?.[selector] || null; }
}
class FakeAudio extends Element {
  constructor(){super();this.paused=true;this.ended=false;this.duration=26;this.currentTime=0;this.playbackRate=1;this.playCount=0;this.pauseCount=0;}
  async play(){this.playCount++;this.paused=false;this.ended=false;this.emit('play');}
  pause(){this.pauseCount++;this.paused=true;this.emit('pause');}
}
function makePlayer(){
  const root=new Element();root.controls=Object.fromEntries([
    '[data-voice-mini-play]', '[data-voice-mini-speed]', '[data-voice-mini-close]', '[data-voice-mini-subtitle]'
  ].map(x=>[x,new Element()]));
  return {root,...Object.fromEntries(Object.entries(root.controls).map(([a,v])=>[a.slice(1,-1),v])),player:createVoicePlayer({root})};
}
function makeVoice(player,id,ensureSource=async()=>true){
  const audio=new FakeAudio(),bubble=new Element(),playButton=new Element(),wave=new Element(),durationNode=new Element();
  player.register({audio,bubble,playButton,wave,durationNode,ensureSource,sourceId:id});
  return {audio,bubble,playButton,wave,durationNode};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('voice waveform is stable, visually varied and has a bounded size',()=>{
  const bars=voiceWaveHeights('id-1');
  assert.equal(bars.length,34);
  assert.deepEqual(bars,voiceWaveHeights('id-1'));
  assert.notDeepEqual(bars,voiceWaveHeights('id-2'));
  assert.ok(new Set(bars).size>8);
  assert.ok(bars.every(h=>h>=5&&h<=28));
  assert.equal(voiceTime(26.9),'0:26');
  assert.equal(voiceTime(91),'1:31');
  assert.equal(voiceTime(NaN),'0:00');
});

test('a floating controller pauses the previous voice and always shows one active track',async()=>{
  const {root,player}=makePlayer();
  const a=makeVoice(player,'first'),b=makeVoice(player,'second');
  assert.equal(root.hidden,true);
  assert.equal(a.wave.children.length,34);
  a.playButton.click();await tick();
  assert.equal(root.hidden,false);
  assert.equal(a.audio.paused,false);
  assert.equal(player.activeAudio,a.audio);
  b.playButton.click();await tick();
  assert.equal(a.audio.paused,true);
  assert.equal(b.audio.paused,false);
  assert.equal(player.activeAudio,b.audio);
  assert.equal(a.bubble.classList.contains('playing'),false);
  assert.equal(b.bubble.classList.contains('playing'),true);
});

test('mini play toggles pause, speed cycles, close pauses and replay can resume',async()=>{
  const {root,player}=makePlayer();
  const a=makeVoice(player,'same');
  a.playButton.click();await tick();
  const miniPlay=root.controls['[data-voice-mini-play]'];
  const speed=root.controls['[data-voice-mini-speed]'];
  const close=root.controls['[data-voice-mini-close]'];
  miniPlay.click();await tick();
  assert.equal(a.audio.paused,true);
  miniPlay.click();await tick();
  assert.equal(a.audio.paused,false);
  speed.click();assert.equal(a.audio.playbackRate,1.25);assert.equal(speed.textContent,'1.25×');
  close.click();assert.equal(root.hidden,true);assert.equal(a.audio.paused,true);assert.equal(player.activeAudio,null);
  a.playButton.click();await tick();
  assert.equal(root.hidden,false);assert.equal(a.audio.playbackRate,1.25);
  a.audio.ended=true;a.audio.paused=true;a.audio.currentTime=26;a.audio.emit('ended');
  a.playButton.click();await tick();
  assert.equal(a.audio.currentTime,0);
  assert.equal(a.audio.paused,false);
});

test('archived audio lazily loads exactly once, including when resumed via mini-player',async()=>{
  const {root,player}=makePlayer();
  let requests=0,loaded=false;const a=makeVoice(player,'old',async()=>{if(!loaded){requests++;loaded=true;}return true;});
  a.playButton.click();await tick();
  root.controls['[data-voice-mini-play]'].click();await tick();
  root.controls['[data-voice-mini-play]'].click();await tick();
  assert.equal(requests,1); // the bubble's ensureSource closure caches the archive request
  assert.equal(a.audio.paused,false);
});

test('concurrent playback requests cannot start an old message after a newer selection',async()=>{
  const {player}=makePlayer();
  let resume;
  const a=makeVoice(player,'slow',()=>new Promise(resolve=>{resume=resolve;}));
  const b=makeVoice(player,'fast');
  a.playButton.click();await tick();
  b.playButton.click();await tick();
  resume(true);await tick();
  assert.equal(a.audio.playCount,0);
  assert.equal(b.audio.paused,false);
});

test('source and UI integration preserve archive, TTS and limit of 12 serverless functions',()=>{
  const chat=file('public/chat.js'),html=file('public/index.html'),css=file('public/voice_player.css');
  assert.match(chat,/voicePlayer\.register\(/u);
  assert.match(chat,/\/api\/archive-media\?id=/u);
  assert.match(chat,/URL\.revokeObjectURL/u);
  assert.match(html,/id="voiceMiniPlayer"/u);
  assert.match(html,/data-voice-mini-close/u);
  assert.match(html,/voice_player\.css\?v=/u);
  assert.match(css,/\.voice-tg__wave i\.is-played/u);
  assert.match(css,/\.voice-mini-player\[hidden\]/u);
  assert.match(file('public/js/release.js'),/2\.6\.5-memory-foundation-floating-voice-player/u);
  assert.equal(readdirSync(new URL('../api',import.meta.url)).filter(name=>name.endsWith('.js')).length,12);
});
