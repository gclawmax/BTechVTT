// ── AI-7 DETERMINISTIC EVALUATION ───────────────────────
// This is an offline planner tournament. It uses the production catalogue,
// maps, legality evaluators and AI planners, but writes no database matches.
// Live acceptance tests separately verify the authoritative server boundary.

const AI_EVALUATION_DIFFICULTIES = ['beginner','intermediate','advanced','expert'];
const AI_EVALUATION_PERSONALITIES = ['balanced','aggressive','cautious','brawler','sniper','objective'];
const AI_EVALUATION_MAPS = ['training-grounds','woodland-approach','ridge-and-ford','industrial-crossing','weathered-frontier','standard-single-sheet'];
const AI_EVALUATION_VICTORIES = ['annihilation','control','breakthrough'];

function aiEvaluationCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function aiEvaluationDurability(mech) {
  return ['armor','structure'].reduce((total,key)=>total+Object.values(mech?.[key]||{}).reduce((sum,value)=>sum+Math.max(0,Number(value)||0),0),0);
}

function aiEvaluationEligibleUnits(ruleset = 'advanced_3060') {
  const ids = typeof databaseSupportedUnitIds !== 'undefined' && databaseSupportedUnitIds.size
    ? [...databaseSupportedUnitIds] : Object.keys(BT_UNITS || {});
  return ids.map(unitId=>({unitId,unit:typeof getSupportedUnit==='function'?getSupportedUnit(unitId):BT_UNITS[unitId]}))
    .filter(({unitId,unit})=>unit&&!unit.customDesign&&unit.armor&&unit.structure&&Number(unit.movement?.walk||0)>0&&
      (unit.weapons||[]).some(entry=>!(typeof weaponProfile==='function'?weaponProfile(entry):entry.weapon)?.supportOnly)&&
      (typeof unitRulesetStatus!=='function'||unitRulesetStatus(unitId,unit,ruleset).allowed))
    .sort((left,right)=>left.unitId.localeCompare(right.unitId));
}

function aiEvaluationOpenHex(preferredCol, preferredRow, occupied = null) {
  const occupiedHexes=new Set((Array.isArray(occupied)?occupied:occupied?[occupied]:[]).map(hex=>`${hex.col},${hex.row}`));
  const candidates=[];
  for(let radius=0;radius<Math.max(GRID_COLS,GRID_ROWS);radius++) for(let col=0;col<GRID_COLS;col++) for(let row=0;row<GRID_ROWS;row++) {
    if(Math.abs(col-preferredCol)+Math.abs(row-preferredRow)!==radius) continue;
    if(occupiedHexes.has(`${col},${row}`)) continue;
    if(typeof terrainMovementBlocked!=='function'||!terrainMovementBlocked(col,row)) candidates.push({col,row});
  }
  return candidates[0]||{col:preferredCol,row:preferredRow};
}

function aiEvaluationMech(unitId, owner, position, index = 0) {
  const unit=typeof getSupportedUnit==='function'?getSupportedUnit(unitId):BT_UNITS[unitId];
  const mech={
    instanceId:`eval-p${owner}-${index}-${unitId}`,unitId,owner,col:position.col,row:position.row,
    facing:owner===1?0:3,torsoFacing:owner===1?0:3,
    armor:{...(unit.armor||{})},structure:{...(unit.structure||{})},
    ammoBins:(unit.ammoBins||[]).map(bin=>({...bin,maxShots:bin.maxShots??bin.shots})),
    heat:0,roundStartingHeat:0,movementHeat:0,weaponHeat:0,externalHeat:0,heatDissipated:0,
    movementMode:null,mpUsed:0,hexesMoved:0,hasMoved:false,hasReacted:false,hasFired:false,
    hasPhysicalAttacked:false,hasManagedHeat:false,destroyed:false,shutdown:false,prone:false,
    pilot:{gunnery:4,piloting:5,hits:0,consciousness:'conscious'},criticalSlotDamage:{},weaponJams:[],destroyedMounts:[]
  };
  const actualOwner=mech.owner; mech.owner=2;
  if(typeof prepareAIAmmoLoadouts==='function') prepareAIAmmoLoadouts([mech]);
  mech.owner=actualOwner;
  return mech;
}

