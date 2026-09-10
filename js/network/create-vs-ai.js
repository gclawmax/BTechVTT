function defaultSkirmishPilot(unit) {
  const clan = techBaseForUnit(unit) === 'clan';
  return {name:'MechWarrior',gunnery:clan ? 3 : 4,piloting:clan ? 4 : 5};
}

function syncVsAiMinefieldControls() {
  const input = document.getElementById('vs-ai-minefields-enabled');
  if (!input) return;
  input.disabled = document.getElementById('vs-ai-ruleset-select')?.value !== 'advanced_3060';
  if (input.disabled) input.checked = false;
}

// ── CONFIGURABLE PLAY VS AI ───────────────────────────────
// The lobby remains a normal pinned-catalogue skirmish: the player can edit
// the suggested force and deploy it, while the AI receives a deterministic
// comparable roster and formation that a replay can reproduce from its seed.

const VS_AI_FORCE_LIMITS = Object.freeze([100, 150, 200, 250]);

function vsAiHash(seed) {
  let value = 2166136261;
  for (const char of String(seed || 'vs-ai')) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return (value >>> 0) / 4294967296;
}

function vsAiUnitEntries(ruleset) {
  return Object.entries(BT_UNIT_CATALOGUE || {})
    .filter(([unitId, unit]) => isSupportedUnit(unitId) && !unit?.customDesign && Number(unit?.tonnage || 0) > 0 && Number(unit?.movement?.walk || 0) > 0 && unitRulesetStatus(unitId, unit, ruleset).allowed)
    .sort(([left], [right]) => left.localeCompare(right));
}

function buildVsAiSuggestedForce(entries, tonnageLimit, seed, excluded = new Set()) {
  const candidates = entries.filter(([unitId, unit]) => !excluded.has(unitId) && Number(unit.tonnage) <= tonnageLimit);
  if (!candidates.length) throw new Error('The selected ruleset has no supported BattleMech within this force limit.');
  const desiredCount = Math.max(1, Math.min(4, Math.round(tonnageLimit / 85)));
  const picked = [];
  let remaining = tonnageLimit;
  for (let index = 0; index < desiredCount; index++) {
    const legal = candidates.filter(([unitId, unit]) => !picked.includes(unitId) && Number(unit.tonnage) <= remaining);
    if (!legal.length) break;
    const desiredMass = remaining / Math.max(1, desiredCount - index);
    legal.sort(([leftId, left], [rightId, right]) => {
      const leftScore = Math.abs(Number(left.tonnage) - desiredMass) + vsAiHash(`${seed}:${index}:${leftId}`) * 14;
      const rightScore = Math.abs(Number(right.tonnage) - desiredMass) + vsAiHash(`${seed}:${index}:${rightId}`) * 14;
      return leftScore - rightScore;
    });
    const unitId = legal[0][0];
    picked.push(unitId);
    remaining -= Number(getSupportedUnit(unitId)?.tonnage || 0);
  }
  return picked.length ? picked : [candidates[0][0]];
}

function buildVsAiSuggestedBvForce(entries, bvLimit, seed, excluded = new Set()) {
  const cost = unit => bv2EntryValue(unit, defaultSkirmishPilot(unit))?.adjusted || Infinity;
  const candidates = entries.filter(([unitId, unit]) => !excluded.has(unitId) && Number(unit?.battleValue?.stock || 0) > 0 && cost(unit) <= bvLimit);
  if (!candidates.length) throw new Error('The selected ruleset has no BattleMech with a verified BV2 value inside this limit.');
  const desiredCount = Math.max(1, Math.min(4, Math.round(bvLimit / 2200)));
  const selected = [], seen = new Set();
  let remaining = bvLimit;
  for (let index = 0; index < desiredCount; index++) {
    const legal = candidates.filter(([unitId, unit]) => !seen.has(unitId) && cost(unit) <= remaining);
    if (!legal.length) break;
    const desiredValue = remaining / Math.max(1, desiredCount - index);
    legal.sort(([leftId, left], [rightId, right]) => {
      const leftScore = Math.abs(cost(left) - desiredValue) + vsAiHash(`${seed}:bv:${index}:${leftId}`) * 260;
      const rightScore = Math.abs(cost(right) - desiredValue) + vsAiHash(`${seed}:bv:${index}:${rightId}`) * 260;
      return leftScore - rightScore;
    });
    const picked = legal[0];
    selected.push(picked[0]); seen.add(picked[0]); remaining -= cost(picked[1]);
  }
  return selected.length ? selected : [candidates[0][0]];
}

