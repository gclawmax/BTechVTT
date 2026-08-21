// ── HELPERS ──────────────────────────────────────────────
function titleCase(str) {
  if (!str) return '';
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
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
    .select('game_id, btech_games!btech_players_game_id_fkey(game_code, status)')
    .eq('user_id', currentUser.id);

  if (!players || players.length === 0) {
    listEl.innerHTML = '';
    return;
  }

  const games = players
    .map(p => p.btech_games)
    .filter(g => g && (g.status === 'lobby' || g.status === 'in-progress'));

  if (games.length === 0) {
    listEl.innerHTML = '';
    return;
  }

  listEl.innerHTML = '<div class="game-label">Active Games</div>' +
    games.map(g => `<div class="game-entry" onclick="handleRejoinGame('${g.game_code}')">${g.game_code} <span style="color:#666">[${g.status}]</span><button class="close-btn" onclick="event.stopPropagation(); handleConcedeGame('${g.game_code}')" title="Concede game">&times;</button></div>`).join('');
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
    } else if (game.status === 'in-progress') {
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
      } else {
        await db.from('btech_players').insert({
          game_id: currentGameId,
          user_id: currentUser.id,
          seat_number: null,
          player_color: '#3060c4',
          role: 'spectator',
          ready: true
        });
        mySeatNumber = null;
      }

      startGameScreen();
    }
  } catch (err) {
    console.error('Rejoin error:', err);
    alert('Failed to rejoin game: ' + (err.message || 'Unknown error'));
  } finally {
    showLoading(false);
  }
}