function aiEvaluationApplyDamage(target, amount, seed) {
  let remaining=Math.max(0,Number(amount)||0), applied=0;
  const locations=['ct','lt','rt','la','ra','ll','rl','hd'];
  const offset=Number.parseInt(hashAIValue(seed),16)%locations.length;
  for(let pass=0;pass<locations.length&&remaining>0;pass++) {
    const location=locations[(offset+pass)%locations.length];
    const armor=Math.max(0,Number(target.armor?.[location]||0));
    const armorDamage=Math.min(armor,remaining);
    if(target.armor&&location in target.armor) target.armor[location]=armor-armorDamage;
    remaining-=armorDamage; applied+=armorDamage;
    if(remaining<=0) break;
    const structure=Math.max(0,Number(target.structure?.[location]||0));
    const structureDamage=Math.min(structure,remaining);
    if(target.structure&&location in target.structure) target.structure[location]=structure-structureDamage;
    remaining-=structureDamage; applied+=structureDamage;
    if(location==='ct'&&Number(target.structure?.ct||0)<=0) break;
  }
  if(Number(target.structure?.ct||0)<=0||aiEvaluationDurability(target)<=0) target.destroyed=true;
  return applied;
}

function aiEvaluationConsumeAmmo(actor, action) {
  for(const allocation of action.allocations||[]) for(const [mountId,binId] of Object.entries(allocation.ammo_bins||{})) {
    if(mountId.startsWith('__')) continue;
    const bin=actor.ammoBins?.find(candidate=>candidate.id===binId);
    if(!bin) continue;
    const mode=allocation.ammo_bins?.__fire_modes?.[mountId]||'single';
    bin.shots=Math.max(0,Number(bin.shots||0)-aiWeaponShots(mode));
  }
}

function aiEvaluationViableWeapons(actor, enemies, settings, coordination) {
  const unit=BT_UNITS[actor.unitId];
  if(!unit?.weapons||!enemies.length) return 0;
  return unit.weapons.filter(entry=>enemies.some(target=>aiWeaponModeOptions(actor,entry).some(modeOption=>
    Boolean(scoreWeaponAttack(actor,target,entry,{modeOption,settings,coordination,proneSupportArm:actor.proneSupportArm}))))).length;
}

function aiEvaluationResetRound(mech, round) {
  mech.roundStartingHeat=Number(mech.heat||0); mech.movementHeat=0; mech.weaponHeat=0; mech.externalHeat=0;
  mech.movementMode=null; mech.mpUsed=0; mech.hexesMoved=0; mech.hasMoved=false; mech.hasReacted=false;
  mech.hasFired=false; mech.hasPhysicalAttacked=false; mech.hasManagedHeat=false; mech.torsoFacing=mech.facing;
  mech.weaponPhaseStart=null;
}

