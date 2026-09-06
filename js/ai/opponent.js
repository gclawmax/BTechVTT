// ── AI OPPONENT SYSTEM ──────────────────────────────────────
let aiTurnInProgress = false;

// AI difficulty settings
const AI_SETTINGS = {
  beginner: {
    moveChance: 0.7,
    attackChance: 0.6,
    targetPriority: 'random', // random, closest, strongest
    movementRange: 1, // hexes per turn
    heatManagement: false,
    planningHorizon: 1,
    maxProjectedHeat: 18,
    ammoConservation: 0
  },
  intermediate: {
    moveChance: 0.85,
    attackChance: 0.75,
    targetPriority: 'closest',
    movementRange: 2,
    heatManagement: true,
    planningHorizon: 2,
    maxProjectedHeat: 13,
    ammoConservation: 0.05
  },
  advanced: {
    moveChance: 0.95,
    attackChance: 0.85,
    targetPriority: 'strongest',
    movementRange: 3,
    heatManagement: true,
    planningHorizon: 3,
    maxProjectedHeat: 10,
    ammoConservation: 0.1
  },
  expert: {
    moveChance: 1.0,
    attackChance: 0.95,
    targetPriority: 'optimal',
    movementRange: 3,
    heatManagement: true,
    planningHorizon: 5,
    maxProjectedHeat: 7,
    ammoConservation: 0.15
  }
};

