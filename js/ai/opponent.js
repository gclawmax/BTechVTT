// ── AI OPPONENT SYSTEM ──────────────────────────────────────
let aiTurnInProgress = false;

// Difficulty controls deliberation quality, never rules, dice or information.
// Personality is an independent doctrine layer: it changes tactical weights
// but never the legal actions available to the computer opponent.
const AI_SETTINGS = {
  beginner: {
    moveChance: 1,
    attackChance: 1,
    targetPriority: 'reasonable',
    movementRange: 1, // hexes per turn
    heatManagement: false,
    planningHorizon: 1,
    maxProjectedHeat: 18,
    ammoConservation: 0,
    searchBreadth: 48,
    choicePool: 6,
    reasonableMargin: 8
  },
  intermediate: {
    moveChance: 1,
    attackChance: 1,
    targetPriority: 'closest',
    movementRange: 2,
    heatManagement: true,
    planningHorizon: 2,
    maxProjectedHeat: 13,
    ammoConservation: 0.05,
    searchBreadth: 120,
    choicePool: 3,
    reasonableMargin: 4
  },
  advanced: {
    moveChance: 1,
    attackChance: 1,
    targetPriority: 'strongest',
    movementRange: 3,
    heatManagement: true,
    planningHorizon: 3,
    maxProjectedHeat: 10,
    ammoConservation: 0.1,
    searchBreadth: 320,
    choicePool: 2,
    reasonableMargin: 2
  },
  expert: {
    moveChance: 1.0,
    attackChance: 1,
    targetPriority: 'optimal',
    movementRange: 3,
    heatManagement: true,
    planningHorizon: 5,
    maxProjectedHeat: 7,
    ammoConservation: 0.15,
    searchBreadth: 1800,
    choicePool: 1,
    reasonableMargin: 0
  }
};

const AI_PERSONALITIES = {
  balanced: { rangeOffset:0, rangeWeight:1, coverWeight:1, hazardWeight:1, heatAllowance:0, heatAversion:1, objectiveWeight:1, formationWeight:1, retreatRatio:.55, physicalWeight:1, punchWeight:1, kickWeight:1, pushWeight:1, riskTolerance:1 },
  aggressive: { rangeOffset:-1, rangeWeight:1.1, coverWeight:.75, hazardWeight:.8, heatAllowance:4, heatAversion:.6, objectiveWeight:1, formationWeight:.8, retreatRatio:.38, physicalWeight:1.2, punchWeight:1.1, kickWeight:1.15, pushWeight:.8, riskTolerance:1.35 },
  cautious: { rangeOffset:2, rangeWeight:1, coverWeight:1.55, hazardWeight:1.4, heatAllowance:-3, heatAversion:1.6, objectiveWeight:.8, formationWeight:1.2, retreatRatio:.75, physicalWeight:.7, punchWeight:.8, kickWeight:.7, pushWeight:1.2, riskTolerance:.55 },
  brawler: { rangeOffset:-3, rangeWeight:1.4, coverWeight:.8, hazardWeight:.9, heatAllowance:1, heatAversion:.85, objectiveWeight:.8, formationWeight:.8, retreatRatio:.48, physicalWeight:1.65, punchWeight:1.35, kickWeight:1.3, pushWeight:.9, riskTolerance:1.25 },
  sniper: { rangeOffset:3, rangeWeight:1.35, coverWeight:1.25, hazardWeight:1.1, heatAllowance:-1, heatAversion:1.25, objectiveWeight:.7, formationWeight:1, retreatRatio:.62, physicalWeight:.55, punchWeight:.7, kickWeight:.65, pushWeight:1.1, riskTolerance:.7 },
  objective: { rangeOffset:0, rangeWeight:.8, coverWeight:1, hazardWeight:1, heatAllowance:0, heatAversion:1, objectiveWeight:2.5, formationWeight:1.15, retreatRatio:.55, physicalWeight:1, punchWeight:1, kickWeight:1, pushWeight:1.2, riskTolerance:1 }
};

function normaliseAIPersonality(value) {
  return AI_PERSONALITIES[value] ? value : 'balanced';
}

function aiSettingsFor(difficulty, personality) {
  const key = AI_SETTINGS[difficulty] ? difficulty : 'beginner';
  const personalityKey = normaliseAIPersonality(personality);
  const doctrine = AI_PERSONALITIES[personalityKey];
  return {
    ...AI_SETTINGS[key],
    difficulty: key,
    personality: personalityKey,
    personalityProfile: doctrine,
    maxProjectedHeat: Math.max(0, AI_SETTINGS[key].maxProjectedHeat + doctrine.heatAllowance)
  };
}

function aiChooseRanked(options, settings, context, score = option => option.score ?? option.scoreBreakdown?.total ?? 0) {
  if (!options.length) return null;
  const ranked = [...options].sort((a, b) => score(b) - score(a));
  const bestScore = score(ranked[0]);
  const reasonable = ranked.filter(option => score(option) >= bestScore - Number(settings.reasonableMargin || 0));
  const pool = reasonable.slice(0, Math.max(1, Number(settings.choicePool || 1)));
  if (pool.length === 1) return pool[0];
  const random = context?.random?.() ?? Math.random();
  // Intermediate/Advanced bias toward the front of their short-list. Beginner
  // samples the reasonable set uniformly, making mistakes without acting at random.
  const exponent = settings.difficulty === 'beginner' ? 1 : settings.difficulty === 'intermediate' ? 1.7 : 2.5;
  return pool[Math.min(pool.length - 1, Math.floor(Math.pow(random, exponent) * pool.length))];
}

function aiSampleCandidates(candidates, settings, context) {
  const limit = Math.max(1, Number(settings.searchBreadth || candidates.length));
  if (candidates.length <= limit) return candidates;
  const seed = context?.seed || 'ai-search';
  return [...candidates].sort((left, right) => {
    const leftHash = Number.parseInt(hashAIValue(`${seed}:${left.col}:${left.row}:${left.facing}:${left.cost}`), 16);
    const rightHash = Number.parseInt(hashAIValue(`${seed}:${right.col}:${right.row}:${right.facing}:${right.cost}`), 16);
    return leftHash - rightHash;
  }).slice(0, limit);
}

