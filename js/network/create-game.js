// ── CREATE GAME ──────────────────────────────────────────
const BV2_FORCE_PRESETS = Object.freeze([2500, 5000, 7500, 10000]);

function normaliseMatchForceLimit(input) {
  if (!input || input.mode !== 'bv2') return { mode:'tonnage' };
  const limit = Number(input.limit);
  if (!Number.isInteger(limit) || limit < 100 || limit > 50000) throw new Error('Choose a whole BV2 limit between 100 and 50,000.');
  return { mode:'bv2', limit, bv_version:'BV2.1' };
}

function readForceLimitControls(prefix) {
  const mode = document.getElementById(`${prefix}-force-format-select`)?.value;
  if (mode !== 'bv2') return { mode:'tonnage' };
  const selected = document.getElementById(`${prefix}-bv-limit-select`)?.value;
  const raw = selected === 'custom' ? document.getElementById(`${prefix}-bv-custom-limit`)?.value : selected;
  return normaliseMatchForceLimit({ mode:'bv2', limit:Number(raw) });
}

function syncForceFormatControls(prefix) {
  const bv = document.getElementById(`${prefix}-force-format-select`)?.value === 'bv2';
  const controls = document.getElementById(`${prefix}-bv-limit-controls`);
  const tonnageControls = document.getElementById(`${prefix}-tonnage-controls`);
  const custom = document.getElementById(`${prefix}-bv-limit-select`)?.value === 'custom';
  if (controls) controls.hidden = !bv;
  if (tonnageControls) tonnageControls.hidden = bv;
  const customInput = document.getElementById(`${prefix}-bv-custom-limit`);
  if (customInput) customInput.hidden = !bv || !custom;
}

function handleCreateGame() {
  if (!currentUser) return;
  // A previous test game against the AI must not turn a new human-created
  // lobby into an AI game merely because the browser retained local state.
  vsAiMode = false;
  const mapSelect = document.getElementById('create-map-select');
  mapSelect.innerHTML = builtInMapOptions();
  mapSelect.value = DEFAULT_MAP_ID;
  renderCreateMapPreview();
  document.getElementById('create-tonnage-select').value = '200';
  document.getElementById('create-force-format-select').value = 'bv2';
  document.getElementById('create-bv-limit-select').value = '5000';
  syncForceFormatControls('create');
  document.getElementById('create-victory-select').value = 'annihilation';
  document.getElementById('create-ruleset-select').value = 'advanced_3060';
  document.getElementById('create-minefields-enabled').checked = false;
  syncCreateMinefieldControls();
  showScreen('match-setup-screen');
}

function syncCreateMinefieldControls() {
  const input = document.getElementById('create-minefields-enabled');
  input.disabled = document.getElementById('create-ruleset-select').value !== 'advanced_3060';
  if (input.disabled) input.checked = false;
}