function aiEvaluationApplyAction(action, phase, match, seat, metrics) {
  const actor=mechInstances.find(mech=>mech.instanceId===action.instanceId);
  if(action.type==='manage_heat') {
    for(const mech of mechInstances.filter(candidate=>candidate.owner===seat&&!candidate.destroyed)) {
      const unit=BT_UNITS[mech.unitId]||{};
      const sinks=Math.max(0,Number(unit.heat_sink_capacity||unit.heat_sinks||0)-(typeof destroyedHeatSinkCapacity==='function'?destroyedHeatSinkCapacity(mech):0));
      const before=Math.max(0,Number(mech.roundStartingHeat||0)+Number(mech.movementHeat||0)+Number(mech.weaponHeat||0)+Number(mech.externalHeat||0));
      const dissipated=Math.min(before,sinks); mech.heat=Math.max(0,before-dissipated); mech.heatDissipated=dissipated; mech.hasManagedHeat=true;
      metrics.heatDissipated+=dissipated; if(mech.heat>=14) metrics.overheatRounds++;
    }
    return;
  }
  if(!actor) return;
  if(action.type==='move'||action.type==='declare_charge'||action.type==='declare_dfa') {
    actor.col=Number(action.toCol); actor.row=Number(action.toRow); actor.facing=Number(action.facing??actor.facing); actor.torsoFacing=actor.facing;
    actor.movementMode=action.movementMode; actor.mpUsed=Number(action.mpUsed||0); actor.hexesMoved=Number(action.hexesMoved||action.path?.length||0); actor.hasMoved=true;
    actor.movementHeat=action.movementMode==='jump'?Math.max(3,actor.hexesMoved):action.movementMode==='run'?2:action.movementMode==='walk'?1:0;
    metrics.heatGenerated+=actor.movementHeat;
  } else if(action.type==='complete_movement'||action.type==='remain_prone'||action.type==='attempt_stand'||action.type==='attempt_startup') {
    actor.hasMoved=true;
  } else if(action.type==='torso_twist') {
    actor.torsoFacing=(Number(actor.torsoFacing??actor.facing)+(action.direction==='left'?1:-1)+6)%6; actor.hasReacted=true;
  } else if(action.type==='complete_reaction') actor.hasReacted=true;
  else if(action.type==='attack') {
    const groups=action.allocations||[]; const mounts=Math.max(1,groups.reduce((sum,group)=>sum+(group.weapon_mounts||[]).length,0));
    for(const group of groups) {
      const target=mechInstances.find(mech=>mech.instanceId===group.target_instance_id);
      const share=Number(action.expectedDamage||0)*(group.weapon_mounts||[]).length/mounts;
      if(target&&!target.destroyed) metrics.damage+=aiEvaluationApplyDamage(target,share,`${match.seed}:${match.round}:${phase}:${seat}:${group.target_instance_id}`);
    }
    aiEvaluationConsumeAmmo(actor,action); actor.weaponHeat=Number(action.weaponHeat||0); actor.hasFired=true;
    metrics.plannedDamage+=Number(action.expectedDamage||0); metrics.heatGenerated+=actor.weaponHeat; metrics.selectedWeapons+=Number(action.weaponCount||0);
  } else if(action.type==='no_fire'||action.type==='find_club') actor.hasFired=true;
  else if(action.type==='physical_attack') {
    const target=mechInstances.find(mech=>mech.instanceId===action.targetInstanceId);
    if(target&&!target.destroyed) metrics.damage+=aiEvaluationApplyDamage(target,Number(action.expectedDamage||0),`${match.seed}:${match.round}:physical:${seat}`);
    metrics.plannedDamage+=Number(action.expectedDamage||0); actor.hasPhysicalAttacked=true;
  } else if(['resolve_charge','resolve_dfa','no_physical_attack'].includes(action.type)) actor.hasPhysicalAttacked=true;
}

function aiEvaluationObjectives(match) {
  if(match.victory==='control') {
    for(const code of match.objectives) {
      const occupants=new Set(mechInstances.filter(mech=>!mech.destroyed&&hexCode(mech.col,mech.row)===code).map(mech=>Number(mech.owner)));
      if(occupants.size===1){const [seat]=occupants;match.objectiveScores[String(seat)]++;}
    }
  } else if(match.victory==='breakthrough') {
    for(const mech of mechInstances.filter(candidate=>!candidate.destroyed&&!match.breakthroughScored.includes(candidate.instanceId))) {
      const enemySeat=Number(mech.owner)===1?2:1;
      if(scenarioDeploymentZoneContains(enemySeat,mech.col,mech.row,currentMatchConfig)) {
        match.breakthroughScored.push(mech.instanceId);match.objectiveScores[String(mech.owner)]++;
      }
    }
    currentMatchConfig.breakthrough_scored_units=[...match.breakthroughScored];
  }
}

