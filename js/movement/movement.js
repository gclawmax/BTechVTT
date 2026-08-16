// ── MOVEMENT PANEL & CONTROLS ─────────────────────────────
const HEX_DIR_LABELS = ['E', 'NE', 'NW', 'W', 'SW', 'SE'];
const MOVE_MODE_LABELS = { stand: 'Standing Still', walk: 'Walked', run: 'Ran', jump: 'Jumped' };
const MOVE_BTN_STYLE = 'padding:9px 10px;border:1px solid var(--phosphor);background:var(--phosphor);color:#fff;font-family:var(--display);font-size:10px;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;border-radius:2px;text-align:left;';
const MOVEMENT_HEAT = { stand: 0, walk: 1, run: 2, jump: 3 };

function titleCaseMode(mode) {
  return MOVE_MODE_LABELS[mode] || (mode ? titleCase(mode) : '—');
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
  if (!mech || mech.hasMoved || mech.owner !== mySeatNumber || currentGameState.phase !== 'movement' || !isMyActiveTurn()) return;
  if ((mech.structure.ll || 0) <= 0 || (mech.structure.rl || 0) <= 0) {
    flashMoveWarning("A destroyed leg prevents this 'Mech from moving.");
    return;
  }
  if (gyroDestroyedByCritical(mech)) {
    flashMoveWarning("A destroyed gyro prevents this 'Mech from moving.");
    return;
  }
  const unit = BT_UNITS[mech.unitId];

  if (mode === 'stand') {
    mech.movementMode = 'stand';
    mech.mpUsed = 0;
    mech.hexesMoved = 0;
    mech.hasMoved = true;
    mech.movementHeat = MOVEMENT_HEAT.stand;
    mech.heat = (mech.roundStartingHeat || 0) + mech.movementHeat + (mech.weaponHeat || 0);
    renderMovementPanel();
    renderRoster();
    renderDetail();
    draw();
    updateAdvanceButtonState();
    await syncMechInstances();
    logEvent(`${mechLabel(mech)} stood still at ${hexCode(mech.col, mech.row)}.`, 'move');
    return;
  }

  const mpMax = (unit.movement && unit.movement[mode]) || 0;
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
    origTorsoFacing: mech.torsoFacing
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
    const dist = axialDistance(mech.col, mech.row, col, row);
    if (dist > mpLeft) { flashMoveWarning('Not enough Jump MP for that hex.'); return; }
    const dir = directionBetween(mech.col, mech.row, col, row);
    mech.col = col;
    mech.row = row;
    if (dir !== -1) mech.facing = dir; // simple default facing on landing; direct hex clicks let the player choose it
    mech.torsoFacing = mech.facing;
    moveState.mpUsed += dist;
    moveState.hexesMoved += dist;
  } else {
    // Walk/Run: one hex per click, forward/rear along current facing, or a facing change + step.
    const dir = directionBetween(mech.col, mech.row, col, row);
    if (dir === -1) { flashMoveWarning('Click a hex adjacent to your ‘Mech.'); return; }
    const isRear = dir === ((mech.facing + 3) % 6);
    if (isRear && moveState.mode !== 'walk') { flashMoveWarning("Can't move backward while running."); return; }
    const cost = (dir === mech.facing) ? 1 : (isRear ? 1 : facingTurnCost(mech.facing, dir) + 1);
    if (cost > mpLeft) { flashMoveWarning('Not enough MP for that move.'); return; }
    mech.col = col;
    mech.row = row;
    if (!isRear) mech.facing = dir; // backing up doesn't change which way you're facing
    mech.torsoFacing = mech.facing;
    moveState.mpUsed += cost;
    moveState.hexesMoved += 1;
  }

  renderMovementPanel();
  renderReactionPanel();
  renderRoster();
  renderDetail();
  draw();
}

// Spend Movement Points to change facing without entering a new hex.
function turnMovementFacing(instanceId, direction) {
  if (!moveState.active || currentGameState.phase !== 'movement') return;
  const mech = mechInstances.find(m => m.instanceId === instanceId);
  if (!mech || mech.instanceId !== moveState.instanceId || mech.owner !== mySeatNumber || !isMyActiveTurn()) return;

  const mpLeft = moveState.mpMax - moveState.mpUsed;
  if (mpLeft < 1) {
    flashMoveWarning('No MP remaining for a facing change.');
    return;
  }

  // Direction indices increase counter-clockwise on the rendered board.
  const delta = direction === 'left' ? 1 : -1;
  mech.facing = (mech.facing + delta + 6) % 6;
  mech.torsoFacing = mech.facing;
  moveState.mpUsed += 1;

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
    mech.movementMode = moveState.mode;
    mech.mpUsed = moveState.mpUsed;
    mech.hexesMoved = moveState.hexesMoved;
    mech.hasMoved = true;
    mech.movementHeat = MOVEMENT_HEAT[moveState.mode] || 0;
    mech.heat = (mech.roundStartingHeat || 0) + mech.movementHeat + (mech.weaponHeat || 0);
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

  const mech = mechInstances.find(m => m.instanceId === selectedInstanceId);
  if (!mech) {
    const unmoved = mechInstances.filter(m => m.owner === mySeatNumber && !m.hasMoved);
    panel.innerHTML = `
      <div class="panel-eyebrow">Movement Phase</div>
      <div style="font-size:11px;color:var(--paper);line-height:1.6;">
        ${unmoved.length > 0
          ? `Select one of your 'Mechs — on the map or in the Roster above — to move it. ${unmoved.length} 'Mech${unmoved.length === 1 ? '' : 's'} still need${unmoved.length === 1 ? 's' : ''} to act.`
          : `All your 'Mechs have acted this turn. Waiting on the other side, or click Next Phase.`}
      </div>`;
    return;
  }

  const unit = BT_UNITS[mech.unitId];
  const isMine = mech.owner === mySeatNumber;

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

  if (moveState.active && moveState.instanceId === mech.instanceId) {
    const mpLeft = moveState.mpMax - moveState.mpUsed;
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
      <div style="display:flex;gap:8px;">
        <button onclick="confirmMove()" style="flex:1;${MOVE_BTN_STYLE}text-align:center;">Confirm Move</button>
        <button onclick="cancelMovement()" style="flex:1;padding:9px 10px;border:1px solid var(--panel-line);background:transparent;color:var(--phosphor);font-family:var(--display);font-size:10px;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;border-radius:2px;">Cancel</button>
      </div>`;
    return;
  }

  const modeButtons = [`<button onclick="startMovementMode('${mech.instanceId}','stand')" style="${MOVE_BTN_STYLE}">Stand Still</button>`];
  if (unit.movement.walk > 0) modeButtons.push(`<button onclick="startMovementMode('${mech.instanceId}','walk')" style="${MOVE_BTN_STYLE}">Walk (${unit.movement.walk} MP)</button>`);
  if (unit.movement.run > 0) modeButtons.push(`<button onclick="startMovementMode('${mech.instanceId}','run')" style="${MOVE_BTN_STYLE}">Run (${unit.movement.run} MP)</button>`);
  if (unit.movement.jump > 0) modeButtons.push(`<button onclick="startMovementMode('${mech.instanceId}','jump')" style="${MOVE_BTN_STYLE}">Jump (${unit.movement.jump} MP)</button>`);

  panel.innerHTML = `
    <div class="panel-eyebrow">Movement</div>
    <div style="display:flex;flex-direction:column;gap:6px;">${modeButtons.join('')}</div>`;
}
