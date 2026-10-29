import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectGameSession,gameMemoryGuard,enforceGameReply,guardImmediateContradictions,overusedMotifWords,repeatedMotifCandidates,reduceStaleMotif } from '../lib/cognition/game-session.js';
import { sanitizeMemoryResult } from '../api/memory.js';
import { fitMessengerText, stabilizeTurn } from '../lib/cognition/turn-stabilizer.js';
import { buildRinMindPrompt } from '../lib/cognition/rin-mind.js';

let id=0;
const u=t=>({id:`u${++id}`,role:'user',content:t});
const a=t=>({id:`a${++id}`,role:'assistant',content:t});
const turn=text=>({
  decision: {act:'playful_roleplay',focus:'game',stance:'warm',question:{mode:'natural',reason:'game'},
    replyLink:{targetEventId:null,reason:null},
    delivery:{responseDepth:'short',messageShape:'single',segments:[{type:'text',purpose:'game',stickerIntent:null,maxChars:200}]},
    intentTransition:{operation:'none',goal:null,motive:null,target:null,nextMove:null,progress:null,commitment:null,reason:null},
    openLoops:{open:[],resolveIds:[]},realityMode:'grounded'},
  realization:{segments:[{type:'text',purpose:'game',text}]}
});

test('bounded ten-question game counts assistant semantic turns, not split bubbles',()=>{
  const history=[u('Ты задаёшь мне 10 вопросов, у меня один пас'),
    {...a('Согласна. Вопрос первый: расскажи о себе?'),requestId:'one'},
    {...a('Мне интересно узнать больше.'),requestId:'one'},u('О проекте'),
    a('Вопрос второй: что нравится?'),u('Процесс')];
  const game=inspectGameSession(history);
  assert.equal(game.type,'ten_questions');assert.equal(game.questionsAsked,2);assert.equal(game.nextQuestion,3);
});

test('ten questions never inserts the eleventh question and honours one pass',()=>{
  const history=[u('Ты мне задаешь 10 вопросов, а у меня один пас')];
  for(let n=1;n<=10;n++){history.push(a(`Вопрос ${n}: Что думаешь?`),u(n===10?'Я хочу самостоятельности':n===3?'Пас':'Мне нравится это'))}
  const game=inspectGameSession(history);
  assert.equal(game.questionsAsked,10);
  assert.equal(game.passUsed,true);
  const fixed=enforceGameReply(game,turn('Тогда последний вопрос: хотел бы проверить это?'));
  assert.doesNotMatch(fixed.realization.segments[0].text,/\?/u);
  assert.match(fixed.realization.segments[0].text,/десять\s+вопросов/iu);
});

test('a live ten-question achievement cannot end just because generic seven-turn horizon is reached',()=>{
  const out=stabilizeTurn({
    ...turn('Вопрос седьмой: что сейчас хочется добавить?'),
    activeIntent:{status:'active',kind:'achievement',goal:'провести игру из десяти вопросов',target:'current_scene',turnCount:7,maxTurns:7,progress:0.6},
    revision:42,
    scene:{type:'challenge'},gameSession:{type:'ten_questions',limit:10,questionsAsked:6,finished:false},
    fallbackText:'Я тебя услышала.'
  });
  assert.equal(out.decision.intentTransition.operation,'advance');
  assert.equal(out.decision.intentTransition.progress,0.7);
  assert.ok(out.warnings.includes('bounded_game_progress_protected'));
});

test('word game rejects repeating user word, strips commentary, and sends only one word',()=>{
  const history=[u('Давай по очереди писать по одному слову. Ты первая'),a('Однажды'),u('Мы')];
  const game=inspectGameSession(history);
  const fixed=enforceGameReply(game,turn('Мы'));
  const word=fixed.realization.segments[0].text;
  assert.match(word,/^\p{L}+$/u);
  assert.notEqual(word.toLowerCase(),'мы');
  assert.equal(fixed.decision.delivery.segments.length,1);
  assert.equal(fixed.decision.delivery.segments[0].type,'text');
  assert.equal(inspectGameSession([...history,u('Стоп игра)')]),null);
});

test('word game stops at ten contributions',()=>{
  const history=[u('По очереди пишем по одному слову'),a('Однажды'),u('Мы'),a('случайно'),u('встретились'),a('под'),u('сакурой'),a('тихо'),u('обнялись'),a('и'),u('поцеловались')];
  const game=inspectGameSession(history);
  assert.equal(game.contributions,10);
  const reply=enforceGameReply(game,turn('Навсегда'));
  assert.match(reply.realization.segments[0].text,/десять\s+слов/iu);
});

test('two-truths game prevents unconfirmed claims being promoted to permanent memory even if model extracts them',()=>{
  const claim='Я люблю долго спать, встаю очень рано, или когда как';
  const history=[a('Сыграем в два правдивых факта и одну выдумку'),a('Угадал) Твоя очередь: два факта и одну выдумку.'),u(claim),a('Понятно. Мои три:...')];
  const guard=gameMemoryGuard({userText:claim,recentHistory:history});
  assert.equal(guard.suppressFacts,true);
  const output=sanitizeMemoryResult({
    facts:[{path:'user.preference',value:'Любит вставать очень рано',confidence:0.99}],
    events:[{text:'Любит вставать рано',importance:8}],
    sharedMoments:[{text:'Пользователь сообщил о раннем подъёме',importance:9}],
    factRetractions:[{path:'user.preference'}]
  },{userText:claim,recentHistory:history});
  assert.deepEqual(output.facts,[]);
  assert.deepEqual(output.events,[]);
  assert.deepEqual(output.sharedMoments,[]);
  assert.deepEqual(output.factRetractions,[]);
});