function aiEvaluationWinner(match, maxRounds) {
  const alive=seat=>mechInstances.filter(mech=>mech.owner===seat&&!mech.destroyed);
  if(!alive(1).length&&!alive(2).length) return 0;
  if(!alive(1).length) return 2;
  if(!alive(2).length) return 1;
  if(match.victory==='control') {
    if(match.objectiveScores['1']>=5) return 1;
    if(match.objectiveScores['2']>=5) return 2;
  }
  if(match.victory==='breakthrough') {
    if(match.objectiveScores['1']>=2) return 1;
    if(match.objectiveScores['2']>=2) return 2;
  }
  if(match.round<maxRounds) return null;
  const remaining=seat=>alive(seat).reduce((sum,mech)=>sum+aiEvaluationDurability(mech),0)/Math.max(1,match.startDurability[String(seat)]);
  const one=remaining(1)+match.objectiveScores['1']*.02, two=remaining(2)+match.objectiveScores['2']*.02;
  return Math.abs(one-two)<.001?0:one>two?1:2;
}

async function runSingleAIEvaluation(config) {
  const previous={mechs:mechInstances,state:currentGameState,match:currentMatchConfig,map:activeMapId};
  const started=performance.now();
  try {
    setActiveMap(config.mapId); setActiveTerrainState({});
    const dimensions=mapDimensions(config.mapId), row=Math.floor(dimensions.rows/2),occupied=[];
    const forceOne=config.unitsOne||[config.unitOne],forceTwo=config.unitsTwo||[config.unitTwo];
    const placeForce=(unitIds,owner,col)=>unitIds.map((unitId,index)=>{const position=aiEvaluationOpenHex(col,Math.max(0,Math.min(dimensions.rows-1,row+(index*2)-Math.floor(unitIds.length/2))),occupied);occupied.push(position);return aiEvaluationMech(unitId,owner,position,index);});
    mechInstances=[...placeForce(forceOne,1,Math.max(1,Math.floor(dimensions.cols*.2))),...placeForce(forceTwo,2,Math.min(dimensions.cols-2,Math.floor(dimensions.cols*.8)))];
    const match={seed:config.seed,round:0,mapId:config.mapId,victory:config.victory,objectives:objectiveHexesForMap(config.mapId),objectiveScores:{'1':0,'2':0},
      breakthroughScored:[],startDurability:Object.fromEntries([1,2].map(seat=>[String(seat),mechInstances.filter(mech=>mech.owner===seat).reduce((sum,mech)=>sum+aiEvaluationDurability(mech),0)]))};
    currentMatchConfig={map_id:config.mapId,ruleset:config.ruleset,victory_mode:config.victory,objective_hexes:match.objectives,objective_scores:match.objectiveScores,breakthrough_scored_units:match.breakthroughScored,terrain_overrides:{}};
    const players=[{id:'eval-p1',player_id:'eval-p1',seat_number:1,is_ai:true},{id:'eval-p2',player_id:'eval-p2',seat_number:2,is_ai:true}];
    const blankMetrics=()=>({decisions:0,decisionMs:0,maxDecisionMs:0,illegalActions:0,stalls:0,damage:0,plannedDamage:0,heatGenerated:0,heatDissipated:0,overheatRounds:0,viableWeapons:0,selectedWeapons:0,unusedViableWeapons:0});
    const metricsBySeat={'1':blankMetrics(),'2':blankMetrics()};
    const replay=[]; let winner=null;
    for(let round=1;round<=config.maxRounds&&winner===null;round++) {
      match.round=round; mechInstances.forEach(mech=>{if(!mech.destroyed)aiEvaluationResetRound(mech,round);});
      const initiativeRandom=createSeededAIRandom(`${config.seed}:${round}:initiative`);
      const order=initiativeRandom()<.5?[1,2]:[2,1];
      for(const phase of ['movement','reaction','weapon_attack','physical_attack','heat']) {
        if(phase==='weapon_attack') for(const mech of mechInstances) mech.weaponPhaseStart={round,mech:aiEvaluationCopy({...mech,weaponPhaseStart:null})};
        for(const seat of order) {
          if(!mechInstances.some(mech=>mech.owner===seat&&!mech.destroyed)) continue;
          currentGameState={round,phase,active_player_id:`eval-p${seat}`,initiative_order:order.map(number=>({player_id:`eval-p${number}`,seat_number:number,is_ai:true})),phase_activation:null};
          const side=config.sides[String(seat)], state={...currentMatchConfig,ai_seed:config.seed,ai_difficulty:side.difficulty,ai_personality:side.personality,ai_evaluation_seat:seat};
          const seatMetrics=metricsBySeat[String(seat)];
          const tick=performance.now(); const plan=generateAIPlan(side.difficulty,`eval-p${seat}`,state,players); const elapsed=performance.now()-tick;
          seatMetrics.decisions++; seatMetrics.decisionMs+=elapsed; seatMetrics.maxDecisionMs=Math.max(seatMetrics.maxDecisionMs,elapsed);
          if(!plan.actions.length) seatMetrics.stalls++;
          const settings=aiSettingsFor(side.difficulty,side.personality);
          if(phase==='weapon_attack') for(const actor of mechInstances.filter(mech=>mech.owner===seat&&!mech.destroyed&&!mech.hasFired)) {
            const enemies=mechInstances.filter(mech=>mech.owner!==seat&&!mech.destroyed);
            const coordination=buildAIForceCoordination([actor],enemies,settings,null); const viable=aiEvaluationViableWeapons(actor,enemies,settings,coordination);
            seatMetrics.viableWeapons+=viable;
            const action=plan.actions.find(candidate=>candidate.instanceId===actor.instanceId);
            seatMetrics.unusedViableWeapons+=Math.max(0,viable-Number(action?.weaponCount||0));
          }
          for(const action of plan.actions) {
            const contract=validateAIActionContract(action,phase); if(!contract.valid) seatMetrics.illegalActions++;
            else aiEvaluationApplyAction(action,phase,match,seat,seatMetrics);
          }
          replay.push({round,phase,seat,difficulty:side.difficulty,personality:side.personality,decision_ms:Number(elapsed.toFixed(3)),actions:plan.actions.map(publicAIAction)});
        }
        if(phase==='heat'&&config.victory!=='annihilation') aiEvaluationObjectives(match);
        winner=aiEvaluationWinner(match,config.maxRounds); if(winner!==null) break;
      }
    }
    const duration=performance.now()-started;
    const additive=['decisions','decisionMs','illegalActions','stalls','damage','plannedDamage','heatGenerated','heatDissipated','overheatRounds','viableWeapons','selectedWeapons','unusedViableWeapons'];
    const metrics=blankMetrics();
    for(const key of additive) metrics[key]=Number(metricsBySeat['1'][key]||0)+Number(metricsBySeat['2'][key]||0);
    metrics.maxDecisionMs=Math.max(metricsBySeat['1'].maxDecisionMs,metricsBySeat['2'].maxDecisionMs);
    for(const seatMetrics of Object.values(metricsBySeat)) {
      seatMetrics.meanDecisionMs=Number((seatMetrics.decisionMs/Math.max(1,seatMetrics.decisions)).toFixed(3));
      seatMetrics.heatEfficiency=Number((seatMetrics.damage/Math.max(1,seatMetrics.heatGenerated)).toFixed(3));
      seatMetrics.unusedWeaponRate=Number((seatMetrics.unusedViableWeapons/Math.max(1,seatMetrics.viableWeapons)*100).toFixed(1));
    }
    return {id:config.id,seed:config.seed,mapId:config.mapId,victory:config.victory,ruleset:config.ruleset,sides:config.sides,units:{'1':forceOne,'2':forceTwo},rounds:match.round,winner,
      objectiveScores:match.objectiveScores,remainingDurability:Object.fromEntries([1,2].map(seat=>[String(seat),Number((mechInstances.filter(mech=>mech.owner===seat&&!mech.destroyed).reduce((sum,mech)=>sum+aiEvaluationDurability(mech),0)/Math.max(1,match.startDurability[String(seat)])*100).toFixed(1))])),
      metrics:{...metrics,meanDecisionMs:Number((metrics.decisionMs/Math.max(1,metrics.decisions)).toFixed(3)),maxDecisionMs:Number(metrics.maxDecisionMs.toFixed(3)),heatEfficiency:Number((metrics.damage/Math.max(1,metrics.heatGenerated)).toFixed(3)),unusedWeaponRate:Number((metrics.unusedViableWeapons/Math.max(1,metrics.viableWeapons)*100).toFixed(1)),durationMs:Number(duration.toFixed(1))},
      metricsBySeat,
      failed:metrics.illegalActions>0||metrics.stalls>0,replay};
  } catch(error) {
    return {id:config.id,seed:config.seed,mapId:config.mapId,victory:config.victory,sides:config.sides,units:{'1':config.unitsOne||[config.unitOne],'2':config.unitsTwo||[config.unitTwo]},rounds:0,winner:null,failed:true,error:error.message||String(error),metrics:{illegalActions:0,stalls:1},replay:[]};
  } finally {
    mechInstances=previous.mechs; currentGameState=previous.state; currentMatchConfig=previous.match; setActiveMap(previous.map); setActiveTerrainState(previous.match||{});
  }
}

