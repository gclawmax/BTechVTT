import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const check = (label, condition, detail = '') => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures.push(label);
};
const sandbox = {
  console:{info(){},warn(){},error(){},log(){}}, currentGameId:'ai6-test',
  currentGameState:{round:2,phase:'movement',active_player_id:'ai'}, currentMatchConfig:{map_id:'training-grounds',ruleset:'advanced_3060',objective_hexes:[]},
  mechInstances:[], GRID_COLS:16, GRID_ROWS:17, BT_UNITS:{},
  axialDistance:(a,b,c,d)=>Math.max(Math.abs(c-a),Math.abs(d-b)),
  hexCode:(col,row)=>`${String(col).padStart(2,'0')}${String(row).padStart(2,'0')}`,
  hexNeighbor:(col,row,direction)=>({col:col+[1,1,0,-1,-1,0][direction],row:row+[0,-1,-1,0,1,1][direction]}),
  terrainMovementBlocked:()=>false, terrainAt:()=> 'clear', movementTerrainCost:()=>0, movementElevationCost:()=>0,
  criticalMovementProfile:()=>({walk:5,run:8,jump:0}), heatMovementPenalty:()=>0, mascTargetNumber:()=>13, hasOperationalMASC:()=>false,
  scenarioDeploymentZoneHexes:seat=>seat===1?['0208']:['1308'],
  weaponProfile:entry=>entry?.weapon||sandbox.BT_WEAPONS[entry?.key], mechLabel:mech=>mech?.unitId||'Unknown',
  currentActivationAllowance:()=>1, physicalAttackTypesFor:()=>[], physicalLimbCandidates:()=>[], evaluatePhysicalAttack:()=>({valid:false}),
  canSearchForImprovisedClub:()=>false, isEnemyHiddenUnit:()=>false,
  emptyWeaponAttackState:()=>({attackerId:null,ammoBinsByMount:{},fireModesByMount:{},aimLocationsByMount:{}}),
  weaponAttackState:{attackerId:null,ammoBinsByMount:{},fireModesByMount:{},aimLocationsByMount:{}},
  weaponMountId:(entry,index)=>`${entry.key}:${index}`, weaponPhaseStartMech:mech=>mech,
  destroyedHeatSinkCapacity:()=>0, signatureHeat:()=>0,
  evaluateWeaponAttack:(_a,_t,entry)=>({valid:true,targetNumber:7,weapon:sandbox.BT_WEAPONS[entry.key],damage:sandbox.BT_WEAPONS[entry.key].damage}),
  BT_WEAPONS:{laser:{name:'Medium Laser',damage:5,heat:3,ranges:{short:3,medium:6,long:9}}}
};
vm.createContext(sandbox);
const load = relative => vm.runInContext(fs.readFileSync(path.join(ROOT,relative),'utf8'),sandbox,{filename:relative});
load('js/ai/engine.js');
load('js/ai/opponent.js');

const ai={instanceId:'ai-1',unitId:'ai',owner:2,col:8,row:8,facing:3,armor:{ct:20},structure:{ct:15},heat:0};
const enemy={instanceId:'human-1',unitId:'human',owner:1,col:3,row:8,facing:0,armor:{ct:20},structure:{ct:15}};
sandbox.BT_UNITS.ai={name:'AI',tons:50,heat_sink_capacity:10,weapons:[{key:'laser',location:'Right Arm',count:1}]};
sandbox.BT_UNITS.human={name:'Human',tons:50,weapons:[]};
sandbox.mechInstances=[ai,enemy];

const difficulties=['beginner','intermediate','advanced','expert'].map(key=>sandbox.aiSettingsFor(key,'balanced'));
check('difficulty tiers progressively increase legal search breadth',difficulties.every((setting,index)=>!index||setting.searchBreadth>difficulties[index-1].searchBreadth),JSON.stringify(difficulties.map(setting=>setting.searchBreadth)));
check('difficulty never changes legal-action probabilities or dice',difficulties.every(setting=>setting.moveChance===1&&setting.attackChance===1));
check('difficulty tiers progressively narrow their reasonable-choice shortlist',difficulties.every((setting,index)=>!index||setting.choicePool<difficulties[index-1].choicePool),JSON.stringify(difficulties.map(setting=>setting.choicePool)));

const cautious=sandbox.aiSettingsFor('advanced','cautious');
const aggressive=sandbox.aiSettingsFor('advanced','aggressive');
check('cautious doctrine keeps a lower post-sink heat ceiling than aggressive doctrine',cautious.maxProjectedHeat<aggressive.maxProjectedHeat,`${cautious.maxProjectedHeat} vs ${aggressive.maxProjectedHeat}`);
const near={col:6,row:8,facing:3,hexes:2,path:[{action:'step',col:7,row:8},{action:'step',col:6,row:8}]};
const far={col:10,row:8,facing:0,hexes:2,path:[{action:'step',col:9,row:8},{action:'step',col:10,row:8}]};
const cautiousCoord=sandbox.buildAIForceCoordination([ai],[enemy],cautious,null);
const brawlerSettings=sandbox.aiSettingsFor('advanced','brawler');
const brawlerCoord=sandbox.buildAIForceCoordination([ai],[enemy],brawlerSettings,null);
const cautiousNear=sandbox.aiScoreDestination(ai,near,[enemy],'walk',cautiousCoord).total;
const cautiousFar=sandbox.aiScoreDestination(ai,far,[enemy],'walk',cautiousCoord).total;
const brawlerNear=sandbox.aiScoreDestination(ai,near,[enemy],'walk',brawlerCoord).total;
const brawlerFar=sandbox.aiScoreDestination(ai,far,[enemy],'walk',brawlerCoord).total;
check('brawler doctrine values closing range more strongly than cautious doctrine',(brawlerNear-brawlerFar)>(cautiousNear-cautiousFar),JSON.stringify({cautiousNear,cautiousFar,brawlerNear,brawlerFar}));

