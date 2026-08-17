// ── TURN STRUCTURE & ALTERNATING ACTIVATIONS ─────────────
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
let autoAdvanceRetryTimer = null;
let scheduledAiTurnKey = null;
let myInitiativePlayerId = null;
const roundOneAmmoChoices = {};

let currentGameState = {
  round: 1,
  phase: 'initiative',
  active_player_id: null,
  initiative_winner: null,
  initiative_order: [],
  initiative_rolls: [],
  initiative_round: null, // which round's initiative_order is currently valid for — gates phase advancement
  initiative_pending: [],
  phase_activation: null,
  match_result: null
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
    phase_activation: currentGameState.phase_activation,
    match_result: currentGameState.match_result,
    active_player_player_id: currentGameState.active_player_id,
    mech_instances: mechInstances,
    ...currentMatchConfig
  };
}

async function loadGameState() {
  if (!currentGameId) return;

  const { data: game } = await db
    .from('btech_games')
    .select('current_round, current_phase, active_player_id, initiative_winner, state, catalogue_version')
    .eq('id', currentGameId)
    .single();

  if (!game) return;

  if (game.catalogue_version) await loadUnitCatalogue(game.catalogue_version);

  const gameState = game.state ? (typeof game.state === 'string' ? JSON.parse(game.state) : game.state) : {};
  setActiveMap(gameState.map_id);
  currentMatchConfig = {
    ...(gameState.map_id ? { map_id: gameState.map_id } : {}),
    ...(gameState.dropship_tonnage ? { dropship_tonnage: gameState.dropship_tonnage } : {}),
    ...(gameState.rosters ? { rosters: gameState.rosters } : {}),
    ...(typeof gameState.vs_ai_mode === 'boolean' ? { vs_ai_mode: gameState.vs_ai_mode } : {}),
    ...(gameState.ai_difficulty ? { ai_difficulty: gameState.ai_difficulty } : {}),
    ...(game.catalogue_version ? { catalogue_version: game.catalogue_version } : {})
  };
  // Always derive this from the loaded game. Otherwise an AI game visited in
  // the same tab can leave AI-only controls visible in a human game created
  // before the flag existed in saved state.
  vsAiMode = gameState.vs_ai_mode === true;
  if (!vsAiMode && currentUser?.id) {
    const { data: myPlayer } = await db.from('btech_players')
      .select('id').eq('game_id', currentGameId).eq('user_id', currentUser.id).eq('role', 'player').maybeSingle();
    myInitiativePlayerId = myPlayer?.id || null;
  }

  currentGameState = {
    round: game.current_round || 1,
    phase: game.current_phase || 'initiative',
    // The column is the single source of truth for turn ownership. Keep the
    // JSON copy only as backward-compatible recovery for older saved games.
    active_player_id: game.active_player_id || gameState.active_player_player_id || null,
    initiative_winner: game.initiative_winner,
    initiative_order: gameState.initiative_order || [],
    initiative_rolls: gameState.initiative_rolls || [],
    initiative_round: gameState.initiative_round ?? null,
    initiative_pending: gameState.initiative_pending || [],
    phase_activation: gameState.phase_activation || null,
    match_result: gameState.match_result || null
  };
  // A Physical Attack phase exists only when opposing 'Mechs are adjacent.
  // The server rechecks this for human games; this call merely requests the
  // safe automatic transition after the prior phase has completed.
  if (!vsAiMode && currentGameState.phase === 'physical_attack' && await skipEmptyPhysicalPhase()) {
    return loadGameState();
  }
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
  await loadPersistentGameLog();
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
  await loadWeaponCombatEvents();
  await loadResolvedPhysicalEvents();

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
  scheduleActiveAiTurn();
}

