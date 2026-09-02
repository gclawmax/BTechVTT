// Player-facing variable-size battlefield and scenario editor. A launched scenario is
// saved as an immutable server snapshot, then follows the normal two-player
// lobby, roster and deployment flow.

const SCENARIO_EDITOR_STORAGE_KEY = 'btech-vtt-scenario-editor-v1';
const SCENARIO_TERRAIN = Object.freeze([
  ['clear', 'Clear'], ['light_woods', 'Light Woods'], ['heavy_woods', 'Heavy Woods'],
  ['rough', 'Rough'], ['rubble', 'Rubble'], ['pavement', 'Pavement'],
  ['shallow_water', 'Shallow Water'], ['deep_water', 'Deep Water'],
  ['building', 'Building'], ['fire', 'Fire'], ['light_smoke', 'Light Smoke'],
  ['heavy_smoke', 'Heavy Smoke'], ['ice', 'Ice'], ['deep_snow', 'Deep Snow'],
  ['mud', 'Mud'], ['sand', 'Sand'], ['swamp', 'Swamp'], ['bridge', 'Bridge'],
  ['magma_crust', 'Magma Crust'], ['magma_liquid', 'Liquid Magma'], ['impassable', 'Impassable']
]);
const SCENARIO_TERRAIN_KEYS = new Set(SCENARIO_TERRAIN.map(([key]) => key));
let scenarioEditorState = null;
let scenarioEditorTool = { type: 'terrain', value: 'light_woods' };
let scenarioEditorPainting = false;

const SCENARIO_SIZE_PRESETS = Object.freeze([
  ['single', 16, 17, 'Standard single sheet · 16 × 17'],
  ['dual-vertical', 16, 34, 'Dual sheets end-to-end · 16 × 34'],
  ['dual-horizontal', 32, 17, 'Dual sheets side-by-side · 32 × 17'],
  ['custom', null, null, 'Custom size']
]);
function scenarioEditorDimensions() {
  const cols = Number(scenarioEditorState?.columns), rows = Number(scenarioEditorState?.rows);
  return { cols: Number.isInteger(cols) && cols >= 8 && cols <= 48 ? cols : 16, rows: Number.isInteger(rows) && rows >= 8 && rows <= 48 ? rows : 17 };
}
function scenarioEditorHexValidFor(code, dimensions = scenarioEditorDimensions()) {
  const match = /^(\d{2})(\d{2})$/.exec(String(code));
  return Boolean(match) && Number(match[1]) >= 0 && Number(match[1]) < dimensions.cols && Number(match[2]) >= 0 && Number(match[2]) < dimensions.rows;
}

function defaultScenarioDeploymentZones() {
  const zones = { '1': [], '2': [] };
  const { cols, rows } = scenarioEditorDimensions();
  const depth = Math.max(2, Math.min(5, Math.floor(cols / 3)));
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    if (col < depth) zones['1'].push(hexCode(col, row));
    if (col >= cols - depth) zones['2'].push(hexCode(col, row));
  }
  return zones;
}

function newScenarioEditorState() {
  return {
    schema_version: 1,
    name: 'New Battlefield',
    description: 'A custom 16 × 17 BattleTech battlefield.',
    columns: 16, rows: 17, generation_seed: '',
    instructions: 'Choose forces, deploy in your marked zone, and complete the selected victory condition.',
    dropship_tonnage: 200,
    victory_mode: 'annihilation',
    terrain: {}, elevation: {},
    deployment_zones: defaultScenarioDeploymentZones(),
    objective_hexes: []
  };
}

