// ── MOVEMENT PANEL & CONTROLS ─────────────────────────────
const HEX_DIR_LABELS = ['E', 'NE', 'NW', 'W', 'SW', 'SE'];
const MOVE_MODE_LABELS = { stand: 'Standing Still', walk: 'Walked', run: 'Ran', jump: 'Jumped' };
const MOVE_BTN_STYLE = 'padding:9px 10px;border:1px solid var(--phosphor);background:var(--phosphor);color:#fff;font-family:var(--display);font-size:10px;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;border-radius:2px;text-align:left;';
const MOVEMENT_HEAT = { stand: 0, walk: 1, run: 2, jump: 3 };

function movementTerrainCost(col, row) {
  return ({ light_woods: 1, heavy_woods: 2, rough: 1, rubble: 1, shallow_water: 1, deep_water: 3 })[terrainAt(col, row)] || 0;
}

function movementTerrainHeat(path = []) {
  return path.filter(step => step.action === 'step' && terrainAt(step.col, step.row) === 'fire').length * 2;
}

function movementElevationCost(fromCol, fromRow, toCol, toRow) {
  const level = (col, row) => terrainAt(col, row) === 'deep_water' ? -2 : terrainAt(col, row) === 'shallow_water' ? -1 : elevationAt(col, row);
  return Math.abs(level(toCol, toRow) - level(fromCol, fromRow));
}

function submergedLegJumpJets(mech) {
  if (terrainAt(mech.col, mech.row) !== 'shallow_water') return 0;
  const layout = BT_CRITICAL_LAYOUTS[mech.unitId] || {};
  return ['ll', 'rl'].reduce((total, location) => total + (layout[location] || []).filter((slot, index) =>
    /jump jet/i.test(criticalSlotName(slot)) && !(mech.criticalSlotDamage?.[location] || []).includes(index)
  ).length, 0);
}

function titleCaseMode(mode) {
  return MOVE_MODE_LABELS[mode] || (mode ? titleCase(mode) : '—');
}

function heatMovementPenalty(mech) {
  const heat = mech.roundStartingHeat ?? mech.heat ?? 0;
  return heat >= 25 ? 4 : heat >= 20 ? 3 : heat >= 15 ? 2 : heat >= 10 ? 1 : 0;
}

async function attemptStartup(instanceId) {
  const mech = mechInstances.find(candidate => candidate.instanceId === instanceId);
  if (!mech || !mech.shutdown || mech.hasMoved || (mech.pilot?.consciousness && mech.pilot.consciousness !== 'conscious') || mech.owner !== mySeatNumber || currentGameState.phase !== 'movement' || !isMyActiveTurn()) return;
  const { data, error } = await db.rpc('attempt_startup_battlemech', { p_game_id: currentGameId, p_instance_id: instanceId });
  if (error) { flashMoveWarning(error.message); logEvent(`Server rejected the startup attempt: ${error.message}`, 'error'); return; }
  const roll = data?.to_hit || {};
  logEvent(`${mechLabel(mech)} ${data?.passed ? 'restarted' : 'failed to restart'} — need ${roll.target}, rolled ${roll.die_a} + ${roll.die_b} = ${roll.total}.`, 'roll');
  await loadGameState();
}

async function attemptStand(instanceId) {
  const mech = mechInstances.find(candidate => candidate.instanceId === instanceId);
  if (!mech || !mech.prone || mech.hasMoved || (mech.pilot?.consciousness && mech.pilot.consciousness !== 'conscious') || mech.owner !== mySeatNumber || currentGameState.phase !== 'movement' || !isMyActiveTurn()) return;
  if (vsAiMode) {
    const mobility = criticalMovementProfile(mech);
    if (mobility.destroyedLegs >= 2 || mobility.gyroDestroyed) return;
    const roll = roll2d6Detailed();
    const target = Number(mech.pilot?.piloting ?? mech.pilotingSkill ?? 5) + mobility.pilotingModifier;
    const passed = roll.total >= target;
    mech.prone = !passed;
    mech.hasMoved = true;
    mech.movementMode = mobility.destroyedLegs === 1 ? 'run' : 'stand';
    mech.mpUsed = mobility.destroyedLegs === 1 ? 1 : 2;
    mech.hexesMoved = 0;
    renderMovementPanel(); renderRoster(); renderDetail(); draw();
    logEvent(`${mechLabel(mech)} ${passed ? 'stood up' : 'failed to stand'} — need ${target}, rolled ${format2d6(roll)}.`, 'roll');
    await syncMechInstances();
    return;
  }
  const { data, error } = await db.rpc('attempt_stand_battlemech', {
    p_game_id: currentGameId, p_instance_id: instanceId
  });
  if (error) { flashMoveWarning(error.message); logEvent(`Server rejected the stand attempt: ${error.message}`, 'error'); return; }
  const roll = data?.to_hit || {};
  const damage = roll.damage_modifier ? ` (including +${roll.damage_modifier} critical damage)` : '';
  logEvent(`${mechLabel(mech)} ${data?.passed ? 'stood up' : 'failed to stand'} — need ${roll.target}${damage}, rolled ${roll.die_a} + ${roll.die_b} = ${roll.total}; spent ${data?.movement_points_spent || 2} MP.`, 'roll');
  await loadGameState();
}