function bv2ForceSnapshot(roster) {
  const entries = (roster || []).map(unitId => {
    const unit = getSupportedUnit(unitId), value = bv2EntryValue(unit, defaultSkirmishPilot(unit));
    return value ? { unit_id:unitId, stock:value.stock, adjusted:value.adjusted, gunnery:value.gunnery, piloting:value.piloting, pilot_multiplier:BV2_SKILL_MULTIPLIERS[value.gunnery][value.piloting] } : null;
  });
  if (entries.some(entry => !entry)) throw new Error('A selected BattleMech is BV pending. Choose only verified catalogue BattleMechs for this BV2 match.');
  return { system:'BV2', bv_version:'BV2.1', stock:entries.reduce((sum, entry) => sum + entry.stock, 0), adjusted:entries.reduce((sum, entry) => sum + entry.adjusted, 0), entries };
}

function vsAiHexCoordinates(code) {
  const value = String(code || '');
  return /^\d{4}$/.test(value) ? { col:Number(value.slice(0, 2)), row:Number(value.slice(2, 4)) } : null;
}

function buildVsAiDeployment(roster, seat, state) {
  const mapId = state?.map_id || DEFAULT_MAP_ID;
  const map = getMapDefinition(mapId);
  const zone = scenarioDeploymentZoneHexes(seat, state).map(vsAiHexCoordinates).filter(Boolean)
    .filter(({ col, row }) => !['building', 'impassable', 'magma_liquid', 'deep_water'].includes(map.terrain?.[hexCode(col, row)] || 'clear'));
  if (zone.length < roster.length) throw new Error('This battlefield has too few legal deployment hexes for the selected force.');
  const objectives = state?.victory_mode === 'control' ? objectiveHexesForMap(mapId).map(vsAiHexCoordinates).filter(Boolean)
    : state?.victory_mode === 'breakthrough' ? scenarioDeploymentZoneHexes(seat === 1 ? 2 : 1, state).map(vsAiHexCoordinates).filter(Boolean) : [];
  const selected = [];
  for (let index = 0; index < roster.length; index++) {
    const target = objectives[index % Math.max(1, objectives.length)] || { col:seat === 1 ? mapDimensions(mapId).cols - 1 : 0, row:Math.round(mapDimensions(mapId).rows / 2) };
    const available = zone.filter(candidate => !selected.some(chosen => chosen.col === candidate.col && chosen.row === candidate.row));
    available.sort((left, right) => Math.abs(left.row - target.row) + Math.abs(left.col - target.col) * .2 - Math.abs(right.row - target.row) - Math.abs(right.col - target.col) * .2 || left.row - right.row || left.col - right.col);
    selected.push({ ...available[0], facing:seat === 1 ? 0 : 3, hidden:false });
  }
  return selected;
}