// AI plan generator - creates movement and attack plans
function generateAIPlan(difficulty, aiPlayerId, gameState, allPlayers) {
  const personality = normaliseAIPersonality(gameState?.ai_personality || (typeof aiPersonality !== 'undefined' ? aiPersonality : 'balanced'));
  const settings = aiSettingsFor(difficulty, personality);
  const context = createAIPlanningContext(settings.difficulty, { ...gameState, ai_personality: personality }, mechInstances);
  const aiPlan = {
    type: 'ai_plan',
    engineVersion: BT_AI_ENGINE_VERSION,
    decisionId: context.decisionId,
    seed: context.seed,
    snapshotHash: context.snapshotHash,
    phase: currentGameState.phase,
    difficulty: settings.difficulty,
    personality,
    timestamp: Date.now(),
    actions: []
  };
  
  // Get AI's mech instances
  const aiMechs = mechInstances.filter(inst => inst.owner === 2); // Owner 2 = AI
  
  if (aiMechs.length === 0) {
    console.warn('No AI mechs found for plan generation');
    return aiPlan;
  }
  
  // Get player mechs (owner 1 = human)
  const playerMechs = mechInstances.filter(inst => inst.owner === 1 && !inst.destroyed &&
    (typeof isEnemyHiddenUnit !== 'function' || !isEnemyHiddenUnit(inst)));
  const coordination = buildAIForceCoordination(aiMechs, playerMechs, settings, context);
  aiPlan.coordination = coordination.summary;
  const orderedAIMechs = orderAIActivations(aiMechs, currentGameState.phase, coordination);
  const weaponAllowance = currentGameState.phase === 'weapon_attack' && typeof currentActivationAllowance === 'function'
    ? currentActivationAllowance('weapon_attack') : aiMechs.length;
  const conscious = mech => !mech.pilot?.consciousness || mech.pilot.consciousness === 'conscious';
  const weaponActors = new Set(orderedAIMechs.filter(mech => !mech.hasFired && !mech.destroyed && !mech.shutdown && conscious(mech))
    .slice(0, Math.max(1, weaponAllowance)).map(mech => mech.instanceId));
  const movementAllowance = currentGameState.phase === 'movement' && typeof currentActivationAllowance === 'function'
    ? currentActivationAllowance('movement') : aiMechs.length;
  const movementActors = new Set(orderedAIMechs.filter(mech => !mech.hasMoved && !mech.destroyed && conscious(mech))
    .slice(0, Math.max(1, movementAllowance)).map(mech => mech.instanceId));
  const phaseAllowance = typeof currentActivationAllowance === 'function' ? currentActivationAllowance(currentGameState.phase) : orderedAIMechs.length;
  const reactionActors = new Set(orderedAIMechs.filter(mech => !mech.hasReacted && !mech.destroyed && !mech.shutdown && conscious(mech)).slice(0,Math.max(1,phaseAllowance)).map(mech=>mech.instanceId));
  const physicalActors = new Set(orderedAIMechs.filter(mech => !mech.hasPhysicalAttacked && !mech.destroyed && !mech.shutdown && conscious(mech)).slice(0,Math.max(1,phaseAllowance)).map(mech=>mech.instanceId));
  
  // Generate one explicit action or pass for every eligible AI BattleMech.
  // A weak difficulty may choose a conservative pass, but it may never omit
  // the activation and leave the match waiting forever.
  for (const mech of orderedAIMechs) {
    // The algorithmic AI is phase-scoped: Movement can only create movement
    // actions; Weapon Attack can only create attack actions.
    if (currentGameState.phase === 'movement' && movementActors.has(mech.instanceId)) {
      const canConsiderMove = !mech.shutdown && (!mech.pilot?.consciousness || mech.pilot.consciousness === 'conscious');
      if (mech.shutdown) aiPlan.actions.push({ type: 'attempt_startup', instanceId: mech.instanceId, reason: 'Attempt reactor startup.' });
      else if (mech.prone) {
        const mobility = criticalMovementProfile(mech);
        const cannotStand = mobility.destroyedLegs >= 2 || mobility.gyroDestroyed;
        aiPlan.actions.push(cannotStand || Number(mech.heat || 0) >= 20
          ? { type: 'remain_prone', instanceId: mech.instanceId, reason: cannotStand ? 'Critical damage prevents standing.' : 'Remain prone while dangerously hot.' }
          : { type: 'attempt_stand', instanceId: mech.instanceId, reason: 'Attempt to regain mobility.' });
      } else {
        const moveAction = canConsiderMove && context.random() < settings.moveChance
          ? generateAIMoveAction(mech, playerMechs, settings, context, coordination) : null;
        aiPlan.actions.push(moveAction || { type: 'complete_movement', instanceId: mech.instanceId, reason: canConsiderMove ? 'Held the best tactical position.' : 'Unable to move.' });
      }
    }

    if (currentGameState.phase === 'weapon_attack' && weaponActors.has(mech.instanceId)) {
      const canConsiderFire = !mech.shutdown && conscious(mech);
      const attackAction = canConsiderFire && context.random() < settings.attackChance
        ? generateAIAttackAction(mech, playerMechs, settings, context, coordination) : null;
      const clubAction = !attackAction && canConsiderFire ? generateAIClubSearchAction(mech, playerMechs, settings) : null;
      aiPlan.actions.push(attackAction || clubAction || { type: 'no_fire', instanceId: mech.instanceId, reason: canConsiderFire ? 'No legal shot selected.' : 'Unable to fire.' });
    }

    if (currentGameState.phase === 'reaction' && reactionActors.has(mech.instanceId)) {
      aiPlan.actions.push(generateAIReactionAction(mech, playerMechs, context));
    }

    if (currentGameState.phase === 'physical_attack' && physicalActors.has(mech.instanceId)) {
      aiPlan.actions.push(generateAIPhysicalAction(mech, playerMechs, settings, context) || { type: 'no_physical_attack', instanceId: mech.instanceId, reason: 'No legal physical attack.' });
    }
  }

  if (currentGameState.phase === 'heat') aiPlan.actions.push({ type: 'manage_heat', reason: 'Resolve every outstanding AI heat ledger.' });

  aiPlan.actions = aiPlan.actions.filter(action => {
    const check = validateAIActionContract(action, currentGameState.phase);
    if (!check.valid) console.error('[BT-AI] Rejected planned action:', check.reason, action);
    return check.valid;
  });
  aiPlan.decision = registerAIPlan(context, aiPlan.actions);
  aiPlan.decision.coordination = coordination.summary;
  aiPlan.decision.personality = personality;
  
  return aiPlan;
}

function generateAIPhysicalAction(mech, targets, settings = AI_SETTINGS.expert, context = null) {
  if (mech.dfaDeclaration) return { type:'resolve_dfa',instanceId:mech.instanceId,targetInstanceId:mech.dfaDeclaration.target_instance_id,attackType:'dfa',_debug:'Resolve Movement-declared DFA.' };
  if (mech.chargeDeclaration) return { type:'resolve_charge',instanceId:mech.instanceId,targetInstanceId:mech.chargeDeclaration.target_instance_id,attackType:'charge',_debug:'Resolve Movement-declared Charge.' };
  const choices=[];
  for (const target of targets) for (const attackType of physicalAttackTypesFor(mech)) {
    const legalLimbs=physicalLimbCandidates(attackType).filter(limb=>evaluatePhysicalAttack(mech,target,attackType,limb).valid);
    if (!legalLimbs.length) continue;
    const limbs=attackType==='punch' ? legalLimbs : [legalLimbs[0]];
    const attacks=limbs.map(limb=>evaluatePhysicalAttack(mech,target,attackType,limb));
    const chance=toHitProbability(Math.max(...attacks.map(attack=>attack.targetNumber)));
    const damage=attacks.reduce((sum,attack)=>sum+Number(attack.damage||0),0);
    const stability=attackType==='kick'?3:attackType==='push'?2:0;
    const doctrine=settings.personalityProfile||AI_PERSONALITIES.balanced;
    const typeWeight=attackType==='punch'?doctrine.punchWeight:attackType==='kick'?doctrine.kickWeight:attackType==='push'?doctrine.pushWeight:1;
    choices.push({target,attackType,limbs,score:chance*(damage+stability)*doctrine.physicalWeight*typeWeight,expectedDamage:chance*damage,targetNumber:Math.max(...attacks.map(attack=>attack.targetNumber))});
  }
  choices.sort((a,b)=>b.score-a.score||b.expectedDamage-a.expectedDamage||String(a.target.instanceId).localeCompare(String(b.target.instanceId)));
  const best=aiChooseRanked(choices,settings,context);
  return best?{type:'physical_attack',instanceId:mech.instanceId,targetInstanceId:best.target.instanceId,attackType:best.attackType,limbs:best.limbs,expectedDamage:best.expectedDamage,_debug:`${best.attackType} ${best.targetNumber}+; EV ${best.expectedDamage.toFixed(1)}`} : null;
}

function generateAIClubSearchAction(mech, targets, settings) {
  if (typeof canSearchForImprovisedClub !== 'function' || !canSearchForImprovisedClub(mech)) return null;
  const adjacent = targets.some(target => axialDistance(mech.col, mech.row, target.col, target.row) === 1);
  const doctrine=settings.personalityProfile||AI_PERSONALITIES.balanced;
  if ((!adjacent && Number(settings.planningHorizon || 1) < 3) || doctrine.physicalWeight < .65) return null;
  return { type: 'find_club', instanceId: mech.instanceId, reason: adjacent ? 'Prepare an improvised club for the imminent Physical Attack phase.' : 'Prepare an improvised club for close combat.' };
}

