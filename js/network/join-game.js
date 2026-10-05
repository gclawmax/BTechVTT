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

    if (game.catalogue_version) await loadUnitCatalogue(game.catalogue_version);

    currentGameId = game.id;
    isHost = false;
    isReady = false;
    vsAiMode = false;

    // Issue #20: a rejoin by a pilot who already holds a seat must RESUME
    // that seat. Filling only empty seats reported a rejoiner's own seat as
    // 'This game lobby is already full.', locking humans out after a refresh.
    const { data: lobbyRoster } = await db
      .from('btech_players')
      .select('user_id,seat_number,ready,is_ai')
      .eq('game_id', currentGameId);

    const myLobbySeat = (lobbyRoster || []).find(p => p.user_id === currentUser.id && !p.is_ai);
    if (myLobbySeat) {
      mySeatNumber = myLobbySeat.seat_number;
      isReady = !!myLobbySeat.ready;
      await loadLobby();
      showScreen('lobby-screen');
      return;
    }

    const occupiedSeats = new Set((lobbyRoster || []).map(p => p.seat_number));
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
  } catch (err) {
    console.error('Join game error:', err);
    alert('Failed to join game: ' + (err.message || 'Unknown error'));
  } finally {
    showLoading(false);
  }
}