function updateGameHeader() {
  const statusEl = document.getElementById('status-readout');
  if (!statusEl) return;

  statusEl.classList.remove('is-my-turn', 'team-p1', 'team-p2');

  if (currentGameState.match_result) {
    const result = currentGameState.match_result;
    statusEl.textContent = result.winner_seat == null
      ? 'Match Complete — Draw'
      : `Match Complete — Player ${result.winner_seat} Wins`;
    updateInitiativeButtonState();
    return;
  }

  const phaseLabel = PHASE_LABELS[currentGameState.phase] || currentGameState.phase;
  statusEl.textContent = `Round ${currentGameState.round} — ${phaseLabel}`;

  if (currentGameState.active_player_id) {
    const activePlayer = getActivePlayerRecord();
    const activeLabel = activePlayer?.is_ai
      ? 'AI'
      : `Player ${activePlayer?.seat_number || '?'}`;
    if (isMyActiveTurn()) {
      statusEl.textContent += ' — YOUR TURN';
      statusEl.classList.add('is-my-turn', `team-p${mySeatNumber}`);
    } else {
      statusEl.textContent += ` — ${activeLabel}'s Turn`;
    }
  } else if (currentGameState.phase === 'initiative') {
    const iHaveRolled = currentGameState.initiative_pending.some(roll =>
      (typeof roll === 'string' ? roll : roll.player_id) === myInitiativePlayerId
    );
    const canRoll = vsAiMode ? isHost : mySeatNumber != null && !iHaveRolled;
    if (canRoll && currentGameState.initiative_round !== currentGameState.round) {
      statusEl.textContent += ' — YOUR ROLL';
      statusEl.classList.add('is-my-turn', `team-p${mySeatNumber || 1}`);
    }
  }

  const autoControl = document.getElementById('auto-ai-phase-control');
  const autoCheckbox = document.getElementById('auto-ai-phase-checkbox');
  if (autoControl) {
    autoControl.hidden = !vsAiMode;
    autoControl.style.display = vsAiMode ? 'inline-flex' : 'none';
  }
  if (autoCheckbox) autoCheckbox.checked = autoAdvanceAfterAi;
  updateInitiativeButtonState();
}

function updateInitiativeButtonState() {
  const initBtn = document.getElementById('btn-roll-initiative');
  if (!initBtn) return;
  // Initiative is the only phase where this control is relevant. Hiding it
  // outside that phase keeps the shared-game header focused on current play.
  initBtn.hidden = currentGameState.phase !== 'initiative';
  const alreadyRolled = currentGameState.initiative_round === currentGameState.round;
  const iHaveRolled = currentGameState.initiative_pending.some(roll =>
    (typeof roll === 'string' ? roll : roll.player_id) === myInitiativePlayerId
  );
  const canRoll = vsAiMode
    ? isHost && currentGameState.phase === 'initiative' && !alreadyRolled && !currentGameState.match_result
    : mySeatNumber != null && currentGameState.phase === 'initiative' && !alreadyRolled && !iHaveRolled && !currentGameState.match_result;
  const lbXPending = currentGameState.round === 1 && mechInstances.some(mech =>
    (!vsAiMode || mech.owner === mySeatNumber) && (mech.ammoBins || []).some(bin => bin.type === 'lb10x' && !bin.loadType)
  );
  initBtn.disabled = !canRoll || lbXPending;
  initBtn.title = canRoll && !lbXPending
    ? (vsAiMode ? 'Roll initiative for both sides.' : 'Roll your own 2D6 initiative.')
    : (lbXPending ? 'Each LB-X ammunition bin must be declared during Round 1 setup.' : (alreadyRolled ? 'Initiative has already been resolved this round.' : 'Waiting for the other player to roll initiative.'));
}

function setAutoAdvanceAfterAi(enabled) {
  autoAdvanceAfterAi = !!enabled;
  localStorage.setItem(AUTO_ADVANCE_AI_STORAGE_KEY, String(autoAdvanceAfterAi));
  updateGameHeader();
  logEvent(`Auto-next after AI ${autoAdvanceAfterAi ? 'enabled' : 'disabled'}.`, 'system');
}

async function autoAdvanceAfterAiTurn(attempt = 0) {
  if (!vsAiMode || !autoAdvanceAfterAi) return;
  // AI actions and log entries share a serialized write queue. Let that queue
  // settle before changing the active player or phase, otherwise an older
  // snapshot could overwrite the automatic hand-off.
  await gameStateWriteQueue;
  if (!getActivePlayerRecord()?.is_ai) return;
  const check = canAdvancePhase();
  if (!check.ok) {
    // A realtime event can briefly expose an older 'Mech snapshot directly
    // after the AI saves. Retry a few times rather than leaving the player to
    // press Next Phase for an otherwise completed AI turn.
    if (attempt < 5) {
      clearTimeout(autoAdvanceRetryTimer);
      autoAdvanceRetryTimer = setTimeout(() => autoAdvanceAfterAiTurn(attempt + 1), 250);
    } else {
      logEvent(`AI auto-next stopped: ${check.reason}`, 'error');
    }
    return;
  }

  logEvent('AI choices complete — auto-advancing.', 'system');
  // The confirmation log captures the current (AI) active-player state.
  // Persist it before the hand-off so it cannot overwrite the new player's
  // active_player_player_id after advancePhase writes it.
  await gameStateWriteQueue;
  if (!getActivePlayerRecord()?.is_ai || !canAdvancePhase().ok) return;
  await advancePhase();
}

