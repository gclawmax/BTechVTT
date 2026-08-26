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
  const aiPlan = {
    type: 'ai_plan',
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
  const playerMechs = mechInstances.filter(inst => inst.owner === 1);
  
  // Generate actions for each AI mech
  for (const mech of aiMechs) {
    // The algorithmic AI is phase-scoped: Movement can only create movement
    // actions; Weapon Attack can only create attack actions.
    if (currentGameState.phase === 'movement' && !mech.hasMoved && Math.random() < settings.moveChance) {
      const moveAction = generateAIMoveAction(mech, playerMechs, settings);
      if (moveAction) aiPlan.actions.push(moveAction);
    }

    if (currentGameState.phase === 'weapon_attack' && !mech.hasFired && Math.random() < settings.attackChance) {
      const attackAction = generateAIAttackAction(mech, playerMechs, settings);
      if (attackAction) aiPlan.actions.push(attackAction);
    }

    if (currentGameState.phase === 'reaction' && !mech.hasReacted) {
      aiPlan.actions.push(generateAIReactionAction(mech, playerMechs));
    }

    if (currentGameState.phase === 'physical_attack' && !mech.hasPhysicalAttacked) {
      const target = playerMechs.find(candidate => physicalLimbCandidates('kick').some(limb => evaluatePhysicalAttack(mech, candidate, 'kick', limb).valid));
      if (target) aiPlan.actions.push({ type: 'physical_attack', instanceId: mech.instanceId, targetInstanceId: target.instanceId, attackType: 'kick' });
    }
  }
  
  return aiPlan;
}

// Pick a legal one-hexside torso twist toward the nearest opposing 'Mech.
// If the target is outside that arc, the AI deliberately holds its torso
// facing and still completes the required Reaction action.
function generateAIReactionAction(mech, playerMechs) {
  const target = [...playerMechs].sort((a, b) =>
    axialDistance(mech.col, mech.row, a.col, a.row) - axialDistance(mech.col, mech.row, b.col, b.row)
  )[0];

  if (!target) return { type: 'complete_reaction', instanceId: mech.instanceId };

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
  if (turn === 1) return { type: 'torso_twist', instanceId: mech.instanceId, direction: 'left' };
  if (turn === 5) return { type: 'torso_twist', instanceId: mech.instanceId, direction: 'right' };
  return { type: 'complete_reaction', instanceId: mech.instanceId };
}

