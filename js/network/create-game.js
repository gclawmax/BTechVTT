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
  renderCreateMapPreview();
  document.getElementById('create-tonnage-select').value = '200';
  document.getElementById('create-victory-select').value = 'annihilation';
  showScreen('match-setup-screen');
}

function renderCreateMapPreview() {
  const mapSelect = document.getElementById('create-map-select');
  const preview = document.getElementById('create-map-preview');
  const map = getMapDefinition(mapSelect?.value);
  if (!preview || !map) return;
  const terrain = map.terrain || {};
  const elevation = map.elevation || {};
  const cells = [];
  const counts = {};
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const key = hexCode(col, row);
      const type = terrain[key] || 'clear';
      if (type !== 'clear') counts[type] = (counts[type] || 0) + 1;
      const level = elevation[key] || 0;
      const description = `${key}: ${type.replaceAll('_', ' ')}${level ? ` · level ${level}` : ''}`;
      cells.push(`<polygon class="map-preview-hex ${type}${level ? ' elevated' : ''}" points="${mapPreviewHexPoints(col, row)}"><title>${description}</title></polygon>`);
    }
  }
  const legend = Object.entries(counts).map(([type, count]) => `${count} ${type.replace('_', ' ')}`).join(' · ') || 'Open ground';
  const levels = Object.values(elevation).filter(level => level > 0);
  const mapWidth = Math.sqrt(3) * (GRID_COLS + 0.5);
  const mapHeight = (GRID_ROWS - 1) * 1.5 + 2;
  preview.innerHTML = `<h3>${map.name}</h3><p>${map.description}</p><svg class="map-preview-grid" viewBox="0 0 ${mapWidth.toFixed(3)} ${mapHeight}" role="img" aria-label="16 by 12 hex terrain preview">${cells.join('')}</svg><div class="map-preview-legend">${legend}${levels.length ? ` · ${levels.length} elevated hexes (up to level ${Math.max(...levels)})` : ''}</div>`;
}

function mapPreviewHexPoints(col, row) {
  const root3 = Math.sqrt(3);
  const centerX = root3 * (col + 0.5 * (row & 1)) + root3 / 2;
  const centerY = row * 1.5 + 1;
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (60 * index + 30) * Math.PI / 180;
    return `${(centerX + Math.cos(angle)).toFixed(3)},${(centerY + Math.sin(angle)).toFixed(3)}`;
  }).join(' ');
}

function cancelCreateGameSetup() {
  showScreen('menu-screen');
}

async function handleCreateConfiguredGame() {
  if (!currentUser) return;
  const mapId = document.getElementById('create-map-select').value;
  const dropshipTonnage = Number.parseInt(document.getElementById('create-tonnage-select').value, 10);
  const victoryMode = document.getElementById('create-victory-select').value;
  if (!BT_MAPS[mapId] || !Number.isFinite(dropshipTonnage) || dropshipTonnage <= 0) return;
  await createHumanGame({ mapId, dropshipTonnage, victoryMode });
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

async function handleCreateFlatlandsScenario() {
  if (!currentUser) return;
  await createHumanGame({
    mapId: 'flatlands-open-terrain', dropshipTonnage: 100,
    rosters: { '1': ['wolverine-wvr-6r'], '2': ['griffin-grf-1n'] },
    beginnerScenario: {
      id: 'flatlands-skirmish', title: 'Flatlands Skirmish — Wolverine vs Griffin',
      instructions: 'A fast 1-on-1 battle across open lanes. Use the wood clusters to break line of sight and control the firing lanes.'
    }
  });
}

async function handleCreateDesertHillsScenario() {
  if (!currentUser) return;
  await createHumanGame({
    mapId: 'desert-hills', dropshipTonnage: 100,
    rosters: { '1': ['wolverine-wvr-6r', 'panther-pnt-9r'], '2': ['griffin-grf-1n', 'blackjack-bj-1'] },
    beginnerScenario: {
      id: 'desert-hills-clash', title: 'Desert Hills Clash — Two Lances',
      instructions: 'Fight for the ridge line. Rough ground can trigger Piloting checks; elevation can block or open firing lanes.'
    }
  });
}

async function createHumanGame({ mapId, dropshipTonnage, rosters = { '1': [], '2': [] }, beginnerScenario = null, victoryMode = 'annihilation', customScenario = null }) {
  if ((!BT_MAPS[mapId] && !BT_CUSTOM_MAPS[mapId]) || !Number.isFinite(dropshipTonnage) || dropshipTonnage <= 0) return;
  showLoading(true);
  try {
    const catalogueVersion = await loadLatestUnitCatalogue();
    // Scenario labels retain the readable historical spelling. Persist the
    // exact ID in the pinned release so the server and browser agree.
    const resolvedRosters = Object.fromEntries(Object.entries(rosters).map(([seat, unitIds]) => [seat, unitIds.map(resolveCatalogueId)]));
    const code = generateGameCode();
    const customTerrain = customScenario?.terrain && typeof customScenario.terrain === 'object' ? customScenario.terrain : null;
    const customBuildings = customTerrain ? Object.fromEntries(Object.entries(customTerrain).filter(([, terrain]) => terrain === 'building').map(([code]) => [code, 40])) : null;
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
          special_ammo_setup_v1: true,
          victory_mode: ['annihilation', 'control', 'breakthrough'].includes(victoryMode) ? victoryMode : 'annihilation',
          objective_hexes: victoryMode === 'control' ? objectiveHexesForMap(mapId) : [],
          objective_scores: { '1': 0, '2': 0 },
          rosters: resolvedRosters,
          ...(customScenario ? {
            custom_scenario: customScenario,
            terrain_overrides: customTerrain || {},
            elevation_overrides: customScenario.elevation || {},
            deployment_zones: customScenario.deployment_zones,
            building_cf: customBuildings || {}
          } : {}),
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