function activationUnitsLeft(seat, phase = currentGameState.phase) {
  const flag = phase === 'movement' ? 'hasMoved' : phase === 'weapon_attack' ? 'hasFired' : 'hasPhysicalAttacked';
  return mechInstances.filter(mech => {
    if (mech.owner !== seat || mech[flag] || (mech.pilot?.consciousness && mech.pilot.consciousness !== 'conscious') || (mech.shutdown && phase !== 'movement')) return false;
    if (phase === 'weapon_attack') {
      return mech.weaponPhaseStart?.round === currentGameState.round && !mech.weaponPhaseStart?.mech?.destroyed;
    }
    return !mech.destroyed;
  }).length;
}

// The database is authoritative. This mirror only explains the current
// unequal-force activation allowance in the panel before the first action.
function currentActivationAllowance(phase = currentGameState.phase) {
  const tracker = currentGameState.phase_activation;
  if (tracker && tracker.round === currentGameState.round && tracker.phase === phase &&
      tracker.current_player_id === currentGameState.active_player_id) {
    return Math.max(1, Number(tracker.remaining) || 1);
  }
  const activeSeat = getActivePlayerSeat();
  const own = activationUnitsLeft(activeSeat, phase);
  const otherSeat = (currentGameState.initiative_order || []).map(entry => entry.seat_number).find(seat => seat !== activeSeat);
  const other = activationUnitsLeft(otherSeat, phase);
  return other ? Math.max(1, Math.floor(own / other)) : Math.max(1, own);
}

// Clears every 'Mech's movement flags at the start of a fresh Movement Phase.
function resetMovementForRound() {
  mechInstances.forEach(m => {
    m.movementMode = null;
    m.mpUsed = 0;
    m.hexesMoved = 0;
    m.hasMoved = false;
    m.hasReacted = false;
    m.torsoFacing = m.facing;
    ensureMechCombatState(m);
    m.roundStartingHeat = m.heat || 0;
    m.movementHeat = 0;
    m.weaponHeat = 0;
    m.externalHeat = 0;
    m.heatDissipated = 0;
    m.hasManagedHeat = false;
  });
}

// Persist 'Mech positions/facings/movement data so the other browser stays in sync.
async function syncMechInstances() {
  if (!currentGameId) return;
  const mechSnapshot = mechInstances.map(mech => ({ ...mech }));
  try {
    await queueGameStateWrite(async () => {
      // In a human game, only the player currently taking the turn may save
      // their own units. The RPC preserves the opponent's units and advances
      // the turn/phase once this seat has completed its required actions.
      if (!vsAiMode) {
        const { error } = await db.rpc('submit_phase_state', {
          p_game_id: currentGameId,
          p_mech_instances: mechSnapshot
        });
        if (error) throw error;
        await loadGameState();
        return;
      }
      const { data: game, error: readError } = await db.from('btech_games').select('state').eq('id', currentGameId).single();
      if (readError) throw readError;
      const gameState = game?.state ? (typeof game.state === 'string' ? JSON.parse(game.state) : game.state) : {};
      gameState.mech_instances = mechSnapshot;
      const { error: writeError } = await db.from('btech_games').update({ state: JSON.stringify(gameState) }).eq('id', currentGameId);
      if (writeError) throw writeError;
    });
  } catch (err) {
    console.warn('Failed to sync mech positions:', err);
    logEvent(`Failed to sync 'Mech positions: ${err.message || err}`, 'error');
  }
}