function scenarioEditorEscape(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function scenarioEditorHexValid(code) { return scenarioEditorHexValidFor(code); }

function normalizeScenarioDefinition(input) {
  const source = input && typeof input === 'object' ? input : {};
  const columns = Number(source.columns ?? source.cols), rows = Number(source.rows);
  const dimensions = { cols: Number.isInteger(columns) && columns >= 8 && columns <= 48 ? columns : 16, rows: Number.isInteger(rows) && rows >= 8 && rows <= 48 ? rows : 17 };
  const valid = code => scenarioEditorHexValidFor(code, dimensions);
  const zones = source.deployment_zones && typeof source.deployment_zones === 'object' ? source.deployment_zones : defaultScenarioDeploymentZones();
  const terrain = Object.fromEntries(Object.entries(source.terrain || {}).filter(([code, type]) => valid(code) && SCENARIO_TERRAIN_KEYS.has(type) && type !== 'clear'));
  const elevation = Object.fromEntries(Object.entries(source.elevation || {}).filter(([code, level]) => valid(code) && Number.isInteger(Number(level)) && Number(level) >= 0 && Number(level) <= 3 && Number(level) !== 0).map(([code, level]) => [code, Number(level)]));
  const cleanZone = seat => [...new Set((Array.isArray(zones[String(seat)]) ? zones[String(seat)] : []).filter(valid))];
  const zoneOne = cleanZone(1);
  const zoneOneSet = new Set(zoneOne);
  return {
    schema_version: 1,
    name: String(source.name || 'New Battlefield').trim().slice(0, 80) || 'New Battlefield',
    description: String(source.description || '').trim().slice(0, 240),
    columns: dimensions.cols, rows: dimensions.rows,
    generation_seed: String(source.generation_seed || '').slice(0, 64),
    instructions: String(source.instructions || '').trim().slice(0, 600),
    dropship_tonnage: [100, 150, 200, 250].includes(Number(source.dropship_tonnage)) ? Number(source.dropship_tonnage) : 200,
    victory_mode: ['annihilation', 'control', 'breakthrough'].includes(source.victory_mode) ? source.victory_mode : 'annihilation',
    terrain, elevation,
    deployment_zones: { '1': zoneOne, '2': cleanZone(2).filter(code => !zoneOneSet.has(code)) },
    objective_hexes: [...new Set((Array.isArray(source.objective_hexes) ? source.objective_hexes : []).filter(valid))]
  };
}

function validateScenarioDefinition(definition) {
  const errors = [];
  if (!definition.name.trim()) errors.push('Give the scenario a name.');
  for (const seat of ['1', '2']) {
    if (!definition.deployment_zones[seat].length) errors.push(`Player ${seat} needs at least one deployment hex.`);
    const usable = definition.deployment_zones[seat].filter(code => !['building', 'impassable', 'magma_liquid'].includes(definition.terrain[code] || 'clear'));
    if (!usable.length) errors.push(`Player ${seat}'s deployment zone needs a passable hex.`);
  }
  if (definition.victory_mode === 'control' && !definition.objective_hexes.length) errors.push('Objective Control needs at least one objective hex.');
  if (definition.objective_hexes.some(code => ['building', 'impassable', 'magma_liquid'].includes(definition.terrain[code] || 'clear'))) errors.push('Objectives must be placed on passable hexes.');
  return errors;
}

function openScenarioEditor() {
  const saved = localStorage.getItem(SCENARIO_EDITOR_STORAGE_KEY);
  try { scenarioEditorState = saved ? normalizeScenarioDefinition(JSON.parse(saved)) : newScenarioEditorState(); }
  catch { scenarioEditorState = newScenarioEditorState(); }
  scenarioEditorTool = { type: 'terrain', value: 'light_woods' };
  showScreen('scenario-editor-screen');
  renderScenarioEditor();
}

function scenarioEditorResize(columns, rows) {
  if (!scenarioEditorState) return;
  const old = scenarioEditorState;
  scenarioEditorState = normalizeScenarioDefinition({ ...old, columns, rows, deployment_zones: { '1': [], '2': [] } });
  scenarioEditorState.deployment_zones = defaultScenarioDeploymentZones();
  renderScenarioEditor();
}
function scenarioEditorSetSizePreset(value) {
  const preset = SCENARIO_SIZE_PRESETS.find(([id]) => id === value);
  if (preset?.[1]) scenarioEditorResize(preset[1], preset[2]);
}
function scenarioEditorApplyCustomSize() {
  scenarioEditorResize(Number(document.getElementById('scenario-columns')?.value), Number(document.getElementById('scenario-rows')?.value));
}
function seededRandom(seed) { let value = 2166136261; for (const char of String(seed)) value = Math.imul(value ^ char.charCodeAt(0), 16777619); return () => { value += 0x6D2B79F5; let t = value; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function generateScenarioEditorMap() {
  if (!scenarioEditorState) return;
  const seed = String(document.getElementById('scenario-seed')?.value || `${Date.now()}`), pattern = document.getElementById('scenario-pattern')?.value || 'balanced', mirror = Boolean(document.getElementById('scenario-symmetry')?.checked); const density = Number(document.getElementById('scenario-density')?.value || 25) / 100;
  const random = seededRandom(seed), { cols, rows } = scenarioEditorDimensions(), terrain = {}, elevation = {};
  const deployDepth = Math.max(2, Math.min(5, Math.floor(cols / 3)));
  const place = (col, row, type, level = 0) => { if (col < deployDepth || col >= cols - deployDepth || row < 0 || row >= rows) return; const code = hexCode(col, row); if (type) terrain[code] = type; if (level) elevation[code] = level; if (mirror) { const mirrorCode = hexCode(cols - 1 - col, row); if (type) terrain[mirrorCode] = type; if (level) elevation[mirrorCode] = level; } };
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    if (col < deployDepth || col >= cols - deployDepth) continue;
    const roll = random(); const code = hexCode(col, row);
    if (pattern === 'urban') { if (roll < density * .22) terrain[code] = 'pavement'; else if (roll < density * .30) terrain[code] = 'rubble'; else if (roll < density * .34) terrain[code] = 'building'; }
    else if (roll < density * .36) terrain[code] = 'light_woods'; else if (roll < density * .52) terrain[code] = 'rough'; else if (roll < density * .61) terrain[code] = 'heavy_woods'; else if (roll < density * .68) terrain[code] = 'shallow_water'; else if (roll < density * .73) terrain[code] = 'rubble';
    if (random() < density * .24) elevation[code] = random() < .22 ? 2 : 1;
  }
  if (pattern === 'ridge') for (let row = 1; row < rows - 1; row++) place(Math.floor(cols / 2) + (row % 3 - 1), row, 'rough', row % 4 === 0 ? 2 : 1);
  if (pattern === 'river') for (let row = 0; row < rows; row++) { const col = Math.floor(cols / 2) + (row % 4 === 0 ? 1 : 0); place(col, row, 'shallow_water'); if (row % 5 === 2) place(col, row, 'bridge'); }
  scenarioEditorState.terrain = terrain; scenarioEditorState.elevation = elevation; scenarioEditorState.generation_seed = seed; scenarioEditorState.deployment_zones = defaultScenarioDeploymentZones();
  renderScenarioEditor();
}

function closeScenarioEditor() { showScreen('menu-screen'); }

function scenarioEditorSetField(field, value) {
  if (!scenarioEditorState) return;
  scenarioEditorState[field] = field === 'dropship_tonnage' ? Number(value) : value;
  const status = document.getElementById('scenario-editor-status');
  if (status) status.textContent = '';
  if (field === 'victory_mode') renderScenarioEditorMap();
}

function selectScenarioEditorTool(type, value) {
  scenarioEditorTool = { type, value };
  document.querySelectorAll('[data-scenario-tool]').forEach(button => button.classList.toggle('selected', button.dataset.scenarioTool === `${type}:${value}`));
}

function scenarioEditorApplyHex(code) {
  if (!scenarioEditorState || !scenarioEditorHexValid(code)) return;
  const { type, value } = scenarioEditorTool;
  if (type === 'terrain') {
    if (value === 'clear') delete scenarioEditorState.terrain[code]; else scenarioEditorState.terrain[code] = value;
  } else if (type === 'elevation') {
    if (Number(value) === 0) delete scenarioEditorState.elevation[code]; else scenarioEditorState.elevation[code] = Number(value);
  } else if (type === 'zone') {
    const own = String(value), other = own === '1' ? '2' : '1';
    scenarioEditorState.deployment_zones[other] = scenarioEditorState.deployment_zones[other].filter(item => item !== code);
    const selected = new Set(scenarioEditorState.deployment_zones[own]);
    if (selected.has(code)) selected.delete(code); else selected.add(code);
    scenarioEditorState.deployment_zones[own] = [...selected];
  } else if (type === 'objective') {
    const selected = new Set(scenarioEditorState.objective_hexes);
    if (selected.has(code)) selected.delete(code); else selected.add(code);
    scenarioEditorState.objective_hexes = [...selected];
  }
  renderScenarioEditorMap();
}

function scenarioEditorHexPoints(col, row) {
  const root3 = Math.sqrt(3);
  const x = root3 * (col + 0.5 * (row & 1)) + root3 / 2;
  const y = row * 1.5 + 1;
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (60 * index + 30) * Math.PI / 180;
    return `${(x + Math.cos(angle)).toFixed(3)},${(y + Math.sin(angle)).toFixed(3)}`;
  }).join(' ');
}

