// GM-3 deployed acceptance. Each fixture enters the real Heat resolver, which
// advances the round and invokes btech_score_scenario_round on the server.
// Passing disposable matches are deleted; a failing match is retained by code.
// Usage: node tools/test-game-modes-live.mjs (after applying SQL/128).

import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { chromium }=require('/Users/mattperkins/.hermes/hermes-agent/node_modules/playwright');
const BASE=process.env.SHOT_URL||'https://gclawmax.github.io/BTechVTT/';
const USER=process.env.BT_GM3_USER||'gm3-live-acceptance';
const PASS=process.env.BT_GM3_PASS||'GM3!Live01';
const KEEP=process.env.BT_GM3_KEEP==='1';
const failures=[],errors=[],retained=[];
const check=(label,ok,detail='')=>{console.log(`${ok?'PASS':'FAIL'}  ${label}${detail?` — ${detail}`:''}`);if(!ok)failures.push(`${label}${detail?` — ${detail}`:''}`);};

const browser=await chromium.launch({headless:true,channel:'chrome',args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1440,height:900}});
page.on('pageerror',error=>errors.push(`PAGEERROR: ${error.message}`));
page.on('console',message=>{if(message.type()==='error')errors.push(`CONSOLE: ${message.text()}`);});
async function screen(){return page.evaluate(()=>Array.from(document.querySelectorAll('.screen')).find(item=>item.classList.contains('active'))?.id||null);}
async function waitFor(id,timeout=20000){const until=Date.now()+timeout;while(Date.now()<until){if(await screen()===id)return true;await page.waitForTimeout(200);}return false;}
async function signIn(){await page.goto(BASE,{waitUntil:'networkidle',timeout:30000});await page.fill('#login-username',USER);await page.fill('#login-password',PASS);await page.click('#btn-login').catch(()=>{});if(await waitFor('menu-screen',12000))return;await page.fill('#login-username',USER);await page.fill('#login-password',PASS);await page.click('#btn-signup').catch(()=>{});if(!await waitFor('menu-screen',20000))throw new Error('Could not sign in to the GM-3 acceptance account.');}
async function fixture(spec){
 return page.evaluate(async spec=>{
  await createVsAIGame({mapId:'standard-single-sheet',dropshipTonnage:200,victoryMode:spec.mode,ruleset:'advanced_3060',difficulty:'beginner',personality:'balanced'});
  if(!currentGameId)throw new Error('Could not create a disposable fixture match.');
  await handleStartGame();
  const {data:game,error:gameError}=await db.from('btech_games').select('*').eq('id',currentGameId).single();if(gameError)throw gameError;
  const {data:players,error:playerError}=await db.from('btech_players').select('*').eq('game_id',currentGameId).eq('role','player').order('seat_number');if(playerError)throw playerError;
  const human=players.find(player=>player.seat_number===1),ai=players.find(player=>player.seat_number===2);if(!human||!ai)throw new Error('Fixture seats are incomplete.');
  await loadUnitCatalogue(game.catalogue_version);
  const unitId=[...databaseSupportedUnitIds].sort().find(id=>{const unit=getSupportedUnit(id);return unit?.armor&&unit?.structure&&Number(unit?.movement?.walk||0)>0;});if(!unitId)throw new Error('Pinned catalogue has no mobile fixture BattleMech.');
  const rosters={'1':Array.from({length:spec.humanCount||1},()=>unitId),'2':Array.from({length:spec.aiCount||1},()=>unitId)};
  const positions={'1':Array.from({length:spec.humanCount||1},(_,index)=>({col:spec.human?.[index]?.col??4,row:spec.human?.[index]?.row??6,facing:0})),'2':Array.from({length:spec.aiCount||1},(_,index)=>({col:spec.ai?.[index]?.col??12,row:spec.ai?.[index]?.row??10,facing:3}))};
  const units=buildRosterInstances(rosters,{},positions);
  for(const unit of units){Object.assign(unit,{destroyed:false,shutdown:false,prone:false,hasMoved:true,hasReacted:true,hasFired:true,hasPhysicalAttacked:true,hasManagedHeat:unit.owner===2,heat:0,roundStartingHeat:0,movementHeat:0,weaponHeat:0,externalHeat:0});}
  for(const index of spec.destroyedAi||[]){if(units.filter(unit=>unit.owner===2)[index])units.filter(unit=>unit.owner===2)[index].destroyed=true;}
  // The AI production path submits its own Heat decision after the human. A
  // fixture invokes one public Heat RPC, so its initiative list contains only
  // that authenticated activation; this forces the exact authoritative
  // round-end transition (and scorer) rather than stopping at an AI hand-off.
  const state={map_id:'standard-single-sheet',map_dimensions:{cols:16,rows:17},catalogue_version:game.catalogue_version,ruleset:'advanced_3060',vs_ai_mode:true,victory_mode:spec.mode,objective_hexes:spec.objectives||[],objective_scores:spec.scores||{'1':0,'2':0},breakthrough_scored_units:spec.priorHumanScorer?[units.find(unit=>unit.owner===1)?.instanceId]:[],deployment_zones:spec.zones,mech_instances:units,initiative_order:[{player_id:human.id,seat_number:1}],active_player_player_id:human.id,round:1};
  const update=await db.from('btech_games').update({current_round:1,current_phase:spec.elimination?'movement':'heat',active_player_id:human.id,state}).eq('id',currentGameId);if(update.error)throw update.error;
  const resolution=spec.elimination?await db.rpc('resolve_btech_match_end',{p_game_id:currentGameId}):await db.rpc('resolve_heat_management',{p_game_id:currentGameId});
  if(resolution.error)throw new Error(`${spec.elimination?'Elimination':'Heat'} fixture failed: ${resolution.error.message}`);
  const {data:resolved,error:resolvedError}=await db.from('btech_games').select('*').eq('id',currentGameId).single();if(resolvedError)throw resolvedError;
  const finalState=typeof resolved.state==='string'?JSON.parse(resolved.state):resolved.state;
  const {data:telemetry}=await db.from('btech_match_telemetry').select('event_type,payload').eq('game_id',currentGameId).order('event_index');
  const {data:report}=await db.from('btech_match_reports').select('*').eq('game_id',currentGameId).maybeSingle();
  return {build:BT_BUILD_ID,gameId:currentGameId,gameCode:resolved.game_code,state:finalState,phase:resolved.current_phase,resolution:resolution.data,telemetry:telemetry||[],report};
 },spec);
}
async function cleanup(result,ok){if(!result?.gameId)return;if(!ok||KEEP){retained.push(result.gameCode);return;}const message=await page.evaluate(async id=>(await db.from('btech_games').delete().eq('id',id)).error?.message||null,result.gameId);check('passing GM-3 fixture is removed',!message,message||result.gameCode);}
try{
 await signIn();
 const build=await page.evaluate(()=>BT_BUILD_ID);check('the deployed browser includes GM-3',/^20260907-gm3-authoritative-modes-(76|77)$/.test(build),build);
 const cases=[
  ['uncontested Control scores and reaches its threshold',{mode:'control',objectives:['0406'],scores:{'1':4,'2':1},human:[{col:4,row:6}],ai:[{col:12,row:10}]},result=>result.state.objective_scores?.['1']===5&&result.state.match_result?.winner_seat===1&&result.state.match_result?.reason==='control'],
  ['contested Control awards no point',{mode:'control',objectives:['0406'],human:[{col:4,row:6}],ai:[{col:4,row:6}]},result=>result.state.objective_scores?.['1']===0&&result.state.objective_scores?.['2']===0&&!result.state.match_result],
  ['simultaneous Control thresholds draw',{mode:'control',objectives:['0406','0808'],scores:{'1':4,'2':4},human:[{col:4,row:6}],ai:[{col:8,row:8}]},result=>result.state.match_result?.winner_seat===null&&result.state.match_result?.reason==='control'],
  ['two distinct live BattleMechs score Breakthrough once',{mode:'breakthrough',humanCount:2,aiCount:2,human:[{col:12,row:10},{col:12,row:10}],ai:[{col:0,row:10},{col:0,row:10}],zones:{'1':['0305'],'2':['1210']},destroyedAi:[0]},result=>result.state.objective_scores?.['1']===2&&result.state.breakthrough_scored_units?.length===2&&result.state.match_result?.winner_seat===1],
  ['a prior Breakthrough scorer cannot score twice',{mode:'breakthrough',humanCount:2,priorHumanScorer:true,scores:{'1':1,'2':0},human:[{col:12,row:10},{col:12,row:10}],zones:{'1':['0305'],'2':['1210']}},result=>result.state.objective_scores?.['1']===2&&result.state.breakthrough_scored_units?.length===2],
  ['elimination remains the fallback in every scenario',{mode:'control',objectives:['0406'],human:[{col:4,row:6}],ai:[{col:12,row:10}],destroyedAi:[0],elimination:true},result=>result.state.match_result?.winner_seat===1&&result.state.match_result?.reason==='annihilation']
 ];
 for(const [label,spec,assertion] of cases){const result=await fixture(spec);const passed=assertion(result);check(label,passed,JSON.stringify({code:result.gameCode,scores:result.state.objective_scores,result:result.state.match_result,events:result.state.scenario_score_events}));if(result.state.match_result){check(`${label}: phase, telemetry and sealed report are authoritative`,result.phase==='end'&&result.telemetry.some(event=>event.event_type==='match_completed')&&Boolean(result.report),result.gameCode);}await cleanup(result,passed);}
}catch(error){failures.push(`fatal GM-3 acceptance error — ${error.message}`);console.error(`FAIL  GM-3 live acceptance — ${error.message}`);}finally{console.log(`\nGM-3 LIVE ACCEPTANCE ${failures.length?'FAILED':'PASSED'}${retained.length?` — retained ${retained.join(', ')}`:''}`);if(errors.length)console.log(`Console/page errors: ${errors.length}\n${errors.slice(0,20).join('\n')}`);await browser.close();}
if(failures.length)process.exitCode=1;