function flashMoveWarning(msg) {
  const cap = document.getElementById('map-caption');
  if (!cap) return;
  if (!cap.dataset.original) cap.dataset.original = cap.textContent;
  cap.textContent = '⚠ ' + msg;
  cap.style.color = 'var(--alert)';
  clearTimeout(flashMoveWarning._t);
  flashMoveWarning._t = setTimeout(() => {
    cap.textContent = cap.dataset.original;
    cap.style.color = '';
  }, 1800);
}

// Begin a movement action for a 'Mech: 'stand' resolves instantly, others open an interactive move.
async function startMovementMode(instanceId, mode) {
  const mech = mechInstances.find(m => m.instanceId === instanceId);
  if (!mech || mech.catalogueUnavailable || mech.hasMoved || (mech.pilot?.consciousness && mech.pilot.consciousness !== 'conscious') || mech.owner !== mySeatNumber || currentGameState.phase !== 'movement' || !isMyActiveTurn()) return;
  const criticalMovement = criticalMovementProfile(mech);
  if (criticalMovement.destroyedLegs >= 2) {
    flashMoveWarning("A 'Mech with both legs destroyed cannot move.");
    return;
  }
  if (gyroDestroyedByCritical(mech)) {
    flashMoveWarning("A destroyed gyro prevents this 'Mech from moving.");
    return;
  }
  if (mode === 'run' && criticalMovement.destroyedLegs) {
    flashMoveWarning("A 'Mech standing on one leg cannot run.");
    return;
  }
  const unit = BT_UNITS[mech.unitId];

  if (mode === 'stand') {
    if (!vsAiMode) {
      await submitAuthoritativeMovement(mech, mode, []);
      return;
    }
    mech.movementMode = 'stand';
    mech.mpUsed = 0;
    mech.hexesMoved = 0;
    mech.hasMoved = true;
    mech.movementHeat = MOVEMENT_HEAT.stand;
    mech.heat = (mech.roundStartingHeat || 0) + mech.movementHeat + (mech.weaponHeat || 0) + (mech.externalHeat || 0);
    renderMovementPanel();
    renderRoster();
    renderDetail();
    draw();
    updateAdvanceButtonState();
    await syncMechInstances();
    logEvent(`${mechLabel(mech)} stood still at ${hexCode(mech.col, mech.row)}.`, 'move');
    return;
  }

  if (mode === 'jump' && terrainAt(mech.col, mech.row) === 'deep_water') {
    flashMoveWarning("A submerged 'Mech cannot use its jump jets.");
    return;
  }
  const waterJetPenalty = mode === 'jump' ? submergedLegJumpJets(mech) : 0;
  const mpMax = Math.max(0, (criticalMovement[mode] || 0) - heatMovementPenalty(mech) - waterJetPenalty);
  if (mpMax <= 0) return;

  moveState = {
    active: true,
    instanceId,
    mode,
    mpMax,
    mpUsed: 0,
    hexesMoved: 0,
    origCol: mech.col,
    origRow: mech.row,
    origFacing: mech.facing,
    origTorsoFacing: mech.torsoFacing,
    path: [],
    jumpFacing: false
  };
  renderMovementPanel();
  draw();
}