function renderScenarioEditorMap() {
  const target = document.getElementById('scenario-editor-map');
  if (!target || !scenarioEditorState) return;
  const zoneOne = new Set(scenarioEditorState.deployment_zones['1']);
  const zoneTwo = new Set(scenarioEditorState.deployment_zones['2']);
  const objectives = new Set(scenarioEditorState.objective_hexes);
  const cells = [];
  const { cols, rows } = scenarioEditorDimensions();
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const code = hexCode(col, row), terrain = scenarioEditorState.terrain[code] || 'clear', level = scenarioEditorState.elevation[code] || 0;
    const zone = zoneOne.has(code) ? 'zone-one' : zoneTwo.has(code) ? 'zone-two' : '';
    const objective = objectives.has(code);
    cells.push(`<g class="scenario-editor-cell" data-code="${code}"><polygon class="scenario-editor-hex ${terrain} ${zone} ${objective ? 'objective' : ''}" points="${scenarioEditorHexPoints(col,row)}"><title>${code} · ${terrain.replaceAll('_',' ')} · level ${level}${zone ? ` · ${zone.replace('-',' ')}` : ''}${objective ? ' · objective' : ''}</title></polygon><text class="scenario-editor-code" x="${(Math.sqrt(3) * (col + 0.5 * (row & 1)) + Math.sqrt(3) / 2).toFixed(3)}" y="${(row * 1.5 + 1.08).toFixed(3)}">${code}</text>${level ? `<text class="scenario-editor-level" x="${(Math.sqrt(3) * (col + 0.5 * (row & 1)) + Math.sqrt(3) / 2).toFixed(3)}" y="${(row * 1.5 + 1.48).toFixed(3)}">L${level}</text>` : ''}${objective ? `<text class="scenario-editor-objective" x="${(Math.sqrt(3) * (col + 0.5 * (row & 1)) + Math.sqrt(3) / 2).toFixed(3)}" y="${(row * 1.5 + .67).toFixed(3)}">◆</text>` : ''}</g>`);
  }
  const mapWidth = Math.sqrt(3) * (cols + .5), mapHeight = (rows - 1) * 1.5 + 2;
  target.innerHTML = `<svg viewBox="0 0 ${mapWidth.toFixed(3)} ${mapHeight}" aria-label="Custom battlefield editor">${cells.join('')}</svg>`;
  target.querySelectorAll('.scenario-editor-cell').forEach(cell => {
    cell.addEventListener('pointerdown', event => { event.preventDefault(); scenarioEditorPainting = true; scenarioEditorApplyHex(cell.dataset.code); });
    cell.addEventListener('pointerenter', () => { if (scenarioEditorPainting && ['terrain', 'elevation'].includes(scenarioEditorTool.type)) scenarioEditorApplyHex(cell.dataset.code); });
  });
}

