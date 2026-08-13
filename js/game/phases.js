// ── TURN STRUCTURE (IGOUGO) ──────────────────────────────
const PHASE_ORDER = ['initiative', 'movement', 'reaction', 'weapon_attack', 'physical_attack', 'heat', 'end'];
const PHASE_LABELS = {
  initiative: 'Initiative Roll',
  movement: 'Movement',
  reaction: 'Reaction',
  weapon_attack: 'Weapon Attack',
  physical_attack: 'Physical Attack',
  heat: 'Heat Management',
  end: 'End Turn'
};
const AUTO_ADVANCE_AI_STORAGE_KEY = 'btech-vtt-auto-advance-after-ai';
let autoAdvanceAfterAi = localStorage.getItem(AUTO_ADVANCE_AI_STORAGE_KEY) === 'true';

let currentGameState = {
  round: 1,
  phase: 'initiative',
  active_player_id: null,
  initiative_winner: null,
  initiative_order: [],
  initiative_rolls: [],
  initiative_round: null // which round's initiative_order is currently valid for — gates phase advancement
};

// active_player_id is the btech_players.id for the active seat.
function getActivePlayerRecord() {
  return (currentGameState.initiative_order || []).find(
    p => p.player_id === currentGameState.active_player_id
  ) || null;
}

function getDatabaseActivePlayerId() {
  return currentGameState.active_player_id || null;
}

function makePhaseState() {
  return {
    initiative_order: currentGameState.initiative_order,
    initiative_rolls: currentGameState.initiative_rolls,
    initiative_round: currentGameState.initiative_round,
    initiative_winner: currentGameState.initiative_winner,
    active_player_player_id: currentGameState.active_player_id,
    mech_instances: mechInstances
  };
}

async function loadGameState() {
  if (!currentGameId) return;

  const { data: game } = await db
    .from('btech_games')
    .select('current_round, current_phase, active_player_id, initiative_winner, state')
    .eq('id', currentGameId)
    .single();

  if (!game) return;

  const gameState = game.state ? (typeof game.state === 'string' ? JSON.parse(game.state) : game.state) : {};
  // Rejoining an AI game must restore AI-specific controls, even though the
  // local vsAiMode flag begins false in a fresh browser session.
  if (typeof gameState.vs_ai_mode === 'boolean') vsAiMode = gameState.vs_ai_mode;

  currentGameState = {
    round: game.current_round || 1,
    phase: game.current_phase || 'initiative',
    active_player_id: gameState.active_player_player_id || null,
    initiative_winner: game.initiative_winner,
    initiative_order: gameState.initiative_order || [],
    initiative_rolls: gameState.initiative_rolls || [],
    initiative_round: gameState.initiative_round ?? null
  };
  // Backward-compatible recovery for games created before the explicit
  // player-record active ID was added. Resolve the auth user ID to a player row.
  if (!currentGameState.active_player_id && game.active_player_id && currentGameId) {
    const { data: activePlayer } = await db.from('btech_players')
      .select('id,is_ai,user_id,seat_number')
      .eq('game_id', currentGameId)
      .eq('user_id', game.active_player_id)
      .maybeSingle();
    if (activePlayer) currentGameState.active_player_id = activePlayer.id;
  }

  mergeRemoteLog(gameState.log);
  if (gameLog.length === 0) logEvent(`Game loaded — Round ${currentGameState.round}, ${PHASE_LABELS[currentGameState.phase] || currentGameState.phase} phase.`, 'system');

  // If units have already been placed/moved (e.g. rejoining), use the saved positions
  // instead of the default setup positions initGame() placed.
  if (gameState.mech_instances && gameState.mech_instances.length > 0) {
    mechInstances = gameState.mech_instances;
    mechInstances.forEach(ensureMechCombatState);
    draw();
    renderRoster();
    renderDetail();
  }

  const initBtn = document.getElementById('btn-roll-initiative');
  if (initBtn) initBtn.disabled = (currentGameState.initiative_round === currentGameState.round);

  updateGameHeader();
  renderInitiativeDisplay();
  renderMovementPanel();
  renderReactionPanel();
  renderWeaponAttackPanel();
  renderPhysicalAttackPanel();
  renderHeatPanel();
  renderEndPanel();
  updateAdvanceButtonState();
}

