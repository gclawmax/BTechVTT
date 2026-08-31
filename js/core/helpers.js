// ── HELPERS ──────────────────────────────────────────────
function titleCase(str) {
  if (!str) return '';
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// Available before match restoration, unlike combat-only helpers.
function criticalSlotName(slot) {
  return String(slot || '').replace(/\s*\([A-Z]\)$/, '').trim();
}

// Matches made before catalogue pinning can still be active. Repair only such
// a match; the server verifies the caller and requires one catalogue release
// to contain every already-deployed unit before committing the permanent pin.
async function repairLegacyMatchCatalogue(game, gameId = currentGameId) {
  if (!game || game.catalogue_version || !gameId) return game;

  const { data, error } = await db.rpc('repair_legacy_match_catalogue_pin', { p_game_id: gameId });
  if (error) {
    console.warn('Unable to repair legacy match catalogue:', error);
    return game;
  }

  if (data?.repaired) logEvent('This older match was safely linked to a compatible BattleMech catalogue.', 'system');
  return {
    ...game,
    catalogue_version: data?.catalogue_version || game.catalogue_version,
    state: data?.state || game.state
  };
}

async function showMainMenu() {
  const username = currentUser?.user_metadata?.username ||
                   currentUser?.email?.replace('@FreeGames.com', '') ||
                   'Player';
  document.getElementById('menu-username').textContent = titleCase(username);
  await populateActiveGames();
  showScreen('menu-screen');
}

async function handleBackToDropship() {
  if (gameSubscription) { gameSubscription.unsubscribe(); gameSubscription = null; }
  if (playersSubscription) { playersSubscription.unsubscribe(); playersSubscription = null; }
  if (gameStateSubscription) { gameStateSubscription.unsubscribe(); gameStateSubscription = null; }
  currentGameId = null;
  currentGameCode = null;
  if (typeof currentSealedMatchReport !== 'undefined') currentSealedMatchReport = null;
  isHost = false;
  isReady = false;
  mySeatNumber = null;
  await showMainMenu();
}

async function populateActiveGames() {
  const listEl = document.getElementById('active-games-list');
  if (!listEl || !currentUser) return;

  const { data: players } = await db
    .from('btech_players')
    .select('game_id, seat_number, btech_games!btech_players_game_id_fkey(game_code, status, match_type, completed_at, state)')
    .eq('user_id', currentUser.id);

  if (!players || players.length === 0) {
    listEl.innerHTML = '';
    return;
  }

  const retainedAfter = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const games = players
    .map(p => ({ ...p.btech_games, seat_number: Number(p.seat_number) }))
    .filter(g => g && (g.status === 'lobby' || g.status === 'in-progress' ||
      (g.status === 'finished' && g.match_type === 'skirmish' &&
       Number.isFinite(new Date(g.completed_at).getTime()) && new Date(g.completed_at).getTime() >= retainedAfter)));

  if (games.length === 0) {
    listEl.innerHTML = '';
    return;
  }

  const activeGames = games.filter(g => g.status !== 'finished');
  const finishedGames = games.filter(g => g.status === 'finished');
  const resultLabel = game => {
    let state = {};
    try { state = typeof game.state === 'string' ? JSON.parse(game.state) : (game.state || {}); } catch (_) { /* legacy state */ }
    const winner = state.match_result?.winner_seat;
    if (winner == null) return 'Finished — Draw';
    return Number(winner) === game.seat_number ? 'Finished — Win' : 'Finished — Loss';
  };
  const activeHtml = activeGames.length
    ? '<div class="game-label">Active Games</div>' + activeGames.map(g => `<div class="game-entry" onclick="handleRejoinGame('${g.game_code}')">${g.game_code} <span style="color:#666">[${g.status}]</span><button class="close-btn" onclick="event.stopPropagation(); handleConcedeGame('${g.game_code}')" title="Concede game">&times;</button></div>`).join('')
    : '';
  const finishedHtml = finishedGames.length
    ? '<div class="game-label">Recent Finished Games</div>' + finishedGames.map(g => `<div class="game-entry game-entry-finished" onclick="handleRejoinGame('${g.game_code}')">${g.game_code} <span class="game-finished-result">${resultLabel(g)}</span><small>Report &amp; replay available for 30 days</small></div>`).join('')
    : '';
  listEl.innerHTML = activeHtml + finishedHtml;
}

async function handleRejoinGame(code) {
  showLoading(true);
  try {
    const { data: game, error } = await db
      .from('btech_games')
      .select('*')
      .eq('game_code', code)
      .single();

    if (error || !game) {
      alert('Game not found.');
      return;
    }

    currentGameId = game.id;
    const gameState = game.state ? (typeof game.state === 'string' ? JSON.parse(game.state) : game.state) : {};
    vsAiMode = gameState.vs_ai_mode === true;

    if (game.status === 'lobby') {
      // Check if user is already a player in this game
      const { data: existingPlayer } = await db
        .from('btech_players')
        .select('*')
        .eq('game_id', currentGameId)
        .eq('user_id', currentUser.id)
        .single();

      if (existingPlayer) {
        isHost = game.host_id === currentUser.id;
        isReady = existingPlayer.ready;
        mySeatNumber = existingPlayer.seat_number;
        await loadLobby();
        showScreen('lobby-screen');
      } else {
        // Find available seat
        const { data: existingPlayers } = await db
          .from('btech_players')
          .select('seat_number')
          .eq('game_id', currentGameId);

        const occupiedSeats = new Set((existingPlayers || []).map(p => p.seat_number));
        const seatNumber = [1, 2].find(seat => !occupiedSeats.has(seat));
        if (!seatNumber) {
          alert('This game lobby is already full.');
          return;
        }

        const { error: joinError } = await db.from('btech_players').insert({
          game_id: currentGameId,
          user_id: currentUser.id,
          seat_number: seatNumber,
          player_color: seatNumber === 1 ? '#c4302b' : '#d4800a',
          role: 'player',
          ready: false
        });
        if (joinError) throw joinError;

        mySeatNumber = seatNumber;
        await loadLobby();
        showScreen('lobby-screen');
      }
    } else if (game.status === 'in-progress' || game.status === 'finished') {
      // Join as spectator
      const { data: existingPlayer } = await db
        .from('btech_players')
        .select('*')
        .eq('game_id', currentGameId)
        .eq('user_id', currentUser.id)
        .single();

      if (existingPlayer) {
        isHost = game.host_id === currentUser.id;
        mySeatNumber = existingPlayer.seat_number; // null if spectator
      } else if (game.status === 'in-progress') {
        await db.from('btech_players').insert({
          game_id: currentGameId,
          user_id: currentUser.id,
          seat_number: null,
          player_color: '#3060c4',
          role: 'spectator',
          ready: true
        });
        mySeatNumber = null;
      } else {
        alert('This completed battle is not available to this account.');
        return;
      }

      // Keep the loading state in place until the saved game snapshot has
      // hydrated. Showing the board first exposed default Round 1 state for a
      // moment after reconnecting during an opponent's turn.
      await startGameScreen();
    }
  } catch (err) {
    console.error('Rejoin error:', err);
    alert('Failed to rejoin game: ' + (err.message || 'Unknown error'));
  } finally {
    showLoading(false);
  }
}