function renderScenarioEditor() {
  const root = document.getElementById('scenario-editor-root');
  if (!root || !scenarioEditorState) return;
  const terrainButtons = SCENARIO_TERRAIN.map(([key, label]) => `<button data-scenario-tool="terrain:${key}" class="scenario-tool terrain-${key}${scenarioEditorTool.type === 'terrain' && scenarioEditorTool.value === key ? ' selected' : ''}" onclick="selectScenarioEditorTool('terrain','${key}')">${label}</button>`).join('');
  const elevationButtons = [0, 1, 2, 3].map(level => `<button data-scenario-tool="elevation:${level}" class="scenario-tool${scenarioEditorTool.type === 'elevation' && Number(scenarioEditorTool.value) === level ? ' selected' : ''}" onclick="selectScenarioEditorTool('elevation','${level}')">Level ${level}</button>`).join('');
  const dimensions = scenarioEditorDimensions(), presetId = SCENARIO_SIZE_PRESETS.find(([, cols, rows]) => cols === dimensions.cols && rows === dimensions.rows)?.[0] || 'custom';
  root.innerHTML = `<header class="scenario-editor-header"><div><h2>Map & Scenario Editor</h2><p>Paint a ${dimensions.cols} × ${dimensions.rows} battlefield, mark deployment zones and choose the victory condition.</p></div><button class="secondary" onclick="closeScenarioEditor()">Back to Dropship</button></header>
    <div class="scenario-editor-layout"><aside class="scenario-editor-sidebar">
      <label>Name<input maxlength="80" value="${scenarioEditorEscape(scenarioEditorState.name)}" oninput="scenarioEditorSetField('name',this.value)"></label>
      <label>Map size<select onchange="scenarioEditorSetSizePreset(this.value)">${SCENARIO_SIZE_PRESETS.map(([id,, , label]) => `<option value="${id}" ${id === presetId ? 'selected' : ''}>${label}</option>`).join('')}</select></label><div class="scenario-editor-size-row"><label>Columns<input id="scenario-columns" type="number" min="8" max="48" value="${dimensions.cols}"></label><label>Rows<input id="scenario-rows" type="number" min="8" max="48" value="${dimensions.rows}"></label><button onclick="scenarioEditorApplyCustomSize()">Resize</button></div>
      <label>Description<textarea maxlength="240" oninput="scenarioEditorSetField('description',this.value)">${scenarioEditorEscape(scenarioEditorState.description)}</textarea></label>
      <label>Player instructions<textarea maxlength="600" oninput="scenarioEditorSetField('instructions',this.value)">${scenarioEditorEscape(scenarioEditorState.instructions)}</textarea></label>
      <label>Tonnage per player<select onchange="scenarioEditorSetField('dropship_tonnage',this.value)">${[100,150,200,250].map(value => `<option value="${value}" ${scenarioEditorState.dropship_tonnage === value ? 'selected' : ''}>${value} tons</option>`).join('')}</select></label>
      <label>Victory condition<select onchange="scenarioEditorSetField('victory_mode',this.value)"><option value="annihilation" ${scenarioEditorState.victory_mode === 'annihilation' ? 'selected' : ''}>Annihilation</option><option value="control" ${scenarioEditorState.victory_mode === 'control' ? 'selected' : ''}>Objective Control</option><option value="breakthrough" ${scenarioEditorState.victory_mode === 'breakthrough' ? 'selected' : ''}>Breakthrough</option></select></label>
      <label>Generation seed<input id="scenario-seed" maxlength="64" value="${scenarioEditorEscape(scenarioEditorState.generation_seed)}"></label><label>Terrain density<select id="scenario-density"><option value="15">Light</option><option value="25" selected>Balanced</option><option value="40">Dense</option></select></label><label>Terrain pattern<select id="scenario-pattern"><option value="balanced">Balanced terrain</option><option value="ridge">Ridge line</option><option value="river">River crossing</option><option value="urban">Industrial district</option></select></label><label class="scenario-editor-check"><input id="scenario-symmetry" type="checkbox" checked> Mirror for a fair duel</label><button class="scenario-generate" onclick="generateScenarioEditorMap()">Generate Terrain</button><div class="scenario-editor-file-actions"><button onclick="saveScenarioEditorDraft()">Save Draft</button><button onclick="exportScenarioEditor()">Export JSON</button><label class="scenario-import-button">Import JSON<input id="scenario-import-input" type="file" accept="application/json,.json" onchange="importScenarioEditor(this.files[0])"></label></div>
      <button class="scenario-launch" onclick="launchScenarioEditorMatch()">Create Two-Player Lobby</button><div id="scenario-editor-status" role="status"></div>
    </aside><main class="scenario-editor-workspace"><div class="scenario-editor-tools"><section><strong>Terrain</strong><div>${terrainButtons}</div></section><section><strong>Elevation</strong><div>${elevationButtons}</div></section><section><strong>Scenario markers</strong><div><button data-scenario-tool="zone:1" class="scenario-tool zone-one-tool" onclick="selectScenarioEditorTool('zone','1')">Player 1 Deployment</button><button data-scenario-tool="zone:2" class="scenario-tool zone-two-tool" onclick="selectScenarioEditorTool('zone','2')">Player 2 Deployment</button><button data-scenario-tool="objective:toggle" class="scenario-tool objective-tool" onclick="selectScenarioEditorTool('objective','toggle')">Objective</button></div></section><section><strong>Starting layout</strong><div><select id="scenario-template-map">${Object.entries(BT_MAPS).map(([id,map]) => `<option value="${id}">${scenarioEditorEscape(map.name)}</option>`).join('')}</select><button onclick="loadScenarioEditorTemplate()">Load Built-in Map</button><button onclick="clearScenarioEditorMap()">Clear Map</button></div></section></div><div id="scenario-editor-map"></div><p class="scenario-editor-help">Click or drag to paint terrain/elevation. Deployment and objective tools toggle one hex at a time. Blue is Player 1; red is Player 2; ◆ marks objectives.</p></main></div>`;
  renderScenarioEditorMap();
}

