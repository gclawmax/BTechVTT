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
