// ── CREATE GAME ──────────────────────────────────────────
function handleCreateGame() {
  if (!currentUser) return;
  // A previous test game against the AI must not turn a new human-created
  // lobby into an AI game merely because the browser retained local state.
  vsAiMode = false;
  const mapSelect = document.getElementById('create-map-select');
  mapSelect.innerHTML = Object.entries(BT_MAPS).map(([id, map]) =>
    `<option value="${id}">${map.name}</option>`
  ).join('');
  mapSelect.value = DEFAULT_MAP_ID;
  document.getElementById('create-tonnage-select').value = '200';
  showScreen('match-setup-screen');
}

function cancelCreateGameSetup() {
  showScreen('menu-screen');
}

async function handleCreateConfiguredGame() {
  if (!currentUser) return;
  const mapId = document.getElementById('create-map-select').value;
  const dropshipTonnage = Number.parseInt(document.getElementById('create-tonnage-select').value, 10);
  if (!BT_MAPS[mapId] || !Number.isFinite(dropshipTonnage) || dropshipTonnage <= 0) return;
  await createHumanGame({ mapId, dropshipTonnage });
}

// A short first match removes roster-building friction while preserving the
// normal human lobby: share the code, both players ready up, then play.
async function handleCreateBeginnerMatch() {
  if (!currentUser) return;
  await createHumanGame({
    mapId: 'training-grounds',
    dropshipTonnage: 100,
    rosters: { '1': ['wolverine-wvr-6r'], '2': ['griffin-grf-1n'] },
    beginnerScenario: {
      id: 'wolverine-vs-griffin',
      title: 'Beginner Match — Wolverine vs Griffin',
      instructions: 'Your BattleMech is already selected. Share the code, ready up, then roll Initiative.'
    }
  });
}

async function createHumanGame({ mapId, dropshipTonnage, rosters = { '1': [], '2': [] }, beginnerScenario = null }) {
  if (!BT_MAPS[mapId] || !Number.isFinite(dropshipTonnage) || dropshipTonnage <= 0) return;
  showLoading(true);
  try {
    const catalogueVersion = await loadLatestUnitCatalogue();
    const code = generateGameCode();
    const { data: game, error: gameErr } = await db
      .from('btech_games')
      .insert({
        game_code: code,
        host_id: currentUser.id,
        catalogue_version: catalogueVersion,
        state: JSON.stringify({
          units: [], turn: 0, phase: 'setup', vs_ai_mode: false,
          map_id: mapId, dropship_tonnage: dropshipTonnage,
          catalogue_version: catalogueVersion,
          rosters,
          ...(beginnerScenario ? { beginner_scenario: beginnerScenario } : {})
        }),
        status: 'lobby',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (gameErr) throw gameErr;

    currentGameId = game.id;
    isHost = true;
    isReady = false;
    mySeatNumber = 1;

    // Host is player 1
    await db.from('btech_players').insert({
      game_id: currentGameId,
      user_id: currentUser.id,
      seat_number: 1,
      player_color: '#c4302b',
      role: 'player',
      ready: false
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
