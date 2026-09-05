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
    planningHorizon: 1
  },
  intermediate: {
    moveChance: 0.85,
    attackChance: 0.75,
    targetPriority: 'closest',
    movementRange: 2,
    heatManagement: true,
    planningHorizon: 2
  },
  advanced: {
    moveChance: 0.95,
    attackChance: 0.85,
    targetPriority: 'strongest',
    movementRange: 3,
    heatManagement: true,
    planningHorizon: 3
  },
  expert: {
    moveChance: 1.0,
    attackChance: 0.95,
    targetPriority: 'optimal',
    movementRange: 3,
    heatManagement: true,
    planningHorizon: 5
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
  
  // Generate one explicit action or pass for every eligible AI BattleMech.
  // A weak difficulty may choose a conservative pass, but it may never omit
  // the activation and leave the match waiting forever.
  for (const mech of aiMechs) {
    // The algorithmic AI is phase-scoped: Movement can only create movement
    // actions; Weapon Attack can only create attack actions.
    if (currentGameState.phase === 'movement' && !mech.hasMoved && !mech.destroyed) {
      const canConsiderMove = !mech.shutdown && (!mech.pilot?.consciousness || mech.pilot.consciousness === 'conscious');
      const moveAction = canConsiderMove && context.random() < settings.moveChance
        ? generateAIMoveAction(mech, playerMechs, settings, context) : null;
      aiPlan.actions.push(moveAction || { type: 'complete_movement', instanceId: mech.instanceId, reason: canConsiderMove ? 'Held position by difficulty policy.' : 'Unable to move.' });
    }

    if (currentGameState.phase === 'weapon_attack' && !mech.hasFired && !mech.destroyed) {
      const canConsiderFire = !mech.shutdown && (!mech.pilot?.consciousness || mech.pilot.consciousness === 'conscious');
      const attackAction = canConsiderFire && context.random() < settings.attackChance
        ? generateAIAttackAction(mech, playerMechs, settings, context) : null;
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
  
  return aiPlan;
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

// Generate a movement action for AI mech
function generateAIMoveAction(mech, playerMechs, settings, context = null) {
  const unit = BT_UNITS[mech.unitId];
  if (!unit) return null;
  
  // Simple AI: move toward nearest player mech
  let targetHex = null;
  let minDistance = Infinity;
  
  for (const playerMech of playerMechs) {
    const distance = axialDistance(mech.col, mech.row, playerMech.col, playerMech.row);
    if (distance < minDistance) {
      minDistance = distance;
      targetHex = { col: playerMech.col, row: playerMech.row };
    }
  }
  
  if (!targetHex) return null;
  
  const mobility = criticalMovementProfile(mech);
  const tsmActive = typeof hasActiveTSM === 'function' && hasActiveTSM(mech);
  const ordinaryRun = tsmActive && typeof boosterRunMP === 'function' ? boosterRunMP(mech, false, false) : mobility.run;
  const ordinaryBudget = Math.min(ordinaryRun, Math.max(1, Number(settings.movementRange) || 1));
  const mascTarget = typeof mascTargetNumber === 'function' ? mascTargetNumber(mech) : 13;
  const riskAcceptable = ['strongest', 'optimal'].includes(settings.targetPriority) && mascTarget <= 7;
  const useMASC = typeof hasOperationalMASC === 'function' && hasOperationalMASC(mech) &&
    Number(mech.mascLastRound) !== Number(currentGameState.round) && riskAcceptable && minDistance > ordinaryBudget + 1;
  const maxMove = useMASC ? Math.min(typeof mascRunMP === 'function' ? mascRunMP(mech) : mobility.run, ordinaryBudget + mobility.walk) : ordinaryBudget;

  // Build a deterministic legal route that reduces true hex distance. MASC is
  // considered only by advanced AI and only while its failure target is 7+ or
  // easier; it is never treated as a free, automatic speed bonus.
  const path = [];
  let current = { col: mech.col, row: mech.row };
  for (let step = 0; step < maxMove; step++) {
    const choices = Array.from({ length: 6 }, (_, direction) => ({ ...hexNeighbor(current.col, current.row, direction), direction }))
      .filter(hex => hex.col >= 0 && hex.col < GRID_COLS && hex.row >= 0 && hex.row < GRID_ROWS)
      .filter(hex => !terrainMovementBlocked(hex.col, hex.row))
      .filter(hex => !mechInstances.some(inst => inst.instanceId !== mech.instanceId && !inst.destroyed && inst.col === hex.col && inst.row === hex.row))
      .sort((a, b) => axialDistance(a.col, a.row, targetHex.col, targetHex.row) - axialDistance(b.col, b.row, targetHex.col, targetHex.row));
    const next = choices[0];
    if (!next || axialDistance(next.col, next.row, targetHex.col, targetHex.row) >= axialDistance(current.col, current.row, targetHex.col, targetHex.row)) break;
    path.push({ col: next.col, row: next.row, direction: next.direction });
    current = next;
    if (axialDistance(current.col, current.row, targetHex.col, targetHex.row) <= 1) break;
  }
  if (!path.length) return null;
  
  return {
    type: 'move',
    instanceId: mech.instanceId,
    fromCol: mech.col,
    fromRow: mech.row,
    toCol: current.col,
    toRow: current.row,
    path,
    useMASC,
    tsmActive,
    mascTarget,
    facing: path.at(-1)?.direction ?? mech.facing,
    _debug: `Closed from range ${minDistance} to ${axialDistance(current.col, current.row, targetHex.col, targetHex.row)}`
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

function scoreWeaponAttack(mech, target, weaponEntry) {
  const attack = evaluateWeaponAttack(mech, target, weaponEntry);
  if (!attack.valid) return null;
  const hitChance = toHitProbability(attack.targetNumber);
  const expectedDamage = hitChance * (attack.damage ?? attack.weapon.damage);
  const killBonus = hitChance * estimatedKillBonus(target, attack);
  return { target, weaponEntry, attack, hitChance, expectedDamage, score: expectedDamage + killBonus };
}

// Generate an attack action scored by expected damage rather than choosing
// the catalogue's first weapon against a distance/tonnage-sorted target.
function generateAIAttackAction(mech, playerMechs, settings, context = null) {
  const unit = BT_UNITS[mech.unitId];
  if (!unit?.weapons?.length) return null;

  const candidates = [];
  for (const target of playerMechs) {
    for (const weaponEntry of unit.weapons) {
      const scored = scoreWeaponAttack(mech, target, weaponEntry);
      if (scored) candidates.push(scored);
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);

  let choice;
  if (settings.targetPriority === 'random') {
    const random = context?.random || Math.random;
    choice = candidates[Math.floor(random() * candidates.length)];
  } else if (settings.targetPriority === 'closest') {
    const nearestTarget = [...playerMechs].sort((a, b) =>
      axialDistance(mech.col, mech.row, a.col, a.row) - axialDistance(mech.col, mech.row, b.col, b.row)
    )[0];
    choice = candidates.find(candidate => candidate.target.instanceId === nearestTarget?.instanceId) || candidates[0];
  } else {
    choice = candidates[0];
  }

  return {
    type: 'attack',
    instanceId: mech.instanceId,
    targetInstanceId: choice.target.instanceId,
    weaponKey: choice.weaponEntry.key,
    weaponLocation: choice.weaponEntry.location,
    weaponCount: choice.weaponEntry.count,
    _debug: `EV ${choice.expectedDamage.toFixed(1)} dmg (${Math.round(choice.hitChance * 100)}% to hit ${choice.attack.targetNumber}+) vs ${mechLabel(choice.target)}`
  };
}

// Execute AI plan after a delay
async function completeAIUnitPhaseAction(action) {
  const mech = mechInstances.find(candidate => candidate.instanceId === action.instanceId);
  if (!mech || mech.destroyed) return false;
  if (action.type === 'complete_movement') {
    mech.movementMode = 'stand';
    mech.mpUsed = 0;
    mech.hexesMoved = 0;
    mech.movementHeat = 0;
    mech.heat = (mech.roundStartingHeat || 0) + (mech.weaponHeat || 0) + (mech.externalHeat || 0);
    mech.hasMoved = true;
    logEvent(`${mechLabel(mech)} (AI) held position.`, 'move');
  } else if (action.type === 'no_fire') {
    mech.hasFired = true;
    logEvent(`${mechLabel(mech)} (AI) declared no weapon fire.`, 'attack');
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
    if (currentGameState.phase === 'weapon_attack') {
      mechInstances.filter(m => m.owner === 2 && !m.destroyed).forEach(m => { m.hasFired = true; });
      await syncMechInstances();
      updateAdvanceButtonState();
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
  
  logEvent(`AI plan: ${aiPlan.actions.length} action${aiPlan.actions.length === 1 ? '' : 's'} queued.`, 'system');
  
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
          await executeAIAttack(action);
          break;
        case 'torso_twist':
        case 'complete_reaction':
          await executeAIReaction(action);
          break;
        case 'physical_attack':
          await executeAIPhysicalAttack(action);
          break;
        case 'complete_movement':
        case 'no_fire':
        case 'no_physical_attack':
          await completeAIUnitPhaseAction(action);
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

  if (currentGameState.phase === 'movement') {
    const aiMechs = mechInstances.filter(m => m.owner === 2 && !m.destroyed);
    aiMechs.forEach(m => { if (!m.hasMoved) { m.movementMode = 'stand'; m.mpUsed = 0; m.hexesMoved = 0; m.movementHeat = 0; m.heat = (m.roundStartingHeat || 0) + (m.weaponHeat || 0); m.hasMoved = true; } });
    await syncMechInstances();
    updateAdvanceButtonState();
  }

  if (currentGameState.phase === 'weapon_attack') {
    const aiMechs = mechInstances.filter(m => m.owner === 2 && !m.destroyed);
    aiMechs.forEach(m => { m.hasFired = true; });
    await syncMechInstances();
    updateAdvanceButtonState();
  }

  if (currentGameState.phase === 'reaction') {
    const aiMechs = mechInstances.filter(m => m.owner === 2 && !m.destroyed);
    aiMechs.forEach(m => {
      if (m.prone) m.torsoFacing = m.facing;
      m.hasReacted = true;
    });
    await syncMechInstances();
    updateAdvanceButtonState();
  }

  if (currentGameState.phase === 'physical_attack') {
    const aiMechs = mechInstances.filter(m => m.owner === 2 && !m.destroyed);
    aiMechs.forEach(m => { m.hasPhysicalAttacked = true; });
    await syncMechInstances();
    updateAdvanceButtonState();
  }

  // The final sync stores the completed decision envelope, including every
  // action outcome, through SQL 123's guarded AI authority gateway.
  if (['movement', 'reaction', 'weapon_attack', 'physical_attack', 'heat'].includes(currentGameState.phase)) await syncMechInstances();
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

  if (action.useMASC) {
    const result = resolveLocalMASCActivation(mech);
    logEvent(`${mechLabel(mech)} (AI) activated MASC — need ${result.target}+, rolled ${format2d6(result)}: ${result.passed ? 'success' : 'failure'}.`, 'roll');
    if (!result.passed) {
      const damaged = result.criticals.map(hit => `${hitLocationLabel(hit.location)} ${hit.label}`).join(', ');
      logEvent(`${mechLabel(mech)} (AI) suffered MASC failure damage to ${damaged || 'no remaining leg component'}${result.fallDamage ? ` and fell for ${result.fallDamage} damage` : ''}.`, 'roll');
      if (!mech.hasMoved) {
        mech.hasMoved = true; mech.movementMode = 'stand'; mech.mpUsed = 0; mech.hexesMoved = 0; mech.movementHeat = 0;
      }
      await syncMechInstances(); draw(); renderRoster(); renderDetail(); renderMovementPanel(); updateAdvanceButtonState();
      return;
    }
  }
  const dir = action.path?.at(-1)?.direction ?? directionBetween(action.fromCol, action.fromRow, action.toCol, action.toRow);

  // Update mech position
  mech.col = action.toCol;
  mech.row = action.toRow;

  // Face the direction of travel (hex-direction index 0-5), when it's a single valid step.
  if (dir !== -1) mech.facing = dir;

  // Simplified bookkeeping so the Movement Panel reflects the AI's move too.
  mech.movementMode = action.useMASC ? 'run' : 'walk';
  mech.mascUsedThisRound = Boolean(action.useMASC);
  mech.tsmActiveThisRound = Boolean(action.tsmActive);
  mech.hexesMoved = action.path?.length || 1;
  mech.mpUsed = action.path?.length || 1;
  mech.hasMoved = true;
  mech.movementHeat = action.useMASC ? MOVEMENT_HEAT.run : MOVEMENT_HEAT.walk;
  mech.heat = (mech.roundStartingHeat || 0) + mech.movementHeat + (mech.weaponHeat || 0) + (mech.externalHeat || 0);

  // Update UI
  draw();
  renderRoster();
  renderDetail();
  renderMovementPanel();
  await syncMechInstances();
  logEvent(`${mechLabel(mech)} (AI) ${action.useMASC ? 'used MASC and ran' : 'moved'} ${mech.hexesMoved} hex${mech.hexesMoved === 1 ? '' : 'es'} to ${hexCode(action.toCol, action.toRow)}${action.tsmActive ? ' with TSM active' : ''}.`, 'move');
}

// Execute AI attack
async function executeAIAttack(action) {
  const attacker = mechInstances.find(m => m.instanceId === action.instanceId);
  const target = mechInstances.find(m => m.instanceId === action.targetInstanceId);
  
  if (!attacker || !target || attacker.destroyed || target.destroyed || attacker.hasFired) throw new Error('Weapon attacker or target is no longer eligible.');
  
  const weaponEntry = BT_UNITS[attacker.unitId].weapons.find(weapon =>
    weapon.key === action.weaponKey && (!action.weaponLocation || weapon.location === action.weaponLocation));
  if (!weaponEntry) throw new Error('Planned weapon mount is no longer available.');
  const attack = evaluateWeaponAttack(attacker, target, weaponEntry);
  if (!attack.valid) throw new Error(attack.reason || 'Planned weapon attack is no longer legal.');

  attacker.weaponHeat = (attacker.weaponHeat || 0) + attack.weapon.heat;
  attacker.heat = (attacker.roundStartingHeat || 0) + (attacker.movementHeat || 0) + attacker.weaponHeat + (attacker.externalHeat || 0);
  const roll = roll2d6Detailed();
  const hit = attack.targetNumber <= 2 || (attack.targetNumber <= 12 && roll.total >= attack.targetNumber);
  let message = `${mechLabel(attacker)} (AI) fired ${attack.weapon.name} at ${mechLabel(target)} — need ${attack.targetNumber}, rolled ${format2d6(roll)}: miss.`;
  if (hit) {
    const shotDamage = attack.damage ?? attack.weapon.damage;
    const damage = applyWeaponDamage(target, shotDamage, attack.attackAngle);
    const flamerHeat = weaponEntry.key === 'flamer' ? 2 : 0;
    if (flamerHeat) {
      target.externalHeat = (target.externalHeat || 0) + flamerHeat;
      target.heat = (target.heat || 0) + flamerHeat;
    }
    message = `${mechLabel(attacker)} (AI) fired ${attack.weapon.name} at ${mechLabel(target)} — need ${attack.targetNumber}, rolled ${format2d6(roll)}: ${attack.attackAngle} hit ${hitLocationLabel(damage.location)} for ${shotDamage} damage.${flamerHeat ? ` ${mechLabel(target)} gains ${flamerHeat} heat.` : ''}${damage.critical ? ' Critical-hit check triggered.' : ''}${damage.destroyedLocations.length ? ` Destroyed: ${damage.destroyedLocations.map(hitLocationLabel).join(', ')}.` : ''}${damage.destroyed ? ' Target destroyed.' : ''}`;
  }
  await syncMechInstances();
  await checkForMatchEnd();
  await queueLocalWeaponPresentation(attacker, [{
    msg: `${message}${action._debug ? ` [${action._debug}]` : ''}`,
    soundFamily: weaponSoundFamily({ weapon: attack.weapon.name })
  }]);

  // Update UI
  draw();
  renderRoster();
  renderDetail();
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