// Handle a click on the hex grid while a movement action is in progress.
function attemptMoveStep(col, row) {
  const mech = mechInstances.find(m => m.instanceId === moveState.instanceId);
  if (!mech) return;
  if (col === mech.col && row === mech.row) return;
  if (isHexOccupied(col, row, mech.instanceId)) { flashMoveWarning("Can't stack on another 'Mech."); return; }

  const mpLeft = moveState.mpMax - moveState.mpUsed;

  if (moveState.mode === 'jump') {
    // Jumping ignores terrain, intervening 'Mechs, and facing en route (Quick-Start Rules, p.3).
    if (terrainMovementBlocked(col, row)) { flashMoveWarning('That hex cannot be used as a jump landing.'); return; }
    const dist = axialDistance(moveState.origCol, moveState.origRow, col, row);
    if (dist > moveState.mpMax) { flashMoveWarning('Not enough Jump MP for that hex.'); return; }
    const dir = directionBetween(moveState.origCol, moveState.origRow, col, row);
    mech.col = col;
    mech.row = row;
    // Per Quick-Start Rules p.3 the 'Mech faces the direction of travel on landing,
    // but the player may then freely rotate to any facing at no MP cost. We land
    // facing the travel direction, then enter a free-facing micro-state where the
    // turn buttons rotate without deducting MP before the move is confirmed.
    if (dir !== -1) mech.facing = dir;
    mech.torsoFacing = mech.facing;
    moveState.mpUsed = dist;
    moveState.hexesMoved = dist;
    moveState.path = [{ action: 'jump', col, row }];
    moveState.jumpFacing = true;
  } else {
    // Walk/Run: one hex per click, forward/rear along current facing, or a facing change + step.
    const dir = directionBetween(mech.col, mech.row, col, row);
    if (dir === -1) { flashMoveWarning('Click a hex adjacent to your ‘Mech.'); return; }
    if (terrainMovementBlocked(col, row)) { flashMoveWarning('That terrain is impassable.'); return; }
    if (movementElevationCost(mech.col, mech.row, col, row) > 2) { flashMoveWarning('A BattleMech cannot cross a level change greater than two.'); return; }
    const isRear = dir === ((mech.facing + 3) % 6);
    if (isRear && moveState.mode !== 'walk') { flashMoveWarning("Can't move backward while running."); return; }
    const levelCost = movementElevationCost(mech.col, mech.row, col, row);
    if (isRear && levelCost) { flashMoveWarning("A BattleMech cannot change levels while moving backward."); return; }
    if (moveState.mode === 'run' && ['shallow_water', 'deep_water'].includes(terrainAt(col, row))) { flashMoveWarning("A running BattleMech cannot enter water."); return; }
    const cost = (dir === mech.facing ? 1 : (isRear ? 1 : facingTurnCost(mech.facing, dir) + 1)) + movementTerrainCost(col, row) + levelCost;
    if (cost > mpLeft) { flashMoveWarning('Not enough MP for that move.'); return; }
    mech.col = col;
    mech.row = row;
    if (!isRear) mech.facing = dir; // backing up doesn't change which way you're facing
    mech.torsoFacing = mech.facing;
    moveState.mpUsed += cost;
    moveState.hexesMoved += 1;
    moveState.path.push({ action: 'step', col, row });
  }

  renderMovementPanel();
  renderReactionPanel();
  renderRoster();
  renderDetail();
  draw();
}

// Spend Movement Points to change facing without entering a new hex.
// During the post-jump free-facing micro-state (moveState.jumpFacing) the rotation
// is free — per Quick-Start Rules p.3 the landing facing may be chosen at no MP cost.
function turnMovementFacing(instanceId, direction) {
  if (!moveState.active || currentGameState.phase !== 'movement') return;
  const mech = mechInstances.find(m => m.instanceId === instanceId);
  if (!mech || mech.instanceId !== moveState.instanceId || mech.owner !== mySeatNumber || !isMyActiveTurn()) return;

  const freeFacing = Boolean(moveState.jumpFacing);
  if (!freeFacing) {
    const mpLeft = moveState.mpMax - moveState.mpUsed;
    if (mpLeft < 1) {
      flashMoveWarning('No MP remaining for a facing change.');
      return;
    }
  }

  // Direction indices increase counter-clockwise on the rendered board.
  const delta = direction === 'left' ? 1 : -1;
  mech.facing = (mech.facing + delta + 6) % 6;
  mech.torsoFacing = mech.facing;
  if (!freeFacing) {
    moveState.mpUsed += 1;
    moveState.path.push({ action: 'turn', direction });
  }

  renderMovementPanel();
  renderReactionPanel();
  renderRoster();
  renderDetail();
  draw();
}

// Lock in the in-progress move (this becomes the 'Mech's Movement Die for the Attack Phase).
async function confirmMove() {
  const mech = mechInstances.find(m => m.instanceId === moveState.instanceId);
  if (mech) {
    if (!vsAiMode) {
      await submitAuthoritativeMovement(mech, moveState.mode, moveState.path || []);
      return;
    }
    mech.movementMode = moveState.mode;
    mech.mpUsed = moveState.mpUsed;
    mech.hexesMoved = moveState.hexesMoved;
    mech.hasMoved = true;
    mech.movementHeat = moveState.mode === 'jump' ? Math.max(3, moveState.hexesMoved) : MOVEMENT_HEAT[moveState.mode] || 0;
    mech.heat = (mech.roundStartingHeat || 0) + mech.movementHeat + (mech.weaponHeat || 0) + (mech.externalHeat || 0);
    const moveSummary = `${mechLabel(mech)} ${moveState.mode === 'jump' ? 'jumped' : moveState.mode === 'run' ? 'ran' : 'walked'} to ${hexCode(mech.col, mech.row)} (${moveState.hexesMoved} hex${moveState.hexesMoved === 1 ? '' : 'es'}, ${moveState.mpUsed}/${moveState.mpMax} MP).`;
    moveState = { active: false, instanceId: null, mode: null, mpMax: 0, mpUsed: 0, hexesMoved: 0 };
    renderMovementPanel();
    renderReactionPanel();
    renderRoster();
    renderDetail();
    draw();
    updateAdvanceButtonState();
    await syncMechInstances();
    logEvent(moveSummary, 'move');
    return;
  }
  moveState = { active: false, instanceId: null, mode: null, mpMax: 0, mpUsed: 0, hexesMoved: 0 };
  renderMovementPanel();
  renderReactionPanel();
  renderRoster();
  renderDetail();
  draw();
  updateAdvanceButtonState();
}

