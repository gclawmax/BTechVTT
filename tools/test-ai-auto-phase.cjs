const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('js/game/phases.js','utf8');let pending=[],count=0,check={ok:true},resolveWrite;
const ctx=vm.createContext({currentGameId:'test',vsAiMode:true,isHost:true,autoAdvanceAfterAi:true,aiTurnInProgress:false,currentGameState:{round:1,phase:'movement',active_player_id:'human'},gameStateWriteQueue:Promise.resolve(),autoAdvanceRetryTimer:null,canAdvancePhase:()=>check,advancePhase:async()=>{count++;ctx.currentGameState.phase='reaction';},updateAdvanceButtonState:()=>{},logEvent:()=>{},setTimeout:fn=>{pending.push(fn);return fn;},clearTimeout:fn=>{pending=pending.filter(item=>item!==fn);}});
vm.runInContext(source.slice(source.indexOf('let autoAdvanceInProgress'),source.indexOf('function scheduleActiveAiTurn()')),ctx);
(async()=>{
ctx.scheduleAiMatchAutoAdvance();assert.equal(pending.length,1);await pending.shift()();assert.equal(count,1); // Human completed step, not restricted to AI owner.
ctx.currentGameState.phase='movement';check={ok:false};ctx.scheduleAiMatchAutoAdvance();assert.equal(pending.length,0);
check={ok:true,warning:true};ctx.scheduleAiMatchAutoAdvance();assert.equal(pending.length,0);
check={ok:true};ctx.aiTurnInProgress=true;ctx.scheduleAiMatchAutoAdvance();assert.equal(pending.length,0);ctx.aiTurnInProgress=false;
ctx.autoAdvanceAfterAi=false;ctx.scheduleAiMatchAutoAdvance();assert.equal(pending.length,0);ctx.autoAdvanceAfterAi=true;
ctx.scheduleAiMatchAutoAdvance();const stale=pending.shift();ctx.currentGameState.active_player_id='ai';await stale();assert.equal(count,1);
ctx.gameStateWriteQueue=new Promise(r=>resolveWrite=r);const first=ctx.autoAdvanceAfterAiTurn();const duplicate=ctx.autoAdvanceAfterAiTurn();resolveWrite();await Promise.all([first,duplicate]);assert.equal(count,2);
ctx.currentGameState.phase='heat';ctx.gameStateWriteQueue=new Promise(r=>resolveWrite=r);const toggled=ctx.autoAdvanceAfterAiTurn();ctx.autoAdvanceAfterAi=false;resolveWrite();await toggled;assert.equal(count,2);
ctx.autoAdvanceAfterAi=true;ctx.gameStateWriteQueue=Promise.resolve();ctx.advancePhase=async()=>{throw Error('Server unavailable');};await ctx.autoAdvanceAfterAiTurn();assert.equal(ctx.canAutoAdvanceAiMatch(),false);
ctx.currentGameState.phase='end';ctx.currentGameState.match_result={winner_seat:1};assert.equal(ctx.canAutoAdvanceAiMatch(),false);
console.log('PASS completed human hand-off, pending choices, physical warnings, AI in-flight, toggle, stale callback, duplicate scheduling, write queue and failure pause.');
})().catch(e=>{console.error(e);process.exitCode=1});
