// Extracted from index_3_1.html — lobby

// ── LOBBY MANAGEMENT ─────────────────────────────────────
async function loadLobby() {
  if (!currentGameId) return;

  // Subscribe to game changes
  if (gameSubscription) gameSubscription.unsubscribe();
  gameSubscription = db
    .channel('btech_games:' + currentGameId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'btech_games', filter: `id=eq.${currentGameId}` },
      (payload) => {
        if (payload.eventType === 'UPDATE' && payload.new.status === 'in-progress') {
          // Game started — transition to game screen
          startGameScreen();
        }
      }
    )
    .subscribe();

  // Subscribe to player changes
  if (playersSubscription) playersSubscription.unsubscribe();
  playersSubscription = db
    .channel('btech_players:' + currentGameId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'btech_players', filter: `game_id=eq.${currentGameId}` },
      (payload) => {
        loadLobbyUI();
      }
    )
    .subscribe();

  // Also load once immediately
  await loadLobbyUI();
}

async function loadLobbyUI() {
  if (!currentGameId) return;

  // Get game info
  const { data: game } = await db
    .from('btech_games')
    .select('game_code')
    .eq('id', currentGameId)
    .single();

  if (game) {
    document.getElementById('lobby-code').textContent = game.game_code;
  }

  // Get players
  const { data: players } = await db
    .from('btech_players')
    .select('*')
    .eq('game_id', currentGameId)
    .order('seat_number');

  // Get spectators
  const { data: spectators } = await db
    .from('btech_players')
    .select('*, profiles(username)')
    .eq('game_id', currentGameId)
    .eq('role', 'spectator')
    .order('created_at');

  // Render seats
  const seatsEl = document.getElementById('lobby-seats');
  seatsEl.innerHTML = '';

  if (players) {
    for (let i = 0; i < 2; i++) {
      const player = players.find(p => p.seat_number === i + 1);
      const row = document.createElement('div');

      if (player) {
        // Check if this is the AI player
        const isAI = player.user_id === AI_UUID;
        const username = isAI 
          ? `AI ${aiDifficulty.charAt(0).toUpperCase() + aiDifficulty.slice(1)}`
          : titleCase(player.profiles?.username || player.user_id.substring(0, 8));
        const isCurrentPlayer = !isAI && player.user_id === currentUser?.id;
        const isReadyClass = player.ready ? 'ready' : '';
        const readyText = player.ready ? 'READY' : 'NOT READY';
        const currentTag = isCurrentPlayer ? ' (you)' : '';
        const aiTag = isAI ? ' 🤖' : '';

        row.className = 'seat-row';
        row.innerHTML = `
          <div class="seat-number">${i + 1}</div>
          <div class="seat-name">${username}${aiTag}${currentTag}</div>
          <div class="seat-status ${isReadyClass}">${readyText}</div>
        `;
      } else {
        row.className = 'seat-row empty';
        row.innerHTML = `
          <div class="seat-number">${i + 1}</div>
          <div class="seat-name">Empty Seat</div>
          <div class="seat-status">—</div>
        `;
      }

      seatsEl.appendChild(row);
    }
  }

  // Render spectators
  const specEl = document.getElementById('lobby-spectators');
  if (spectators && spectators.length > 0) {
    specEl.innerHTML = spectators.map(s => {
      const username = titleCase(s.profiles?.username || s.user_id.substring(0, 8));
      return `<div class="spectator-item">${username}</div>`;
    }).join('');
  } else {
    specEl.innerHTML = '<div class="spectator-item" style="color:var(--phosphor-dim);font-style:italic;">No spectators</div>';
  }

  // Update button states
  const btnReady = document.getElementById('btn-ready');
  const btnStart = document.getElementById('btn-start');

  if (btnReady) {
    btnReady.textContent = isReady ? 'Unready' : 'Ready Up';
  }
  if (btnStart) {
    btnStart.disabled = !isHost || !isReady;
  }

  // Update status
  const statusEl = document.getElementById('lobby-status');
  if (statusEl) {
    const playerCount = players ? players.filter(p => p.role === 'player').length : 0;
    statusEl.textContent = `${playerCount}/2 players in lobby`;
  }
}

async function handleReadyUp() {
  if (!currentGameId || !currentUser) return;

  const { data: player } = await db
    .from('btech_players')
    .select('*')
    .eq('game_id', currentGameId)
    .eq('user_id', currentUser.id)
    .single();

  if (!player) return;

  const newReady = !player.ready;
  isReady = newReady;

  await db
    .from('btech_players')
    .update({ ready: newReady })
    .eq('id', player.id);
}