sandbox.currentMatchConfig.victory_mode='control';
sandbox.currentMatchConfig.objective_hexes=['1008'];
const balanced=sandbox.aiSettingsFor('advanced','balanced');
const objective=sandbox.aiSettingsFor('advanced','objective');
const balancedScore=sandbox.aiScoreDestination(ai,far,[enemy],'walk',sandbox.buildAIForceCoordination([ai],[enemy],balanced,null));
const objectiveScore=sandbox.aiScoreDestination(ai,far,[enemy],'walk',sandbox.buildAIForceCoordination([ai],[enemy],objective,null));
check('objective personality gives objective hexes additional weight',objectiveScore.objectiveScore>balancedScore.objectiveScore,`${objectiveScore.objectiveScore} vs ${balancedScore.objectiveScore}`);
const approachScore=sandbox.aiScoreDestination(ai,{...far,col:9},[enemy],'walk',sandbox.buildAIForceCoordination([ai],[enemy],balanced,null));
check('control-mode AI values progress toward an objective before reaching its exact hex',approachScore.objectiveProgress>0&&approachScore.objectiveDistance===1,JSON.stringify(approachScore));
sandbox.currentMatchConfig.victory_mode='breakthrough';sandbox.currentMatchConfig.objective_hexes=[];
const breakthroughScore=sandbox.aiScoreDestination(ai,near,[enemy],'walk',sandbox.buildAIForceCoordination([ai],[enemy],balanced,null));
check('breakthrough-mode AI advances toward the opposing deployment zone',breakthroughScore.objectiveProgress>0&&breakthroughScore.objectiveTarget==='0208',JSON.stringify(breakthroughScore));
sandbox.currentMatchConfig.breakthrough_scored_units=[ai.instanceId];
check('a BattleMech that already scored a breakthrough returns to ordinary tactics',sandbox.aiVictoryTargets(ai).length===0);
sandbox.currentMatchConfig={map_id:'training-grounds',ruleset:'advanced_3060',victory_mode:'annihilation',objective_hexes:[]};

const contextA=sandbox.createAIPlanningContext('advanced',{ai_seed:'ai6',ai_personality:'sniper'},[ai,enemy]);
const contextB=sandbox.createAIPlanningContext('advanced',{ai_seed:'ai6',ai_personality:'sniper'},[ai,enemy]);
check('personality is part of the replayable decision context',contextA.personality==='sniper'&&contextA.snapshot.aiPersonality==='sniper');
check('AI-6 remains deterministic for an identical tier, personality and battlefield',contextA.seed===contextB.seed&&contextA.random()===contextB.random());
const changed=sandbox.createAIPlanningContext('advanced',{ai_seed:'ai6',ai_personality:'brawler'},[ai,enemy]);
check('changing personality changes the audited battlefield snapshot',changed.snapshotHash!==contextA.snapshotHash);

const index=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const state=fs.readFileSync(path.join(ROOT,'js/ai/state.js'),'utf8');
const create=fs.readFileSync(path.join(ROOT,'js/network/create-vs-ai.js'),'utf8');
check('Dropship exposes difficulty and personality controls',index.includes('ai-difficulty-select')&&index.includes('ai-personality-select'));
check('AI selections are retained locally and pinned into each new match',state.includes('btech-vtt-ai-personality')&&create.includes('ai_personality: aiPersonality'));
const stored=new Map();
const elements={
  'ai-difficulty-select':{value:'beginner'},
  'ai-personality-select':{value:'balanced'},
  'ai-opponent-summary':{textContent:''}
};
const stateSandbox={
  localStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)},
  document:{getElementById:id=>elements[id]||null},
  titleCase:value=>String(value).replace(/\b\w/g,letter=>letter.toUpperCase())
};
vm.createContext(stateSandbox);
vm.runInContext(state,stateSandbox,{filename:'js/ai/state.js'});
stateSandbox.setAIOpponentOptions('expert','objective');
check('Dropship selection updates its readable summary and browser preference',elements['ai-opponent-summary'].textContent==='Expert · Objective Focused'&&stored.get('btech-vtt-ai-difficulty')==='expert'&&stored.get('btech-vtt-ai-personality')==='objective',elements['ai-opponent-summary'].textContent);

if(failures.length){console.error(`\n${failures.length} AI-6 regression failure(s).`);process.exitCode=1;}
else console.log('\nAI-6 difficulty and personality regression passed.');