function scheduleActiveAiTurn() {
  const activeEntry = getActivePlayerRecord();
  const aiPhase = ['movement', 'reaction', 'weapon_attack', 'physical_attack', 'heat'].includes(currentGameState.phase);
  if (!vsAiMode || !activeEntry?.is_ai || !aiPhase) return;

  const turnKey = `${currentGameId}:${currentGameState.round}:${currentGameState.phase}:${currentGameState.active_player_id}`;
  if (scheduledAiTurnKey === turnKey || aiTurnInProgress) return;
  scheduledAiTurnKey = turnKey;
  setTimeout(async () => {
    if (scheduledAiTurnKey === turnKey) scheduledAiTurnKey = null;
    // Ignore an outdated callback if the human has received the turn while
    // the short AI-start delay was pending.
    if (currentGameState.active_player_id !== activeEntry.player_id || !getActivePlayerRecord()?.is_ai) return;
    const aiCompleted = await aiTurnHandler();
    updateAdvanceButtonState();
    if (aiCompleted) await autoAdvanceAfterAiTurn();
  }, 500);
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

  const allUnloadedLbBins = currentGameState.round === 1 && currentGameState.phase === 'initiative'
    ? mechInstances.flatMap(mech => (mech.ammoBins || []).filter(bin => bin.type === 'lb10x' && !bin.loadType).map(bin => ({ mech, bin })))
    : [];
  const ownUnloadedLbBins = allUnloadedLbBins.filter(({ mech }) => mech.owner === mySeatNumber);
  if (ownUnloadedLbBins.length) {
    initDisplay.innerHTML = `<div style="color:var(--amber);font-size:10px;margin-bottom:4px;">ROUND 1 AMMUNITION LOADOUT — declare each LB-X bin before initiative.</div>${ownUnloadedLbBins.map(({ mech, bin }) => {
      const key = `${mech.instanceId}:${bin.id}`;
      const selected = roundOneAmmoChoices[key] || 'slug';
      return `<label style="display:flex;justify-content:center;gap:6px;align-items:center;margin:3px 0;color:var(--paper);">${mechLabel(mech)} · ${bin.location}<select onchange="setRoundOneAmmoChoice('${key}',this.value)" style="font:10px var(--mono);padding:3px;"><option value="slug" ${selected === 'slug' ? 'selected' : ''}>Slug</option><option value="cluster" ${selected === 'cluster' ? 'selected' : ''}>Cluster</option></select></label>`;
    }).join('')}<button onclick="submitRoundOneAmmoLoadout()" style="margin-top:4px;padding:5px 10px;font:10px var(--mono);cursor:pointer;">Confirm LB-X Ammunition</button>`;
    return;
  }
  if (allUnloadedLbBins.length) {
    initDisplay.textContent = 'Waiting for the other player to declare Round 1 LB-X ammunition.';
    return;
  }
  if (currentGameState.initiative_order.length === 0) {
    initDisplay.textContent = 'Roll Initiative to begin!';
    return;
  }

  // Show each player's 2D6 roll and who goes first/second
  const orderText = currentGameState.initiative_order.map((p, idx) => {
    const roll = currentGameState.initiative_rolls.find(r => r.player_id === p.player_id);
    const rollVal = roll ? (roll.die_a != null && roll.die_b != null ? `${roll.die_a} + ${roll.die_b} = ${roll.roll}` : roll.roll) : '?';
    const ordinal = idx === 0 ? '1st' : idx === 1 ? '2nd' : `${idx + 1}th`;
    const label = p.is_ai ? `AI` : `P${p.seat_number}`;
    return `${label}: ${rollVal} (${ordinal})`;
  }).join(' | ');

  // BattleTech convention: highest goes second, so lowest goes first
  const firstPlayer = currentGameState.initiative_order[0];
  const firstLabel = firstPlayer?.is_ai ? 'AI' : `Player ${firstPlayer?.seat_number || '?'}`;
  initDisplay.textContent = `Initiative: ${firstLabel} goes first | ${orderText}`;
}