async function handleStartGame() {
  if (!isHost || !currentGameId) return;

  // Get all players
  const { data: players } = await db
    .from('btech_players')
    .select('*')
    .eq('game_id', currentGameId)
    .eq('role', 'player');

  if (!players || players.length < 1) {
    document.getElementById('lobby-status').textContent = 'Need at least 1 player!';
    return;
  }

  // In AI mode, we only need 1 human player (AI auto-readies)
  // In multiplayer, all players must be ready
  if (!vsAiMode) {
    const allReady = players.every(p => p.ready === true);
    if (!allReady) {
      document.getElementById('lobby-status').textContent = 'All players must be ready!';
      return;
    }
  }

  // Store AI difficulty and mode in game state
  const { data: game } = await db
    .from('btech_games')
    .select('state')
    .eq('id', currentGameId)
    .single();

  const gameState = game?.state ? (typeof game.state === 'string' ? JSON.parse(game.state) : game.state) : {};
  gameState.vs_ai_mode = vsAiMode;
  gameState.ai_difficulty = aiDifficulty;

  // Single update call — set up game but leave phase at 'initiative' for manual roll
  await db
    .from('btech_games')
    .update({
      status: 'in-progress',
      current_round: 1,
      current_phase: 'initiative',
      state: JSON.stringify(gameState)
    })
    .eq('id', currentGameId);

  // Transition to game screen
  startGameScreen();
}

function startGameScreen() {
  if (gameSubscription) { gameSubscription.unsubscribe(); gameSubscription = null; }
  if (playersSubscription) { playersSubscription.unsubscribe(); playersSubscription = null; }

  showScreen('game-screen');
  initGame();
  loadGameState();
  subscribeGameStateSync();
}

// Keep unit positions/facings/movement in sync between both browsers during play.
function subscribeGameStateSync() {
  if (gameStateSubscription) { gameStateSubscription.unsubscribe(); gameStateSubscription = null; }
  if (!currentGameId) return;

  gameStateSubscription = db
    .channel('btech_games_state:' + currentGameId)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'btech_games', filter: `id=eq.${currentGameId}` },
      (payload) => {
        const remote = payload.new;
        // Round/phase bookkeeping
        currentGameState.round = remote.current_round || currentGameState.round;
        currentGameState.phase = remote.current_phase || currentGameState.phase;
        currentGameState.active_player_id = remote.active_player_id;
        currentGameState.initiative_winner = remote.initiative_winner;
        const gs = remote.state ? (typeof remote.state === 'string' ? JSON.parse(remote.state) : remote.state) : {};
        currentGameState.initiative_order = gs.initiative_order || currentGameState.initiative_order;
        currentGameState.initiative_rolls = gs.initiative_rolls || currentGameState.initiative_rolls;
        currentGameState.initiative_round = gs.initiative_round ?? currentGameState.initiative_round;
        mergeRemoteLog(gs.log);

        const initBtn = document.getElementById('btn-roll-initiative');
        if (initBtn) initBtn.disabled = (currentGameState.initiative_round === currentGameState.round);

        // Don't clobber a move currently in progress locally
        if (gs.mech_instances && !moveState.active) {
          mechInstances = gs.mech_instances;
          if (selectedInstanceId && !mechInstances.some(m => m.instanceId === selectedInstanceId)) {
            selectedInstanceId = null;
          }
          draw();
          renderRoster();
          renderDetail();
        }

        updateGameHeader();
        renderInitiativeDisplay();
        renderMovementPanel();
        updateAdvanceButtonState();
      }
    )
    .subscribe();
}

async function handleLeaveLobby() {
  if (!currentGameId) return;

  if (currentUser) {
    await db
      .from('btech_players')
      .delete()
      .eq('game_id', currentGameId)
      .eq('user_id', currentUser.id);
  }

  // If host leaves, delete the game
  if (isHost) {
    await db.from('btech_players').delete().eq('game_id', currentGameId);
    await db.from('btech_games').delete().eq('id', currentGameId);
  }

  currentGameId = null;
  isHost = false;
  isReady = false;
  showScreen('menu-screen');
}

// ── TURN STRUCTURE (IGOUGO) ──────────────────────────────
const PHASE_ORDER = ['initiative', 'movement', 'weapon_attack', 'physical_attack', 'heat', 'end'];
const PHASE_LABELS = {
  initiative: 'Initiative Roll',
  movement: 'Movement',
  weapon_attack: 'Weapon Attack',
  physical_attack: 'Physical Attack',
  heat: 'Heat Management',
  end: 'End Turn'
};

let currentGameState = {
  round: 1,
  phase: 'initiative',
  active_player_id: null,
  initiative_winner: null,
  initiative_order: [],
  initiative_rolls: [],
  initiative_round: null // which round's initiative_order is currently valid for — gates phase advancement
};