function updateGameHeader() {
  const statusEl = document.getElementById('status-readout');
  if (!statusEl) return;

  const phaseLabel = PHASE_LABELS[currentGameState.phase] || currentGameState.phase;
  statusEl.textContent = `Round ${currentGameState.round} — ${phaseLabel}`;

  if (currentGameState.active_player_id) {
    const activePlayer = getActivePlayerRecord();
    const activeLabel = activePlayer?.is_ai
      ? 'AI'
      : `Player ${activePlayer?.seat_number || '?'}`;
    statusEl.textContent += ` — ${activeLabel}'s Turn`;
  }

  const autoControl = document.getElementById('auto-ai-phase-control');
  const autoCheckbox = document.getElementById('auto-ai-phase-checkbox');
  if (autoControl) autoControl.hidden = !vsAiMode;
  if (autoCheckbox) autoCheckbox.checked = autoAdvanceAfterAi;
}

function setAutoAdvanceAfterAi(enabled) {
  autoAdvanceAfterAi = !!enabled;
  localStorage.setItem(AUTO_ADVANCE_AI_STORAGE_KEY, String(autoAdvanceAfterAi));
  updateGameHeader();
  logEvent(`Auto-next after AI ${autoAdvanceAfterAi ? 'enabled' : 'disabled'}.`, 'system');
}

async function autoAdvanceAfterAiTurn() {
  if (!vsAiMode || !autoAdvanceAfterAi) return;
  const activeEntry = getActivePlayerRecord();
  if (!activeEntry?.is_ai || !canAdvancePhase().ok) return;

  logEvent('AI choices complete — auto-advancing.', 'system');
  // AI actions and log entries share a serialized write queue. Let that queue
  // settle before changing the active player or phase, otherwise an older
  // snapshot could overwrite the automatic hand-off.
  await gameStateWriteQueue;
  if (!getActivePlayerRecord()?.is_ai || !canAdvancePhase().ok) return;
  await advancePhase();
}

function renderInitiativeDisplay() {
  // Find or create initiative display area
  let initDisplay = document.getElementById('initiative-display');
  if (!initDisplay) {
    const header = document.getElementById('header');
    initDisplay = document.createElement('div');
    initDisplay.id = 'initiative-display';
    initDisplay.style.cssText = 'font-size:11px;color:#888;font-family:var(--mono);margin-top:4px;text-align:center;';
    header.appendChild(initDisplay);
  }

  if (currentGameState.initiative_order.length === 0) {
    initDisplay.textContent = 'Roll Initiative to begin!';
    return;
  }

  // Show each player's 2D6 roll and who goes first/second
  const orderText = currentGameState.initiative_order.map((p, idx) => {
    const roll = currentGameState.initiative_rolls.find(r => r.player_id === p.player_id);
    const rollVal = roll ? roll.roll : '?';
    const ordinal = idx === 0 ? '1st' : idx === 1 ? '2nd' : `${idx + 1}th`;
    const label = p.is_ai ? `AI` : `P${p.seat_number}`;
    return `${label}: ${rollVal}d6 (${ordinal})`;
  }).join(' | ');

  // BattleTech convention: highest goes second, so lowest goes first
  const firstPlayer = currentGameState.initiative_order[0];
  const firstLabel = firstPlayer?.is_ai ? 'AI' : `Player ${firstPlayer?.seat_number || '?'}`;
  initDisplay.textContent = `Initiative: ${firstLabel} goes first | ${orderText}`;
}

