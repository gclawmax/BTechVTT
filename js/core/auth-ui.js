// Extracted from index_3_1.html — screen_auth

// ── SCREEN MANAGEMENT ────────────────────────────────────
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

function showLoading(show) {
  document.getElementById('loading-overlay').classList.toggle('hidden', !show);
}

// ── AUTH ─────────────────────────────────────────────────
async function handleLogin() {
  const username = document.getElementById('login-username').value.trim().toLowerCase();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';

  if (!username || !password) {
    errorEl.textContent = 'Please enter username and password.';
    return;
  }

  showLoading(true);
  try {
    const email = `${username}@FreeGames.com`;
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) throw error;
    currentUser = data.user;
    await showMainMenu();
  } catch (err) {
    errorEl.textContent = 'Login failed: ' + (err.message || 'Check credentials.');
  } finally {
    showLoading(false);
  }
}

async function handleSignup() {
  const username = document.getElementById('login-username').value.trim().toLowerCase();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';

  if (!username || !password) {
    errorEl.textContent = 'Please enter username and password.';
    return;
  }

  showLoading(true);
  try {
    const email = `${username}@FreeGames.com`;
    const { data, error } = await db.auth.signUp({ email, password });
    if (error) throw error;
    if (!data.user) {
      // Email confirmation required — try to sign in instead
      const { data: signInData, error: signInErr } = await db.auth.signInWithPassword({ email, password });
      if (signInErr) throw signInErr;
      currentUser = signInData.user;
    } else {
      currentUser = data.user;
    }
    // Create profile
    await createProfile(username);
    await showMainMenu();
  } catch (err) {
    errorEl.textContent = 'Signup failed: ' + (err.message || 'Try logging in instead.');
  } finally {
    showLoading(false);
  }
}

async function createProfile(username) {
  try {
    const { error } = await db
      .from('profiles')
      .upsert({
        id: currentUser.id,
        username: username,
        email: `${username}@FreeGames.com`,
      }, { onConflict: 'id' });
    if (error) console.warn('Profile create error:', error);
  } catch (err) {
    console.warn('Profile table may not exist yet:', err.message);
  }
}