function setRoundOneAmmoChoice(key, loadType) {
  if (['slug', 'cluster'].includes(loadType)) roundOneAmmoChoices[key] = loadType;
}

async function submitRoundOneAmmoLoadout() {
  const entries = mechInstances.flatMap(mech => mech.owner === mySeatNumber
    ? (mech.ammoBins || []).filter(bin => bin.type === 'lb10x' && !bin.loadType).map(bin => [
      `${mech.instanceId}:${bin.id}`, roundOneAmmoChoices[`${mech.instanceId}:${bin.id}`] || 'slug'
    ]) : []);
  if (!entries.length) return;
  if (vsAiMode) {
    entries.forEach(([key, loadType]) => {
      const separator = key.indexOf(':');
      const instanceId = key.slice(0, separator);
      const binId = key.slice(separator + 1);
      const mech = mechInstances.find(candidate => candidate.instanceId === instanceId);
      const bin = mech?.ammoBins?.find(candidate => candidate.id === binId);
      if (bin) bin.loadType = loadType;
    });
    await syncMechInstances();
    await loadGameState();
    return;
  }
  const { error } = await db.rpc('submit_round_one_ammo_loadout', {
    p_game_id: currentGameId,
    p_loadouts: Object.fromEntries(entries)
  });
  if (error) {
    logEvent(`Could not save LB-X ammunition: ${error.message}`, 'error');
    return;
  }
  logEvent('Round 1 LB-X ammunition loadout saved.', 'system');
  await loadGameState();
}

// Roll initiative for ALL players (human + AI) using 2D6
// BattleTech convention: highest roll goes SECOND
async function rollInitiative() {
  if (!currentGameId || currentGameState.match_result) return;

  // Human-versus-human initiative is deliberately submitted separately by
  // each seat. The database resolves the order only after both rolls arrive.
  if (!vsAiMode) {
    const { data: me, error: meError } = await db.from('btech_players')
      .select('id,seat_number')
      .eq('game_id', currentGameId).eq('user_id', currentUser.id).eq('role', 'player').maybeSingle();
    if (meError || !me) {
      logEvent(`Unable to identify your player seat: ${meError?.message || 'seat not found'}`, 'error');
      return;
    }
    myInitiativePlayerId = me.id;
    if (currentGameState.initiative_pending.some(roll => (typeof roll === 'string' ? roll : roll.player_id) === me.id)) return;
    const dice = roll2d6Detailed();
    const { data, error } = await db.rpc('submit_initiative_roll', {
      p_game_id: currentGameId,
      p_die_a: dice.dieA,
      p_die_b: dice.dieB
    });
    if (error) {
      logEvent(`Failed to submit initiative: ${error.message}`, 'error');
      return;
    }
    const result = data || {};
    if (result.status === 'tie') {
      logEvent(`Initiative tie — ${result.summary || 'both players rolled the same total'}. Both players re-roll.`, 'roll');
    } else if (result.status === 'resolved') {
      logEvent(`Initiative resolved — ${result.summary}`, 'roll');
    } else {
      logEvent(`Initiative rolled — P${me.seat_number}=${dice.dieA} + ${dice.dieB} = ${dice.total}. Waiting for the other player.`, 'roll');
    }
    await loadGameState();
    return;
  }

  if (!isHost) return;

  // Get all players (including AI)
  const { data: players } = await db
    .from('btech_players')
    .select('*')
    .eq('game_id', currentGameId)
    .eq('role', 'player');

  if (!players || players.length < 1) return;

  // BattleTech initiative ties are re-rolled. Re-roll all participants so
  // both sides receive a fresh 2D6 result and the resulting order is unique.
  let initiativeRolls;
  const tiedRolls = [];
  do {
    initiativeRolls = players.map(p => {
      const dice = roll2d6Detailed();
      return {
        player_id: p.id,
        roll: dice.total,
        die_a: dice.dieA,
        die_b: dice.dieB,
        seat_number: p.seat_number,
        user_id: p.user_id,
        is_ai: p.is_ai === true
      };
    });
    const hasTie = new Set(initiativeRolls.map(r => r.roll)).size !== initiativeRolls.length;
    if (hasTie) tiedRolls.push(initiativeRolls);
  } while (tiedRolls.length > 0 && new Set(initiativeRolls.map(r => r.roll)).size !== initiativeRolls.length);

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
  gameState.initiative_rolls = initiativeRolls.map(r => ({ player_id: r.player_id, roll: r.roll, die_a: r.die_a, die_b: r.die_b }));
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

  tiedRolls.forEach(tiedRound => {
    const tieSummary = tiedRound.map(r => `${r.is_ai ? 'AI' : 'P' + r.seat_number}=${r.die_a} + ${r.die_b} = ${r.roll}`).join(', ');
    logEvent(`Initiative tie — ${tieSummary}. Re-rolling.`, 'roll');
  });
  const rollSummary = initiativeRolls.map((r, idx) =>
    `${r.is_ai ? 'AI' : 'P' + r.seat_number}=${r.die_a} + ${r.die_b} = ${r.roll}${idx === 0 ? ' (1st)' : idx === initiativeRolls.length - 1 ? ' (last)' : ''}`
  ).join(', ');
  logEvent(`Initiative rolled — ${rollSummary}`, 'roll');
}