// Roll initiative for ALL players (human + AI) using 2D6
// BattleTech convention: highest roll goes SECOND
async function rollInitiative() {
  if (!currentGameId) return;

  // Get all players (including AI)
  const { data: players } = await db
    .from('btech_players')
    .select('*')
    .eq('game_id', currentGameId)
    .eq('role', 'player');

  if (!players || players.length < 1) return;

  // Roll 2D6 for each player
  const initiativeRolls = players.map((p, idx) => ({
    player_id: p.id,
    roll: Math.floor(Math.random() * 6) + Math.floor(Math.random() * 6) + 2, // 2D6 (2-12)
    seat_number: p.seat_number,
    user_id: p.user_id,
    is_ai: p.is_ai === true
  }));

  // Sort ASCENDING — lowest goes FIRST (BattleTech convention)
  initiativeRolls.sort((a, b) => a.roll - b.roll);

  // Store in game state
  const { data: game } = await db
    .from('btech_games')
    .select('state')
    .eq('id', currentGameId)
    .single();

  const gameState = game?.state ? (typeof game.state === 'string' ? JSON.parse(game.state) : game.state) : {};
  gameState.initiative_order = initiativeRolls;
  gameState.initiative_rolls = initiativeRolls.map(r => ({ player_id: r.player_id, roll: r.roll }));
  gameState.initiative_winner = initiativeRolls[initiativeRolls.length - 1].player_id; // highest goes second
  gameState.initiative_round = currentGameState.round; // marks initiative as "done" for THIS round only
  gameState.active_player_player_id = initiativeRolls[0].player_id;
  const firstPlayerId = initiativeRolls[0].player_id;

  await db
    .from('btech_games')
    .update({
      current_phase: 'initiative',
      initiative_winner: gameState.initiative_winner,
      active_player_id: firstPlayerId,
      state: JSON.stringify(gameState)
    })
    .eq('id', currentGameId);

  // Update local state
  currentGameState.initiative_order = initiativeRolls;
  currentGameState.initiative_rolls = gameState.initiative_rolls;
  currentGameState.initiative_winner = gameState.initiative_winner;
  currentGameState.initiative_round = gameState.initiative_round;
  currentGameState.active_player_id = initiativeRolls[0].player_id;

  renderInitiativeDisplay();
  updateGameHeader();
  updateAdvanceButtonState();

  // Disable button after rolling
  const btn = document.getElementById('btn-roll-initiative');
  if (btn) btn.disabled = true;

  const rollSummary = initiativeRolls.map((r, idx) =>
    `${r.is_ai ? 'AI' : 'P' + r.seat_number}=${r.roll}${idx === 0 ? ' (1st)' : idx === initiativeRolls.length - 1 ? ' (last)' : ''}`
  ).join(', ');
  logEvent(`Initiative rolled — ${rollSummary}`, 'roll');
}

// Returns the player order established by Initiative: loser first, winner second.
function getPhasePlayerOrder() {
  return (currentGameState.initiative_order || []).map(p => p.player_id).filter(Boolean);
}

function getPlayerSeatById(playerId) {
  const entry = (currentGameState.initiative_order || []).find(p => p.player_id === playerId);
  return entry?.seat_number ?? null;
}

function getActivePlayerSeat() {
  return getPlayerSeatById(currentGameState.active_player_id);
}

function isMyActiveTurn() {
  return mySeatNumber != null && getActivePlayerSeat() === mySeatNumber;
}

function getPhaseUnitsForActivePlayer() {
  const seat = getActivePlayerSeat();
  if (seat == null) return [];
  return mechInstances.filter(m => m.owner === seat && !m.destroyed);
}

function activePlayerPhaseComplete(phase) {
  const units = getPhaseUnitsForActivePlayer();
  if (units.length === 0) return true;
  if (phase === 'movement') return units.every(m => m.hasMoved);
  if (phase === 'reaction') return units.every(m => m.hasReacted);
  if (phase === 'weapon_attack') return units.every(m => m.hasFired);
  if (phase === 'physical_attack') return units.every(m => m.hasPhysicalAttacked);
  if (phase === 'heat') return units.every(m => m.hasManagedHeat);
  return true;
}

