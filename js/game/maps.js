// Built-in maps use only terrain that the current rules engine understands.
// Custom-map authoring can add records to this catalogue later.
const BT_MAPS = Object.freeze({
  'training-grounds': {
    name: 'Training Grounds',
    description: 'Open ground with scattered light and heavy woods.',
    terrain: {
      '0602': 'light_woods', '0702': 'light_woods', '1203': 'heavy_woods',
      '0308': 'light_woods', '0408': 'light_woods', '1109': 'heavy_woods'
    }
  },
  'woodland-approach': {
    name: 'Woodland Approach',
    description: 'A denser central wood line with open flanks.',
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
    terrain: {
      '0404': 'light_woods', '0504': 'light_woods', '0405': 'light_woods',
      '1107': 'heavy_woods', '1207': 'heavy_woods', '1108': 'light_woods'
    }
  },
  'ridge-and-ford': {
    name: 'Ridge and Ford',
    description: 'A one-level ridge, rough approaches, a shallow-water ford, and one impassable ravine hex.',
    terrain: {
      '0604': 'rough', '0704': 'rough', '0804': 'pavement', '0904': 'rough',
      '0605': 'shallow_water', '0705': 'shallow_water', '0805': 'rough', '0905': 'impassable',
      '0703': 'light_woods', '0903': 'heavy_woods'
    },
    elevation: {
      '0703': 1, '0803': 1, '0903': 1,
      '0704': 1, '0804': 1, '0904': 1, '0805': 1
    }
  }
});

const DEFAULT_MAP_ID = 'training-grounds';
let activeMapId = DEFAULT_MAP_ID;

function getMapDefinition(mapId) {
  return BT_MAPS[mapId] || BT_MAPS[DEFAULT_MAP_ID];
}

function setActiveMap(mapId) {
  activeMapId = BT_MAPS[mapId] ? mapId : DEFAULT_MAP_ID;
}

function elevationAt(col, row) {
  return getMapDefinition(activeMapId).elevation?.[hexCode(col, row)] || 0;
}