// Returns the player order established by Initiative: loser first, winner second.
function getPhasePlayerOrder() {
  return (currentGameState.initiative_order || []).map(p => p.player_id).filter(Boolean);
}

function getPlayerSeatById(playerId) {
  const entry = (currentGameState.initiative_order || []).find(p => p.player_id === playerId);
  // JSON from older saves may contain the seat as a string. Normalize it so
  // turn ownership cannot fail a strict comparison in the action controls.
  return entry?.seat_number == null ? null : Number(entry.seat_number);
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
  return mechInstances.filter(m => m.owner === seat && (
    currentGameState.phase === 'weapon_attack' && typeof canFireFromWeaponPhaseStart === 'function'
      ? canFireFromWeaponPhaseStart(m)
      : !m.destroyed
  ));
}

function determineMatchResult() {
  const survivingSeats = [...new Set(mechInstances.filter(mech => !mech.destroyed).map(mech => mech.owner))];
  if (survivingSeats.length > 1) return null;
  return {
    winner_seat: survivingSeats.length === 1 ? survivingSeats[0] : null,
    resolved_at: new Date().toISOString()
  };
}

// Record a finished match once all of one side's 'Mechs are destroyed. The
// result lives in the shared state so both browsers, rejoining players, and
// spectators receive the same definitive outcome.
async function checkForMatchEnd() {
  if (currentGameState.match_result) return currentGameState.match_result;
  if (!vsAiMode) {
    const { data, error } = await db.rpc('resolve_btech_match_end', { p_game_id: currentGameId });
    if (error) {
      logEvent(`Unable to resolve match result: ${error.message}`, 'error');
      return null;
    }
    if (data?.status !== 'resolved') return null;
    const result = data.result;
    currentGameState.match_result = result;
    currentGameState.phase = 'end';
    currentGameState.active_player_id = null;
    logEvent(result.winner_seat == null ? 'Match complete — all forces destroyed. Draw.' : `Match complete — Player ${result.winner_seat} wins.`, 'phase');
    await loadGameState();
    return result;
  }
  // Weapon attacks are simultaneous. A force destroyed by an earlier saved
  // result must still make every attack it was eligible for at phase start.
  if (currentGameState.phase === 'weapon_attack' && typeof canFireFromWeaponPhaseStart === 'function' &&
      mechInstances.some(mech => canFireFromWeaponPhaseStart(mech) && !mech.hasFired)) return null;
  const result = determineMatchResult();
  if (!result) return null;

  await gameStateWriteQueue;
  const { data: game, error: readError } = await db
    .from('btech_games')
    .select('state')
    .eq('id', currentGameId)
    .single();
  if (readError || !game) {
    logEvent(`Unable to record match result: ${readError?.message || 'game not found'}`, 'error');
    return null;
  }

  const gameState = game.state ? (typeof game.state === 'string' ? JSON.parse(game.state) : game.state) : {};
  if (gameState.match_result) {
    currentGameState.match_result = gameState.match_result;
    return gameState.match_result;
  }
  gameState.match_result = result;
  gameState.active_player_player_id = null;
  gameState.mech_instances = mechInstances.map(mech => ({ ...mech }));

  const { error: writeError } = await db
    .from('btech_games')
    .update({ current_phase: 'end', active_player_id: null, state: JSON.stringify(gameState) })
    .eq('id', currentGameId);
  if (writeError) {
    logEvent(`Unable to save match result: ${writeError.message}`, 'error');
    return null;
  }

  currentGameState.phase = 'end';
  currentGameState.active_player_id = null;
  currentGameState.match_result = result;
  logEvent(result.winner_seat == null ? 'Match complete — all forces destroyed. Draw.' : `Match complete — Player ${result.winner_seat} wins.`, 'phase');
  updateGameHeader();
  renderEndPanel();
  updateAdvanceButtonState();
  return result;
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
    target.owner !== attacker.owner && !target.destroyed && ['punch', 'kick'].some(type =>
      physicalLimbCandidates(type).some(limb => evaluatePhysicalAttack(attacker, target, type, limb).valid))
  ));
}

