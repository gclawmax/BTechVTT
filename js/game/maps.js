// Built-in maps use only terrain that the current rules engine understands.
// Custom-map authoring can add records to this catalogue later.
const BT_MAPS = Object.freeze({
  'standard-single-sheet': {
    name: 'Standard Map Sheet', description: 'A standard BattleTech map sheet: 16 columns by 17 rows.', visual: 'grassland', columns: 16, rows: 17, terrain: {}
  },
  'standard-dual-vertical': {
    name: 'Dual Sheets — End to End', description: 'Two standard sheets joined end-to-end: 16 columns by 34 rows.', visual: 'grassland', columns: 16, rows: 34, terrain: {}
  },
  'standard-dual-horizontal': {
    name: 'Dual Sheets — Side by Side', description: 'Two standard sheets joined side-by-side: 32 columns by 17 rows.', visual: 'grassland', columns: 32, rows: 17, terrain: {}
  },
  'training-grounds': {
    name: 'Training Grounds',
    description: 'Open ground with scattered light and heavy woods.',
    visual: 'grassland',
    terrain: {
      '0602': 'light_woods', '0702': 'light_woods', '1203': 'heavy_woods',
      '0308': 'light_woods', '0408': 'light_woods', '1109': 'heavy_woods'
    }
  },
  'woodland-approach': {
    name: 'Woodland Approach',
    description: 'A denser central wood line with open flanks.',
    visual: 'woodland',
    terrain: {
      '0603': 'light_woods', '0703': 'light_woods', '0803': 'heavy_woods',
      '0504': 'light_woods', '0604': 'heavy_woods', '0704': 'heavy_woods',
      '0804': 'light_woods', '0904': 'light_woods', '0605': 'light_woods',
      '0705': 'heavy_woods', '0805': 'light_woods', '0905': 'light_woods'
    }
  },
  'open-engagement': {
    name: 'Open Engagement',
    description: 'Mostly clear terrain with two small areas of cover.',
    visual: 'steppe',
    terrain: {
      '0404': 'light_woods', '0504': 'light_woods', '0405': 'light_woods',
      '1107': 'heavy_woods', '1207': 'heavy_woods', '1108': 'light_woods'
    }
  },
  'ridge-and-ford': {
    name: 'Ridge and Ford',
    description: 'A one-level ridge, rough approaches, a shallow-water ford, and one impassable ravine hex.',
    visual: 'highland',
    terrain: {
      '0604': 'rough', '0704': 'rough', '0804': 'pavement', '0904': 'rough',
      '0605': 'shallow_water', '0705': 'shallow_water', '0805': 'rough', '0905': 'impassable',
      '0703': 'light_woods', '0903': 'heavy_woods'
    },
    elevation: {
      '0703': 1, '0803': 1, '0903': 1,
      '0704': 1, '0804': 1, '0904': 1, '0805': 1
    }
  },
  // Terrain transcribed from the supplied Flatlands Terrain Set into the
  // VTT's 16×12 board. The original PDF remains a local reference asset; the
  // browser draws its own native terrain rather than copying map artwork.
  'flatlands-open-terrain': {
    name: 'Flatlands — Open Terrain',
    description: 'Wide open lanes divided by two irregular wood clusters.',
    visual: 'flatland',
    terrain: {
      '0102': 'light_woods', '0202': 'heavy_woods', '0302': 'light_woods',
      '0103': 'light_woods', '0203': 'light_woods', '0303': 'heavy_woods',
      '0104': 'heavy_woods', '0204': 'light_woods',
      '0906': 'light_woods', '0907': 'heavy_woods', '0908': 'light_woods',
      '1007': 'light_woods', '1008': 'heavy_woods', '1009': 'light_woods',
      '1108': 'heavy_woods', '1109': 'light_woods',
      '0111': 'light_woods', '0211': 'heavy_woods', '0311': 'light_woods'
    }
  },
  // Terrain transcribed from the supplied Hill Terrain Set. Elevation and
  // rough ground are supported by the authoritative movement and LOS rules.
  'desert-hills': {
    name: 'Desert Hills',
    description: 'Rolling ridges, rocky channels, and several high firing positions.',
    visual: 'desert',
    terrain: {
      '0600': 'rough', '0601': 'rough', '0602': 'rough', '0603': 'rough',
      '0705': 'rough', '0706': 'rough', '0707': 'rough',
      '0708': 'rough', '0709': 'rough', '0809': 'rough', '0810': 'rough',
      '1308': 'rough'
    },
    elevation: {
      '0200': 1, '0300': 1, '0400': 1, '0201': 1, '0301': 2, '0401': 1,
      '0202': 2, '0302': 2, '0402': 1, '0203': 2, '0303': 2, '0403': 1,
      '0204': 2, '0304': 1, '0305': 1, '0405': 1,
      '1000': 1, '1100': 1, '1001': 1, '1101': 2, '1002': 2, '1102': 2,
      '1003': 2, '1103': 1, '1004': 2, '1104': 1,
      '0904': 1, '0905': 1, '0805': 1, '0806': 1, '0906': 1,
      '1007': 1, '1107': 2, '1207': 2, '1008': 2, '1108': 3, '1208': 2,
      '1009': 2, '1109': 3, '1209': 2, '1110': 2, '1210': 2,
      '1306': 1, '1406': 2, '1307': 2, '1407': 2, '1308': 2,
      '0911': 1, '1011': 1, '1111': 1, '1211': 1, '1311': 1
    }
  },
  'industrial-crossing': {
    name: 'Industrial Crossing',
    description: 'A damaged industrial district with deep water, burning ground, smoke, rubble, pavement and solid buildings.',
    visual: 'industrial',
    terrain: {
      '0700': 'pavement', '0800': 'pavement', '0701': 'pavement', '0801': 'pavement',
      '0702': 'pavement', '0802': 'pavement', '0703': 'pavement', '0803': 'pavement',
      '0704': 'pavement', '0804': 'pavement', '0705': 'pavement', '0805': 'pavement',
      '0706': 'pavement', '0806': 'pavement', '0707': 'pavement', '0807': 'pavement',
      '0708': 'pavement', '0808': 'pavement', '0709': 'pavement', '0809': 'pavement',
      '0710': 'pavement', '0810': 'pavement', '0711': 'pavement', '0811': 'pavement',
      '0205': 'shallow_water', '0305': 'deep_water', '0405': 'deep_water',
      '0505': 'deep_water', '0605': 'shallow_water',
      '0503': 'rubble', '1008': 'rubble',
      '0603': 'building', '0903': 'building', '0608': 'building', '0908': 'building',
      '1004': 'fire', '1104': 'light_smoke', '1204': 'heavy_smoke'
    }
  },
  'weathered-frontier': {
    name: 'Weathered Frontier',
    description: 'A hostile proving ground with ice, snow, mud, sand, swamp, magma and two bridge crossings.',
    visual: 'tundra',
    terrain: {
      '0102':'deep_snow','0202':'deep_snow','0302':'ice','0402':'ice','0502':'deep_snow',
      '0203':'mud','0303':'mud','0403':'swamp','0503':'swamp',
      '0700':'sand','0701':'sand','0702':'sand','0800':'sand','0801':'sand','0802':'sand',
      '0905':'shallow_water','1005':'bridge','1105':'shallow_water','1205':'bridge','1305':'shallow_water',
      '0308':'magma_crust','0408':'magma_crust','0508':'magma_liquid','0309':'magma_crust','0409':'magma_crust',
      '1009':'ice','1109':'ice','1209':'deep_snow','1010':'mud','1110':'swamp'
    }
  },
  // These are original VTT layouts. They borrow broad tactical ideas from the
  // locally supplied map references (river crossings, broken city blocks,
  // wood lanes and rolling hills) without reproducing published map artwork.
  'river-delta': {
    name: 'River Delta', description: 'A winding waterway splits the field; two bridges and wooded banks create competing crossing points.', visual: 'river',
    terrain: {
      '0400':'shallow_water','0401':'shallow_water','0501':'shallow_water','0502':'deep_water','0602':'deep_water','0703':'deep_water','0803':'deep_water','0904':'deep_water','1004':'shallow_water','1005':'shallow_water','1106':'shallow_water','1107':'deep_water','1208':'deep_water','1209':'shallow_water','0704':'bridge','1105':'bridge',
      '0203':'light_woods','0303':'light_woods','0204':'heavy_woods','0304':'light_woods','0404':'light_woods','1202':'light_woods','1302':'heavy_woods','1402':'light_woods','1203':'light_woods','1303':'light_woods','0709':'light_woods','0809':'heavy_woods','0909':'light_woods','0808':'light_woods','0908':'light_woods'
    }
  },
  'city-ruins': {
    name: 'City Ruins', description: 'Rubble-choked avenues and intact structures divide the city into brutal short-range fire lanes.', visual: 'urban',
    terrain: {
      '0302':'building','0402':'building','0303':'building','0403':'rubble','0503':'rubble','0603':'pavement','0703':'pavement','0803':'pavement','0903':'pavement','1003':'pavement','1103':'pavement','1203':'rubble',
      '0604':'pavement','0704':'pavement','0804':'pavement','0904':'pavement','1004':'pavement','0605':'pavement','0705':'pavement','0805':'pavement','0905':'pavement','1005':'pavement','0606':'pavement','0706':'pavement','0806':'pavement','0906':'pavement','1006':'pavement','0607':'pavement','0707':'pavement','0807':'pavement','0907':'pavement','1007':'pavement','0608':'pavement','0708':'pavement','0808':'pavement','0908':'pavement','1008':'pavement','0609':'pavement','0709':'pavement','0809':'pavement','0909':'pavement','1009':'pavement','0610':'pavement','0710':'pavement','0810':'pavement','0910':'pavement','1010':'pavement',
      '1107':'building','1207':'building','1108':'rubble','1208':'rubble','0309':'building','0409':'rubble','0308':'rubble','0408':'building','1305':'light_smoke','1306':'heavy_smoke','0206':'fire'
    }
  },
  'forest-lanes': {
    name: 'Forest Lanes', description: 'Three broken woodland belts provide concealment while preserving a few long, dangerous lanes of fire.', visual: 'woodland',
    terrain: {
      '0301':'light_woods','0401':'heavy_woods','0501':'light_woods','0302':'heavy_woods','0402':'heavy_woods','0502':'light_woods','0203':'light_woods','0303':'heavy_woods','0403':'light_woods',
      '0804':'light_woods','0904':'heavy_woods','1004':'light_woods','0705':'light_woods','0805':'heavy_woods','0905':'heavy_woods','1005':'light_woods','0806':'light_woods','0906':'heavy_woods','1006':'light_woods',
      '0309':'light_woods','0409':'heavy_woods','0509':'light_woods','0310':'heavy_woods','0410':'heavy_woods','0510':'light_woods','0211':'light_woods','0311':'heavy_woods','0411':'light_woods','1311':'light_woods','1411':'heavy_woods','1312':'heavy_woods','1412':'light_woods'
    }
  },
  'rolling-highlands': {
    name: 'Rolling Highlands', description: 'Interlocking hills and rough gullies reward elevation control without turning the map into a single ridge fight.', visual: 'highland',
    terrain: { '0404':'rough','0504':'rough','0604':'rough','0405':'rough','0505':'rough','0605':'rough','1006':'rough','1106':'rough','1206':'rough','1007':'rough','1107':'rough','1207':'rough','0710':'rough','0810':'rough','0910':'rough','0811':'rough' },
    elevation: {
      '0403':1,'0503':1,'0603':1,'0304':1,'0404':2,'0504':2,'0604':2,'0704':1,'0305':1,'0405':2,'0505':3,'0605':2,'0705':1,'0406':1,'0506':2,'0606':1,
      '1005':1,'1105':1,'1205':1,'0906':1,'1006':2,'1106':3,'1206':2,'1306':1,'0907':1,'1007':2,'1107':2,'1207':2,'1307':1,'1008':1,'1108':1,
      '0709':1,'0809':1,'0909':1,'0710':1,'0810':2,'0910':1,'0811':1
    }
  },
  'badlands-run': {
    name: 'Badlands Run', description: 'Sand flats, rocky badlands and a hazardous magma shelf make speed and route choice equally important.', visual: 'badlands',
    terrain: {
      '0202':'sand','0302':'sand','0402':'sand','0203':'sand','0303':'sand','0403':'sand','0503':'sand','0802':'rough','0902':'rough','1002':'rough','0803':'rough','0903':'rough','1003':'rough','1103':'rough','0904':'rough','1004':'rough',
      '0509':'magma_crust','0609':'magma_crust','0709':'magma_crust','0610':'magma_liquid','0710':'magma_crust','0810':'magma_crust','0711':'magma_crust','1208':'light_woods','1308':'heavy_woods','1408':'light_woods','1209':'light_woods','1309':'light_woods','1409':'heavy_woods'
    }
  }
});