function getNextPhasePlayerId() {
  const order = getPhasePlayerOrder();
  const idx = order.indexOf(currentGameState.active_player_id);
  return idx >= 0 && idx + 1 < order.length ? order[idx + 1] : null;
}

function resetReactionForRound() {
  mechInstances.forEach(m => {
    m.hasReacted = false;
    if (m.torsoFacing == null) m.torsoFacing = m.facing;
  });
}

function resetWeaponAttacksForRound() {
  mechInstances.forEach(m => {
    m.hasFired = false;
    m.weaponHeat = 0;
  });
}

function resetPhysicalAttacksForRound() {
  mechInstances.forEach(m => { m.hasPhysicalAttacked = false; });
}

function resetHeatManagementForRound() {
  mechInstances.forEach(m => { m.hasManagedHeat = false; });
}

function activePlayerHasLegalPhysicalAttack() {
  const attackers = getPhaseUnitsForActivePlayer().filter(m => !m.hasPhysicalAttacked);
  return attackers.some(attacker => mechInstances.some(target =>
    target.owner !== attacker.owner && !target.destroyed && evaluatePhysicalAttack(attacker, target, 'punch').valid
  ));
}

async function passRemainingPhysicalAttacks() {
  const pending = getPhaseUnitsForActivePlayer().filter(m => !m.hasPhysicalAttacked);
  if (!pending.length) return;
  pending.forEach(m => { m.hasPhysicalAttacked = true; });
  physicalAttackState = { attackerId: null, targetId: null, attackType: null };
  renderPhysicalAttackPanel();
  renderRoster();
  renderDetail();
  draw();
  await syncMechInstances();
  logEvent(`Player ${getActivePlayerSeat()} declined ${pending.length} remaining physical attack${pending.length === 1 ? '' : 's'}.`, 'phase');
}

function beginPhaseForFirstPlayer(phase) {
  const order = getPhasePlayerOrder();
  currentGameState.active_player_id = order[0] || null;
  if (phase === 'movement') resetMovementForRound();
  if (phase === 'reaction') resetReactionForRound();
  if (phase === 'weapon_attack') resetWeaponAttacksForRound();
  if (phase === 'physical_attack') resetPhysicalAttacksForRound();
  if (phase === 'heat') resetHeatManagementForRound();
}

// Enforces that every required VTT step for the CURRENT phase is actually done
// before the group can move on — nothing gets skipped by clicking through.
function canAdvancePhase() {
  if (currentGameState.phase === 'initiative') {
    const rolled = currentGameState.initiative_round === currentGameState.round &&
                   currentGameState.initiative_order && currentGameState.initiative_order.length > 0;
    if (!rolled) return { ok: false, reason: 'Roll Initiative before continuing to the Movement Phase.' };
  }
  if (['movement', 'reaction', 'weapon_attack', 'physical_attack', 'heat'].includes(currentGameState.phase)) {
    if (!currentGameState.active_player_id) {
      return { ok: false, reason: 'No active player is set for this phase.' };
    }
    if (!activePlayerPhaseComplete(currentGameState.phase)) {
      // The optional skip confirmation belongs only to the human who owns the
      // current turn. Never show it while an AI turn is finishing or handing
      // control across to the player.
      if (currentGameState.phase === 'physical_attack' && isMyActiveTurn() && activePlayerHasLegalPhysicalAttack()) {
        return { ok: true, reason: 'Legal physical attacks remain.', warning: true };
      }
      const phaseName = currentGameState.phase === 'movement'
        ? 'move'
        : currentGameState.phase === 'reaction'
          ? 'complete their Reaction'
          : currentGameState.phase === 'weapon_attack'
            ? 'complete their weapon attacks'
            : currentGameState.phase === 'physical_attack'
              ? 'complete their physical attacks'
              : 'complete heat management';
      return { ok: false, reason: `The active player must ${phaseName} all eligible 'Mechs first.` };
    }
  }
  return { ok: true, reason: '' };
}

