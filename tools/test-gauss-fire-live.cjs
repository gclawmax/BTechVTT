// Focused live acceptance; creates and removes only its own disposable game.
const {chromium}=require('/Users/mattperkins/.hermes/hermes-agent/node_modules/playwright'),assert=require('node:assert/strict');
(async()=>{const b=await chromium.launch({headless:true,channel:'chrome'});let gameId;try{const p=await b.newPage();await p.goto(process.env.SHOT_URL||'http://127.0.0.1:8790/index.html');await p.locator('#login-screen.active').waitFor();
 gameId=await p.evaluate(async({user,pass})=>{const {data,error}=await db.auth.signInWithPassword({email:user+'@FreeGames.com',password:pass});if(error)throw Error(error.message);currentUser=data.user;await createVsAIGame({mapId:'training-grounds',dropshipTonnage:200,ruleset:'standard_3060'});return currentGameId;},{user:process.env.BT_TEST_USER,pass:process.env.BT_TEST_PASS});assert.ok(gameId);
 const results=await p.evaluate(async()=>{
  aiTurnInProgress=true;autoAdvanceAfterAi=false;
  const copy=v=>JSON.parse(JSON.stringify(v));
  const {data:players}=await db.from('btech_players').select('*').eq('game_id',currentGameId).eq('role','player');
  const human=players.find(p=>!p.is_ai),ai=players.find(p=>p.is_ai);
  const {data:game}=await db.from('btech_games').select('*').eq('id',currentGameId).single();
  await loadUnitCatalogue(game.catalogue_version);const results=[];
  for(const [round,mode,actor] of [[2,true,1],[3,false,1],[4,true,2]]){
   const roster={'1':[actor===1?'dragon-drg-7n':'atlas-as7-d'],'2':[actor===2?'dragon-drg-7n':'atlas-as7-d']};
   const units=buildRosterInstances(roster,{}, {'1':[{col:4,row:8,facing:0}],'2':[{col:9,row:8,facing:3}]});
   for(const m of units){ensureMechCombatState(m);Object.assign(m,{hasMoved:true,hasReacted:true,hasFired:m.owner!==actor,hasPhysicalAttacked:false,hasManagedHeat:false,roundStartingHeat:5,movementHeat:2,weaponHeat:0,externalHeat:0,heat:7,movementMode:'run',hexesMoved:0});m.pilot={name:'Test',gunnery:2,piloting:5,hits:0,consciousness:'conscious'};m.weaponPhaseStart={round,mech:copy(m)};}
   const attacker=units.find(m=>m.owner===actor),target=units.find(m=>m.owner!==actor),unit=BT_UNITS[attacker.unitId];
   const entry=unit.weapons.find(w=>weaponProfile(w)?.ammoType==='gauss');if(!entry)throw Error('Missing Gauss fixture');const mount=weaponMountId(entry,unit.weapons.indexOf(entry));
   const bin=attacker.ammoBins.find(b=>b.type==='gauss');const before=bin.shots;
   const terrain={};for(let col=0;col<16;col++)for(let row=0;row<17;row++)terrain[hexCode(col,row)]='clear';
   const active=actor===1?human.id:ai.id;
   const st={vs_ai_mode:mode,ruleset:'standard_3060',map_id:'training-grounds',terrain_overrides:terrain,catalogue_version:game.catalogue_version,mech_instances:units,initiative_order:[{player_id:human.id,seat_number:1,is_ai:false},{player_id:ai.id,seat_number:2,is_ai:true}],initiative_round:round,active_player_player_id:active,ai_decisions:[]};
   const saved=await db.from('btech_games').update({status:'in-progress',current_phase:'weapon_attack',current_round:round,active_player_id:active,state:st}).eq('id',currentGameId);if(saved.error)throw Error(saved.error.message);
   await loadGameState();aiTurnInProgress=true;vsAiMode=mode;mySeatNumber=1;
   if(actor===1){weaponAttackState={...emptyWeaponAttackState(),attackerId:attacker.instanceId,targetId:target.instanceId,primaryTargetId:target.instanceId,weaponKeys:[mount],targetAssignments:{[mount]:target.instanceId},ammoBinsByMount:{[mount]:bin.id}};await confirmWeaponAttack();}
   else {await executeAIWeaponDeclaration({type:'attack',instanceId:attacker.instanceId,allocations:[{target_instance_id:target.instanceId,primary:true,weapon_mounts:[mount],ammo_bins:{[mount]:bin.id}}]});}
   const {data:afterGame}=await db.from('btech_games').select('state').eq('id',currentGameId).single();const afterState=typeof afterGame.state==='string'?JSON.parse(afterGame.state):afterGame.state;
   const after=afterState.mech_instances.find(m=>m.instanceId===attacker.instanceId);
   const ev=await db.from('btech_combat_events').select('*').eq('game_id',currentGameId).eq('round',round).eq('phase','weapon_attack').eq('attacker_instance_id',attacker.instanceId).single();if(ev.error)throw Error(ev.error.message);
   const retry=await db.rpc('submit_multi_target_weapon_declaration',{p_game_id:currentGameId,p_attacker_instance_id:attacker.instanceId,p_target_allocations:[{target_instance_id:target.instanceId,primary:true,weapon_mounts:[mount],ammo_bins:{[mount]:bin.id}}]});
   results.push({mode,actor,before,after:after.ammoBins.find(b=>b.id===bin.id).shots,weaponHeat:after.weaponHeat,heat:after.heat,status:ev.data.status,dice:ev.data.resolution?.results?.[0]?.to_hit,retryRejected:!!retry.error});
  }
  return results;
 });
 for(const r of results){assert.equal(r.after,r.before-1);assert.equal(r.weaponHeat,1);assert.equal(r.heat,8);assert.equal(r.status,'resolved');assert.ok(r.dice);assert.equal(r.retryRejected,true);console.log('PASS live Gauss firing: '+JSON.stringify(r));}
 const routes=await p.evaluate(async()=>{
  const {data:g}=await db.from('btech_games').select('*').eq('id',currentGameId).single();
  const st=typeof g.state==='string'?JSON.parse(g.state):g.state;st.phase_activation=null;
  const human=st.initiative_order.find(p=>p.seat_number===1).player_id;
  const mine=st.mech_instances.find(m=>m.owner===1),other=st.mech_instances.find(m=>m.owner===2);
  mine.col=4;mine.row=8;mine.facing=0;mine.torsoFacing=0;mine.hasMoved=false;other.hasMoved=true;
  mine.destroyed=false;mine.shutdown=false;mine.prone=false;mine.pilot.consciousness='conscious';
  st.active_player_player_id=human;
  let saved=await db.from('btech_games').update({current_phase:'movement',current_round:5,active_player_id:human,state:st}).eq('id',currentGameId);if(saved.error)throw Error(saved.error.message);
  await loadGameState();await startMovementMode(mine.instanceId,'stand');
  const {data:movement}=await db.from('btech_games').select('*').eq('id',currentGameId).single();const ms=typeof movement.state==='string'?JSON.parse(movement.state):movement.state;
  if(!ms.mech_instances.find(m=>m.owner===1).hasMoved)throw Error('Human Vs AI stand-still was not saved');
  const pm=ms.mech_instances.find(m=>m.owner===1),pt=ms.mech_instances.find(m=>m.owner===2);
  pm.hasPhysicalAttacked=false;pt.hasPhysicalAttacked=true;pm.col=4;pm.row=8;pm.facing=0;pt.col=5;pt.row=8;pt.destroyed=false;pm.shutdown=false;pm.prone=false;pm.pilot.consciousness='conscious';delete pm.physicalPhaseStart;delete pt.physicalPhaseStart;ms.phase_activation=null;ms.active_player_player_id=human;
  saved=await db.from('btech_games').update({current_phase:'physical_attack',active_player_id:human,state:ms}).eq('id',currentGameId);if(saved.error)throw Error(saved.error.message);
  await loadGameState();physicalAttackState={attackerId:pm.instanceId,targetId:pt.instanceId,attackType:'kick',limbs:['rl']};await confirmPhysicalAttack();
  const events=await db.from('btech_combat_events').select('status').eq('game_id',currentGameId).eq('round',5).eq('phase','physical_attack').eq('attacker_instance_id',pm.instanceId);
  if(events.error||!events.data.some(e=>e.status==='resolved'))throw Error('Human Vs AI physical declaration did not resolve');return true;
 });assert.equal(routes,true);console.log('PASS live human Vs AI movement and physical confirmation use shared server resolution');
 if(process.env.BT_TEST_SHARED_HEAT==='1') {
  const heat=await p.evaluate(async()=>{
   const {data:g}=await db.from('btech_games').select('*').eq('id',currentGameId).single();const st=typeof g.state==='string'?JSON.parse(g.state):g.state;
   const {data:players}=await db.from('btech_players').select('*').eq('game_id',currentGameId).eq('role','player');const human=players.find(p=>!p.is_ai),ai=players.find(p=>p.is_ai);
   for(const m of st.mech_instances)Object.assign(m,{destroyed:false,hasManagedHeat:false,shutdown:false,roundStartingHeat:5,movementHeat:2,weaponHeat:1,externalHeat:0,pendingTerrainHeat:0,heat:999});
   st.phase_activation=null;st.active_player_player_id=human.id;st.ai_decisions=[];
   const saved=await db.from('btech_games').update({current_phase:'heat',current_round:6,active_player_id:human.id,state:st}).eq('id',currentGameId);if(saved.error)throw Error(saved.error.message);
   await loadGameState();await confirmHeatManagement();if(getActivePlayerSeat()!==2)throw Error('Human heat did not hand over to AI');
   const plan=generateAIPlan('beginner',ai.id,st,players);if(!await executeAIPlan(plan))throw Error('AI heat plan failed');
   const {data:afterGame}=await db.from('btech_games').select('*').eq('id',currentGameId).single();const after=typeof afterGame.state==='string'?JSON.parse(afterGame.state):afterGame.state;
   const audit=await db.from('btech_ai_decisions').select('status').eq('game_id',currentGameId).eq('decision_id',plan.decisionId).single();
   return {phase:afterGame.current_phase,round:afterGame.current_round,units:after.mech_instances.map(m=>({heat:m.heat,dissipated:m.heatDissipated})),audit:audit.data?.status};
  });assert.equal(heat.phase,'initiative');assert.equal(heat.round,7);assert.equal(heat.audit,'completed');for(const m of heat.units){assert.equal(m.heat,0);assert.equal(m.dissipated,8);}console.log('PASS live human and AI heat: ledger 8 rather than stale 999, sinks once, audited AI completion and next-round transition');
 }
 const error=await p.evaluate(async id=>(await db.from('btech_games').delete().eq('id',id)).error?.message,gameId);assert.ok(!error);console.log('PASS disposable match removed: '+gameId);
}catch(e){console.error(e);if(gameId)console.error('Failed fixture retained: '+gameId);process.exitCode=1;}finally{await b.close()}})();