function renderVsAIMapPreview() {
  const mapId = document.getElementById('vs-ai-map-select')?.value;
  const preview = document.getElementById('vs-ai-map-preview');
  const map = getMapDefinition(mapId);
  if (!preview || !map) return;
  const victoryMode = document.getElementById('vs-ai-victory-select')?.value || 'annihilation';
  const dimensions = mapDimensions(mapId), previewState = { map_id:mapId };
  const objectives = new Set(victoryMode === 'control' ? objectiveHexesForMap(mapId) : []);
  const zoneOne = new Set(victoryMode === 'breakthrough' ? scenarioDeploymentZoneHexes(1, previewState) : []);
  const zoneTwo = new Set(victoryMode === 'breakthrough' ? scenarioDeploymentZoneHexes(2, previewState) : []);
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

function handleCreateVsAI() {
  if (!currentUser) return;
  updateAIOpponentOptions();
  const mapSelect = document.getElementById('vs-ai-map-select');
  mapSelect.innerHTML = builtInMapOptions();
  mapSelect.value = DEFAULT_MAP_ID;
  document.getElementById('vs-ai-tonnage-select').value = '200';
  document.getElementById('vs-ai-force-format-select').value = 'tonnage';
  document.getElementById('vs-ai-bv-limit-select').value = '5000';
  syncForceFormatControls('vs-ai');
  document.getElementById('vs-ai-victory-select').value = 'annihilation';
  document.getElementById('vs-ai-ruleset-select').value = 'advanced_3060';
  document.getElementById('vs-ai-difficulty-setup-select').value = aiDifficulty;
  document.getElementById('vs-ai-personality-setup-select').value = aiPersonality;
  document.getElementById('vs-ai-minefields-enabled').checked = false;
  syncVsAiMinefieldControls();
  renderVsAIMapPreview();
  showScreen('vs-ai-setup-screen');
}

function cancelVsAISetup() { showScreen('menu-screen'); }

async function handleCreateConfiguredVsAI() {
  const mapId = document.getElementById('vs-ai-map-select')?.value;
  const victoryMode = document.getElementById('vs-ai-victory-select')?.value;
  const ruleset = document.getElementById('vs-ai-ruleset-select')?.value;
  let forceLimit;
  try { forceLimit = readForceLimitControls('vs-ai'); }
  catch (error) { alert(error.message); return; }
  const dropshipTonnage = forceLimit.mode === 'tonnage' ? Number(document.getElementById('vs-ai-tonnage-select')?.value) : null;
  setAIOpponentOptions(document.getElementById('vs-ai-difficulty-setup-select')?.value, document.getElementById('vs-ai-personality-setup-select')?.value);
  await createVsAIGame({ mapId, dropshipTonnage, victoryMode, ruleset, difficulty:aiDifficulty, personality:aiPersonality, forceLimit, minefieldsEnabled:document.getElementById('vs-ai-minefields-enabled')?.checked === true });
}

async function createVsAIGame({ mapId, dropshipTonnage, victoryMode = 'annihilation', ruleset = 'advanced_3060', difficulty = aiDifficulty, personality = aiPersonality, customScenario = null, forceLimit = null, minefieldsEnabled = false }) {
  const sealedForceLimit = normaliseMatchForceLimit(forceLimit || customScenario?.force_limit);
  if (!currentUser || (!BT_MAPS[mapId] && !BT_CUSTOM_MAPS[mapId]) || (sealedForceLimit.mode === 'tonnage' && !VS_AI_FORCE_LIMITS.includes(Number(dropshipTonnage)))) return;
  showLoading(true);
  try {
    const catalogueVersion = await loadLatestUnitCatalogue();
    const code = generateGameCode(), aiSeed = `${code}:${Date.now().toString(36)}`;
    const validRuleset = BT_RULESETS?.[ruleset] ? ruleset : 'advanced_3060';
    const validMode = ['annihilation', 'control', 'breakthrough'].includes(victoryMode) ? victoryMode : 'annihilation';
    const entries = vsAiUnitEntries(validRuleset);
    const humanRoster = sealedForceLimit.mode === 'bv2' ? buildVsAiSuggestedBvForce(entries, sealedForceLimit.limit, `${aiSeed}:human`) : buildVsAiSuggestedForce(entries, Number(dropshipTonnage), `${aiSeed}:human`);
    const aiRoster = sealedForceLimit.mode === 'bv2' ? buildVsAiSuggestedBvForce(entries, sealedForceLimit.limit, `${aiSeed}:ai`, new Set(humanRoster)) : buildVsAiSuggestedForce(entries, Number(dropshipTonnage), `${aiSeed}:ai`, new Set(humanRoster));
    const setupState = { map_id:mapId, map_dimensions:mapDimensions(mapId), ...(sealedForceLimit.mode === 'tonnage' ? { dropship_tonnage:Number(dropshipTonnage) } : {}), ...(sealedForceLimit.mode === 'bv2' ? { force_limit:sealedForceLimit, force_values:{ '1':bv2ForceSnapshot(humanRoster), '2':bv2ForceSnapshot(aiRoster) } } : {}), ruleset:validRuleset, victory_mode:validMode, objective_hexes:validMode === 'control' ? objectiveHexesForMap(mapId) : [], objective_scores:{ '1':0,'2':0 }, vs_ai_mode:true, ai_difficulty:AI_DIFFICULTY_KEYS.includes(difficulty) ? difficulty : 'beginner', ai_personality:AI_PERSONALITY_KEYS.includes(personality) ? personality : 'balanced', ai_seed:aiSeed, ai_engine_version:BT_AI_ENGINE_VERSION, ai_decisions:[], catalogue_version:catalogueVersion, special_ammo_setup_v1:true, hidden_units_v1:true, minefield_rules:validRuleset === 'advanced_3060' && (customScenario?.minefield_rules || minefieldsEnabled) ? (customScenario?.minefield_rules || { budget:40, permitted_types:['conventional','vibrabomb'], permitted_densities:[10,20,30], vibrabomb_sensitivities:[20,30,40,50,60,70,80,90,100] }) : {budget:0,permitted_types:[]}, rosters:{ '1':humanRoster, '2':aiRoster }, deployment_positions:{}, units:[], turn:0, phase:'setup' };
    const humanHangar = humanRoster.map((unitId, index) => ({ id:`vsai-human-${index + 1}`, unit_id:unitId, pilot:{ id:`vsai-human-pilot-${index + 1}`, ...defaultSkirmishPilot(getSupportedUnit(unitId)) } }));
    setupState.skirmish_avatars = { '1':{ id:`skirmish-${code}-p1`, callsign:'Skirmish Commander P1', gunnery:4, piloting:5, hangar:humanHangar, deployed:humanHangar.map(entry => entry.id) } };
    const aiHangar = aiRoster.map((unitId,index) => ({id:`vsai-enemy-${index+1}`,unit_id:unitId,pilot:{id:`vsai-enemy-pilot-${index+1}`,...defaultSkirmishPilot(getSupportedUnit(unitId))}}));
    setupState.skirmish_avatars['2'] = {id:`skirmish-${code}-p2`,callsign:'AI Opponent',hangar:aiHangar,deployed:aiHangar.map(entry=>entry.id)};
    if (getMapDefinition(mapId).deployment_zones) setupState.deployment_zones = getMapDefinition(mapId).deployment_zones;
    const customTerrain = customScenario?.terrain && typeof customScenario.terrain === 'object' ? customScenario.terrain : null;
    if (customScenario) Object.assign(setupState, { custom_scenario:customScenario, terrain_overrides:customTerrain || {}, elevation_overrides:customScenario.elevation || {}, deployment_zones:customScenario.deployment_zones, building_cf:Object.fromEntries(Object.entries(customTerrain || {}).filter(([, terrain]) => terrain === 'building').map(([hex]) => [hex, 40])) });
    setupState.deployment_positions['1'] = buildVsAiDeployment(humanRoster, 1, setupState);
    setupState.deployment_positions['2'] = buildVsAiDeployment(aiRoster, 2, setupState);
    setupState.ai_setup = { version:'bv3', force_format:sealedForceLimit, generated_force:[...aiRoster], generated_deployment:[...setupState.deployment_positions['2']], minefields:'server-private after lobby start' };
    const { data: game, error: gameErr } = await db.from('btech_games').insert({ game_code:code, host_id:currentUser.id, catalogue_version:catalogueVersion, state:JSON.stringify(setupState), status:'lobby', created_at:new Date().toISOString() }).select().single();
    if (gameErr) throw gameErr;
    currentGameId = game.id; isHost = true; isReady = true; vsAiMode = true; mySeatNumber = 1;
    const { error: humanPlayerErr } = await db.from('btech_players').insert({ game_id:currentGameId, user_id:currentUser.id, seat_number:1, player_color:'#c4302b', role:'player', ready:true, is_ai:false });
    if (humanPlayerErr) throw humanPlayerErr;
    const { error: aiPlayerErr } = await db.from('btech_players').insert({ game_id:currentGameId, user_id:null, seat_number:2, player_color:'#3060c4', role:'player', ready:true, is_ai:true });
    if (aiPlayerErr) throw aiPlayerErr;
    await loadLobby(); showScreen('lobby-screen');
    console.log('[BT-DIAG] Configured AI game created', currentGameId, code, { mapId, dropshipTonnage, victoryMode:validMode, ruleset:validRuleset });
  } catch (err) {
    console.error('Create configured AI game error:', err);
    alert('Failed to create AI game: ' + (err.message || 'Unknown error'));
  } finally { showLoading(false); }
}