async function submitAuthoritativeMovement(mech, mode, path) {
  const summary = `${mechLabel(mech)} ${mode === 'jump' ? 'jumped' : mode === 'run' ? 'ran' : mode === 'walk' ? 'walked' : 'stood still'}${mode === 'stand' ? '' : ` to ${hexCode(mech.col, mech.row)}`}`;
  // For a jump, attach the player's chosen landing facing so the server honours it
  // (the 'Mech faces travel direction by default, but the player may rotate freely).
  const submitPath = (mode === 'jump' && Array.isArray(path) && path.length === 1 && path[0].action === 'jump')
    ? [{ ...path[0], facing: mech.facing }]
    : path;
  const { data, error } = await db.rpc('submit_battlemech_movement', {
    p_game_id: currentGameId,
    p_instance_id: mech.instanceId,
    p_mode: mode,
    p_path: submitPath
  });
  if (error) {
    flashMoveWarning(error.message);
    logEvent(`Server rejected the movement: ${error.message}`, 'error');
    return;
  }
  moveState = { active: false, instanceId: null, mode: null, mpMax: 0, mpUsed: 0, hexesMoved: 0, path: [] };
  await loadGameState();
  logEvent(`${summary}${mode === 'stand' ? '' : ` (${data?.hexes_moved || 0} hex${data?.hexes_moved === 1 ? '' : 'es'}, ${data?.mp_used || 0}/${data?.mp_max || 0} MP)`}.`, 'move');
  if (data?.terrain_heat) logEvent(`${mechLabel(mech)} gained ${data.terrain_heat} heat from burning terrain.`, 'phase');
  if (data?.terrain_check) {
    const check = data.terrain_check;
    const movedMech = mechInstances.find(candidate => candidate.instanceId === check.instance_id) || mech;
    const roll = check.to_hit || {};
    const gyro = roll.gyro_modifier ? ` (including +${roll.gyro_modifier} gyro damage)` : '';
    const reason = (check.reasons || ['terrain hazard']).join(' and ');
    if (check.passed) {
      logEvent(`${mechLabel(movedMech)} passed its Piloting Skill Roll for ${reason} — need ${roll.target}${gyro}, rolled ${roll.die_a} + ${roll.die_b} = ${roll.total}.`, 'roll');
    } else {
      const groups = (check.fall_groups || []).map(group => `${hitLocationLabel(group.location)} ${group.damage}`).join(', ');
      logEvent(`${mechLabel(movedMech)} failed its Piloting Skill Roll for ${reason} — need ${roll.target}${gyro}, rolled ${roll.die_a} + ${roll.die_b} = ${roll.total}; fell ${check.fall_angle} for ${check.fall_damage} damage${groups ? ` (${groups})` : ''}.`, 'roll');
      if (check.skid) {
        const collision = (check.skid.collisions || []).map(item => item.type === 'building'
          ? `building ${item.hex} (CF ${item.construction_factor_before}→${item.construction_factor_after})`
          : mechLabel(mechInstances.find(unit => unit.instanceId === item.target_instance_id))).join(', ');
        logEvent(`${mechLabel(movedMech)} skidded ${check.skid.hexes_skidded}/${check.skid.hexes_required} hexes for ${check.skid.damage} additional damage${collision ? `; struck ${collision}` : ''}${check.skid.stop_reason ? `; stopped by ${check.skid.stop_reason}` : ''}.`, 'roll');
      }
    }
  }
  if (data?.movement_piloting_check && !data?.terrain_check) {
    const check = data.movement_piloting_check;
    const movedMech = mechInstances.find(candidate => candidate.instanceId === check.instance_id) || mech;
    const roll = check.to_hit || {};
    const reasons = (check.reasons || []).join(' and ');
    if (check.passed) logEvent(`${mechLabel(movedMech)} passed its Piloting Skill Roll for ${reasons} — need ${roll.target}, rolled ${roll.die_a} + ${roll.die_b} = ${roll.total}.`, 'roll');
    else {
      const groups = (check.fall_groups || []).map(group => `${hitLocationLabel(group.location)} ${group.damage}`).join(', ');
      logEvent(`${mechLabel(movedMech)} failed its Piloting Skill Roll for ${reasons} — need ${roll.target}${check.automatic ? ' (automatic fall)' : ''}; fell ${check.fall_angle} for ${check.fall_damage} damage${groups ? ` (${groups})` : ''}.`, 'roll');
    }
  }
}

