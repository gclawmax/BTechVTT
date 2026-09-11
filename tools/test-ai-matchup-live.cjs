// Disposable real-server setup acceptance; no full-match outcome is implied.
const fs=require('fs'),assert=require('node:assert/strict');const {chromium}=require('/Users/mattperkins/.hermes/hermes-agent/node_modules/playwright');
(async()=>{const b=await chromium.launch({headless:true,channel:'chrome'});let gameId;try{const page=await b.newPage();page.on('dialog',d=>d.dismiss());await page.goto(process.env.SHOT_URL||'http://127.0.0.1:8790/index.html');await page.locator('#login-screen.active').waitFor();
const fixture=JSON.parse(fs.readFileSync('tools/fixtures/ai-clan-vs-is.json','utf8'));
const result=await page.evaluate(async({fixture,user,pass})=>{
 const {data,error}=await db.auth.signInWithPassword({email:user+'@FreeGames.com',password:pass});if(error)throw Error(error.message);currentUser=data.user;
 await createVsAIGame({mapId:fixture.map_id,dropshipTonnage:null,ruleset:fixture.ruleset,forceLimit:{mode:'bv2',limit:fixture.bv_limit,bv_version:'BV2.1'},minefieldsEnabled:false});
 if(!currentGameId)throw Error('No fixture game created');
 const read=async()=>{const {data,error}=await db.from('btech_games').select('*').eq('id',currentGameId).single();if(error)throw Error(error.message);return {...data,state:typeof data.state==='string'?JSON.parse(data.state):data.state};};
 const game=await read();
 const hangar=side=>fixture[side].map((u,i)=>({id:side+'-'+i,unit_id:u.unit_id,pilot:{name:u.name,gunnery:u.gunnery,piloting:u.piloting}}));
 const human=hangar('human'),ai=hangar('ai');
 for(const u of [...fixture.human,...fixture.ai]){const value=bv2EntryValue(getSupportedUnit(u.unit_id),u);if(value?.stock!==u.stock_bv||value?.adjusted!==u.adjusted_bv)throw Error('Catalogue BV changed: '+u.unit_id);}
 let response=await db.rpc('update_skirmish_hangar',{p_game_id:currentGameId,p_hangar:human,p_deployed:human.map(u=>u.id)});if(response.error)throw Error(response.error.message);
 const afterHuman=await read();afterHuman.state.deployment_positions['1']=buildVsAiDeployment(human.map(u=>u.unit_id),1,afterHuman.state);
 response=await db.from('btech_games').update({state:afterHuman.state}).eq('id',currentGameId);if(response.error)throw Error(response.error.message);
 response=await db.rpc('update_ai_skirmish_force',{p_game_id:currentGameId,p_hangar:ai,p_deployed:ai.map(u=>u.id),p_positions:buildVsAiDeployment(ai.map(u=>u.unit_id),2,game.state)});if(response.error)throw Error(response.error.message);
 response=await db.from('btech_players').update({ready:true}).eq('game_id',currentGameId).eq('user_id',currentUser.id);if(response.error)throw Error(response.error.message);
 await handleStartGame();const started=await read();
 return {gameId:currentGameId,gameCode:started.game_code,status:started.status,mines:started.state.minefield_rules,units:started.state.mech_instances,values:started.state.force_values};
},{fixture,user:process.env.BT_TEST_USER,pass:process.env.BT_TEST_PASS});
gameId=result.gameId;assert.equal(result.status,'in-progress');assert.equal(result.mines.budget,0);assert.equal(result.units.length,3);for(const expected of [...fixture.human,...fixture.ai]){const actual=result.units.find(u=>u.unitId===expected.unit_id);assert.equal(actual.pilot.name,expected.name);assert.equal(actual.pilot.gunnery,expected.gunnery);assert.equal(actual.pilot.piloting,expected.piloting);}assert.equal(result.values['1'].adjusted,2554);assert.equal(result.values['2'].adjusted,2750);
if(process.env.BT_TEST_AUTOPHASE==='1') {
 await page.evaluate(async()=>{
  const {data,error}=await db.from('btech_games').select('state').eq('id',currentGameId).single();if(error)throw Error(error.message);
  const st=typeof data.state==='string'?JSON.parse(data.state):data.state;
  Object.assign(st,{initiative_order:[],initiative_rolls:[],initiative_round:null,initiative_pending:[],active_player_player_id:null});
  const saved=await db.from('btech_games').update({current_round:2,current_phase:'initiative',active_player_id:null,initiative_winner:null,state:st}).eq('id',currentGameId);if(saved.error)throw Error(saved.error.message);
  await loadGameState();setAutoAdvanceAfterAi(true);await submitInitiativeRoll();
 });
 await page.waitForFunction(()=>currentGameState.phase==='movement',null,{timeout:15000});
 assert.equal(await page.evaluate(()=>mechInstances.filter(m=>m.owner===1).every(m=>!m.hasMoved)),true);
 await page.evaluate(()=>setAutoAdvanceAfterAi(false));
 console.log('PASS live Auto-next advances resolved initiative without clicking Next Phase; human movement remains unconfirmed.');
}
const cleanup=await page.evaluate(async id=>(await db.from('btech_games').delete().eq('id',id)).error?.message||null,gameId);assert.equal(cleanup,null);console.log('PASS real-server 2 IS vs 1 Clan setup, editable AI save, skill-adjusted BV, pilots preserved at start, mines off; disposable match removed: '+result.gameCode);
}catch(error){console.error(error);if(gameId)console.error('Failed fixture retained: '+gameId);process.exitCode=1;}finally{await b.close()}})();