test('explicit reveal may be recorded; ordinary facts outside games unaffected',()=>{
  const history=[a('Два факта и одна выдумка'),a('Твоя очередь загадывать'),u('Я люблю долго спать, встаю очень рано, или когда как'),a('Ставлю на "встаю очень рано". Угадала?'),u('Да, я не люблю вставать очень рано')];
  assert.equal(gameMemoryGuard({userText:'Да, я не люблю вставать очень рано',recentHistory:history}).suppressFacts,false);
  const result=sanitizeMemoryResult({facts:[{path:'user.preference',value:'Не любит вставать очень рано',confidence:.9}]},{userText:'Да, я не люблю вставать очень рано',recentHistory:history});
  assert.equal(result.facts.length,1);
  assert.equal(gameMemoryGuard({userText:'Я люблю кофе',recentHistory:[u('Я люблю кофе')]}).suppressFacts,false);
});

test('two-truths game requires a guess before Rin starts her next round',()=>{
  const history=[a('Сыграем в два правдивых факта и одну выдумку'),a('Твоя очередь — загадывай'),u('Я люблю долго спать, встаю очень рано, или когда как')];
  const game=inspectGameSession(history);
  assert.equal(game.pendingGuess,true);
  const fixed=enforceGameReply(game,turn('А теперь мои три факта: я люблю читать, рисовать и гулять'));
  assert.match(fixed.realization.segments[0].text,/выдумка/iu);
  assert.match(fixed.realization.segments[0].text,/Угадала\?/iu);
});

test('messenger text preserves a complete meaningful question instead of clipped alternative',()=>{
  const source='Вопрос десятый: если проект станет самостоятельнее, что ты хотел бы почувствовать — что он может обходиться без подсказок или что вы научились лучше понимать друг друга?';
  const reply=fitMessengerText(source,100);
  assert.equal(reply,'Вопрос десятый: если проект станет самостоятельнее, что ты хотел бы почувствовать?');
  assert.ok(reply.length<=100);
  const other='Ты имеешь в виду больше функций и вариантов — или больше свободы, когда приложение делает выбор?';
  assert.equal(fitMessengerText(other,70),'Ты имеешь в виду больше функций и вариантов?');
});

test('repeated joke is removed only when an independent good sentence remains, never if user explicitly raises subject',()=>{
  const history=[a('Шоколадка всё-таки соблазнила тебя?'),a('Шоколадку я подозреваю.'),a('Шоколадка главная улика.'),a('Дело о шоколадке не закрыто.'),a('Но шоколадку я не оправдала.')];
  const reply='Мне приятно твоё внимание. Но шоколадка всё равно под подозрением.';
  assert.ok(overusedMotifWords(history,'Все внимание одной девушке',reply).length>0);
  assert.equal(reduceStaleMotif(reply,history,'Все внимание одной девушке'),'Мне приятно твоё внимание.');
  assert.equal(reduceStaleMotif(reply,history,'А почему ты снова про шоколадку?'),reply);
});

test('nearby factual contradictions and direction of visiting are locally corrected',()=>{
  assert.match(guardImmediateContradictions('А, значит, Японию я не угадала — ты там ещё не был.','Нет, но мечтаю. Так что ты угадала'),/с Японией я угадала/u);
  assert.equal(guardImmediateContradictions('К тебе в гости — очень заманчиво.','Я бы поехал к тебе в гости'),'Ко мне в гости — очень заманчиво.');
});


test('a bare guess confirmation cannot revive unverified biographical details',()=>{
  const userText='Да, угадала)';
  const history=[a('Два факта и одна выдумка'),a('Твоя очередь: два факта и одну выдумку'),u('Я люблю спать, встаю очень рано, или когда как'),a('Ставлю на ранний подъём. Угадала?'),u(userText)];
  const extracted=sanitizeMemoryResult({facts:[{path:'user.preference',value:'Любит вставать очень рано',confidence:1}]},{userText,recentHistory:history});
  assert.equal(extracted.facts.length,0);
});

test('Rin Mind receives stale-joke warning as context, not a fixed canned response',()=>{
  const history=[a('Шоколадка всё-таки соблазнила тебя?'),a('Шоколадку я подозреваю.'),a('Шоколадка главная улика.'),a('Дело о шоколадке не закрыто.'),a('Но шоколадку я не оправдала.')];
  const repeated=repeatedMotifCandidates(history,'Все внимание только одной девушке');
  assert.ok(repeated.some(x=>x.example.startsWith('шоколад')));
  const prompt=buildRinMindPrompt({profile:{prompt_profile:{}},state:{userText:'Все внимание только одной девушке',recentHistory:history,innerLife:{},dialogueState:{},staleJokeMotifs:repeated}});
  assert.match(prompt.dynamicSystem,/ПОВТОР ШУТКИ/);
  assert.match(prompt.dynamicSystem,/шоколад/);
  assert.deepEqual(repeatedMotifCandidates(history,'Почему ты всё время про шоколадку?'),[]);
});