function updateAdvanceButtonState() {
  const btn = document.getElementById('btn-advance-phase');
  if (!btn) return;
  const check = canAdvancePhase();
  btn.disabled = !check.ok;
  btn.title = check.ok ? 'Advance to the next phase' : check.reason;
  btn.style.opacity = check.ok ? '1' : '0.45';
  btn.style.cursor = check.ok ? 'pointer' : 'not-allowed';
}

async function advancePhase(skipPhysicalWarning = false) {
  const check = canAdvancePhase();
  if (!check.ok) {
    flashMoveWarning(check.reason);
    return;
  }
  if (check.warning && !skipPhysicalWarning) {
    showConfirmModal(
      'Skip Physical Attacks?',
      'One or more legal punches or kicks are available. Continue anyway will record no physical attack for the remaining units and advance the phase.',
      async () => {
        await passRemainingPhysicalAttacks();
        advancePhase(true);
      },
      'Continue anyway',
      'Go back'
    );
    return;
  }

  const currentIdx = PHASE_ORDER.indexOf(currentGameState.phase);
  const nextIdx = currentIdx + 1;
  const prevRound = currentGameState.round;
  const prevPhaseLabel = PHASE_LABELS[currentGameState.phase] || currentGameState.phase;

  if (nextIdx >= PHASE_ORDER.length) {
    // End of round — start new round. Initiative must be rolled again, so clear last round's roll.
    const { data: game } = await db.from('btech_games').select('state').eq('id', currentGameId).single();
    const gameState = game?.state ? (typeof game.state === 'string' ? JSON.parse(game.state) : game.state) : {};
    gameState.initiative_order = [];
    gameState.initiative_rolls = [];
    gameState.initiative_round = null;
    gameState.initiative_winner = null;
    // End Phase cleans the round state after every player has explicitly
    // resolved heat in the Heat Management phase.
    mechInstances.forEach(m => {
      ensureMechCombatState(m);
      m.torsoFacing = m.facing;
      m.hasManagedHeat = false;
    });
    gameState.mech_instances = mechInstances;

    await db
      .from('btech_games')
      .update({
        current_round: currentGameState.round + 1,
        current_phase: 'initiative',
        initiative_winner: null,
        active_player_id: null,
        state: JSON.stringify(gameState)
      })
      .eq('id', currentGameId);

    currentGameState.round += 1;
    currentGameState.phase = 'initiative';
    currentGameState.active_player_id = null;
    currentGameState.initiative_order = [];
    currentGameState.initiative_rolls = [];
    currentGameState.initiative_round = null;
    currentGameState.initiative_winner = null;

    // Re-enable initiative rolling for the new round
    const initBtn = document.getElementById('btn-roll-initiative');
    if (initBtn) initBtn.disabled = false;

    logEvent(`End of Round ${prevRound} (${prevPhaseLabel}) — advancing to Round ${currentGameState.round}, Initiative Roll.`, 'phase');
  } else {
    // During unit-action phases, the active player completes their actions first.
    // Next Phase acts as a pass to the next player in Initiative order; only the
    // final player advances the game into the next phase.
    const samePhasePlayer = ['movement', 'reaction', 'weapon_attack', 'physical_attack', 'heat'].includes(currentGameState.phase)
      ? getNextPhasePlayerId()
      : null;

    if (samePhasePlayer) {
      currentGameState.active_player_id = samePhasePlayer;
      const samePhasePlayerId = getDatabaseActivePlayerId();
      const samePhaseState = makePhaseState();
      const { error: samePhaseError } = await db
        .from('btech_games')
        .update({ active_player_id: samePhasePlayerId, state: JSON.stringify(samePhaseState) })
        .eq('id', currentGameId);
      if (samePhaseError) {
        console.error('Failed to advance active player:', samePhaseError);
        logEvent(`Failed to advance active player: ${samePhaseError.message}`, 'error');
        return;
      }
      logEvent(`Round ${currentGameState.round}: ${prevPhaseLabel} — next player in Initiative order.`, 'phase');
    } else {
      const nextPhase = PHASE_ORDER[nextIdx];

      // Set the next phase AND its first active player in ONE database update.
      // Writing active_player_id = null first lets realtime briefly publish an
      // invalid state and can overwrite the local active player, preventing the
      // first player from selecting/moving a 'Mech.
      currentGameState.phase = nextPhase;
      if (['movement', 'reaction', 'weapon_attack', 'physical_attack', 'heat'].includes(nextPhase)) {
        beginPhaseForFirstPlayer(nextPhase);
      } else {
        currentGameState.active_player_id = null;
      }

      const transitionState = {
        initiative_order: currentGameState.initiative_order,
        initiative_rolls: currentGameState.initiative_rolls,
        initiative_round: currentGameState.initiative_round,
        initiative_winner: currentGameState.initiative_winner,
        active_player_player_id: currentGameState.active_player_id,
        mech_instances: mechInstances
      };

      const { error: phaseError } = await db
        .from('btech_games')
        .update({
          current_phase: nextPhase,
          active_player_id: getDatabaseActivePlayerId(),
          state: JSON.stringify(transitionState)
        })
        .eq('id', currentGameId);

      if (phaseError) {
        console.error('Failed to advance phase:', phaseError);
        logEvent(`Failed to advance to ${PHASE_LABELS[nextPhase] || nextPhase}: ${phaseError.message}`, 'error');
        return;
      }

      logEvent(`Round ${currentGameState.round}: ${prevPhaseLabel} → ${PHASE_LABELS[currentGameState.phase] || currentGameState.phase}.`, 'phase');
    }
  }

  cancelMovement();

  // Select the first unit that still needs an action when a unit-action phase begins or changes player.
  if (['movement', 'weapon_attack', 'physical_attack'].includes(currentGameState.phase)) {
    const activeSeat = getActivePlayerSeat();
    const nextMech = mechInstances.find(m => m.owner === activeSeat &&
      (currentGameState.phase === 'movement'
        ? !m.hasMoved
        : currentGameState.phase === 'weapon_attack'
          ? !m.hasFired
          : !m.hasPhysicalAttacked));
    if (nextMech) selectedInstanceId = nextMech.instanceId;
  }

  updateGameHeader();
  renderInitiativeDisplay();
  renderMovementPanel();
  renderReactionPanel();
  renderWeaponAttackPanel();
  renderPhysicalAttackPanel();
  renderHeatPanel();
  renderEndPanel();
  renderRoster();
  renderDetail();
  draw();
  updateAdvanceButtonState();

  // Trigger the existing algorithmic AI only when it is actually the active player.
  // In Vs AI games, let the AI explicitly complete every phase it owns.
  const activeEntry = (currentGameState.initiative_order || [])
    .find(p => p.player_id === currentGameState.active_player_id);
  if (vsAiMode && activeEntry?.is_ai && ['movement', 'reaction', 'weapon_attack', 'physical_attack', 'heat'].includes(currentGameState.phase)) {
    const scheduledPlayerId = currentGameState.active_player_id;
    const scheduledPhase = currentGameState.phase;
    setTimeout(async () => {
      // Ignore an outdated callback if the human has received the turn while
      // the short AI-start delay was pending.
      if (currentGameState.active_player_id !== scheduledPlayerId || currentGameState.phase !== scheduledPhase || !getActivePlayerRecord()?.is_ai) return;
      await aiTurnHandler();
      updateAdvanceButtonState();
      await autoAdvanceAfterAiTurn();
    }, 500);
  }
}