// Custom scenarios are immutable server snapshots, but are registered in the
// browser when their lobby/game state is loaded. Keeping them separate leaves
// the built-in catalogue read-only while allowing every participant to render
// the exact map embedded in the match.
const BT_CUSTOM_MAPS = Object.create(null);

const DEFAULT_MAP_ID = 'training-grounds';
let activeMapId = DEFAULT_MAP_ID;
let activeTerrainState = { overrides: {}, building_cf: {} };

const DEFAULT_MAP_DIMENSIONS = Object.freeze({ cols: 16, rows: 17 });
function mapDimensions(mapId = activeMapId) {
  const map = BT_CUSTOM_MAPS[mapId] || BT_MAPS[mapId] || {};
  const cols = Number(map.columns ?? map.cols ?? DEFAULT_MAP_DIMENSIONS.cols);
  const rows = Number(map.rows ?? DEFAULT_MAP_DIMENSIONS.rows);
  return { cols: Number.isInteger(cols) && cols >= 8 && cols <= 48 ? cols : DEFAULT_MAP_DIMENSIONS.cols, rows: Number.isInteger(rows) && rows >= 8 && rows <= 48 ? rows : DEFAULT_MAP_DIMENSIONS.rows };
}
function setActiveMapDimensions(mapId = activeMapId) {
  const dimensions = mapDimensions(mapId);
  GRID_COLS = dimensions.cols; GRID_ROWS = dimensions.rows;
  return dimensions;
}