// AI plan generator - creates movement and attack plans
function generateAIPlan(difficulty, aiPlayerId, gameState, allPlayers) {
  const settings = AI_SETTINGS[difficulty] || AI_SETTINGS.beginner;
  const context = createAIPlanningContext(difficulty, gameState, mechInstances);
  const aiPlan = {
    type: 'ai_plan',
    engineVersion: BT_AI_ENGINE_VERSION,
    decisionId: context.decisionId,
    seed: context.seed,
    snapshotHash: context.snapshotHash,
    phase: currentGameState.phase,
    difficulty: difficulty,
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
  const weaponActors = new Set(orderedAIMechs.filter(mech => !mech.hasFired && !mech.destroyed)
    .slice(0, Math.max(1, weaponAllowance)).map(mech => mech.instanceId));
  const movementAllowance = currentGameState.phase === 'movement' && typeof currentActivationAllowance === 'function'
    ? currentActivationAllowance('movement') : aiMechs.length;
  const movementActors = new Set(orderedAIMechs.filter(mech => !mech.hasMoved && !mech.destroyed)
    .slice(0, Math.max(1, movementAllowance)).map(mech => mech.instanceId));
  
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
      const canConsiderFire = !mech.shutdown && (!mech.pilot?.consciousness || mech.pilot.consciousness === 'conscious');
      const attackAction = canConsiderFire && context.random() < settings.attackChance
        ? generateAIAttackAction(mech, playerMechs, settings, context, coordination) : null;
      aiPlan.actions.push(attackAction || { type: 'no_fire', instanceId: mech.instanceId, reason: canConsiderFire ? 'No legal shot selected.' : 'Unable to fire.' });
    }

    if (currentGameState.phase === 'reaction' && !mech.hasReacted && !mech.destroyed) {
      aiPlan.actions.push(generateAIReactionAction(mech, playerMechs, context));
    }

    if (currentGameState.phase === 'physical_attack' && !mech.hasPhysicalAttacked && !mech.destroyed) {
      const target = playerMechs.find(candidate => physicalLimbCandidates('kick').some(limb => evaluatePhysicalAttack(mech, candidate, 'kick', limb).valid));
      aiPlan.actions.push(target
        ? { type: 'physical_attack', instanceId: mech.instanceId, targetInstanceId: target.instanceId, attackType: 'kick', _debug: `Legal kick against ${mechLabel(target)}` }
        : { type: 'no_physical_attack', instanceId: mech.instanceId, reason: 'No legal physical attack.' });
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
  
  return aiPlan;
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
  const capabilities = Object.fromEntries(aiMechs.map(mech => [mech.instanceId, aiUnitCapabilities(mech)]));
  const enemyScores = enemies.map(enemy => {
    const capability = aiUnitCapabilities(enemy);
    const durability = aiCurrentDurability(enemy);
    const objective = typeof currentMatchConfig !== 'undefined' && (currentMatchConfig.objective_hexes || []).includes(typeof hexCode === 'function' ? hexCode(enemy.col, enemy.row) : '') ? 20 : 0;
    const marked = Number(enemy.taggedRound) === Number(currentGameState.round) || Number(enemy.narcPod?.round) === Number(currentGameState.round) ? 12 : 0;
    return { instanceId: enemy.instanceId, score: capability.damage * 1.5 + capability.tonnage * .15 + objective + marked + Math.max(0, 80 - durability) * .35, durability };
  }).sort((a, b) => b.score - a.score || String(a.instanceId).localeCompare(String(b.instanceId)));
  const focusTargetId = enemyScores[0]?.instanceId || null;
  const retreating = new Set(aiMechs.filter(mech => {
    const capability = capabilities[mech.instanceId];
    return aiCurrentDurability(mech) < capability.tonnage * .55 || Number(mech.pilot?.hits || 0) >= 4;
  }).map(mech => mech.instanceId));
  const supportFirst = new Set(aiMechs.filter(mech => capabilities[mech.instanceId].designator).map(mech => mech.instanceId));
  return {
    capabilities, enemyScores, focusTargetId, retreating, supportFirst,
    enabled: Number(settings.planningHorizon || 1) >= 3,
    summary: {
      doctrine: Number(settings.planningHorizon || 1) >= 3 ? 'coordinated' : 'individual',
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
  const unit = BT_UNITS[mech.unitId] || {};
  const nearest = [...playerMechs].sort((a, b) => axialDistance(candidate.col, candidate.row, a.col, a.row) - axialDistance(candidate.col, candidate.row, b.col, b.row))[0];
  if (!nearest) return { total: 0 };
  const range = axialDistance(candidate.col, candidate.row, nearest.col, nearest.row);
  const weaponRanges = (unit.weapons || []).map(entry => Number((typeof weaponProfile === 'function' ? weaponProfile(entry) : null)?.ranges?.medium || 0)).filter(Boolean);
  const preferred = weaponRanges.length ? Math.max(2, Math.round(weaponRanges.reduce((a, b) => a + b, 0) / weaponRanges.length)) : 3;
  const rangeScore = 18 - Math.abs(range - preferred) * 3;
  const terrain = typeof terrainAt === 'function' ? terrainAt(candidate.col, candidate.row) : 'clear';
  const coverScore = ({ heavy_woods: 7, light_woods: 3, rubble: 2, shallow_water: 3 }[terrain] || 0);
  const hazardPenalty = ({ fire: 12, deep_water: 10, magma_crust: 9, magma_liquid: 50 }[terrain] || 0);
  const movementScore = Math.min(5, candidate.hexes) * 1.5;
  const heatPenalty = Math.max(0, Number(mech.heat || 0) + (mode === 'run' ? 2 : mode === 'walk' ? 1 : 0) - 13) * 1.5;
  const facing = aiFacingToward(candidate.col, candidate.row, nearest);
  const facingPenalty = candidate.facing === facing ? 0 : 2;
  const armor = Object.values(mech.armor || {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  const structure = Object.values(mech.structure || {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  const preservation = armor + structure < Number(unit.tons || 50) ? coverScore * 0.75 : 0;
  const probe = { ...mech, col: candidate.col, row: candidate.row, facing: candidate.facing, torsoFacing: candidate.facing };
  const losScore = typeof weaponLineOfSight === 'function' && weaponLineOfSight(probe, nearest).valid ? 4 : -8;
  const objectives = typeof currentMatchConfig !== 'undefined' && Array.isArray(currentMatchConfig.objective_hexes) ? currentMatchConfig.objective_hexes : [];
  const objectiveScore = objectives.includes(typeof hexCode === 'function' ? hexCode(candidate.col, candidate.row) : '') ? 8 : 0;
  const nextRoundOptions = Array.from({ length: 6 }, (_, direction) => hexNeighbor(candidate.col, candidate.row, direction))
    .filter(hex => hex.col >= 0 && hex.col < GRID_COLS && hex.row >= 0 && hex.row < GRID_ROWS && !terrainMovementBlocked(hex.col, hex.row)).length * 0.4;
  const allyDistances = mechInstances.filter(unit => unit.owner === mech.owner && unit.instanceId !== mech.instanceId && !unit.destroyed).map(unit => axialDistance(candidate.col, candidate.row, unit.col, unit.row));
  const formationScore = allyDistances.length ? (Math.min(...allyDistances) < 2 ? -4 : Math.min(...allyDistances) <= 6 ? 2 : -2) : 0;
  const retreatScore = coordination?.retreating?.has(mech.instanceId) ? axialDistance(candidate.col, candidate.row, nearest.col, nearest.row) * 2 + coverScore : 0;
  const ecmCoverScore = coordination?.capabilities?.[mech.instanceId]?.ecm && allyDistances.some(distance => distance <= 6) ? 3 : 0;
  const total = rangeScore + coverScore + movementScore + preservation + losScore + objectiveScore + nextRoundOptions + formationScore + retreatScore + ecmCoverScore - hazardPenalty - heatPenalty - facingPenalty;
  return { total, rangeScore, coverScore, movementScore, preservation, losScore, objectiveScore, nextRoundOptions, formationScore, retreatScore, ecmCoverScore, hazardPenalty, heatPenalty, range, preferred };
}

// Generate a deterministic, rules-legal movement action by enumerating final
// positions/facings and scoring range, cover, terrain, heat and survivability.
function generateAIMoveAction(mech, playerMechs, settings, context = null, coordination = null) {
  const unit = BT_UNITS[mech.unitId];
  if (!unit) return null;
  
  if (!playerMechs.length) return null;
  const mobility = criticalMovementProfile(mech);
  const heatPenalty = typeof heatMovementPenalty === 'function' ? heatMovementPenalty(mech) : 0;
  const modes = [{ mode: 'walk', mp: Math.max(0, Number(mobility.walk || 0) - heatPenalty) }, { mode: 'run', mp: Math.max(0, Number(mobility.run || 0) - heatPenalty) }];
  const mascTarget = typeof mascTargetNumber === 'function' ? mascTargetNumber(mech) : 13;
  const riskAcceptable = ['strongest', 'optimal'].includes(settings.targetPriority) && mascTarget <= 7;
  if (riskAcceptable && typeof hasOperationalMASC === 'function' && hasOperationalMASC(mech) && Number(mech.mascLastRound) !== Number(currentGameState.round)) {
    modes.push({ mode: 'run', mp: Math.max(0, Number(mobility.walk || 0) * 2 - heatPenalty), useMASC: true });
  }
  const options = [];
  for (const choice of modes) for (const candidate of aiMovementCandidates(mech, choice.mode, choice.mp)) {
    if (!candidate.path.length) continue;
    const scoreBreakdown = aiScoreDestination(mech, candidate, playerMechs, choice.mode, coordination);
    const mascRisk = choice.useMASC ? Math.max(0, mascTarget - 3) : 0;
    options.push({ ...candidate, movementMode: choice.mode, useMASC: Boolean(choice.useMASC), scoreBreakdown: { ...scoreBreakdown, mascRisk, total: scoreBreakdown.total - mascRisk } });
  }
  const jumpMP = Math.max(0, Number(mobility.jump || 0) - heatPenalty);
  if (jumpMP > 0 && (typeof terrainAt !== 'function' || terrainAt(mech.col, mech.row) !== 'deep_water')) {
    for (let col = 0; col < GRID_COLS; col++) for (let row = 0; row < GRID_ROWS; row++) {
      const distance = axialDistance(mech.col, mech.row, col, row);
      if (!distance || distance > jumpMP || terrainMovementBlocked(col, row) || mechInstances.some(unit => unit.instanceId !== mech.instanceId && !unit.destroyed && unit.col === col && unit.row === row)) continue;
      const nearest = [...playerMechs].sort((a, b) => axialDistance(col, row, a.col, a.row) - axialDistance(col, row, b.col, b.row))[0];
      const facing = aiFacingToward(col, row, nearest);
      const candidate = { col, row, facing, cost: distance, hexes: distance, path: [{ action: 'jump', col, row, facing }] };
      options.push({ ...candidate, movementMode: 'jump', useMASC: false, scoreBreakdown: aiScoreDestination(mech, candidate, playerMechs, 'jump', coordination) });
    }
  }
  options.sort((a, b) => b.scoreBreakdown.total - a.scoreBreakdown.total || a.cost - b.cost || a.col - b.col || a.row - b.row || a.facing - b.facing);
  const best = options[0];
  if (!best || best.scoreBreakdown.total <= aiScoreDestination(mech, { col: mech.col, row: mech.row, facing: mech.facing, hexes: 0 }, playerMechs, 'stand', coordination).total) return null;
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

function withAIWeaponSelection(mech, mountId, option, aimedLocation, callback) {
  const previous = weaponAttackState;
  weaponAttackState = {
    ...emptyWeaponAttackState(),
    attackerId: mech.instanceId,
    ammoBinsByMount: option.bin ? { [mountId]: option.bin.id } : {},
    fireModesByMount: { [mountId]: option.mode },
    aimLocationsByMount: aimedLocation ? { [mountId]: aimedLocation } : {}
  };
  try { return callback(); }
  finally { weaponAttackState = previous; }
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
    evaluateWeaponAttack(mech, target, weaponEntry, { secondaryTarget: Boolean(options.secondaryTarget), indirect, spotter }));
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
  let score = expectedDamage + hitChance * estimatedKillBonus(target, attack) + aiAmmoUtility(modeOption, attack, target, options.settings || {}) + supportUtility + focusBonus;

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
  score *= jamReliability;
  return { target, weaponEntry, mountId, attack, modeOption, aimedLocation, heat, hitChance, expectedDamage, score, indirect, spotterId: spotter?.instanceId || null };
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
      const choices = aiWeaponModeOptions(mech, weaponEntry)
        .map(modeOption => scoreWeaponAttack(mech, target, weaponEntry, { modeOption, settings, coordination }))
        .filter(Boolean);
      return sum + Math.max(0, ...choices.map(choice => choice.score));
    }, 0)
  })).filter(candidate => candidate.score > 0);
  if (!legal.length) return null;
  if (coordination?.enabled) {
    const focus = legal.find(candidate => candidate.target.instanceId === coordination.focusTargetId);
    if (focus) return focus.target;
  }
  if (settings.targetPriority === 'random') return legal[Math.floor((context?.random?.() ?? Math.random()) * legal.length)].target;
  if (settings.targetPriority === 'closest') return legal.sort((a, b) =>
    axialDistance(mech.col, mech.row, a.target.col, a.target.row) - axialDistance(mech.col, mech.row, b.target.col, b.target.row))[0].target;
  return legal.sort((a, b) => b.score - a.score)[0].target;
}

// AI-2 chooses one complete declaration for the current activation. Every
// mount is independently evaluated against the primary and legal secondary
// targets, then the package is constrained by heat and shared ammunition.
function generateAIAttackAction(mech, playerMechs, settings, context = null, coordination = null) {
  const unit = BT_UNITS[mech.unitId];
  if (!unit?.weapons?.length || !playerMechs.length) return null;
  const primary = aiPrimaryWeaponTarget(mech, playerMechs, unit, settings, context, coordination);
  if (!primary) return null;

  const candidateGroups = unit.weapons.map(weaponEntry => {
    const choices = [];
    for (const target of playerMechs) {
      for (const modeOption of aiWeaponModeOptions(mech, weaponEntry)) {
        const choice = scoreWeaponAttack(mech, target, weaponEntry, {
          modeOption,
          secondaryTarget: target.instanceId !== primary.instanceId,
          settings,
          coordination
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
    const choice = choices.find(candidate => {
      const binId = candidate.modeOption.bin?.id;
      const used = binId ? ammoUsed.get(binId) || 0 : 0;
      const available = Number(candidate.modeOption.bin?.shots || Infinity);
      const incompatibleFireLine = selected.some(chosen => chosen.target.instanceId === candidate.target.instanceId && chosen.indirect !== candidate.indirect);
      return !incompatibleFireLine && heatUsed + candidate.heat <= heatBudget && used + candidate.modeOption.shots <= available;
    });
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
    focusTargetId: coordination?.focusTargetId || null,
    _debug: `${selected.length} mount${selected.length === 1 ? '' : 's'}, EV ${expectedDamage.toFixed(1)} damage, ${heatUsed}/${heatBudget} planned heat${coordination?.enabled && primary.instanceId === coordination.focusTargetId ? ', coordinated focus' : ''}${allocations.length > 1 ? `, split across ${allocations.length} targets` : ''}`
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
    mech.hasPhysicalAttacked = true;
    logEvent(`${mechLabel(mech)} (AI) declared no physical attack.`, 'attack');
  } else {
    return false;
  }
  await syncMechInstances();
  updateAdvanceButtonState();
  return true;
}

async function executeAIPlan(aiPlan) {
  if (!aiPlan || !aiPlan.actions || aiPlan.actions.length === 0) {
    completeAIDecision('completed');
    logEvent('AI has no actions to take this phase.', 'system');
    if (currentGameState.phase === 'movement') {
      // No planned move is still a legal decision: the AI stands still.
      mechInstances.filter(m => m.owner === 2 && !m.destroyed).forEach(m => {
        m.movementMode = 'stand';
        m.mpUsed = 0;
        m.hexesMoved = 0;
        m.hasMoved = true;
      });
      await syncMechInstances();
      updateAdvanceButtonState();
      logEvent('AI held position and completed Movement.', 'move');
    }
    if (currentGameState.phase === 'physical_attack') {
      mechInstances.filter(m => m.owner === 2 && !m.destroyed).forEach(m => { m.hasPhysicalAttacked = true; });
      await syncMechInstances();
      updateAdvanceButtonState();
      logEvent('AI made no physical attacks.', 'attack');
    }
    if (currentGameState.phase === 'heat') await resolveAIHeatManagement();
    return;
  }
  
  const plannedPhase = aiPlan.phase || currentGameState.phase;
  logEvent(`AI plan: ${aiPlan.actions.length} action${aiPlan.actions.length === 1 ? '' : 's'} queued.`, 'system');
  // A weapon declaration can immediately hand play back to the human or
  // advance the phase. Save the reproducible plan before that happens; SQL
  // 124 finalizes its outcomes without rewriting combat state afterward.
  if (['movement', 'weapon_attack'].includes(plannedPhase)) await syncMechInstances();
  
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
        case 'attack':
        case 'no_fire':
          await executeAIWeaponDeclaration(action);
          break;
        case 'torso_twist':
        case 'complete_reaction':
          await executeAIReaction(action);
          break;
        case 'physical_attack':
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

  if (plannedPhase === 'reaction') {
    const aiMechs = mechInstances.filter(m => m.owner === 2 && !m.destroyed);
    aiMechs.forEach(m => {
      if (m.prone) m.torsoFacing = m.facing;
      m.hasReacted = true;
    });
    await syncMechInstances();
    updateAdvanceButtonState();
  }

  if (plannedPhase === 'physical_attack') {
    const aiMechs = mechInstances.filter(m => m.owner === 2 && !m.destroyed);
    aiMechs.forEach(m => { m.hasPhysicalAttacked = true; });
    await syncMechInstances();
    updateAdvanceButtonState();
  }

  if (['movement', 'weapon_attack'].includes(plannedPhase)) await finalizeAIDecisionRecord();
  else if (['reaction', 'physical_attack', 'heat'].includes(plannedPhase)) await syncMechInstances();
}

async function executeAISpecialMovement(action) {
  const rpc = { attempt_startup: 'attempt_startup_battlemech', attempt_stand: 'attempt_stand_battlemech', remain_prone: 'remain_prone_battlemech' }[action.type];
  const { error } = await db.rpc(rpc, { p_game_id: currentGameId, p_instance_id: action.instanceId });
  if (error) throw new Error(`Server rejected AI ${action.type.replaceAll('_', ' ')}: ${error.message}`);
  await loadGameState();
}

async function executeAIPhysicalAttack(action) {
  const attacker = mechInstances.find(m => m.instanceId === action.instanceId);
  const target = mechInstances.find(m => m.instanceId === action.targetInstanceId);
  const limb = physicalLimbCandidates(action.attackType).find(candidate => evaluatePhysicalAttack(attacker, target, action.attackType, candidate).valid);
  const attack = evaluatePhysicalAttack(attacker, target, action.attackType, limb);
  if (!attack.valid) throw new Error(attack.reason || 'Physical attack is no longer legal.');
  const roll = roll2d6Detailed();
  const hit = attack.targetNumber <= 2 || (attack.targetNumber <= 12 && roll.total >= attack.targetNumber);
  let message = `${mechLabel(attacker)} (AI) kicked ${mechLabel(target)} — need ${attack.targetNumber}, rolled ${format2d6(roll)}: miss.`;
  if (hit) {
    const damage = applyWeaponDamage(target, attack.damage, 'front');
    message = `${mechLabel(attacker)} (AI) kicked ${mechLabel(target)} — need ${attack.targetNumber}, rolled ${format2d6(roll)}: hit ${hitLocationLabel(damage.location)} for ${attack.damage} damage.${damage.critical ? ' Critical-hit check triggered.' : ''}${damage.destroyedLocations.length ? ` Destroyed: ${damage.destroyedLocations.map(hitLocationLabel).join(', ')}.` : ''}${damage.destroyed ? ' Target destroyed.' : ''}`;
  }
  await syncMechInstances();
  await checkForMatchEnd();
  logEvent(message, 'attack');
  attacker.hasPhysicalAttacked = true;
}

async function executeAIReaction(action) {
  const mech = mechInstances.find(m => m.instanceId === action.instanceId);
  if (!mech || mech.destroyed || mech.hasReacted) throw new Error('Reaction BattleMech is no longer eligible.');

  if (action.type === 'torso_twist') {
    const delta = action.direction === 'left' ? 1 : -1;
    const torsoFacing = mech.torsoFacing == null ? mech.facing : mech.torsoFacing;
    mech.torsoFacing = (torsoFacing + delta + 6) % 6;
    logEvent(`${mechLabel(mech)} (AI) twisted torso ${action.direction}.`, 'phase');
  } else {
    logEvent(`${mechLabel(mech)} (AI) held torso facing.`, 'phase');
  }

  mech.hasReacted = true;
  await syncMechInstances();
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
