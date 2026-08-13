// ── LOBBY MANAGEMENT ─────────────────────────────────────
async function loadLobby() {
  if (!currentGameId) return;

  // Subscribe to game changes
  if (gameSubscription) gameSubscription.unsubscribe();
  gameSubscription = db
    .channel('btech_games:' + currentGameId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'btech_games', filter: `id=eq.${currentGameId}` },
      (payload) => {
        console.log('[BT-DIAG] lobby game update', payload.new?.status, payload.new?.id);
        if (payload.eventType === 'UPDATE' && payload.new.status === 'in-progress') {
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
    .select('*')
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
        const isAI = player.is_ai === true;
        const username = isAI 
          ? `AI ${aiDifficulty.charAt(0).toUpperCase() + aiDifficulty.slice(1)}`
          : titleCase(player.user_id?.substring(0, 8) || `Player ${player.seat_number}`);
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
      const username = titleCase(s.user_id?.substring(0, 8) || 'Spectator');
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
        if (remote.status !== 'in-progress') {
          console.warn('[BT-DIAG] Game status changed while game screen is active:', remote.status);
          logEvent(`Diagnostic: database game status changed to ${remote.status}. No automatic lobby navigation is performed.`, 'error');
        }
        // Round/phase bookkeeping
        currentGameState.round = remote.current_round || currentGameState.round;
        currentGameState.phase = remote.current_phase || currentGameState.phase;
        currentGameState.initiative_winner = remote.initiative_winner;
        const gs = remote.state ? (typeof remote.state === 'string' ? JSON.parse(remote.state) : remote.state) : {};
        currentGameState.active_player_id = gs.active_player_player_id || null;
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
        renderReactionPanel();
        renderWeaponAttackPanel();
        updateAdvanceButtonState();
      }
    )
    .subscribe();
}

async function handleLeaveLobby() {
  if (!currentGameId) return;

  // A host deletes the game itself; its player rows are removed by the
  // btech_players.game_id ON DELETE CASCADE relationship.
  if (isHost) {
    const { error: clearError } = await db
      .from('btech_games')
      .update({ active_player_id: null, initiative_winner: null })
      .eq('id', currentGameId);
    if (clearError) {
      console.error('Failed to clear game turn references before leaving:', clearError);
      return;
    }

    const { error: deleteError } = await db.from('btech_games').delete().eq('id', currentGameId);
    if (deleteError) {
      console.error('Failed to delete hosted game:', deleteError);
      return;
    }
  } else if (currentUser) {
    await db
      .from('btech_players')
      .delete()
      .eq('game_id', currentGameId)
      .eq('user_id', currentUser.id);
  }

  currentGameId = null;
  isHost = false;
  isReady = false;
  showScreen('menu-screen');
}