function getMapDefinition(mapId) {
  return BT_CUSTOM_MAPS[mapId] || BT_MAPS[mapId] || BT_MAPS[DEFAULT_MAP_ID];
}

function builtInMapCategory(mapId) {
  if (mapId.startsWith('standard-')) return 'Standard sizes';
  if (['training-grounds', 'woodland-approach', 'open-engagement', 'flatlands-open-terrain', 'forest-lanes'].includes(mapId)) return 'Open and woodland';
  if (['ridge-and-ford', 'desert-hills', 'rolling-highlands', 'badlands-run'].includes(mapId)) return 'Hills and badlands';
  return 'Special terrain';
}

function builtInMapOptions() {
  const groups = new Map();
  for (const [id, map] of Object.entries(BT_MAPS)) {
    const category = builtInMapCategory(id);
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(`<option value="${id}">${escapeHtml(map.name)}</option>`);
  }
  return [...groups.entries()].map(([category, options]) => `<optgroup label="${category}">${options.join('')}</optgroup>`).join('');
}

function setActiveMap(mapId) {
  activeMapId = BT_MAPS[mapId] || BT_CUSTOM_MAPS[mapId] ? mapId : DEFAULT_MAP_ID;
  setActiveMapDimensions(activeMapId);
}

function registerCustomMapDefinition(definition) {
  if (!definition || typeof definition !== 'object') return null;
  const id = String(definition.map_id || definition.id || '');
  if (!id.startsWith('custom:')) return null;
  BT_CUSTOM_MAPS[id] = {
    name: String(definition.name || 'Custom Battlefield').slice(0, 80),
    description: String(definition.description || 'Player-created battlefield.').slice(0, 240),
    visual: String(definition.visual || 'custom'),
    columns: Number(definition.columns ?? definition.cols) || DEFAULT_MAP_DIMENSIONS.cols,
    rows: Number(definition.rows) || DEFAULT_MAP_DIMENSIONS.rows,
    terrain: definition.terrain && typeof definition.terrain === 'object' ? { ...definition.terrain } : {},
    elevation: definition.elevation && typeof definition.elevation === 'object' ? { ...definition.elevation } : {},
    objective_hexes: Array.isArray(definition.objective_hexes) ? [...definition.objective_hexes] : [],
    deployment_zones: definition.deployment_zones && typeof definition.deployment_zones === 'object'
      ? { '1': [...(definition.deployment_zones['1'] || [])], '2': [...(definition.deployment_zones['2'] || [])] }
      : null
  };
  return id;
}