function summarizeAIEvaluation(matches) {
  const summary={matches:matches.length,completed:0,draws:0,failures:0,illegalActions:0,stalls:0,rounds:0,decisions:0,damage:0,heatGenerated:0,heatDissipated:0,unusedViableWeapons:0,viableWeapons:0,decisionMs:0,maxDecisionMs:0,objectivePoints:0,byDifficulty:{},byPersonality:{},byMap:{},byVictory:{}};
  const group=(collection,key)=>collection[key]||(collection[key]={appearances:0,wins:0,losses:0,draws:0,winRate:0,damage:0,heatGenerated:0,heatEfficiency:0,viableWeapons:0,unusedViableWeapons:0,unusedWeaponRate:0,objectivePoints:0});
  for(const match of matches) {
    summary.completed+=match.winner===null?0:1; summary.draws+=match.winner===0?1:0; summary.failures+=match.failed?1:0;
    for(const key of ['illegalActions','stalls','decisions','damage','heatGenerated','heatDissipated','unusedViableWeapons','viableWeapons']) summary[key]+=Number(match.metrics?.[key]||0);
    summary.rounds+=Number(match.rounds||0); summary.decisionMs+=Number(match.metrics?.decisionMs||0); summary.maxDecisionMs=Math.max(summary.maxDecisionMs,Number(match.metrics?.maxDecisionMs||0));
    summary.objectivePoints+=Number(match.objectiveScores?.['1']||0)+Number(match.objectiveScores?.['2']||0);
    for(const seat of [1,2]) for(const [collection,key] of [[summary.byDifficulty,match.sides?.[String(seat)]?.difficulty],[summary.byPersonality,match.sides?.[String(seat)]?.personality]]) {
      if(!key) continue; const item=group(collection,key),seatMetrics=match.metricsBySeat?.[String(seat)]||{}; item.appearances++; if(match.winner===0)item.draws++;else if(match.winner===seat)item.wins++;else item.losses++;
      item.damage+=Number(seatMetrics.damage||0); item.heatGenerated+=Number(seatMetrics.heatGenerated||0); item.viableWeapons+=Number(seatMetrics.viableWeapons||0); item.unusedViableWeapons+=Number(seatMetrics.unusedViableWeapons||0); item.objectivePoints+=Number(match.objectiveScores?.[String(seat)]||0);
    }
    for(const [collection,key] of [[summary.byMap,match.mapId],[summary.byVictory,match.victory]]) {const item=group(collection,key);item.appearances++;item.completed=(item.completed||0)+(match.winner===null?0:1);item.draws+=match.winner===0?1:0;item.failures=(item.failures||0)+(match.failed?1:0);item.rounds=(item.rounds||0)+Number(match.rounds||0);item.objectivePoints+=Number(match.objectiveScores?.['1']||0)+Number(match.objectiveScores?.['2']||0);}
  }
  for(const collection of [summary.byDifficulty,summary.byPersonality]) for(const item of Object.values(collection)) {
    item.winRate=Number((item.wins/Math.max(1,item.wins+item.losses)*100).toFixed(1)); item.heatEfficiency=Number((item.damage/Math.max(1,item.heatGenerated)).toFixed(3)); item.unusedWeaponRate=Number((item.unusedViableWeapons/Math.max(1,item.viableWeapons)*100).toFixed(1));
  }
  for(const collection of [summary.byMap,summary.byVictory]) for(const item of Object.values(collection)) {item.averageRounds=Number(((item.rounds||0)/Math.max(1,item.appearances)).toFixed(2));item.averageObjectivePoints=Number((item.objectivePoints/Math.max(1,item.appearances)).toFixed(2));}
  summary.averageRounds=Number((summary.rounds/Math.max(1,summary.matches)).toFixed(2));
  summary.meanDecisionMs=Number((summary.decisionMs/Math.max(1,summary.decisions)).toFixed(3));
  summary.heatEfficiency=Number((summary.damage/Math.max(1,summary.heatGenerated)).toFixed(3));
  summary.unusedWeaponRate=Number((summary.unusedViableWeapons/Math.max(1,summary.viableWeapons)*100).toFixed(1));
  return summary;
}