async function loadGameState() {
  if (!currentGameId) return;

  const { data: game } = await db
    .from('btech_games')
    .select('current_round, current_phase, active_player_id, initiative_winner, state')
    .eq('id', currentGameId)
    .single();

  if (!game) return;

  const gameState = game.state ? (typeof game.state === 'string' ? JSON.parse(game.state) : game.state) : {};

  currentGameState = {
    round: game.current_round || 1,
    phase: game.current_phase || 'initiative',
    active_player_id: game.active_player_id,
    initiative_winner: game.initiative_winner,
    initiative_order: gameState.initiative_order || [],
    initiative_rolls: gameState.initiative_rolls || [],
    initiative_round: gameState.initiative_round ?? null
  };
  mergeRemoteLog(gameState.log);
  if (gameLog.length === 0) logEvent(`Game loaded — Round ${currentGameState.round}, ${PHASE_LABELS[currentGameState.phase] || currentGameState.phase} phase.`, 'system');

  // If units have already been placed/moved (e.g. rejoining), use the saved positions
  // instead of the default setup positions initGame() placed.
  if (gameState.mech_instances && gameState.mech_instances.length > 0) {
    mechInstances = gameState.mech_instances;
    draw();
    renderRoster();
    renderDetail();
  }

  const initBtn = document.getElementById('btn-roll-initiative');
  if (initBtn) initBtn.disabled = (currentGameState.initiative_round === currentGameState.round);

  updateGameHeader();
  renderInitiativeDisplay();
  renderMovementPanel();
  updateAdvanceButtonState();
}

function updateGameHeader() {
  const statusEl = document.getElementById('status-readout');
  if (!statusEl) return;

  const phaseLabel = PHASE_LABELS[currentGameState.phase] || currentGameState.phase;
  statusEl.textContent = `Round ${currentGameState.round} — ${phaseLabel}`;

  if (currentGameState.active_player_id) {
    // Get player username for active player display
    db.from('btech_players')
      .select('profiles(username)')
      .eq('id', currentGameState.active_player_id)
      .single()
      .then(({ data: player }) => {
        const username = player?.profiles?.username || 'Unknown';
        statusEl.textContent += ` — ${titleCase(username)}'s Turn`;
      });
  }
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
    is_ai: p.user_id === AI_UUID
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

  await db
    .from('btech_games')
    .update({
      current_phase: 'initiative',
      initiative_winner: gameState.initiative_winner,
      active_player_id: initiativeRolls[0].player_id, // lowest goes first
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

// Enforces that every required VTT step for the CURRENT phase is actually done
// before the group can move on — nothing gets skipped by clicking through.
function canAdvancePhase() {
  if (currentGameState.phase === 'initiative') {
    const rolled = currentGameState.initiative_round === currentGameState.round &&
                   currentGameState.initiative_order && currentGameState.initiative_order.length > 0;
    if (!rolled) return { ok: false, reason: 'Roll Initiative before continuing to the Movement Phase.' };
  }
  if (currentGameState.phase === 'movement') {
    const unmoved = mechInstances.filter(m => !m.hasMoved).length;
    if (mechInstances.length > 0 && unmoved > 0) {
      return { ok: false, reason: `${unmoved} 'Mech${unmoved === 1 ? '' : 's'} still need${unmoved === 1 ? 's' : ''} to move (or Stand Still) first.` };
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

async function advancePhase() {
  const check = canAdvancePhase();
  if (!check.ok) {
    flashMoveWarning(check.reason);
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
    await db
      .from('btech_games')
      .update({
        current_phase: PHASE_ORDER[nextIdx]
      })
      .eq('id', currentGameId);

    currentGameState.phase = PHASE_ORDER[nextIdx];
    currentGameState.active_player_id = null;

    logEvent(`Round ${currentGameState.round}: ${prevPhaseLabel} → ${PHASE_LABELS[currentGameState.phase] || currentGameState.phase}.`, 'phase');
  }

  // Clear each 'Mech's movement flags/mode at the start of a fresh Movement Phase
  if (currentGameState.phase === 'movement') {
    resetMovementForRound();
    // Jump straight to picking a 'Mech so it's obvious how to move — select the player's first unmoved unit.
    const myMech = mechInstances.find(m => m.owner === mySeatNumber && !m.hasMoved);
    if (myMech) selectedInstanceId = myMech.instanceId;
  }
  cancelMovement();

  updateGameHeader();
  renderInitiativeDisplay();
  renderMovementPanel();
  renderRoster();
  renderDetail();
  draw();
  updateAdvanceButtonState();

  // Trigger AI turn if in AI mode and we're in an action phase
  if (vsAiMode && currentGameState.phase !== 'initiative' && currentGameState.phase !== 'end') {
    setTimeout(async () => {
      await aiTurnHandler();
      updateAdvanceButtonState();
    }, 500);
  }
}