function renderCreateMapPreview() {
  const mapSelect = document.getElementById('create-map-select');
  const preview = document.getElementById('create-map-preview');
  const map = getMapDefinition(mapSelect?.value);
  if (!preview || !map) return;
  const terrain = map.terrain || {};
  const elevation = map.elevation || {};
  const victoryMode = document.getElementById('create-victory-select')?.value || 'annihilation';
  const previewState = { map_id:mapSelect?.value };
  const objectives = new Set(victoryMode === 'control' ? objectiveHexesForMap(mapSelect?.value) : []);
  const zoneOne = new Set(victoryMode === 'breakthrough' ? scenarioDeploymentZoneHexes(1,previewState) : []);
  const zoneTwo = new Set(victoryMode === 'breakthrough' ? scenarioDeploymentZoneHexes(2,previewState) : []);
  const cells = [];
  const counts = {};
  const dimensions = mapDimensions(mapSelect?.value);
  for (let row = 0; row < dimensions.rows; row++) {
    for (let col = 0; col < dimensions.cols; col++) {
      const key = hexCode(col, row);
      const type = terrain[key] || 'clear';
      if (type !== 'clear') counts[type] = (counts[type] || 0) + 1;
      const level = elevation[key] || 0;
      const description = `${key}: ${type.replaceAll('_', ' ')}${level ? ` · level ${level}` : ''}`;
      const code = hexCode(col,row);
      const marker = objectives.has(code) ? ' objective' : zoneOne.has(code) ? ' breakthrough-zone-one' : zoneTwo.has(code) ? ' breakthrough-zone-two' : '';
      cells.push(`<polygon class="map-preview-hex ${type}${level ? ' elevated' : ''}${marker}" points="${mapPreviewHexPoints(col, row)}"><title>${description}${objectives.has(code)?' · objective':zoneOne.has(code)?' · Player 2 breakthrough goal':zoneTwo.has(code)?' · Player 1 breakthrough goal':''}</title></polygon>`);
      if (type === 'light_woods' || type === 'heavy_woods') {
        const x = Math.sqrt(3) * (col + .5 * (row & 1)) + Math.sqrt(3)/2;
        const y = row * 1.5 + 1;
        cells.push(`<g aria-hidden="true" pointer-events="none" fill="#d8e5bd"><path d="M ${x} ${y-.65} l -.42 .75 h .27 v .32 h .3 v -.32 h .27 Z"/>${type === 'heavy_woods' ? `<path d="M ${x+.45} ${y-.3} l -.25 .5 h .5 Z"/>` : ''}</g>`);
      }
    }
  }
  const legend = Object.entries(counts).map(([type, count]) => `${count} ${type.replace('_', ' ')}`).join(' · ') || 'Open ground';
  const levels = Object.values(elevation).filter(level => level > 0);
  const mapWidth = Math.sqrt(3) * (dimensions.cols + 0.5);
  const mapHeight = (dimensions.rows - 1) * 1.5 + 2;
  const mode = victoryModeDetails(victoryMode);
  preview.innerHTML = `<h3>${map.name}</h3><p>${map.description}</p><svg class="map-preview-grid" viewBox="0 0 ${mapWidth.toFixed(3)} ${mapHeight}" role="img" aria-label="${dimensions.cols} by ${dimensions.rows} hex terrain preview">${cells.join('')}</svg><div class="map-preview-legend">${dimensions.cols} × ${dimensions.rows} hexes · ${legend}${levels.length ? ` · ${levels.length} elevated hexes (up to level ${Math.max(...levels)})` : ''}</div><div class="map-preview-mode"><strong>${mode.label}:</strong> ${mode.guidance}</div>`;
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
  const victoryMode = document.getElementById('create-victory-select').value;
  const ruleset = document.getElementById('create-ruleset-select').value;
  let forceLimit;
  try { forceLimit = readForceLimitControls('create'); }
  catch (error) { alert(error.message); return; }
  const dropshipTonnage = forceLimit.mode === 'tonnage' ? Number.parseInt(document.getElementById('create-tonnage-select').value, 10) : null;
  if (!BT_MAPS[mapId] || (forceLimit.mode === 'tonnage' && (!Number.isFinite(dropshipTonnage) || dropshipTonnage <= 0))) return;
  await createHumanGame({ mapId, dropshipTonnage, victoryMode, ruleset, forceLimit, minefieldsEnabled: document.getElementById('create-minefields-enabled').checked });
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

async function createHumanGame({ mapId, dropshipTonnage, rosters = { '1': [], '2': [] }, beginnerScenario = null, victoryMode = 'annihilation', customScenario = null, ruleset = 'advanced_3060', forceLimit = null, minefieldsEnabled = false }) {
  const sealedForceLimit = normaliseMatchForceLimit(forceLimit || customScenario?.force_limit);
  if ((!BT_MAPS[mapId] && !BT_CUSTOM_MAPS[mapId]) || (sealedForceLimit.mode === 'tonnage' && (!Number.isFinite(dropshipTonnage) || dropshipTonnage <= 0))) return;
  showLoading(true);
  try {
    const catalogueVersion = await loadLatestUnitCatalogue();
    // Scenario labels retain the readable historical spelling. Persist the
    // exact ID in the pinned release so the server and browser agree.
    const resolvedRosters = Object.fromEntries(Object.entries(rosters).map(([seat, unitIds]) => [seat, unitIds.map(resolveCatalogueId)]));
    const code = generateGameCode();
    const dimensions = mapDimensions(mapId);
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
          map_id: mapId, map_dimensions: dimensions,
          ...(sealedForceLimit.mode === 'tonnage' ? { dropship_tonnage:dropshipTonnage } : {}),
          ...(sealedForceLimit.mode === 'bv2' ? { force_limit:sealedForceLimit, force_values:{} } : {}),
          catalogue_version: catalogueVersion,
          ruleset: BT_RULESETS?.[ruleset] ? ruleset : 'advanced_3060',
          special_ammo_setup_v1: true,
          hidden_units_v1: true,
          minefield_rules: ruleset === 'advanced_3060' ? (customScenario?.minefield_rules || { budget:minefieldsEnabled ? 40 : 0, permitted_types:minefieldsEnabled ? ['conventional','vibrabomb'] : [], permitted_densities:[10,20,30], vibrabomb_sensitivities:[20,30,40,50,60,70,80,90,100] }) : { budget:0, permitted_types:[] },
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