function selectAIEvaluationReplays(matches, representativeLimit = 6) {
  const failures=matches.filter(match=>match.failed);
  const selected=[], seen=new Set();
  for(const match of matches.filter(candidate=>!candidate.failed)) {
    if(selected.length>=representativeLimit) break;
    const key=`${match.winner}:${match.mapId}:${match.victory}`; if(seen.has(key))continue;
    seen.add(key); selected.push(match); if(selected.length>=representativeLimit)break;
  }
  return {failures,representatives:selected,discarded:Math.max(0,matches.length-failures.length-selected.length)};
}

async function runAIEvaluationTournament(options = {}) {
  const runs=Math.max(1,Math.min(500,Number(options.runs||12))), maxRounds=Math.max(1,Math.min(50,Number(options.maxRounds||12)));
  const seed=String(options.seed||'ai7-evaluation'),ruleset=String(options.ruleset||'advanced_3060');
  const candidates=aiEvaluationEligibleUnits(ruleset); if(candidates.length<4)throw new Error(`Only ${candidates.length} catalogue BattleMechs are eligible for AI evaluation; four are required for objective forces.`);
  const random=createSeededAIRandom(seed),matches=[];
  for(let index=0;index<runs;index++) {
    const selected=[];while(selected.length<4){const candidate=Math.floor(random()*candidates.length);if(!selected.includes(candidate))selected.push(candidate);}
    const forceSize=index%AI_EVALUATION_VICTORIES.length===0?1:2;
    const config={id:`ai7-${String(index+1).padStart(4,'0')}`,seed:`${seed}:${index+1}`,ruleset,maxRounds,
      mapId:AI_EVALUATION_MAPS[index%AI_EVALUATION_MAPS.length],victory:AI_EVALUATION_VICTORIES[index%AI_EVALUATION_VICTORIES.length],
      unitOne:candidates[selected[0]].unitId,unitTwo:candidates[selected[2]].unitId,
      unitsOne:selected.slice(0,forceSize).map(candidate=>candidates[candidate].unitId),unitsTwo:selected.slice(2,2+forceSize).map(candidate=>candidates[candidate].unitId),
      sides:{'1':{difficulty:AI_EVALUATION_DIFFICULTIES[index%4],personality:AI_EVALUATION_PERSONALITIES[index%6]},'2':{difficulty:AI_EVALUATION_DIFFICULTIES[(index+2)%4],personality:AI_EVALUATION_PERSONALITIES[(index*3+1)%6]}}};
    matches.push(await runSingleAIEvaluation(config));
  }
  const representativeLimit=options.representativeLimit===undefined?6:Number(options.representativeLimit);
  return {engineVersion:BT_AI_ENGINE_VERSION,seed,runs,maxRounds,ruleset,eligibleUnits:candidates.length,summary:summarizeAIEvaluation(matches),retention:selectAIEvaluationReplays(matches,representativeLimit),matches:matches.map(({replay,...match})=>match)};
}