function anyLegalPhysicalAttackExists() {
  return mechInstances.some(attacker => !attacker.destroyed && mechInstances.some(target =>
    target.owner !== attacker.owner && !target.destroyed &&
    ['punch', 'kick'].some(type => physicalLimbCandidates(type).some(limb => evaluatePhysicalAttack(attacker, target, type, limb).valid))
  ));
}

async function skipEmptyPhysicalPhase() {
  if (!currentGameId || currentGameState.phase !== 'physical_attack') return false;
  const { data: skipped, error } = await db.rpc('skip_empty_physical_phase', { p_game_id: currentGameId });
  if (error) {
    console.warn('Failed to check empty physical phase:', error);
    return false;
  }
  if (skipped) logEvent('No opposing \'Mechs are adjacent — Physical Attack skipped.', 'phase');
  return skipped === true;
}

async function passRemainingPhysicalAttacks() {
  const pending = getPhaseUnitsForActivePlayer().filter(m => !m.hasPhysicalAttacked);
  if (!pending.length) return;
  if (!vsAiMode) {
    const allowance = Math.min(currentActivationAllowance('physical_attack'), pending.length);
    for (const mech of pending.slice(0, allowance)) {
      const { error } = await db.rpc('submit_simultaneous_physical_declaration', {
        p_game_id: currentGameId, p_attacker_instance_id: mech.instanceId,
        p_target_instance_id: null, p_attack_type: 'pass', p_limbs: []
      });
      if (error) { logEvent(`Server rejected the Physical Attack pass: ${error.message}`, 'error'); return; }
    }
    physicalAttackState = { attackerId: null, targetId: null, attackType: null, limbs: [] };
    await loadGameState();
    return;
  }
  pending.forEach(m => { m.hasPhysicalAttacked = true; });
  physicalAttackState = { attackerId: null, targetId: null, attackType: null, limbs: [] };
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
  if (currentGameState.match_result) return { ok: false, reason: 'This match is complete.' };
  if ((currentGameState.phase === 'initiative' || currentGameState.phase === 'end') && !isHost) {
    return { ok: false, reason: 'The host advances this shared step.' };
  }
  if (currentGameState.phase === 'initiative') {
    const rolled = currentGameState.initiative_round === currentGameState.round &&
                   currentGameState.initiative_order && currentGameState.initiative_order.length > 0;
    if (!rolled) return { ok: false, reason: 'Roll Initiative before continuing to the Movement Phase.' };
  }
  if (['movement', 'reaction', 'weapon_attack', 'physical_attack', 'heat'].includes(currentGameState.phase)) {
    if (!currentGameState.active_player_id) {
      return { ok: false, reason: 'No active player is set for this phase.' };
    }
    const activeEntry = getActivePlayerRecord();
    if (!isMyActiveTurn() && !(vsAiMode && activeEntry?.is_ai)) {
      return { ok: false, reason: 'Wait for the active player to complete their turn.' };
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
  // Human games advance automatically once each seat confirms its actions.
  // The button remains an AI-testing aid only.
  btn.hidden = !vsAiMode;
  if (!vsAiMode) return;
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
      let nextPhase = PHASE_ORDER[nextIdx];
      // AI games retain their local phase engine. Skip an empty physical phase
      // rather than asking both sides to pass through a phase with no choices.
      if (vsAiMode && nextPhase === 'physical_attack' && !anyLegalPhysicalAttackExists()) {
        nextPhase = 'heat';
        logEvent('No opposing \'Mechs are adjacent — Physical Attack skipped.', 'phase');
      }

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
        match_result: currentGameState.match_result,
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
  // Phase changes deliberately leave the board unselected. This keeps the
  // phase/log context visible until the player chooses a 'Mech themselves.
  selectedInstanceId = null;

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

  // Trigger the AI for a newly active AI turn. The same helper is also used
  // when rejoining a game already waiting on the AI.
  scheduleActiveAiTurn();
}