// Terrain which changes during a match is kept in the authoritative game
// state.  An explicit "clear" override is meaningful: it removes smoke or a
// fire printed in the base map without changing the map catalogue itself.
function setActiveTerrainState(state = {}) {
  activeTerrainState = {
    overrides: state.terrain_overrides && typeof state.terrain_overrides === 'object' ? state.terrain_overrides : {},
    building_cf: state.building_cf && typeof state.building_cf === 'object' ? state.building_cf : {}
  };
}

function terrainStatusAt(col, row) {
  const code = hexCode(col, row);
  return {
    terrain: Object.prototype.hasOwnProperty.call(activeTerrainState.overrides, code)
      ? activeTerrainState.overrides[code]
      : (getMapDefinition(activeMapId).terrain[code] || 'clear'),
    buildingCF: activeTerrainState.building_cf[code] ?? null
  };
}

function objectiveHexesForMap(mapId) {
  if (BT_CUSTOM_MAPS[mapId]) return [...(BT_CUSTOM_MAPS[mapId].objective_hexes || [])];
  return ({
    'standard-single-sheet': ['0406', '0808', '1110'],
    'standard-dual-vertical': ['0408', '0816', '1125'],
    'standard-dual-horizontal': ['0806', '1508', '2310'],
    'industrial-crossing': ['0703', '0806', '0809'],
    'desert-hills': ['0302', '0906', '1108'],
    'flatlands-open-terrain': ['0505', '0806', '1108'],
    'ridge-and-ford': ['0704', '0804', '0805']
    ,'weathered-frontier': ['0403', '1005', '0408'],
    'river-delta': ['0704', '1105', '0909'],
    'city-ruins': ['0705', '0908', '1207'],
    'forest-lanes': ['0503', '0905', '0410'],
    'rolling-highlands': ['0505', '1106', '0810'],
    'badlands-run': ['0903', '0709', '1308']
  })[mapId] || ['0704', '0806', '0808'];
}