// ── HELPERS ──────────────────────────────────────────────
function titleCase(str) {
  if (!str) return '';
  return str.replace(/\b\w/g, c => c.toUpperCase());
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
    .select('game_id, btech_games(game_code, status)')
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

    if (game.status === 'lobby') {
      // Check if user is already a player in this game
      const { data: existingPlayer } = await db
        .from('btech_players')
        .select('*')
        .eq('game_id', currentGameId)
        .eq('user_id', currentUser.id)
        .single();

      if (existingPlayer) {
        isHost = false;
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

        let seatNumber = 1;
        if (existingPlayers && existingPlayers.some(p => p.seat_number === 1)) {
          seatNumber = 2;
        }

        await db.from('btech_players').insert({
          game_id: currentGameId,
          user_id: currentUser.id,
          seat_number: seatNumber,
          player_color: seatNumber === 1 ? '#c4302b' : '#d4800a',
          role: 'player',
          ready: false
        });

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

// ── CONFIRMATION MODAL ───────────────────────────────────
let confirmCallback = null;

function showConfirmModal(title, message, onConfirm) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-modal').classList.remove('hidden');
  confirmCallback = onConfirm;

  document.getElementById('confirm-ok').onclick = () => {
    document.getElementById('confirm-modal').classList.add('hidden');
    if (confirmCallback) confirmCallback();
    confirmCallback = null;
  };

  document.getElementById('confirm-cancel').onclick = () => {
    document.getElementById('confirm-modal').classList.add('hidden');
    confirmCallback = null;
  };
}

async function handleConcedeGame(code) {
  const { data: game } = await db
    .from('btech_games')
    .select('*')
    .eq('game_code', code)
    .single();

  if (!game) return;

  showConfirmModal(
    'Concede Game?',
    `This will remove you from ${game.game_code} (${game.status}). You cannot undo this action.`,
    async () => {
      showLoading(true);
      try {
        // Remove player record
        await db
          .from('btech_players')
          .delete()
          .eq('game_id', game.id)
          .eq('user_id', currentUser.id);

        // If host, delete the entire game
        if (game.host_id === currentUser.id) {
          await db.from('btech_players').delete().eq('game_id', game.id);
          await db.from('btech_games').delete().eq('id', game.id);
        }

        // Refresh the active games list
        await populateActiveGames();
      } catch (err) {
        console.error('Concede error:', err);
        alert('Failed to concede game: ' + (err.message || 'Unknown error'));
      } finally {
        showLoading(false);
      }
    }
  );
}

async function handleLogout() {
  showLoading(true);
  try {
    await db.auth.signOut();
    currentUser = null;
    currentGameId = null;
    showScreen('login-screen');
  } catch (err) {
    console.error('Logout error:', err);
  } finally {
    showLoading(false);
  }
}

// ── GAME CODE GENERATION ─────────────────────────────────
function generateGameCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'BT-';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ── CREATE GAME ──────────────────────────────────────────
async function handleCreateGame() {
  if (!currentUser) return;
  showLoading(true);
  try {
    const code = generateGameCode();
    const { data: game, error: gameErr } = await db
      .from('btech_games')
      .insert({
        game_code: code,
        host_id: currentUser.id,
        state: JSON.stringify({ units: [], turn: 0, phase: 'setup' }),
        status: 'lobby',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (gameErr) throw gameErr;

    currentGameId = game.id;
    isHost = true;
    isReady = true;
    mySeatNumber = 1;

    // Host is player 1
    await db.from('btech_players').insert({
      game_id: currentGameId,
      user_id: currentUser.id,
      seat_number: 1,
      player_color: '#c4302b',
      role: 'player',
      ready: true,
      is_ai: true
    });

    await loadLobby();
    showScreen('lobby-screen');
  } catch (err) {
    console.error('Create game error:', err);
    alert('Failed to create game: ' + (err.message || 'Unknown error'));
  } finally {
    showLoading(false);
  }
}

// ── CREATE VS AI GAME ────────────────────────────────────
async function handleCreateVsAI() {
  if (!currentUser) return;
  showLoading(true);
  try {
    const code = generateGameCode();
    const { data: game, error: gameErr } = await db
      .from('btech_games')
      .insert({
        game_code: code,
        host_id: currentUser.id,
        state: JSON.stringify({ units: [], turn: 0, phase: 'setup', ai_difficulty: aiDifficulty }),
        status: 'lobby',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (gameErr) throw gameErr;

    currentGameId = game.id;
    isHost = true;
    isReady = true;
    vsAiMode = true;
    mySeatNumber = 1;

    // Host is player 1
    await db.from('btech_players').insert({
      game_id: currentGameId,
      user_id: currentUser.id,
      seat_number: 1,
      player_color: '#c4302b',
      role: 'player',
      ready: true
    });

    // AI auto-joins as player 2
    await db.from('btech_players').insert({
      game_id: currentGameId,
      user_id: null,
      seat_number: 2,
      player_color: '#3060c4',
      role: 'player',
      ready: true
    });

    await loadLobby();
    showScreen('lobby-screen');
  } catch (err) {
    console.error('Create vs AI error:', err);
    alert('Failed to create AI game: ' + (err.message || 'Unknown error'));
  } finally {
    showLoading(false);
  }
}

// ── JOIN GAME ────────────────────────────────────────────
async function handleJoinGame() {
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!code) {
    alert('Please enter a game code.');
    return;
  }

  showLoading(true);
  try {
    const { data: game, error } = await db
      .from('btech_games')
      .select('*')
      .eq('game_code', code)
      .eq('status', 'lobby')
      .single();

    if (error || !game) {
      alert('Game not found or not in lobby. Check the code and try again.');
      return;
    }

    currentGameId = game.id;
    isHost = false;
    isReady = false;

    // Find available seat (2 for now)
    const { data: existingPlayers } = await db
      .from('btech_players')
      .select('seat_number')
      .eq('game_id', currentGameId);

    let seatNumber = 1;
    if (existingPlayers && existingPlayers.some(p => p.seat_number === 1)) {
      seatNumber = 2;
    }

    await db.from('btech_players').insert({
      game_id: currentGameId,
      user_id: currentUser.id,
      seat_number: seatNumber,
      player_color: seatNumber === 1 ? '#c4302b' : '#d4800a',
      role: 'player',
      ready: false
    });

    mySeatNumber = seatNumber;
    await loadLobby();
    showScreen('lobby-screen');
  } catch (err) {
    console.error('Join game error:', err);
    alert('Failed to join game: ' + (err.message || 'Unknown error'));
  } finally {
    showLoading(false);
  }
}
