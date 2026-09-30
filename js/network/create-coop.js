// ── COOP SKIRMISH CREATION (coop 1-a) ────────────────────
// Two human pilots on team A (seats 1 & 2) against a computer opponent on
// team B (seat 3). The host creates the lobby on seat 1; the friend joins on
// seat 2 through the normal game-code join flow. Team assignment is written
// into the game record at creation (state.team_assignments) — the single
// source of truth read by the server (btech_seat_team, SQL/160) and by the
// client team model (js/game/team-model.js). No code may infer a side from
// seat arithmetic.
//
// The provisional AI force reuses the existing vs-AI generator at the same
// tonnage cap, so the computer receives a comparable force (design doc Q2).
// The dropship tonnage in a coop_skirmish is the TEAM-A total across both
// pilots (decision 1), enforced as a soft cap in SQL/162.
//
// AI minefields: skipped at start for now. The server plan seeder
// (seed_ai_minefield_plan, SQL/130) places into the seat-2 zone through
// btech_scenario_zone_contains (SQL/127), which does not yet accept seat 3 —
// that zone work lands in SQL/163. Humans keep full lobby minefield planning
// on their own seats, which is seat-agnostic.

const COOP_TONNAGE_LIMITS = Object.freeze([100, 150, 200, 250]);
const COOP_AI_SEAT = 3;

function handleCreateCoop() {
  if (!currentUser) return;
  vsAiMode = false; // set true again on creation
  const mapSelect = document.getElementById('coop-map-select');
  mapSelect.innerHTML = builtInMapOptions();
  mapSelect.value = DEFAULT_MAP_ID;
  document.getElementById('coop-tonnage-select').value = '200';
  document.getElementById('coop-victory-select').value = 'annihilation';
  document.getElementById('coop-ruleset-select').value = 'advanced_3060';
  document.getElementById('coop-difficulty-select').value = aiDifficulty;
  document.getElementById('coop-personality-select').value = aiPersonality;
  document.getElementById('coop-minefields-enabled').checked = false;
  syncCoopMinefieldControls();
  renderCoopMapPreview();
  showScreen('coop-setup-screen');
}

function cancelCoopSetup() { showScreen('menu-screen'); }

function syncCoopMinefieldControls() {
  const input = document.getElementById('coop-minefields-enabled');
  if (!input) return;
  input.disabled = document.getElementById('coop-ruleset-select')?.value !== 'advanced_3060';
  if (input.disabled) input.checked = false;
}

function renderCoopMapPreview() {
  const mapId = document.getElementById('coop-map-select')?.value;
  const preview = document.getElementById('coop-map-preview');
  const map = getMapDefinition(mapId);
  if (!preview || !map) return;
  const victoryMode = document.getElementById('coop-victory-select')?.value || 'annihilation';
  const dimensions = mapDimensions(mapId), previewState = { map_id:mapId };
  const objectives = new Set(victoryMode === 'control' ? objectiveHexesForMap(mapId) : []);
  const zoneOne = new Set(victoryMode === 'breakthrough' ? scenarioDeploymentZoneHexes(1, previewState) : []);
  const zoneTwo = new Set(victoryMode === 'breakthrough' ? scenarioDeploymentZoneHexes(COOP_AI_SEAT, previewState) : []);
  const cells = [];
  const terrainCounts = {};
  for (let row = 0; row < dimensions.rows; row++) for (let col = 0; col < dimensions.cols; col++) {
    const code = hexCode(col, row), terrain = map.terrain?.[code] || 'clear', level = map.elevation?.[code] || 0;
    if (terrain !== 'clear') terrainCounts[terrain] = (terrainCounts[terrain] || 0) + 1;
    const marker = objectives.has(code) ? ' objective' : zoneOne.has(code) ? ' breakthrough-zone-one' : zoneTwo.has(code) ? ' breakthrough-zone-two' : '';
    cells.push(`<polygon class="map-preview-hex ${terrain}${level ? ' elevated' : ''}${marker}" points="${mapPreviewHexPoints(col, row)}"><title>${code}: ${terrain.replaceAll('_', ' ')}</title></polygon>`);
  }
  const mode = victoryModeDetails(victoryMode), mapWidth = Math.sqrt(3) * (dimensions.cols + .5), mapHeight = (dimensions.rows - 1) * 1.5 + 2;
  const terrainSummary = Object.entries(terrainCounts).map(([terrain, count]) => `${count} ${terrain.replaceAll('_', ' ')}`).join(' · ') || 'Open ground';
  const levels = Object.values(map.elevation || {}).filter(level => Number(level) > 0);
  preview.innerHTML = `<h3>${escapeHtml(map.name)}</h3><p>${escapeHtml(map.description)}</p><svg class="map-preview-grid" viewBox="0 0 ${mapWidth.toFixed(3)} ${mapHeight}" role="img" aria-label="${dimensions.cols} by ${dimensions.rows} hex terrain preview">${cells.join('')}</svg><div class="map-preview-legend">${dimensions.cols} × ${dimensions.rows} hexes · ${terrainSummary}${levels.length ? ` · ${levels.length} elevated hexes (up to level ${Math.max(...levels)})` : ''}</div><div class="map-preview-mode"><strong>${mode.label}:</strong> ${mode.guidance}</div>`;
}

