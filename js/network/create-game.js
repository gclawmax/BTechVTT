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
      ready: true
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