// DFA is declared during Movement, after the jumper has stopped one hex short
// of a target. The database keeps that staging hex until Physical Attacks.
async function declareDeathFromAbove(targetId) {
  const mech = mechInstances.find(candidate => candidate.instanceId === moveState.instanceId);
  const target = mechInstances.find(candidate => candidate.instanceId === targetId);
  if (!mech || !target || vsAiMode || moveState.mode !== 'jump' || axialDistance(mech.col, mech.row, target.col, target.row) !== 1) return;
  const { data, error } = await db.rpc('declare_death_from_above', {
    p_game_id: currentGameId, p_attacker_instance_id: mech.instanceId, p_target_instance_id: target.instanceId,
    p_staging_col: mech.col, p_staging_row: mech.row, p_staging_facing: mech.facing
  });
  if (error) { flashMoveWarning(error.message); logEvent(`Server rejected Death From Above: ${error.message}`, 'error'); return; }
  moveState = { active: false, instanceId: null, mode: null, mpMax: 0, mpUsed: 0, hexesMoved: 0, path: [] };
  await loadGameState();
  logEvent(`${mechLabel(mech)} declared Death From Above against ${mechLabel(target)}. It remains one hex short until the Physical Attack Phase.`, 'move');
  if (data?.status) renderMovementPanel();
}

async function declareChargeAttack(targetId) {
  const mech = mechInstances.find(candidate => candidate.instanceId === moveState.instanceId);
  const target = mechInstances.find(candidate => candidate.instanceId === targetId);
  if (!mech || !target || vsAiMode || !['walk', 'run'].includes(moveState.mode) || axialDistance(mech.col, mech.row, target.col, target.row) !== 1) return;
  const { data, error } = await db.rpc('declare_charge_attack', {
    p_game_id: currentGameId, p_attacker_instance_id: mech.instanceId, p_target_instance_id: target.instanceId,
    p_staging_col: mech.col, p_staging_row: mech.row, p_staging_facing: mech.facing,
    p_mode: moveState.mode, p_hexes_moved: moveState.hexesMoved, p_mp_used: moveState.mpUsed
  });
  if (error) { flashMoveWarning(error.message); logEvent(`Server rejected Charge: ${error.message}`, 'error'); return; }
  moveState = { active: false, instanceId: null, mode: null, mpMax: 0, mpUsed: 0, hexesMoved: 0, path: [] };
  await loadGameState();
  logEvent(`${mechLabel(mech)} declared a Charge against ${mechLabel(target)}. It remains one hex short until Physical Attacks.`, 'move');
  if (data?.status) renderMovementPanel();
}

// Abandon the in-progress move and snap the 'Mech back to where it started this action.
function cancelMovement() {
  if (moveState.active) {
    const mech = mechInstances.find(m => m.instanceId === moveState.instanceId);
    if (mech) {
      mech.col = moveState.origCol;
      mech.row = moveState.origRow;
      mech.facing = moveState.origFacing;
      mech.torsoFacing = moveState.origTorsoFacing;
    }
  }
  moveState = { active: false, instanceId: null, mode: null, mpMax: 0, mpUsed: 0, hexesMoved: 0 };
  renderMovementPanel();
  renderReactionPanel();
  renderRoster();
  renderDetail();
  draw();
}

