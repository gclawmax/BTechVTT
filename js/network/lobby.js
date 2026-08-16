// ── LOBBY MANAGEMENT ─────────────────────────────────────
async function loadLobby() {
  if (!currentGameId) return;
  lobbyClosureInProgress = false;

  // Subscribe to game changes
  if (gameSubscription) gameSubscription.unsubscribe();
  gameSubscription = db
    .channel('btech_games:' + currentGameId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'btech_games', filter: `id=eq.${currentGameId}` },
      (payload) => {
        console.log('[BT-DIAG] lobby game update', payload.new?.status, payload.new?.id);
        if (payload.eventType === 'DELETE') {
          handleLobbyClosed();
          return;
        }
        if (payload.eventType === 'UPDATE' && payload.new.status === 'in-progress') {
          startGameScreen();
        } else {
          loadLobbyUI();
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
  const { data: game, error: gameError } = await db
    .from('btech_games')
    .select('game_code,state,catalogue_version')
    .eq('id', currentGameId)
    .single();

  // A cascading player-delete event can arrive before the game DELETE event.
  // Treat a missing game row as a closed lobby in either order.
  if (!game && gameError?.code === 'PGRST116') {
    await handleLobbyClosed();
    return;
  }
  if (!game) {
    console.warn('Unable to refresh lobby:', gameError);
    return;
  }

  if (game) {
    document.getElementById('lobby-code').textContent = game.game_code;
  }
  if (game.catalogue_version) {
    try {
      await loadUnitCatalogue(game.catalogue_version);
    } catch (error) {
      console.error('Unable to load match catalogue:', error);
      document.getElementById('lobby-status').textContent = 'The BattleMech catalogue for this match could not be loaded.';
      return;
    }
  }
  const gameState = game?.state ? (typeof game.state === 'string' ? JSON.parse(game.state) : game.state) : {};
  if (typeof gameState.vs_ai_mode === 'boolean') vsAiMode = gameState.vs_ai_mode;

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
        if (isCurrentPlayer) isReady = player.ready === true;
        const isReadyClass = player.ready ? 'ready' : '';
        const readyText = player.ready ? 'READY' : 'NOT READY';
        const currentTag = isCurrentPlayer ? ' (you)' : '';
        const aiTag = isAI ? ' 🤖' : '';
        const rosterSummary = !isAI && !vsAiMode && gameState.map_id
          ? `<div class="seat-roster">${rosterSummaryForSeat(gameState, player.seat_number)}</div>`
          : '';

        row.className = 'seat-row';
        row.innerHTML = `
          <div class="seat-number">${i + 1}</div>
          <div class="seat-name">${username}${aiTag}${currentTag}${rosterSummary}</div>
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

  renderLobbyMatchSetup(gameState, players || []);

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
    const playerSeats = (players || []).filter(player => player.role === 'player');
    const rostersReady = vsAiMode || playerSeats.every(player => isRosterLegal(gameState.rosters?.[String(player.seat_number)], gameState.dropship_tonnage));
    const canStart = vsAiMode
      ? playerSeats.length === 2 && playerSeats.some(player => !player.is_ai && player.ready)
      : playerSeats.length === 2 && playerSeats.every(player => player.ready) && rostersReady;
    btnStart.disabled = !isHost || !canStart;
  }

  // Update status
  const statusEl = document.getElementById('lobby-status');
  if (statusEl) {
    const playerCount = players ? players.filter(p => p.role === 'player').length : 0;
    statusEl.textContent = vsAiMode
      ? `${playerCount}/2 players in lobby`
      : `${playerCount}/2 human players in lobby${playerCount < 2 ? ' — waiting for an opponent' : ''}`;
  }
}

function stopLobbySubscriptions() {
  if (gameSubscription) { gameSubscription.unsubscribe(); gameSubscription = null; }
  if (playersSubscription) { playersSubscription.unsubscribe(); playersSubscription = null; }
  if (gameLogSubscription) { gameLogSubscription.unsubscribe(); gameLogSubscription = null; }
}

async function handleLobbyClosed() {
  if (lobbyClosureInProgress) return;
  lobbyClosureInProgress = true;
  stopLobbySubscriptions();
  currentGameId = null;
  isHost = false;
  isReady = false;
  mySeatNumber = null;
  alert('The host has closed this room. You have been returned to the Dropship.');
  await showMainMenu();
}

function supportedUnitEntries() {
  return Object.entries(BT_UNIT_CATALOGUE).filter(([id]) => isSupportedUnit(id));
}

function rosterTonnage(roster) {
  return (roster || []).reduce((total, unitId) => total + (getSupportedUnit(unitId)?.tonnage || 0), 0);
}

function isRosterLegal(roster, tonnageLimit) {
  const units = roster || [];
  return units.length > 0 && units.every(isSupportedUnit) && rosterTonnage(units) <= Number(tonnageLimit || 0);
}

function rosterSummaryForSeat(gameState, seatNumber) {
  const roster = gameState.rosters?.[String(seatNumber)] || [];
  const names = roster.map(unitId => {
    const unit = getSupportedUnit(unitId);
    return unit ? `${unit.chassis} ${unit.variant}` : unitId;
  });
  return names.length
    ? `Roster: ${names.join(', ')} · ${rosterTonnage(roster)} tons`
    : 'Roster: not selected';
}

function renderLobbyMatchSetup(gameState, players) {
  const settingsEl = document.getElementById('lobby-match-settings');
  const rosterSection = document.getElementById('lobby-roster-section');
  const rosterEl = document.getElementById('lobby-roster-builder');
  if (!settingsEl || !rosterSection || !rosterEl) return;

  if (vsAiMode || !gameState.map_id) {
    settingsEl.innerHTML = '<div class="match-setting-summary">AI skirmish using the current demonstration map and test roster.</div>';
    rosterSection.hidden = true;
    return;
  }

  const map = getMapDefinition(gameState.map_id);
  const limit = Number(gameState.dropship_tonnage || 0);
  settingsEl.innerHTML = `<div class="match-setting-summary"><strong>${map.name}</strong><br>${map.description}<br>Force limit: <strong>${limit} tons per player</strong></div>`;
  rosterSection.hidden = false;
  const roster = gameState.rosters?.[String(mySeatNumber)] || [];
  const total = rosterTonnage(roster);
  rosterEl.innerHTML = `<div class="roster-summary">${total} / ${limit} tons · choose at least one tested unit</div><div class="roster-options">${supportedUnitEntries().map(([id, unit]) => {
    const selected = roster.includes(id);
    const disabled = !selected && total + unit.tonnage > limit;
    return `<button class="roster-option ${selected ? 'selected' : ''}" onclick="toggleRosterUnit('${id}')" ${disabled ? 'disabled' : ''}><span class="roster-option-name">${unit.chassis} ${unit.variant}</span><span class="roster-option-tonnage">${unit.tonnage} tons${selected ? ' · selected' : ''}</span></button>`;
  }).join('')}</div>`;
}

async function toggleRosterUnit(unitId) {
  if (!currentGameId || !currentUser || vsAiMode || !isSupportedUnit(unitId)) return;
  const { data: game, error } = await db.from('btech_games').select('state').eq('id', currentGameId).single();
  if (error || !game) return;
  const state = game.state ? (typeof game.state === 'string' ? JSON.parse(game.state) : game.state) : {};
  const rosterKey = String(mySeatNumber);
  const roster = [...(state.rosters?.[rosterKey] || [])];
  const index = roster.indexOf(unitId);
  if (index >= 0) roster.splice(index, 1);
  else if (rosterTonnage(roster) + getSupportedUnit(unitId).tonnage <= Number(state.dropship_tonnage)) roster.push(unitId);
  else return;
  state.rosters = { ...(state.rosters || {}), [rosterKey]: roster };
  const { error: updateError } = await db.rpc('update_lobby_roster', {
    p_game_id: currentGameId,
    p_roster: roster
  });
  if (updateError) {
    console.error('Failed to save lobby roster:', updateError);
    document.getElementById('lobby-status').textContent = 'Roster could not be saved. Please refresh and try again.';
    return;
  }
  isReady = false;
  const { error: readyError } = await db.from('btech_players')
    .update({ ready: false })
    .eq('game_id', currentGameId)
    .eq('user_id', currentUser.id);
  if (readyError) console.error('Failed to clear readiness after roster change:', readyError);
  await loadLobbyUI();
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
  if (newReady) {
    const { data: game } = await db.from('btech_games').select('state').eq('id', currentGameId).single();
    const state = game?.state ? (typeof game.state === 'string' ? JSON.parse(game.state) : game.state) : {};
    if (!vsAiMode && !isRosterLegal(state.rosters?.[String(player.seat_number)], state.dropship_tonnage)) {
      document.getElementById('lobby-status').textContent = 'Choose a legal roster before readying up.';
      return;
    }
  }
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

  if (!players || players.length !== 2) {
    document.getElementById('lobby-status').textContent = 'Two player seats are required to start.';
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
    .select('state,catalogue_version')
    .eq('id', currentGameId)
    .single();

  const gameState = game?.state ? (typeof game.state === 'string' ? JSON.parse(game.state) : game.state) : {};
  if (game?.catalogue_version) {
    await loadUnitCatalogue(game.catalogue_version);
    gameState.catalogue_version = game.catalogue_version;
  }
  if (!vsAiMode) {
    const rostersValid = players.every(player => isRosterLegal(gameState.rosters?.[String(player.seat_number)], gameState.dropship_tonnage));
    if (!rostersValid) {
      document.getElementById('lobby-status').textContent = 'Each player needs a legal roster within the dropship limit.';
      return;
    }
    gameState.mech_instances = buildRosterInstances(gameState.rosters);
  }
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

function buildRosterInstances(rosters) {
  const deployment = {
    1: [
      { col: 4, row: 4, facing: 0 }, { col: 3, row: 5, facing: 0 },
      { col: 4, row: 6, facing: 0 }, { col: 3, row: 7, facing: 0 },
      { col: 4, row: 8, facing: 0 }, { col: 5, row: 6, facing: 0 }
    ],
    2: [
      { col: 11, row: 4, facing: 3 }, { col: 12, row: 5, facing: 3 },
      { col: 11, row: 6, facing: 3 }, { col: 12, row: 7, facing: 3 },
      { col: 11, row: 8, facing: 3 }, { col: 10, row: 6, facing: 3 }
    ]
  };
  return [1, 2].flatMap(seat => (rosters?.[String(seat)] || []).map((unitId, index) => {
    const position = deployment[seat][index];
    return {
      instanceId: `${unitId}-p${seat}-${index + 1}`,
      unitId, owner: seat, col: position.col, row: position.row,
      facing: position.facing, torsoFacing: position.facing,
      ...(activeCatalogueVersion ? { catalogueVersion: activeCatalogueVersion } : {})
    };
  }));
}

async function startGameScreen() {
  stopLobbySubscriptions();

  showScreen('game-screen');
  gameLog = [];
  renderGameLog();
  initGame();
  // Finish the initial snapshot before listening for changes. Otherwise a
  // slower initial read can overwrite a newer realtime turn hand-off.
  await loadGameState();
  subscribeGameStateSync();
  subscribePersistentGameLog();
}

// Keep unit positions/facings/movement in sync between both browsers during play.
function subscribeGameStateSync() {
  if (gameStateSubscription) { gameStateSubscription.unsubscribe(); gameStateSubscription = null; }
  if (!currentGameId) return;

  gameStateSubscription = db
    .channel('btech_games_state:' + currentGameId)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'btech_games', filter: `id=eq.${currentGameId}` },
      async (payload) => {
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
        if (remote.catalogue_version) await loadUnitCatalogue(remote.catalogue_version);
        setActiveMap(gs.map_id);
        currentMatchConfig = {
          ...(gs.map_id ? { map_id: gs.map_id } : {}),
          ...(gs.dropship_tonnage ? { dropship_tonnage: gs.dropship_tonnage } : {}),
          ...(gs.rosters ? { rosters: gs.rosters } : {}),
          ...(typeof gs.vs_ai_mode === 'boolean' ? { vs_ai_mode: gs.vs_ai_mode } : {}),
          ...(gs.ai_difficulty ? { ai_difficulty: gs.ai_difficulty } : {}),
          ...(remote.catalogue_version ? { catalogue_version: remote.catalogue_version } : {})
        };
        // Realtime updates must update this too: a tab may previously have
        // been used for an AI match before entering a human game.
        vsAiMode = gs.vs_ai_mode === true;
        // active_player_id is the authoritative database column. The state
        // copy exists for a single JSON snapshot, but can briefly lag behind
        // during concurrent human actions and must not steal a player's turn.
        currentGameState.active_player_id = remote.active_player_id || gs.active_player_player_id || null;
        // Empty arrays/null are meaningful here: they are how an initiative
        // tie resets both players for a re-roll. Never retain stale values.
        currentGameState.initiative_order = gs.initiative_order || [];
        currentGameState.initiative_rolls = gs.initiative_rolls || [];
        currentGameState.initiative_round = gs.initiative_round ?? null;
        currentGameState.initiative_pending = gs.initiative_pending || [];
        currentGameState.match_result = gs.match_result || null;
        mergeRemoteLog(gs.log);

        const initBtn = document.getElementById('btn-roll-initiative');
        if (initBtn) initBtn.disabled = (currentGameState.initiative_round === currentGameState.round);

        // Don't clobber a move currently in progress locally
        if (gs.mech_instances && !moveState.active) {
          mechInstances = gs.mech_instances;
          // The compact multiplayer state stores only unit placement and
          // action flags. Restore derived combat fields before any panel can
          // inspect armour or structure after a realtime update.
          mechInstances.forEach(ensureMechCombatState);
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
        renderPhysicalAttackPanel();
        renderHeatPanel();
        renderEndPanel();
        updateAdvanceButtonState();
        scheduleActiveAiTurn();
      }
    )
    .subscribe();
}

async function handleLeaveLobby() {
  if (!currentGameId) return;

  // The host intentionally closes the room below. Stop listening first so
  // their own DELETE event does not display the room-closed notice.
  lobbyClosureInProgress = true;
  stopLobbySubscriptions();

  // A host deletes the game itself; its player rows are removed by the
  // btech_players.game_id ON DELETE CASCADE relationship.
  if (isHost) {
    const { error: clearError } = await db
      .from('btech_games')
      .update({ active_player_id: null, initiative_winner: null })
      .eq('id', currentGameId);
    if (clearError) {
      console.error('Failed to clear game turn references before leaving:', clearError);
      lobbyClosureInProgress = false;
      await loadLobby();
      return;
    }

    const { error: deleteError } = await db.from('btech_games').delete().eq('id', currentGameId);
    if (deleteError) {
      console.error('Failed to delete hosted game:', deleteError);
      lobbyClosureInProgress = false;
      await loadLobby();
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
  mySeatNumber = null;
  lobbyClosureInProgress = false;
  showScreen('menu-screen');
}