function aiCurrentDurability(mech) {
  return ['armor', 'structure'].reduce((total, key) => total + Object.values(mech[key] || {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0), 0);
}

function aiUnitCapabilities(mech) {
  const unit = BT_UNITS[mech.unitId] || {};
  const weapons = unit.weapons || [];
  const keys = weapons.map(entry => String(entry.key || '').toLowerCase());
  const damage = weapons.reduce((sum, entry) => sum + Math.max(0, Number((typeof weaponProfile === 'function' ? weaponProfile(entry) : null)?.damage || 0)) * Math.max(1, Number(entry.count || 1)), 0);
  const electronic = labels => typeof hasOperationalElectronicEquipment === 'function' && hasOperationalElectronicEquipment(mech, labels);
  return {
    damage,
    tonnage: Number(unit.tonnage || unit.tons || 50),
    designator: keys.some(key => ['tag', 'c3_master_tag', 'narc'].includes(key)),
    tag: keys.some(key => ['tag', 'c3_master_tag'].includes(key)),
    narc: keys.includes('narc'),
    missiles: keys.some(key => /^(lrm|mml|atm|srm)/.test(key)),
    ecm: typeof hasOperationalEcm === 'function' ? hasOperationalEcm(mech) : electronic(['guardianecmsuite', 'ecmsuite', 'angelecmsuite', 'watchdogcews', 'watchdogecm']),
    probe: typeof hasOperationalActiveProbe === 'function' ? hasOperationalActiveProbe(mech) : electronic(['beagleactiveprobe', 'activeprobe', 'lightactiveprobe', 'watchdogcews', 'watchdogecm']),
    c3: Boolean(mech.c3Network),
    mobility: Number(criticalMovementProfile(mech).walk || 0)
  };
}

function buildAIForceCoordination(aiMechs, enemies, settings, context) {
  const doctrine = settings.personalityProfile || AI_PERSONALITIES.balanced;
  const capabilities = Object.fromEntries(aiMechs.map(mech => [mech.instanceId, aiUnitCapabilities(mech)]));
  const enemyScores = enemies.map(enemy => {
    const capability = aiUnitCapabilities(enemy);
    const durability = aiCurrentDurability(enemy);
    const objective = typeof currentMatchConfig !== 'undefined' && (currentMatchConfig.objective_hexes || []).includes(typeof hexCode === 'function' ? hexCode(enemy.col, enemy.row) : '') ? 20 : 0;
    const marked = Number(enemy.taggedRound) === Number(currentGameState.round) || Number(enemy.narcPod?.round) === Number(currentGameState.round) ? 12 : 0;
    return { instanceId: enemy.instanceId, score: capability.damage * 1.5 + capability.tonnage * .15 + objective * doctrine.objectiveWeight + marked + Math.max(0, 80 - durability) * .35, durability };
  }).sort((a, b) => b.score - a.score || String(a.instanceId).localeCompare(String(b.instanceId)));
  const focusTargetId = enemyScores[0]?.instanceId || null;
  const retreating = new Set(aiMechs.filter(mech => {
    const capability = capabilities[mech.instanceId];
    return aiCurrentDurability(mech) < capability.tonnage * doctrine.retreatRatio || Number(mech.pilot?.hits || 0) >= (doctrine.retreatRatio >= .7 ? 3 : 4);
  }).map(mech => mech.instanceId));
  const supportFirst = new Set(aiMechs.filter(mech => capabilities[mech.instanceId].designator).map(mech => mech.instanceId));
  return {
    capabilities, enemyScores, focusTargetId, retreating, supportFirst, settings,
    enabled: Number(settings.planningHorizon || 1) >= 3,
    summary: {
      doctrine: Number(settings.planningHorizon || 1) >= 3 ? 'coordinated' : 'individual',
      personality: settings.personality || 'balanced',
      search_breadth: Number(settings.searchBreadth || 0),
      focus_target_id: focusTargetId,
      target_priority: enemyScores.map(item => item.instanceId),
      support_first: [...supportFirst],
      withdrawing: [...retreating],
      scouts: aiMechs.filter(mech => capabilities[mech.instanceId].probe || capabilities[mech.instanceId].mobility >= 6).map(mech => mech.instanceId),
      missile_support: aiMechs.filter(mech => capabilities[mech.instanceId].missiles).map(mech => mech.instanceId),
      c3_nodes: aiMechs.filter(mech => capabilities[mech.instanceId].c3).map(mech => mech.instanceId),
      ecm_escorts: aiMechs.filter(mech => capabilities[mech.instanceId].ecm).map(mech => mech.instanceId)
    }
  };
}

function orderAIActivations(mechs, phase, coordination) {
  return [...mechs].sort((a, b) => {
    const ac = coordination.capabilities[a.instanceId], bc = coordination.capabilities[b.instanceId];
    if (phase === 'weapon_attack') return Number(bc.designator) - Number(ac.designator) || ac.damage - bc.damage || String(a.instanceId).localeCompare(String(b.instanceId));
    if (phase === 'movement') return Number(coordination.retreating.has(b.instanceId)) - Number(coordination.retreating.has(a.instanceId)) || Number(bc.probe) - Number(ac.probe) || ac.tonnage - bc.tonnage || String(a.instanceId).localeCompare(String(b.instanceId));
    return String(a.instanceId).localeCompare(String(b.instanceId));
  });
}

// Pick a legal one-hexside torso twist toward the nearest opposing 'Mech.
// If the target is outside that arc, the AI deliberately holds its torso
// facing and still completes the required Reaction action.
function generateAIReactionAction(mech, playerMechs, context = null) {
  if (mech.prone || mech.shutdown) return { type: 'complete_reaction', instanceId: mech.instanceId, reason: mech.prone ? 'Prone BattleMechs cannot torso twist.' : 'Shutdown BattleMech.' };
  const target = [...playerMechs].sort((a, b) =>
    axialDistance(mech.col, mech.row, a.col, a.row) - axialDistance(mech.col, mech.row, b.col, b.row)
  )[0];

  if (!target) return { type: 'complete_reaction', instanceId: mech.instanceId, reason: 'No visible target.' };

  let desiredFacing = mech.facing;
  let bestDistance = Infinity;
  for (let direction = 0; direction < 6; direction++) {
    const neighbor = hexNeighbor(mech.col, mech.row, direction);
    const distance = axialDistance(neighbor.col, neighbor.row, target.col, target.row);
    if (distance < bestDistance) {
      bestDistance = distance;
      desiredFacing = direction;
    }
  }

  const torsoFacing = mech.torsoFacing == null ? mech.facing : mech.torsoFacing;
  const turn = (desiredFacing - torsoFacing + 6) % 6;
  if (turn === 1) return { type: 'torso_twist', instanceId: mech.instanceId, direction: 'left', _debug: `Turn toward ${mechLabel(target)}` };
  if (turn === 5) return { type: 'torso_twist', instanceId: mech.instanceId, direction: 'right', _debug: `Turn toward ${mechLabel(target)}` };
  return { type: 'complete_reaction', instanceId: mech.instanceId, reason: 'Current torso arc is preferred.' };
}

function aiFacingToward(col, row, target) {
  let best = 0, distance = Infinity;
  for (let direction = 0; direction < 6; direction++) {
    const hex = hexNeighbor(col, row, direction);
    const next = axialDistance(hex.col, hex.row, target.col, target.row);
    if (next < distance) { best = direction; distance = next; }
  }
  return best;
}

function aiSearchWaypoint(mech) {
  const width = Number(typeof GRID_COLS === 'undefined' ? 16 : GRID_COLS);
  const height = Number(typeof GRID_ROWS === 'undefined' ? 17 : GRID_ROWS);
  const points = [
    { col: Math.floor(width / 2), row: Math.floor(height / 2) },
    { col: Math.max(0, width - 3), row: 2 },
    { col: 2, row: Math.max(0, height - 3) },
    { col: Math.max(0, width - 3), row: Math.max(0, height - 3) },
    { col: 2, row: 2 }
  ];
  const identity = [...String(mech.instanceId || mech.unitId || '')].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return points[(identity + Number(currentGameState.round || 1)) % points.length];
}

function aiKnownEnemyMinefield(mech, col, row) {
  const fields = typeof currentMatchConfig === 'undefined' ? [] : currentMatchConfig.minefields || [];
  return fields.find(field => Number(field.col) === col && Number(field.row) === row && Number(field.owner) !== Number(mech.owner) &&
    (field.revealed_to || []).map(Number).includes(Number(mech.owner))) || null;
}

function aiMovementCandidates(mech, mode, mpMax) {
  const width = Number(typeof GRID_COLS === 'undefined' ? 16 : GRID_COLS);
  const height = Number(typeof GRID_ROWS === 'undefined' ? 17 : GRID_ROWS);
  const occupied = new Set(mechInstances.filter(unit => unit.instanceId !== mech.instanceId && !unit.destroyed).map(unit => `${unit.col},${unit.row}`));
  const terrainCost = (col, row) => typeof movementTerrainCost === 'function' ? movementTerrainCost(col, row) : 0;
  const elevationCost = (a, b, c, d) => typeof movementElevationCost === 'function' ? movementElevationCost(a, b, c, d) : 0;
  const candidates = [{ col: mech.col, row: mech.row, facing: mech.facing, cost: 0, hexes: 0, path: [] }];
  const best = new Map([[`${mech.col},${mech.row},${mech.facing}`, 0]]);
  for (let cursor = 0; cursor < candidates.length && candidates.length < 1800; cursor++) {
    const state = candidates[cursor];
    for (let direction = 0; direction < 6; direction++) {
      const next = hexNeighbor(state.col, state.row, direction);
      if (next.col < 0 || next.col >= width || next.row < 0 || next.row >= height || occupied.has(`${next.col},${next.row}`) || terrainMovementBlocked(next.col, next.row)) continue;
      const rear = direction === (state.facing + 3) % 6;
      if (rear && mode !== 'walk') continue;
      const level = elevationCost(state.col, state.row, next.col, next.row);
      if (level > 2 || (rear && level)) continue;
      const terrain = typeof terrainAt === 'function' ? terrainAt(next.col, next.row) : 'clear';
      if (mode === 'run' && ['shallow_water', 'deep_water'].includes(terrain)) continue;
      const turns = direction === state.facing || rear ? 0 : Math.min(Math.abs(direction - state.facing), 6 - Math.abs(direction - state.facing));
      const cost = state.cost + 1 + turns + terrainCost(next.col, next.row) + level;
      if (cost > mpMax) continue;
      const facing = rear ? state.facing : direction;
      const key = `${next.col},${next.row},${facing}`;
      if ((best.get(key) ?? Infinity) <= cost) continue;
      best.set(key, cost);
      candidates.push({ col: next.col, row: next.row, facing, cost, hexes: state.hexes + 1, path: [...state.path, { action: 'step', col: next.col, row: next.row }] });
    }
  }
  return candidates;
}

function aiScoreDestination(mech, candidate, playerMechs, mode, coordination = null) {
  const settings = coordination?.settings || aiSettingsFor('advanced', 'balanced');
  const doctrine = settings.personalityProfile || AI_PERSONALITIES.balanced;
  const unit = BT_UNITS[mech.unitId] || {};
  const visibleTarget = [...playerMechs].sort((a, b) => axialDistance(candidate.col, candidate.row, a.col, a.row) - axialDistance(candidate.col, candidate.row, b.col, b.row))[0] || null;
  const nearest = visibleTarget || aiSearchWaypoint(mech);
  const range = axialDistance(candidate.col, candidate.row, nearest.col, nearest.row);
  const weaponRanges = (unit.weapons || []).map(entry => Number((typeof weaponProfile === 'function' ? weaponProfile(entry) : null)?.ranges?.medium || 0)).filter(Boolean);
  const basePreferred = weaponRanges.length ? Math.max(2, Math.round(weaponRanges.reduce((a, b) => a + b, 0) / weaponRanges.length)) : 3;
  const preferred = Math.max(1, basePreferred + Number(doctrine.rangeOffset || 0));
  const rangeScore = (visibleTarget ? 18 - Math.abs(range - preferred) * 3 : 16 - range * 2) * doctrine.rangeWeight;
  const terrain = typeof terrainAt === 'function' ? terrainAt(candidate.col, candidate.row) : 'clear';
  const coverScore = ({ heavy_woods: 7, light_woods: 3, rubble: 2, shallow_water: 3 }[terrain] || 0) * doctrine.coverWeight;
  const hazardPenalty = ({ fire: 12, deep_water: 10, magma_crust: 9, magma_liquid: 50 }[terrain] || 0) * doctrine.hazardWeight;
  const movementScore = Math.min(5, candidate.hexes) * 1.5;
  const heatPenalty = Math.max(0, Number(mech.heat || 0) + (mode === 'run' ? 2 : mode === 'walk' ? 1 : 0) - 13) * 1.5 * doctrine.heatAversion;
  const facing = aiFacingToward(candidate.col, candidate.row, nearest);
  const facingPenalty = candidate.facing === facing ? 0 : 2;
  const armor = Object.values(mech.armor || {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  const structure = Object.values(mech.structure || {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  const preservation = armor + structure < Number(unit.tons || 50) ? coverScore * 0.75 : 0;
  const probe = { ...mech, col: candidate.col, row: candidate.row, facing: candidate.facing, torsoFacing: candidate.facing };
  const losScore = visibleTarget && typeof weaponLineOfSight === 'function' ? (weaponLineOfSight(probe, nearest).valid ? 4 : -8) : 0;
  const objectives = typeof currentMatchConfig !== 'undefined' && Array.isArray(currentMatchConfig.objective_hexes) ? currentMatchConfig.objective_hexes : [];
  const objectiveScore = objectives.includes(typeof hexCode === 'function' ? hexCode(candidate.col, candidate.row) : '') ? 8 * doctrine.objectiveWeight : 0;
  const nextRoundOptions = Array.from({ length: 6 }, (_, direction) => hexNeighbor(candidate.col, candidate.row, direction))
    .filter(hex => hex.col >= 0 && hex.col < GRID_COLS && hex.row >= 0 && hex.row < GRID_ROWS && !terrainMovementBlocked(hex.col, hex.row)).length * 0.4;
  const allyDistances = mechInstances.filter(unit => unit.owner === mech.owner && unit.instanceId !== mech.instanceId && !unit.destroyed).map(unit => axialDistance(candidate.col, candidate.row, unit.col, unit.row));
  const formationScore = (allyDistances.length ? (Math.min(...allyDistances) < 2 ? -4 : Math.min(...allyDistances) <= 6 ? 2 : -2) : 0) * doctrine.formationWeight;
  const retreatScore = coordination?.retreating?.has(mech.instanceId) ? axialDistance(candidate.col, candidate.row, nearest.col, nearest.row) * 2 + coverScore : 0;
  const ecmCoverScore = coordination?.capabilities?.[mech.instanceId]?.ecm && allyDistances.some(distance => distance <= 6) ? 3 : 0;
  const probeSearchScore = !visibleTarget && coordination?.capabilities?.[mech.instanceId]?.probe ? Math.min(5, candidate.hexes) * 2 : 0;
  const traversed = [{ col:candidate.col, row:candidate.row }, ...(candidate.path || []).filter(step => ['step', 'jump'].includes(step.action))];
  const knownMines = [...new Map(traversed.map(hex => {
    const field = aiKnownEnemyMinefield(mech, hex.col, hex.row);
    return field ? [`${hex.col},${hex.row}`, field] : null;
  }).filter(Boolean)).values()];
  const minefieldPenalty = knownMines.reduce((total, field) => total + Math.max(10, Number(field.density || 10)), 0);
  const total = rangeScore + coverScore + movementScore + preservation + losScore + objectiveScore + nextRoundOptions + formationScore + retreatScore + ecmCoverScore + probeSearchScore - hazardPenalty - minefieldPenalty - heatPenalty - facingPenalty;
  return { total, rangeScore, coverScore, movementScore, preservation, losScore, objectiveScore, nextRoundOptions, formationScore, retreatScore, ecmCoverScore, probeSearchScore, hazardPenalty, minefieldPenalty, heatPenalty, range, preferred, searching: !visibleTarget };
}

// Generate a deterministic, rules-legal movement action by enumerating final
// positions/facings and scoring range, cover, terrain, heat and survivability.
function generateAIMoveAction(mech, playerMechs, settings, context = null, coordination = null) {
  const unit = BT_UNITS[mech.unitId];
  if (!unit) return null;
  
  const mobility = criticalMovementProfile(mech);
  const heatPenalty = typeof heatMovementPenalty === 'function' ? heatMovementPenalty(mech) : 0;
  const modes = [{ mode: 'walk', mp: Math.max(0, Number(mobility.walk || 0) - heatPenalty) }, { mode: 'run', mp: Math.max(0, Number(mobility.run || 0) - heatPenalty) }];
  const mascTarget = typeof mascTargetNumber === 'function' ? mascTargetNumber(mech) : 13;
  const doctrine=settings.personalityProfile||AI_PERSONALITIES.balanced;
  const riskAcceptable = ['strongest', 'optimal'].includes(settings.targetPriority) && mascTarget <= Math.round(5 + doctrine.riskTolerance * 2);
  if (riskAcceptable && typeof hasOperationalMASC === 'function' && hasOperationalMASC(mech) && Number(mech.mascLastRound) !== Number(currentGameState.round)) {
    modes.push({ mode: 'run', mp: Math.max(0, Number(mobility.walk || 0) * 2 - heatPenalty), useMASC: true });
  }
  const options = [];
  for (const choice of modes) for (const candidate of aiSampleCandidates(aiMovementCandidates(mech, choice.mode, choice.mp).filter(option => option.path.length), settings, context)) {
    if (!candidate.path.length) continue;
    const scoreBreakdown = aiScoreDestination(mech, candidate, playerMechs, choice.mode, coordination);
    const mascRisk = choice.useMASC ? Math.max(0, mascTarget - 3) : 0;
    options.push({ ...candidate, movementMode: choice.mode, useMASC: Boolean(choice.useMASC), scoreBreakdown: { ...scoreBreakdown, mascRisk, total: scoreBreakdown.total - mascRisk } });
  }
  const jumpMP = Math.max(0, Number(mobility.jump || 0) - heatPenalty);
  if (jumpMP > 0 && (typeof terrainAt !== 'function' || terrainAt(mech.col, mech.row) !== 'deep_water')) {
    const jumpCandidates=[];
    for (let col = 0; col < GRID_COLS; col++) for (let row = 0; row < GRID_ROWS; row++) {
      const distance = axialDistance(mech.col, mech.row, col, row);
      if (!distance || distance > jumpMP || terrainMovementBlocked(col, row) || mechInstances.some(unit => unit.instanceId !== mech.instanceId && !unit.destroyed && unit.col === col && unit.row === row)) continue;
      const nearest = [...playerMechs].sort((a, b) => axialDistance(col, row, a.col, a.row) - axialDistance(col, row, b.col, b.row))[0] || aiSearchWaypoint(mech);
      const facing = aiFacingToward(col, row, nearest);
      const candidate = { col, row, facing, cost: distance, hexes: distance, path: [{ action: 'jump', col, row, facing }] };
      jumpCandidates.push(candidate);
    }
    for(const candidate of aiSampleCandidates(jumpCandidates,settings,context)) options.push({ ...candidate, movementMode: 'jump', useMASC: false, scoreBreakdown: aiScoreDestination(mech, candidate, playerMechs, 'jump', coordination) });
  }
  options.sort((a, b) => b.scoreBreakdown.total - a.scoreBreakdown.total || a.cost - b.cost || a.col - b.col || a.row - b.row || a.facing - b.facing);
  const best = aiChooseRanked(options,settings,context,option=>option.scoreBreakdown.total);
  if (!best || best.scoreBreakdown.total <= aiScoreDestination(mech, { col: mech.col, row: mech.row, facing: mech.facing, hexes: 0 }, playerMechs, 'stand', coordination).total) return null;
  const adjacentTarget=playerMechs.find(target=>target.hasMoved&&!target.dfaDeclaration&&!target.chargeDeclaration&&axialDistance(best.col,best.row,target.col,target.row)===1);
  const specialAttackThreshold=Math.max(.15,Math.min(.95,.3+Number(settings.planningHorizon||1)*.1))*doctrine.riskTolerance;
  if(adjacentTarget&&Number(settings.planningHorizon||1)>=3&&best.hexes>=2&&(context?.random?.()??Math.random())<specialAttackThreshold){
    if(best.movementMode==='jump'&&axialDistance(mech.col,mech.row,adjacentTarget.col,adjacentTarget.row)<=jumpMP)return{type:'declare_dfa',instanceId:mech.instanceId,targetInstanceId:adjacentTarget.instanceId,toCol:best.col,toRow:best.row,facing:best.facing,path:best.path,movementMode:'jump',mpUsed:best.cost,hexesMoved:best.hexes,_debug:`DFA staging against ${mechLabel(adjacentTarget)}`};
    if(best.movementMode==='run'&&!adjacentTarget.prone&&best.scoreBreakdown.range===1&&aiFacingToward(best.col,best.row,adjacentTarget)===best.facing)return{type:'declare_charge',instanceId:mech.instanceId,targetInstanceId:adjacentTarget.instanceId,toCol:best.col,toRow:best.row,facing:best.facing,path:best.path,movementMode:'run',mpUsed:best.cost,hexesMoved:best.hexes,_debug:`Charge staging against ${mechLabel(adjacentTarget)}`};
  }
  return {
    type: 'move',
    instanceId: mech.instanceId,
    fromCol: mech.col,
    fromRow: mech.row,
    toCol: best.col,
    toRow: best.row,
    path: best.useMASC ? best.path.map((step, index) => index === 0 ? { ...step, masc: true } : step) : best.path,
    movementMode: best.movementMode,
    useMASC: best.useMASC,
    mpUsed: best.cost,
    facing: best.facing,
    scoreBreakdown: best.scoreBreakdown,
    _debug: `${best.movementMode} ${best.hexes} hexes to range ${best.scoreBreakdown.range}; tactical score ${best.scoreBreakdown.total.toFixed(1)}`
  };
}

// 2d6 cumulative hit-probability table (chance of rolling >= N on 2d6).
const TWO_D6_HIT_CHANCE = {
  2: 1.00, 3: 0.972, 4: 0.917, 5: 0.833, 6: 0.722,
  7: 0.583, 8: 0.417, 9: 0.278, 10: 0.167, 11: 0.083, 12: 0.028
};

function toHitProbability(targetNumber) {
  if (targetNumber <= 2) return 1;
  if (targetNumber > 12) return 0;
  return TWO_D6_HIT_CHANCE[targetNumber] ?? 0;
}

// Roughly value a shot that may finish a badly damaged target. This remains a
// deliberately conservative bonus: normal expected damage is still the main
// score, and the real damage resolver remains authoritative.
function estimatedKillBonus(target, attack) {
  if (!BT_UNITS[target.unitId]) return 0;
  const remainingArmor = Object.values(target.armor || {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  const remainingStructure = Object.values(target.structure || {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  const totalRemaining = remainingArmor + remainingStructure;
  const damage = attack.damage ?? attack.weapon.damage;
  if (totalRemaining <= damage) return damage * 1.5;
  if (totalRemaining <= damage * 2) return damage * 0.5;
  return 0;
}

function aiWeaponModes(weaponEntry) {
  const key = weaponProfile(weaponEntry)?.key || weaponEntry?.key || '';
  if (key.startsWith('uac')) return ['single', 'rapid'];
  if (key.startsWith('rac')) return ['1', '2', '3', '4', '5', '6'];
  if (key === 'lb10x') return ['slug', 'cluster'];
  return ['single'];
}

// Play-vs-AI has no second human available to configure the AI force's
// immutable Round 1 ammunition. Give every specialised AI bin a conservative
// legal default before the match is persisted. The planner may choose among
// bins and weapon modes later, but it may never invent a loadout mid-battle.
function prepareAIAmmoLoadouts(units) {
  for (const mech of units || []) {
    if (Number(mech.owner) !== 2) continue;
    mech.ammoBins = (mech.ammoBins || []).map(bin => {
      if (bin.loadType) return bin;
      let loadType = null;
      if (bin.type === 'lb10x') loadType = 'slug';
      else if (/^mml(3|5|7|9)$/.test(bin.type)) loadType = 'lrm';
      else if (/^atm(3|6|9|12)$/.test(bin.type)) loadType = 'standard';
      else if (['srm2','srm4','srm6','ac2','ac5','ac10','ac20','lrm5','lrm10','lrm15','lrm20'].includes(bin.type)) loadType = 'standard';
      if (!loadType) return bin;
      const prepared = { ...bin, loadType };
      const rack = /^mml(3|5|7|9)$/.test(bin.type) ? Number(bin.type.slice(3)) : 0;
      if (rack) prepared.shots = prepared.maxShots = Math.floor(120 / rack);
      return prepared;
    });
  }
  return units;
}

function aiWeaponShots(mode) {
  if (/^[1-6]$/.test(mode)) return Number(mode);
  return mode === 'rapid' ? 2 : 1;
}

function aiWeaponModeOptions(mech, weaponEntry) {
  const weapon = weaponProfile(weaponEntry);
  if (!weapon) return [];
  const bins = weaponPhaseStartMech(mech).ammoBins || [];
  return aiWeaponModes(weaponEntry).flatMap(mode => {
    const shots = aiWeaponShots(mode);
    if (!weapon.ammoType) return [{ mode, shots, bin: null }];
    return bins.filter(bin => bin.type === weapon.ammoType && !bin.destroyed && Number(bin.shots || 0) >= shots)
      .filter(bin => weaponEntry.key !== 'lb10x' || !bin.loadType || bin.loadType === mode)
      .map(bin => ({ mode, shots, bin }));
  });
}

function aiWeakestAimLocation(target) {
  return ['ct', 'lt', 'rt', 'la', 'ra', 'll', 'rl']
    .filter(location => Number(target.structure?.[location] || 0) > 0)
    .sort((a, b) => Number(target.armor?.[a] || 0) + Number(target.structure?.[a] || 0) -
      Number(target.armor?.[b] || 0) - Number(target.structure?.[b] || 0))[0] || null;
}

function withAIWeaponSelection(mech, mountId, option, aimedLocation, callback, armsFlipped = false, supportArm = null) {
  const previous = weaponAttackState;
  const previousSupport = mech.proneSupportArm;
  if (supportArm) mech.proneSupportArm = supportArm;
  weaponAttackState = {
    ...emptyWeaponAttackState(),
    attackerId: mech.instanceId,
    ammoBinsByMount: option.bin ? { [mountId]: option.bin.id } : {},
    fireModesByMount: { [mountId]: option.mode },
    aimLocationsByMount: aimedLocation ? { [mountId]: aimedLocation } : {},
    armsFlipped
  };
  try { return callback(); }
  finally { weaponAttackState = previous; mech.proneSupportArm = previousSupport; }
}

function aiClusterFraction(mech, weapon, option, target) {
  if (!weapon?.clusterSize && option.mode !== 'cluster') return 1;
  if (weapon.streak) return 1;
  let fraction = 0.63;
  const guided = option.bin?.artemisCapable || (option.bin?.narcCapable && target.narcPod &&
    Number(target.narcPod.round) === Number(currentGameState.round));
  if (guided && (typeof targetGuidanceEcm !== 'function' || !targetGuidanceEcm(mech, target))) fraction = 0.72;
  return fraction;
}

function aiAmmoUtility(option, attack, target, settings) {
  if (!option.bin) return 0;
  const load = option.bin.loadType || 'standard';
  let utility = 0;
  if (load === 'inferno') utility += toHitProbability(attack.targetNumber) * 4;
  if (load === 'armor_piercing') utility += toHitProbability(attack.targetNumber) * 1.5;
  if (load === 'precision') utility += 0.5;
  if (load === 'semi_guided' && Number(target.taggedRound) === Number(currentGameState.round)) utility += 2;
  const scarcity = option.shots / Math.max(option.shots, Number(option.bin.shots || 0));
  return utility - scarcity * Number(settings.ammoConservation || 0) * Number(attack.damage || attack.weapon.damage || 0);
}

function scoreWeaponAttack(mech, target, weaponEntry, options = {}) {
  const mountIndex = BT_UNITS[mech.unitId].weapons.indexOf(weaponEntry);
  const mountId = weaponMountId(weaponEntry, mountIndex);
  const modeOption = options.modeOption || aiWeaponModeOptions(mech, weaponEntry)[0];
  if (!modeOption) return null;
  const evaluate = (aimedLocation, indirect = false, spotter = null) => withAIWeaponSelection(mech, mountId, modeOption, aimedLocation, () =>
    evaluateWeaponAttack(mech, target, weaponEntry, { secondaryTarget: Boolean(options.secondaryTarget), indirect, spotter }),Boolean(options.armsFlipped),options.proneSupportArm);
  let aimedLocation = null;
  let attack = evaluate(null);
  let indirect = false;
  let spotter = null;
  if (!attack.valid && options.coordination?.enabled && typeof isIndirectCapableWeapon === 'function' && isIndirectCapableWeapon(mech, weaponEntry) && typeof eligibleIndirectSpotters === 'function') {
    spotter = eligibleIndirectSpotters(mech, target).sort((a, b) => Number(options.coordination.capabilities?.[b.instanceId]?.probe) - Number(options.coordination.capabilities?.[a.instanceId]?.probe) || axialDistance(a.col, a.row, target.col, target.row) - axialDistance(b.col, b.row, target.col, target.row))[0] || null;
    if (spotter) { const indirectAttack = evaluate(null, true, spotter); if (indirectAttack.valid) { attack = indirectAttack; indirect = true; } }
  }
  if (!attack.valid) return null;
  let hitChance = toHitProbability(attack.targetNumber);
  const perShotDamage = Number(attack.damage ?? attack.weapon.damage ?? 0);
  const clusterFraction = aiClusterFraction(mech, attack.weapon, modeOption, target);
  const loadType = modeOption.bin?.loadType || 'standard';
  const specialDamageFactor = ['inferno', 'fragmentation'].includes(loadType) ? 0 : loadType === 'flechette' ? 0.5 : 1;
  let expectedDamage = hitChance * perShotDamage * modeOption.shots * clusterFraction * specialDamageFactor;
  const supportUtility = ['tag', 'c3_master_tag'].includes(weaponEntry.key) && Number(target.taggedRound) !== Number(currentGameState.round) ? 8 * hitChance
    : weaponEntry.key === 'narc' && Number(target.narcPod?.round) !== Number(currentGameState.round) ? 7 * hitChance : 0;
  const focusBonus = options.coordination?.enabled && target.instanceId === options.coordination.focusTargetId ? 2.5 : 0;
  const settings=options.settings||aiSettingsFor('advanced','balanced');
  const doctrine=settings.personalityProfile||AI_PERSONALITIES.balanced;
  const distance=axialDistance(mech.col,mech.row,target.col,target.row);
  const rangeStyle=doctrine.rangeOffset>0?distance*.12*doctrine.rangeOffset:Math.max(0,7-distance)*.12*Math.abs(doctrine.rangeOffset);
  let score = expectedDamage + hitChance * estimatedKillBonus(target, attack) + aiAmmoUtility(modeOption, attack, target, settings) + supportUtility + focusBonus + rangeStyle;

  const weakLocation = aiWeakestAimLocation(target);
  const canAim = weakLocation && typeof targetingComputerCanAim === 'function' &&
    withAIWeaponSelection(mech, mountId, modeOption, null, () => targetingComputerCanAim(mech, weaponEntry, mountId));
  if (canAim) {
    const aimedAttack = indirect ? { valid: false } : evaluate(weakLocation);
    if (aimedAttack.valid) {
      const aimedChance = toHitProbability(aimedAttack.targetNumber);
      const locationRemaining = Number(target.armor?.[weakLocation] || 0) + Number(target.structure?.[weakLocation] || 0);
      const aimedDamage = aimedChance * perShotDamage * modeOption.shots * clusterFraction * specialDamageFactor;
      const aimedScore = aimedDamage + (perShotDamage >= locationRemaining ? aimedChance * perShotDamage * 2 : 0);
      if (aimedScore > score) {
        attack = aimedAttack;
        aimedLocation = weakLocation;
        hitChance = aimedChance;
        expectedDamage = aimedDamage;
        score = aimedScore;
      }
    }
  }

  const heat = Number(attack.weapon.heat || 0) * modeOption.shots;
  const jamReliability = weaponEntry.key?.startsWith('rac') ? Math.max(0.72, 1 - modeOption.shots * 0.035)
    : modeOption.mode === 'rapid' ? 0.97 : 1;
  score = (score - heat * .08 * doctrine.heatAversion) * jamReliability;
  return { target, weaponEntry, mountId, attack, modeOption, aimedLocation, heat, hitChance, expectedDamage, score, indirect, spotterId: spotter?.instanceId || null, armsFlipped:Boolean(options.armsFlipped) };
}

function aiWeaponHeatBudget(mech, settings) {
  const unit = BT_UNITS[mech.unitId] || {};
  const destroyed = typeof destroyedHeatSinkCapacity === 'function' ? destroyedHeatSinkCapacity(mech) : 0;
  const sinks = Math.max(0, Number(unit.heat_sink_capacity || unit.heat_sinks || 0) - destroyed);
  const signature = typeof signatureHeat === 'function' ? signatureHeat(mech) : 0;
  const beforeWeapons = Number(mech.roundStartingHeat || 0) + Number(mech.movementHeat || 0) +
    Number(mech.externalHeat || 0) + signature;
  return Math.max(0, sinks + Number(settings.maxProjectedHeat ?? 13) - beforeWeapons);
}

function aiPrimaryWeaponTarget(mech, targets, unit, settings, context, coordination = null) {
  const legal = targets.map(target => ({
    target,
    score: unit.weapons.reduce((sum, weaponEntry) => {
      const flipModes = typeof canFlipBattleMechArms === 'function' && canFlipBattleMechArms(mech) ? [false,true] : [false];
      const choices = aiWeaponModeOptions(mech, weaponEntry)
        .flatMap(modeOption => flipModes.map(armsFlipped => scoreWeaponAttack(mech, target, weaponEntry, { modeOption, settings, coordination, armsFlipped, proneSupportArm:mech.proneSupportArm })))
        .filter(Boolean);
      return sum + Math.max(0, ...choices.map(choice => choice.score));
    }, 0)
  })).filter(candidate => candidate.score > 0);
  if (!legal.length) return null;
  if (coordination?.enabled) {
    const focus = legal.find(candidate => candidate.target.instanceId === coordination.focusTargetId);
    if (focus) return focus.target;
  }
  if (settings.targetPriority === 'reasonable') return aiChooseRanked(legal,settings,context)?.target || null;
  if (settings.targetPriority === 'closest') return legal.sort((a, b) =>
    axialDistance(mech.col, mech.row, a.target.col, a.target.row) - axialDistance(mech.col, mech.row, b.target.col, b.target.row))[0].target;
  return aiChooseRanked(legal,settings,context)?.target || null;
}

// AI-2 chooses one complete declaration for the current activation. Every
// mount is independently evaluated against the primary and legal secondary
// targets, then the package is constrained by heat and shared ammunition.
function generateAIAttackAction(mech, playerMechs, settings, context = null, coordination = null) {
  const unit = BT_UNITS[mech.unitId];
  if (!unit?.weapons?.length || !playerMechs.length) return null;
  let proneSupportArm = mech.proneSupportArm || null;
  if (mech.prone && !proneSupportArm) {
    const intact=['la','ra'].filter(arm=>Number(mech.structure?.[arm]||0)>0);
    const armWeaponValue=arm=>(unit.weapons||[]).reduce((total,entry)=>{
      const location=String(entry.location||'').toLowerCase().replaceAll(' ','');
      if(location!==(arm==='la'?'leftarm':'rightarm'))return total;
      return total+Number((typeof weaponProfile==='function'?weaponProfile(entry):null)?.damage||0)*Math.max(1,Number(entry.count||1));
    },0);
    proneSupportArm=intact.sort((a,b)=>armWeaponValue(a)-armWeaponValue(b)||a.localeCompare(b))[0]||null;
    if(!proneSupportArm)return null;
    mech={...mech,proneSupportArm};
  }
  const primary = aiPrimaryWeaponTarget(mech, playerMechs, unit, settings, context, coordination);
  if (!primary) return null;
  const targetDirection=typeof weaponDirectionTo==='function'?weaponDirectionTo(mech,primary):aiFacingToward(mech.col,mech.row,primary);
  const direction=(targetDirection-mech.facing+6)%6;
  const armsFlipped=Boolean(typeof canFlipBattleMechArms==='function'&&canFlipBattleMechArms(mech)&&[2,3,4].includes(direction));

  const candidateGroups = unit.weapons.map(weaponEntry => {
    const choices = [];
    for (const target of playerMechs) {
      for (const modeOption of aiWeaponModeOptions(mech, weaponEntry)) {
        const choice = scoreWeaponAttack(mech, target, weaponEntry, {
          modeOption,
          secondaryTarget: target.instanceId !== primary.instanceId,
          settings,
          coordination,
          armsFlipped,
          proneSupportArm
        });
        if (choice?.score > 0) choices.push(choice);
      }
    }
    return choices.sort((a, b) => b.score - a.score);
  }).filter(choices => choices.length).sort((a, b) =>
    (b[0].score / Math.max(1, b[0].heat)) - (a[0].score / Math.max(1, a[0].heat)) || b[0].score - a[0].score);

  const heatBudget = aiWeaponHeatBudget(mech, settings);
  let heatUsed = 0;
  const ammoUsed = new Map();
  const selected = [];
  for (const choices of candidateGroups) {
    const viable = choices.filter(candidate => {
      const binId = candidate.modeOption.bin?.id;
      const used = binId ? ammoUsed.get(binId) || 0 : 0;
      const available = Number(candidate.modeOption.bin?.shots || Infinity);
      const incompatibleFireLine = selected.some(chosen => chosen.target.instanceId === candidate.target.instanceId && chosen.indirect !== candidate.indirect);
      return !incompatibleFireLine && heatUsed + candidate.heat <= heatBudget && used + candidate.modeOption.shots <= available;
    });
    const choice = aiChooseRanked(viable,settings,context);
    if (!choice) continue;
    const binId = choice.modeOption.bin?.id;
    const used = binId ? ammoUsed.get(binId) || 0 : 0;
    selected.push(choice);
    heatUsed += choice.heat;
    if (binId) ammoUsed.set(binId, used + choice.modeOption.shots);
  }
  if (!selected.length) return null;

  const grouped = new Map();
  for (const choice of selected) {
    const targetId = choice.target.instanceId;
    if (!grouped.has(targetId)) grouped.set(targetId, { target_instance_id: targetId, primary: targetId === primary.instanceId, weapon_mounts: [], ammo_bins: { __fire_modes: {}, __aim_locations: {} } });
    const allocation = grouped.get(targetId);
    allocation.weapon_mounts.push(choice.mountId);
    if (choice.modeOption.bin) allocation.ammo_bins[choice.mountId] = choice.modeOption.bin.id;
    if (choice.modeOption.mode !== 'single') allocation.ammo_bins.__fire_modes[choice.mountId] = choice.modeOption.mode;
    if (choice.aimedLocation) allocation.ammo_bins.__aim_locations[choice.mountId] = choice.aimedLocation;
    if (choice.indirect) { allocation.ammo_bins.__indirect = true; allocation.ammo_bins.__spotter = choice.spotterId; }
  }
  const allocations = [...grouped.values()];
  if(armsFlipped) allocations.forEach(allocation=>{allocation.ammo_bins.__arms_flipped=true;});
  if (!allocations.some(allocation => allocation.primary)) allocations[0].primary = true;
  const expectedDamage = selected.reduce((sum, choice) => sum + choice.expectedDamage, 0);
  const first = selected[0];
  return {
    type: 'attack',
    instanceId: mech.instanceId,
    targetInstanceId: allocations.find(allocation => allocation.primary)?.target_instance_id || primary.instanceId,
    weaponKey: first.weaponEntry.key,
    weaponLocation: first.weaponEntry.location,
    weaponCount: selected.length,
    allocations,
    weaponHeat: heatUsed,
    expectedDamage,
    coordinationRole: coordination?.capabilities?.[mech.instanceId]?.designator ? 'designator' : coordination?.retreating?.has(mech.instanceId) ? 'withdrawing' : 'striker',
    personality: settings.personality || 'balanced',
    focusTargetId: coordination?.focusTargetId || null,
    proneSupportArm,
    _debug: `${settings.difficulty || 'custom'} ${settings.personality || 'balanced'}: ${selected.length} mount${selected.length === 1 ? '' : 's'}, EV ${expectedDamage.toFixed(1)} damage, ${heatUsed}/${heatBudget} planned heat${coordination?.enabled && primary.instanceId === coordination.focusTargetId ? ', coordinated focus' : ''}${allocations.length > 1 ? `, split across ${allocations.length} targets` : ''}`
  };
}

// Execute AI plan after a delay
async function completeAIUnitPhaseAction(action) {
  const mech = mechInstances.find(candidate => candidate.instanceId === action.instanceId);
  if (!mech || mech.destroyed) return false;
  if (action.type === 'complete_movement') {
    const { error } = await db.rpc('submit_battlemech_movement', { p_game_id: currentGameId, p_instance_id: mech.instanceId, p_mode: 'stand', p_path: [] });
    if (error) throw new Error(`Server rejected AI stand-still: ${error.message}`);
    await loadGameState();
    logEvent(`${mechLabel(mech)} (AI) held position.`, 'move');
    updateAdvanceButtonState();
    return true;
  } else if (action.type === 'no_physical_attack') {
    const {error}=await db.rpc('submit_simultaneous_physical_declaration',{p_game_id:currentGameId,p_attacker_instance_id:mech.instanceId,p_target_instance_id:null,p_attack_type:'pass',p_limbs:[]});
    if(error) throw new Error(`Server rejected AI physical pass: ${error.message}`);
    await loadGameState();
    logEvent(`${mechLabel(mech)} (AI) declared no physical attack.`, 'attack');
    updateAdvanceButtonState();
    return true;
  } else {
    return false;
  }
}

async function executeAIPlan(aiPlan) {
  if (!aiPlan || !aiPlan.actions || aiPlan.actions.length === 0) {
    completeAIDecision('completed');
    logEvent('AI has no actions to take this phase.', 'system');
    if (currentGameState.phase === 'heat') await resolveAIHeatManagement();
    else updateAdvanceButtonState();
    return;
  }
  
  const plannedPhase = aiPlan.phase || currentGameState.phase;
  logEvent(`AI plan: ${aiPlan.actions.length} action${aiPlan.actions.length === 1 ? '' : 's'} queued.`, 'system');
  // A weapon declaration can immediately hand play back to the human or
  // advance the phase. Save the reproducible plan before that happens; SQL
  // 124 finalizes its outcomes without rewriting combat state afterward.
  if (['movement', 'reaction', 'weapon_attack', 'physical_attack'].includes(plannedPhase)) await syncMechInstances();
  
  // Execute actions one by one with delays for visual feedback
  for (const action of aiPlan.actions) {
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay between actions
    try {
      const contract = validateAIActionContract(action, aiPlan.phase || currentGameState.phase);
      if (!contract.valid) throw new Error(contract.reason);
      switch (action.type) {
        case 'move':
          await executeAIMove(action);
          break;
        case 'declare_charge':
        case 'declare_dfa':
          await executeAISpecialAttackMovement(action);
          break;
        case 'attack':
        case 'no_fire':
          await executeAIWeaponDeclaration(action);
          break;
        case 'find_club':
          await executeAIClubSearch(action);
          break;
        case 'torso_twist':
        case 'complete_reaction':
          await executeAIReaction(action);
          break;
        case 'physical_attack':
        case 'resolve_charge':
        case 'resolve_dfa':
          await executeAIPhysicalAttack(action);
          break;
        case 'complete_movement':
        case 'no_physical_attack':
          await completeAIUnitPhaseAction(action);
          break;
        case 'attempt_startup':
        case 'attempt_stand':
        case 'remain_prone':
          await executeAISpecialMovement(action);
          break;
        case 'manage_heat':
          await resolveAIHeatManagement();
          break;
      }
      recordAIActionOutcome(action, 'completed', action._debug || action.reason || '');
    } catch (error) {
      recordAIActionOutcome(action, 'failed', error.message || error);
      console.error('[BT-AI] Action failed:', action, error);
      logEvent(`AI action failed safely: ${error.message || error}`, 'error');
    }
  }
  
  console.log('AI plan execution complete');
  const decisionFailed = pendingAIDecisionEnvelope?.outcomes?.some(outcome => outcome.status === 'failed');
  completeAIDecision(decisionFailed ? 'failed' : 'completed');

  if (['movement', 'reaction', 'weapon_attack', 'physical_attack'].includes(plannedPhase)) await finalizeAIDecisionRecord();
  else if (plannedPhase === 'heat') await syncMechInstances();
}

async function executeAISpecialMovement(action) {
  const rpc = { attempt_startup: 'attempt_startup_battlemech', attempt_stand: 'attempt_stand_battlemech', remain_prone: 'remain_prone_battlemech' }[action.type];
  const { error } = await db.rpc(rpc, { p_game_id: currentGameId, p_instance_id: action.instanceId });
  if (error) throw new Error(`Server rejected AI ${action.type.replaceAll('_', ' ')}: ${error.message}`);
  await loadGameState();
}

async function executeAISpecialAttackMovement(action){
 const args={p_game_id:currentGameId,p_attacker_instance_id:action.instanceId,p_target_instance_id:action.targetInstanceId,p_staging_col:action.toCol,p_staging_row:action.toRow,p_staging_facing:action.facing,p_path:action.path||[]};
 const rpc=action.type==='declare_dfa'?'declare_death_from_above':'declare_charge_attack';
 if(action.type==='declare_charge')Object.assign(args,{p_mode:action.movementMode||'run',p_hexes_moved:action.hexesMoved||action.path?.length||0,p_mp_used:action.mpUsed||0});
 const {error}=await db.rpc(rpc,args);if(error)throw new Error(`Server rejected AI ${action.type}: ${error.message}`);await loadGameState();
}

async function executeAIPhysicalAttack(action) {
  const attacker = mechInstances.find(m => m.instanceId === action.instanceId);
  if(!attacker) throw new Error('Physical attacker is no longer eligible.');
  let call;
  if(action.type==='resolve_dfa') call=db.rpc('resolve_declared_death_from_above',{p_game_id:currentGameId,p_attacker_instance_id:attacker.instanceId});
  else if(action.type==='resolve_charge') call=db.rpc('resolve_declared_charge',{p_game_id:currentGameId,p_attacker_instance_id:attacker.instanceId});
  else if(action.attackType==='push') call=db.rpc('resolve_push_attack',{p_game_id:currentGameId,p_attacker_instance_id:attacker.instanceId,p_target_instance_id:action.targetInstanceId});
  else call=db.rpc('submit_simultaneous_physical_declaration',{p_game_id:currentGameId,p_attacker_instance_id:attacker.instanceId,p_target_instance_id:action.targetInstanceId,p_attack_type:action.attackType,p_limbs:(action.limbs||[]).map(limb=>limb==='both'?'ra':limb)});
  const {data,error}=await call;if(error) throw new Error(`Server rejected AI physical attack: ${error.message}`);
  await loadGameState();await loadResolvedPhysicalEvents();await checkForMatchEnd();
  logEvent(`${mechLabel(attacker)} (AI) submitted ${action.attackType} for authoritative resolution.`, 'attack');
}

async function executeAIClubSearch(action) {
  const attacker = mechInstances.find(mech => mech.instanceId === action.instanceId);
  if (!attacker) throw new Error('Club-searching BattleMech is no longer eligible.');
  const { data, error } = await db.rpc('find_improvised_club', { p_game_id: currentGameId, p_instance_id: attacker.instanceId });
  if (error) throw new Error(`Server rejected AI club search: ${error.message}`);
  logEvent(data?.found ? `${mechLabel(attacker)} (AI) found an improvised ${data.club_type === 'tree' ? 'tree' : 'girder'} club.` : `${mechLabel(attacker)} (AI) found no usable club.`, 'phase');
  await loadGameState();
}

async function executeAIReaction(action) {
  const mech = mechInstances.find(m => m.instanceId === action.instanceId);
  if (!mech || mech.destroyed || mech.hasReacted) throw new Error('Reaction BattleMech is no longer eligible.');

  let torsoFacing=mech.facing;
  if (action.type === 'torso_twist') {
    const delta = action.direction === 'left' ? 1 : -1;
    const currentFacing = mech.torsoFacing == null ? mech.facing : mech.torsoFacing;
    torsoFacing = (currentFacing + delta + 6) % 6;
    logEvent(`${mechLabel(mech)} (AI) twisted torso ${action.direction}.`, 'phase');
  } else {
    logEvent(`${mechLabel(mech)} (AI) held torso facing.`, 'phase');
  }

  const {error}=await db.rpc('submit_torso_twist_reaction',{p_game_id:currentGameId,p_instance_id:mech.instanceId,p_torso_facing:torsoFacing});
  if(error) throw new Error(`Server rejected AI reaction: ${error.message}`);
  await loadGameState();
  draw();
  renderRoster();
  renderDetail();
  renderReactionPanel();
  updateAdvanceButtonState();
}

// Execute AI movement
async function executeAIMove(action) {
  const mech = mechInstances.find(m => m.instanceId === action.instanceId);
  if (!mech || mech.destroyed || mech.hasMoved) throw new Error('Movement BattleMech is no longer eligible.');

  const { data, error } = await db.rpc('submit_battlemech_movement', {
    p_game_id: currentGameId, p_instance_id: mech.instanceId,
    p_mode: action.movementMode || 'walk', p_path: action.path || []
  });
  if (error) throw new Error(`Server rejected AI movement: ${error.message}`);
  await loadGameState();
  logEvent(`${mechLabel(mech)} (AI) ${action.movementMode || 'walk'}ed to ${hexCode(data?.col ?? action.toCol, data?.row ?? action.toRow)} (${data?.mp_used ?? action.mpUsed} MP).`, 'move');
}

async function finalizeAIDecisionRecord() {
  if (!pendingAIDecisionEnvelope || !currentGameId) return;
  const { error } = await db.rpc('finalize_ai_decision', {
    p_game_id: currentGameId,
    p_decision: pendingAIDecisionEnvelope
  });
  if (error) {
    console.warn('[BT-AI] Could not finalize decision record:', error);
    logEvent(`AI decision audit could not be finalized: ${error.message}`, 'error');
  }
}

// AI-2 submits exactly the same complete multi-target declaration as a human.
// Dice, ammunition, heat, jams, criticals and damage are resolved by Supabase;
// no client-calculated combat state is written back over that result.
async function executeAIWeaponDeclaration(action) {
  const attacker = mechInstances.find(m => m.instanceId === action.instanceId);
  if (!attacker || attacker.destroyed || attacker.hasFired) throw new Error('Weapon attacker is no longer eligible.');
  if(attacker.prone&&action.proneSupportArm&&attacker.proneSupportArm!==action.proneSupportArm){const support=await db.rpc('set_prone_weapon_support_arm',{p_game_id:currentGameId,p_instance_id:attacker.instanceId,p_arm:action.proneSupportArm});if(support.error)throw new Error(`Server rejected AI prone support arm: ${support.error.message}`);}
  const allocations = action.type === 'no_fire' ? [] : action.allocations;
  let { data, error } = await db.rpc('submit_multi_target_weapon_declaration', {
    p_game_id: currentGameId,
    p_attacker_instance_id: attacker.instanceId,
    p_target_allocations: allocations
  });
  if (error && allocations.length) {
    const rejected = error.message;
    logEvent(`AI weapon package was rejected; declaring no fire safely: ${rejected}`, 'error');
    ({ data, error } = await db.rpc('submit_multi_target_weapon_declaration', {
      p_game_id: currentGameId,
      p_attacker_instance_id: attacker.instanceId,
      p_target_allocations: []
    }));
    if (!error) action._debug = `${action._debug || ''}; authoritative package rejected (${rejected}); no-fire fallback accepted`;
  }
  if (error) throw new Error(`Server rejected the AI weapon declaration: ${error.message}`);
  if (action.type === 'no_fire') logEvent(`${mechLabel(attacker)} (AI) declared no weapon fire.`, 'attack');
  else logEvent(`${mechLabel(attacker)} (AI) submitted ${action.weaponCount} weapon mount${action.weaponCount === 1 ? '' : 's'} for authoritative resolution.`, 'attack');
  weaponAttackState = emptyWeaponAttackState();
  await loadGameState();
  renderWeaponAttackPanel(); renderRoster(); renderDetail(); draw(); updateAdvanceButtonState();
  if (data?.status === 'resolved') await checkForMatchEnd();
}

// AI turn handler - called when it's AI's turn
async function aiTurnHandler() {
  // A delayed callback can survive a hand-off to the human player. Only the
  // player currently on turn may execute AI choices, and never in parallel.
  if (!vsAiMode || aiTurnInProgress || !getActivePlayerRecord()?.is_ai) return false;
  aiTurnInProgress = true;
  
  try {
    logEvent(`AI turn started (${PHASE_LABELS[currentGameState.phase] || currentGameState.phase}).`, 'system');

    // Get game state from Supabase
    const { data: game } = await db
      .from('btech_games')
      .select('state')
      .eq('id', currentGameId)
      .single();

    if (!game) { logEvent('AI turn aborted — could not load game state.', 'error'); return false; }

    const gameState = game.state ? (typeof game.state === 'string' ? JSON.parse(game.state) : game.state) : {};
    const difficulty = gameState.ai_difficulty || window.aiDifficulty || 'beginner';

    // Generate AI plan
    const aiPlan = generateAIPlan(difficulty, null, gameState, []);

    // Execute AI plan
    await executeAIPlan(aiPlan);

    logEvent('AI turn complete.', 'system');
    return true;
  } finally {
    aiTurnInProgress = false;
  }
}

// ── END AI OPPONENT SYSTEM ──────────────────────────────────
