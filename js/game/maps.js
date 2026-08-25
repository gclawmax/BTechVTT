// Built-in maps use only terrain that the current rules engine understands.
// Custom-map authoring can add records to this catalogue later.
const BT_MAPS = Object.freeze({
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
  }
});

const DEFAULT_MAP_ID = 'training-grounds';
let activeMapId = DEFAULT_MAP_ID;
let activeTerrainState = { overrides: {}, building_cf: {} };

function getMapDefinition(mapId) {
  return BT_MAPS[mapId] || BT_MAPS[DEFAULT_MAP_ID];
}

function setActiveMap(mapId) {
  activeMapId = BT_MAPS[mapId] ? mapId : DEFAULT_MAP_ID;
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
  return ({
    'industrial-crossing': ['0703', '0806', '0809'],
    'desert-hills': ['0302', '0906', '1108'],
    'flatlands-open-terrain': ['0505', '0806', '1108'],
    'ridge-and-ford': ['0704', '0804', '0805']
    ,'weathered-frontier': ['0403', '1005', '0408']
  })[mapId] || ['0704', '0806', '0808'];
}

function elevationAt(col, row) {
  return getMapDefinition(activeMapId).elevation?.[hexCode(col, row)] || 0;
}
