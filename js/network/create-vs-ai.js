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
    const { error: humanPlayerErr } = await db.from('btech_players').insert({
      game_id: currentGameId,
      user_id: currentUser.id,
      seat_number: 1,
      player_color: '#c4302b',
      role: 'player',
      ready: true,
      is_ai: false
    });

    if (humanPlayerErr) throw humanPlayerErr;

    // AI auto-joins as player 2. AI opponents are not Supabase auth users,
    // so user_id is intentionally NULL and is_ai identifies the seat.
    const { error: aiPlayerErr } = await db.from('btech_players').insert({
      game_id: currentGameId,
      user_id: null,
      seat_number: 2,
      player_color: '#3060c4',
      role: 'player',
      ready: true,
      is_ai: true
    });

    if (aiPlayerErr) throw aiPlayerErr;

    await loadLobby();
    showScreen('lobby-screen');
  } catch (err) {
    console.error('Create vs AI error:', err);
    alert('Failed to create AI game: ' + (err.message || 'Unknown error'));
  } finally {
    showLoading(false);
  }
}
