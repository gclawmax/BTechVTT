const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
(async()=>{const source=fs.readFileSync('js/game/heat.js','utf8');let calls=0,release;const gate=new Promise(r=>release=r);
const ctx={currentGameId:'fixture',gameStateWriteQueue:Promise.resolve(),db:{rpc:async()=>{calls++;await gate;return {data:{results:[]}};}},loadGameState:async()=>{},checkForMatchEnd:async()=>{},mechInstances:[],logEvent:()=>{},flashMoveWarning:()=>{}};vm.createContext(ctx);vm.runInContext(source,ctx);
const first=ctx.resolveAuthoritativeHeatManagement(),second=ctx.resolveAuthoritativeHeatManagement();await new Promise(setImmediate);assert.equal(calls,1);release();await Promise.all([first,second]);
ctx.db.rpc=async()=>({error:{message:'Server unavailable'}});await assert.rejects(ctx.resolveAuthoritativeHeatManagement(),/Server unavailable/);
ctx.db.rpc=async()=>{calls++;return {data:{results:[]}};};await ctx.resolveAuthoritativeHeatManagement();assert.equal(calls,2);
console.log('PASS repeated heat clicks submit once; server errors release the guard and permit retry');})();