function scenarioDeploymentZoneHexes(seat, state = null) {
  state = state || (typeof currentMatchConfig !== 'undefined' ? currentMatchConfig : {});
  const dimensions = mapDimensions(state.map_id || activeMapId);
  const authored = state.deployment_zones?.[String(seat)];
  if (Array.isArray(authored)) return authored.filter(code => {
    const col = Number(String(code).slice(0, 2)), row = Number(String(code).slice(2, 4));
    return /^\d{4}$/.test(String(code)) && col >= 0 && col < dimensions.cols && row >= 0 && row < dimensions.rows;
  });
  const depth = Math.min(5, dimensions.cols);
  const start = Number(seat) === 1 ? 0 : dimensions.cols - depth;
  const end = Number(seat) === 1 ? depth : dimensions.cols;
  const result = [];
  for (let col = start; col < end; col++) for (let row = 0; row < dimensions.rows; row++) result.push(hexCode(col, row));
  return result;
}

function scenarioDeploymentZoneContains(seat, col, row, state = null) {
  if (col < 0 || row < 0) return false;
  return scenarioDeploymentZoneHexes(seat, state).includes(hexCode(col, row));
}

function victoryModeDetails(mode) {
  return ({
    annihilation: { label:'Annihilation', target:0, guidance:'Destroy every opposing BattleMech.' },
    control: { label:'Objective Control', target:5, guidance:'Each uncontested objective scores 1 point at round end. First to 5 wins.' },
    breakthrough: { label:'Breakthrough', target:2, guidance:'Move 2 different BattleMechs into the enemy deployment zone. Each unit scores once.' }
  })[mode] || { label:'Annihilation', target:0, guidance:'Destroy every opposing BattleMech.' };
}

function elevationAt(col, row) {
  return getMapDefinition(activeMapId).elevation?.[hexCode(col, row)] || 0;
}

// Public terrain information only: never include hidden units or minefields.
function terrainDescription(col, row) {
 const terrain = terrainStatusAt(col, row);
 const names = {shallow_water:'Shallow water · Depth 1',deep_water:'Deep water · Depth 2',light_woods:'Light woods',heavy_woods:'Heavy woods',bridge:'Bridge'};
 const descriptions = {clear:'Open ground.',light_woods:'Scattered trees. Slows ground movement and provides cover.',heavy_woods:'Dense trees. Slows ground movement more than light woods and provides heavier cover.',shallow_water:'Depth 1 water is available in Standard 3060. Select Walk to enter; running into water is not allowed. Entry needs enough MP for terrain, depth change and any turn.',deep_water:'Deep water; the bottom is two levels below the surface.',bridge:'A bridge crossing. The thick horizontal bar marks its deck.',rough:'Uneven, rocky ground.',rubble:'Debris and broken ground.',building:'A structure occupying this hex.',pavement:'A paved surface.',road:'A road surface.',impassable:'Ground movement is blocked.',ice:'An icy surface.',deep_snow:'Deep snow covering the ground.',mud:'Soft, muddy ground.',sand:'Sandy ground.',swamp:'Waterlogged ground.',magma_crust:'A crust over hot magma.',magma_liquid:'Exposed magma; ground movement is blocked.',fire:'Burning terrain.',light_smoke:'Light smoke obscures the view.',heavy_smoke:'Dense smoke obscures the view.'};
 const name = names[terrain.terrain] || terrain.terrain.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
 const level = ['shallow_water','deep_water'].includes(terrain.terrain) ? '' : ` · Elevation ${elevationAt(col,row)}`;
 return `${hexCode(col,row)} · ${name}${level}\n${descriptions[terrain.terrain] || ''}${terrain.buildingCF != null ? ` Construction Factor: ${terrain.buildingCF}.` : ''}`;
}