async function handleCreateConfiguredCoop() {
  const mapId = document.getElementById('coop-map-select')?.value;
  const victoryMode = document.getElementById('coop-victory-select')?.value;
  const ruleset = document.getElementById('coop-ruleset-select')?.value;
  const dropshipTonnage = Number(document.getElementById('coop-tonnage-select')?.value);
  if (!COOP_TONNAGE_LIMITS.includes(dropshipTonnage)) return;
  setAIOpponentOptions(document.getElementById('coop-difficulty-select')?.value, document.getElementById('coop-personality-select')?.value);
  await createCoopGame({ mapId, dropshipTonnage, victoryMode, ruleset, difficulty:aiDifficulty, personality:aiPersonality, minefieldsEnabled:document.getElementById('coop-minefields-enabled')?.checked === true });
}

async function createCoopGame({ mapId, dropshipTonnage, victoryMode = 'annihilation', ruleset = 'advanced_3060', difficulty = aiDifficulty, personality = aiPersonality, minefieldsEnabled = false }) {
  if (!currentUser || (!BT_MAPS[mapId] && !BT_CUSTOM_MAPS[mapId]) || !COOP_TONNAGE_LIMITS.includes(Number(dropshipTonnage))) return;
  showLoading(true);
  try {
    const catalogueVersion = await loadLatestUnitCatalogue();
    const code = generateGameCode(), aiSeed = `${code}:${Date.now().toString(36)}:coop`;
    const validRuleset = BT_RULESETS?.[ruleset] ? ruleset : 'advanced_3060';
    const validMode = ['annihilation', 'control', 'breakthrough'].includes(victoryMode) ? victoryMode : 'annihilation';
    const entries = vsAiUnitEntries(validRuleset);
    const aiRoster = buildVsAiSuggestedForce(entries, Number(dropshipTonnage), `${aiSeed}:ai`);
    const setupState = {
      map_id:mapId, map_dimensions:mapDimensions(mapId),
      dropship_tonnage:Number(dropshipTonnage),
      ruleset:validRuleset, victory_mode:validMode,
      objective_hexes:validMode === 'control' ? objectiveHexesForMap(mapId) : [],
      objective_scores:{ '1':0,'2':0 },
      vs_ai_mode:true,
      ai_difficulty:AI_DIFFICULTY_KEYS.includes(difficulty) ? difficulty : 'beginner',
      ai_personality:AI_PERSONALITY_KEYS.includes(personality) ? personality : 'balanced',
      ai_seed:aiSeed, ai_engine_version:BT_AI_ENGINE_VERSION, ai_decisions:[],
      catalogue_version:catalogueVersion,
      special_ammo_setup_v1:true, hidden_units_v1:true,
      minefield_rules:validRuleset === 'advanced_3060' && minefieldsEnabled
        ? { budget:40, permitted_types:['conventional','vibrabomb'], permitted_densities:[10,20,30], vibrabomb_sensitivities:[20,30,40,50,60,70,80,90,100] }
        : { budget:0, permitted_types:[] },
      rosters:{ '1':[], '2':[], '3':aiRoster },
      // The single source of the seat→team mapping (SQL/160 server reader +
      // js/game/team-model.js client model). Team A = both humans, team B = AI.
      team_assignments:{ A:[1,2], B:[COOP_AI_SEAT] },
      // Default loadout permission for the friend seat (decision 5: pick_own);
      // the host can change it from the lobby panel.
      loadout_modes:{ '2':'pick_own' },
      deployment_positions:{ '1':[], '2':[], '3':buildVsAiDeployment(aiRoster, COOP_AI_SEAT, setupState) },
      units:[], turn:0, phase:'setup'
    };
    if (getMapDefinition(mapId).deployment_zones) setupState.deployment_zones = getMapDefinition(mapId).deployment_zones;
    setupState.ai_setup = { version:'coop-1a', force_format:'tonnage', generated_force:[...aiRoster], generated_deployment:[...setupState.deployment_positions['3']], minefields:'deferred to SQL/163' };
    // Resolve deployment zones through the team model with the NEW game's
    // assignments, not the browser's previous match.
    refreshCurrentTeamModel(setupState);

    const { data: game, error: gameErr } = await db.from('btech_games').insert({
      game_code:code, host_id:currentUser.id, catalogue_version:catalogueVersion,
      match_type:'coop_skirmish', state:JSON.stringify(setupState), status:'lobby', created_at:new Date().toISOString()
    }).select().single();
    if (gameErr) throw gameErr;
    currentGameId = game.id; isHost = true; isReady = false; vsAiMode = true; mySeatNumber = 1;

    // Host on seat 1 (team A). Seat 2 stays empty for the friend to join by
    // game code; the AI holds seat 3 (team B) and is always ready.
    const { error: hostErr } = await db.from('btech_players').insert({ game_id:currentGameId, user_id:currentUser.id, seat_number:1, player_color:'#c4302b', role:'player', ready:false, is_ai:false });
    if (hostErr) throw hostErr;
    const { error: aiErr } = await db.from('btech_players').insert({ game_id:currentGameId, user_id:null, seat_number:COOP_AI_SEAT, player_color:'#3060c4', role:'player', ready:true, is_ai:true });
    if (aiErr) throw aiErr;

    await loadLobby(); showScreen('lobby-screen');
    console.log('[BT-DIAG] Coop skirmish created', currentGameId, code, { mapId, dropshipTonnage, victoryMode:validMode, ruleset:validRuleset });
  } catch (err) {
    console.error('Create coop game error:', err);
    alert('Failed to create coop game: ' + (err.message || 'Unknown error'));
  } finally { showLoading(false); }
}