// Generate a movement action for AI mech
function generateAIMoveAction(mech, playerMechs, settings) {
  const unit = BT_UNITS[mech.unitId];
  const maxMove = unit.movement.walk * settings.movementRange;
  
  // Simple AI: move toward nearest player mech
  let targetHex = null;
  let minDistance = Infinity;
  
  for (const playerMech of playerMechs) {
    const distance = Math.abs(mech.col - playerMech.col) + Math.abs(mech.row - playerMech.row);
    if (distance < minDistance) {
      minDistance = distance;
      targetHex = { col: playerMech.col, row: playerMech.row };
    }
  }
  
  if (!targetHex) return null;
  
  // Calculate desired direction
  const colDelta = targetHex.col - mech.col;
  const rowDelta = targetHex.row - mech.row;
  
  // Simple movement - move toward target in one or two axes
  const newCol = Math.max(0, Math.min(GRID_COLS - 1, mech.col + Math.sign(colDelta)));
  const newRow = Math.max(0, Math.min(GRID_ROWS - 1, mech.row + Math.sign(rowDelta)));
  
  // Check if hex is empty
  const occupied = mechInstances.some(inst => 
    inst.instanceId !== mech.instanceId && 
    inst.col === newCol && 
    inst.row === newRow
  );
  
  if (occupied) return null;
  
  return {
    type: 'move',
    instanceId: mech.instanceId,
    fromCol: mech.col,
    fromRow: mech.row,
    toCol: newCol,
    toRow: newRow,
    facing: mech.facing // Keep current facing for now
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
  if (totalRemaining <= attack.weapon.damage) return attack.weapon.damage * 1.5;
  if (totalRemaining <= attack.weapon.damage * 2) return attack.weapon.damage * 0.5;
  return 0;
}

function scoreWeaponAttack(mech, target, weaponEntry) {
  const attack = evaluateWeaponAttack(mech, target, weaponEntry);
  if (!attack.valid) return null;
  const hitChance = toHitProbability(attack.targetNumber);
  const expectedDamage = hitChance * attack.weapon.damage;
  const killBonus = hitChance * estimatedKillBonus(target, attack);
  return { target, weaponEntry, attack, hitChance, expectedDamage, score: expectedDamage + killBonus };
}

// Generate an attack action scored by expected damage rather than choosing
// the catalogue's first weapon against a distance/tonnage-sorted target.
function generateAIAttackAction(mech, playerMechs, settings) {
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
    choice = candidates[Math.floor(Math.random() * candidates.length)];
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
async function executeAIPlan(aiPlan) {
  if (!aiPlan || !aiPlan.actions || aiPlan.actions.length === 0) {
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
    
    switch (action.type) {
      case 'move':
        await executeAIMove(action);
        break;
      case 'attack':
        await executeAIAttack(action);
        break;
      case 'torso_twist':
        await executeAIReaction(action);
        break;
      case 'complete_reaction':
        await executeAIReaction(action);
        break;
      case 'physical_attack':
        await executeAIPhysicalAttack(action);
        break;
    }
  }
  
  console.log('AI plan execution complete');

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

  if (currentGameState.phase === 'physical_attack') {
    const aiMechs = mechInstances.filter(m => m.owner === 2 && !m.destroyed);
    aiMechs.forEach(m => { m.hasPhysicalAttacked = true; });
    await syncMechInstances();
    updateAdvanceButtonState();
  }
}

async function executeAIPhysicalAttack(action) {
  const attacker = mechInstances.find(m => m.instanceId === action.instanceId);
  const target = mechInstances.find(m => m.instanceId === action.targetInstanceId);
  const limb = physicalLimbCandidates(action.attackType).find(candidate => evaluatePhysicalAttack(attacker, target, action.attackType, candidate).valid);
  const attack = evaluatePhysicalAttack(attacker, target, action.attackType, limb);
  if (!attack.valid) return;
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
}

async function executeAIReaction(action) {
  const mech = mechInstances.find(m => m.instanceId === action.instanceId);
  if (!mech || mech.destroyed || mech.hasReacted) return;

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
  if (!mech) return;

  const dir = directionBetween(action.fromCol, action.fromRow, action.toCol, action.toRow);

  // Update mech position
  mech.col = action.toCol;
  mech.row = action.toRow;

  // Face the direction of travel (hex-direction index 0-5), when it's a single valid step.
  if (dir !== -1) mech.facing = dir;

  // Simplified bookkeeping so the Movement Panel reflects the AI's move too.
  mech.movementMode = 'walk';
  mech.hexesMoved = (mech.hexesMoved || 0) + 1;
  mech.mpUsed = (mech.mpUsed || 0) + 1;
  mech.hasMoved = true;
  mech.movementHeat = MOVEMENT_HEAT.walk;
  mech.heat = (mech.roundStartingHeat || 0) + mech.movementHeat + (mech.weaponHeat || 0) + (mech.externalHeat || 0);

  // Update UI
  draw();
  renderRoster();
  renderDetail();
  renderMovementPanel();
  await syncMechInstances();
  logEvent(`${mechLabel(mech)} (AI) moved to ${hexCode(action.toCol, action.toRow)}.`, 'move');
}

// Execute AI attack
async function executeAIAttack(action) {
  const attacker = mechInstances.find(m => m.instanceId === action.instanceId);
  const target = mechInstances.find(m => m.instanceId === action.targetInstanceId);
  
  if (!attacker || !target || attacker.hasFired) return;
  
  const weaponEntry = BT_UNITS[attacker.unitId].weapons.find(weapon =>
    weapon.key === action.weaponKey && (!action.weaponLocation || weapon.location === action.weaponLocation));
  if (!weaponEntry) return;
  const attack = evaluateWeaponAttack(attacker, target, weaponEntry);
  if (!attack.valid) return;

  attacker.weaponHeat = (attacker.weaponHeat || 0) + attack.weapon.heat;
  attacker.heat = (attacker.roundStartingHeat || 0) + (attacker.movementHeat || 0) + attacker.weaponHeat + (attacker.externalHeat || 0);
  const roll = roll2d6Detailed();
  const hit = attack.targetNumber <= 2 || (attack.targetNumber <= 12 && roll.total >= attack.targetNumber);
  let message = `${mechLabel(attacker)} (AI) fired ${attack.weapon.name} at ${mechLabel(target)} — need ${attack.targetNumber}, rolled ${format2d6(roll)}: miss.`;
  if (hit) {
    const damage = applyWeaponDamage(target, attack.weapon.damage, attack.attackAngle);
    const flamerHeat = weaponEntry.key === 'flamer' ? 2 : 0;
    if (flamerHeat) {
      target.externalHeat = (target.externalHeat || 0) + flamerHeat;
      target.heat = (target.heat || 0) + flamerHeat;
    }
    message = `${mechLabel(attacker)} (AI) fired ${attack.weapon.name} at ${mechLabel(target)} — need ${attack.targetNumber}, rolled ${format2d6(roll)}: ${attack.attackAngle} hit ${hitLocationLabel(damage.location)} for ${attack.weapon.damage} damage.${flamerHeat ? ` ${mechLabel(target)} gains ${flamerHeat} heat.` : ''}${damage.critical ? ' Critical-hit check triggered.' : ''}${damage.destroyedLocations.length ? ` Destroyed: ${damage.destroyedLocations.map(hitLocationLabel).join(', ')}.` : ''}${damage.destroyed ? ' Target destroyed.' : ''}`;
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