function renderMovementPanel() {
  const panel = document.getElementById('movement-panel');
  if (!panel) return;

  if (currentGameState.phase !== 'movement') {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'block';

  if (!isMyActiveTurn()) {
    const activeSeat = getActivePlayerSeat();
    panel.innerHTML = `<div class="panel-eyebrow">Movement Phase</div><div style="font-size:11px;color:var(--phosphor-dim);">Waiting for Player ${activeSeat} to complete the current activation.</div>`;
    return;
  }

  const mech = mechInstances.find(m => m.instanceId === selectedInstanceId);
  if (!mech) {
    const unmoved = mechInstances.filter(m => m.owner === mySeatNumber && !m.hasMoved && (!m.pilot?.consciousness || m.pilot.consciousness === 'conscious'));
    const allowance = Math.min(currentActivationAllowance('movement'), unmoved.length);
    panel.innerHTML = `
      <div class="panel-eyebrow">Movement Phase</div>
      <div style="font-size:11px;color:var(--paper);line-height:1.6;">
        ${unmoved.length > 0
          ? `Move ${allowance} 'Mech${allowance === 1 ? '' : 's'} in this activation. ${unmoved.length} total still need${unmoved.length === 1 ? 's' : ''} to act.`
          : `All your 'Mechs have acted this turn. Waiting on the other side, or click Next Phase.`}
      </div>`;
    return;
  }

  const unit = BT_UNITS[mech.unitId];
  const isMine = mech.owner === mySeatNumber;

  if (mech.pilot?.consciousness && mech.pilot.consciousness !== 'conscious') {
    panel.innerHTML = `<div class="panel-eyebrow">Movement — Pilot ${mech.pilot.consciousness}</div><div style="font-size:11px;color:#a32832;line-height:1.5;">This BattleMech cannot act while its pilot is ${mech.pilot.consciousness}.</div>`;
    return;
  }

  if (mech.shutdown) {
    panel.innerHTML = `<div class="panel-eyebrow">Movement — Shut Down</div><div style="font-size:11px;color:#a32832;line-height:1.5;margin-bottom:8px;">This BattleMech cannot move until it restarts. A startup attempt consumes its Movement activation.</div><button onclick="attemptStartup('${mech.instanceId}')" style="${MOVE_BTN_STYLE}text-align:center;">Attempt Startup</button>`;
    return;
  }

  if (mech.hasMoved) {
    panel.innerHTML = `
      <div class="panel-eyebrow">Movement</div>
      <div style="font-size:11px;color:var(--phosphor-dim);line-height:1.5;">
        ${titleCaseMode(mech.movementMode)} — ${mech.hexesMoved} hex${mech.hexesMoved === 1 ? '' : 'es'} moved, ${mech.mpUsed} MP spent.
      </div>`;
    return;
  }

  if (!isMine) {
    panel.innerHTML = `
      <div class="panel-eyebrow">Movement</div>
      <div style="font-size:11px;color:var(--phosphor-dim);">Not your 'Mech — waiting on Player ${mech.owner}.</div>`;
    return;
  }

  if (mech.prone) {
    const mobility = criticalMovementProfile(mech);
    const cannotStand = mobility.destroyedLegs >= 2 || mobility.gyroDestroyed;
    const standCost = mobility.destroyedLegs === 1 ? 1 : 2;
    panel.innerHTML = `
      <div class="panel-eyebrow">Movement — Prone</div>
      <div style="font-size:11px;color:#a32832;line-height:1.5;margin-bottom:8px;">${cannotStand ? `This BattleMech cannot stand with ${mobility.gyroDestroyed ? 'a destroyed gyro' : 'both legs destroyed'}.` : `This BattleMech is prone. A stand attempt costs ${standCost} MP and requires a Piloting Skill Roll${mobility.destroyedLegs === 1 ? ' at +5' : ''}.`}</div>
      ${cannotStand ? '' : `<button onclick="attemptStand('${mech.instanceId}')" style="${MOVE_BTN_STYLE}text-align:center;">Attempt to Stand — ${standCost} MP</button>`}`;
    return;
  }

  if (moveState.active && moveState.instanceId === mech.instanceId) {
    const mpLeft = moveState.mpMax - moveState.mpUsed;
    const dfaTargets = moveState.mode === 'jump' && !vsAiMode
      ? mechInstances.filter(candidate => candidate.owner !== mech.owner && !candidate.destroyed && candidate.hasMoved && axialDistance(mech.col, mech.row, candidate.col, candidate.row) === 1)
      : [];
    const dfaPicker = dfaTargets.length ? `<div style="margin:0 0 7px;font-size:10px;color:var(--amber);">Death From Above — declare against a completed enemy movement. The jump costs MP to the target hex; your 'Mech remains one hex short until Physical Attacks.<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:5px;">${dfaTargets.map(target => `<button onclick="declareDeathFromAbove('${target.instanceId}')" style="padding:6px;border:1px solid var(--amber);background:rgba(212,128,10,.12);color:var(--paper);font:9px var(--mono);cursor:pointer;">DFA: ${mechLabel(target)}</button>`).join('')}</div></div>` : '';
    const chargeTargets = ['walk', 'run'].includes(moveState.mode) && !vsAiMode && moveState.hexesMoved > 0
      ? mechInstances.filter(candidate => candidate.owner !== mech.owner && !candidate.destroyed && !candidate.prone && candidate.hasMoved && !candidate.dfaDeclaration && !candidate.chargeDeclaration && axialDistance(mech.col, mech.row, candidate.col, candidate.row) === 1 && directionBetween(mech.col, mech.row, candidate.col, candidate.row) === mech.facing)
      : [];
    const chargePicker = chargeTargets.length ? `<div style="margin:0 0 7px;font-size:10px;color:var(--amber);">Charge — declare against a standing enemy that has completed movement. No weapons may be fired this turn.<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:5px;">${chargeTargets.map(target => `<button onclick="declareChargeAttack('${target.instanceId}')" style="padding:6px;border:1px solid var(--amber);background:rgba(212,128,10,.12);color:var(--paper);font:9px var(--mono);cursor:pointer;">Charge: ${mechLabel(target)}</button>`).join('')}</div></div>` : '';
    panel.innerHTML = `
      <div class="panel-eyebrow">Movement — ${titleCaseMode(moveState.mode)}</div>
      <div style="font-size:11px;color:var(--paper);margin-bottom:6px;">
        MP ${moveState.mpUsed}/${moveState.mpMax} used (${mpLeft} left) · ${moveState.hexesMoved} hex${moveState.hexesMoved === 1 ? '' : 'es'} moved
      </div>
      <div style="font-size:10px;color:var(--phosphor-dim);margin-bottom:10px;">Click a highlighted hex to move, or spend 1 MP per hexside to change facing.</div>
      <div style="display:flex;gap:6px;margin-bottom:6px;">
        <button onclick="turnMovementFacing('${mech.instanceId}','left')" style="flex:1;padding:8px 6px;border:1px solid var(--panel-line);background:transparent;color:var(--phosphor);font-family:var(--display);font-size:9px;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;border-radius:2px;">↶ Turn Left — 1 MP</button>
        <button onclick="turnMovementFacing('${mech.instanceId}','right')" style="flex:1;padding:8px 6px;border:1px solid var(--panel-line);background:transparent;color:var(--phosphor);font-family:var(--display);font-size:9px;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;border-radius:2px;">↷ Turn Right — 1 MP</button>
      </div>
      ${dfaPicker}
      ${chargePicker}
      <div style="display:flex;gap:8px;">
        <button onclick="confirmMove()" style="flex:1;${MOVE_BTN_STYLE}text-align:center;">Confirm Move</button>
        <button onclick="cancelMovement()" style="flex:1;padding:9px 10px;border:1px solid var(--panel-line);background:transparent;color:var(--phosphor);font-family:var(--display);font-size:10px;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;border-radius:2px;">Cancel</button>
      </div>`;
    return;
  }

  const mobility = criticalMovementProfile(mech);
  const modeButtons = [`<button onclick="startMovementMode('${mech.instanceId}','stand')" style="${MOVE_BTN_STYLE}">Stand Still</button>`];
  const heatPenalty = heatMovementPenalty(mech);
  if (mobility.walk > heatPenalty) modeButtons.push(`<button onclick="startMovementMode('${mech.instanceId}','walk')" style="${MOVE_BTN_STYLE}">Walk (${mobility.walk - heatPenalty} MP)</button>`);
  if (mobility.run > heatPenalty) modeButtons.push(`<button onclick="startMovementMode('${mech.instanceId}','run')" style="${MOVE_BTN_STYLE}">Run (${mobility.run - heatPenalty} MP)</button>`);
  if (mobility.jump > heatPenalty) modeButtons.push(`<button onclick="startMovementMode('${mech.instanceId}','jump')" style="${MOVE_BTN_STYLE}">Jump (${mobility.jump - heatPenalty} MP)</button>`);

  panel.innerHTML = `
    <div class="panel-eyebrow">Movement</div>
    <div style="display:flex;flex-direction:column;gap:6px;">${modeButtons.join('')}</div>`;
}