function loadScenarioEditorTemplate() {
  const id = document.getElementById('scenario-template-map')?.value || DEFAULT_MAP_ID;
  const map = getMapDefinition(id);
  scenarioEditorState.terrain = { ...(map.terrain || {}) };
  scenarioEditorState.elevation = { ...(map.elevation || {}) };
  scenarioEditorState.name = `${map.name} Custom Scenario`;
  scenarioEditorState.description = map.description || scenarioEditorState.description;
  renderScenarioEditor();
}

function clearScenarioEditorMap() {
  scenarioEditorState.terrain = {};
  scenarioEditorState.elevation = {};
  scenarioEditorState.objective_hexes = [];
  scenarioEditorState.deployment_zones = defaultScenarioDeploymentZones();
  renderScenarioEditor();
}

function saveScenarioEditorDraft() {
  scenarioEditorState = normalizeScenarioDefinition(scenarioEditorState);
  localStorage.setItem(SCENARIO_EDITOR_STORAGE_KEY, JSON.stringify(scenarioEditorState));
  const status = document.getElementById('scenario-editor-status');
  if (status) status.textContent = 'Draft saved in this browser.';
}

function exportScenarioEditor() {
  scenarioEditorState = normalizeScenarioDefinition(scenarioEditorState);
  const blob = new Blob([JSON.stringify(scenarioEditorState, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${scenarioEditorState.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'btech-scenario'}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

async function importScenarioEditor(file) {
  if (!file) return;
  const status = document.getElementById('scenario-editor-status');
  try {
    scenarioEditorState = normalizeScenarioDefinition(JSON.parse(await file.text()));
    renderScenarioEditor();
    document.getElementById('scenario-editor-status').textContent = 'Scenario imported. Review it before launching.';
  } catch (error) {
    if (status) status.textContent = `Import failed: ${error.message}`;
  }
}

async function launchScenarioEditorMatch() {
  if (!currentUser || !scenarioEditorState) return;
  scenarioEditorState = normalizeScenarioDefinition(scenarioEditorState);
  const errors = validateScenarioDefinition(scenarioEditorState);
  const status = document.getElementById('scenario-editor-status');
  if (errors.length) { if (status) status.textContent = errors.join(' '); return; }
  if (status) status.textContent = 'Saving the scenario and creating its lobby…';
  const { data: scenarioId, error } = await db.rpc('save_btech_custom_scenario', { p_definition: scenarioEditorState });
  if (error) { if (status) status.textContent = `Scenario could not be saved: ${error.message}`; return; }
  const mapId = `custom:${scenarioId}`;
  const customScenario = { ...scenarioEditorState, map_id: mapId, id: mapId, visual: 'custom' };
  registerCustomMapDefinition(customScenario);
  localStorage.setItem(SCENARIO_EDITOR_STORAGE_KEY, JSON.stringify(scenarioEditorState));
  await createHumanGame({
    mapId,
    dropshipTonnage: scenarioEditorState.dropship_tonnage,
    victoryMode: scenarioEditorState.victory_mode,
    customScenario
  });
}

window.addEventListener('pointerup', () => { scenarioEditorPainting = false; });
