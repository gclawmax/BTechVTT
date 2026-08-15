// BT-VTT's shipped unit catalogue. This is the sole source of gameplay stats
// for units that have been tested in the VTT. It intentionally remains
// separate from the large, local-only MegaMek reference catalogue.

const BT_UNIT_CATALOGUE = Object.freeze({
  'atlas-as7-d': {
    chassis: 'Atlas', variant: 'AS7-D', tonnage: 100, color: '#c4302b',
    movement: { walk: 3, run: 5, jump: 0 },
    heat_sinks: 20, heat_sink_type: 'double',
    weapons: [
      { key: 'ac20', count: 1, location: 'Right Arm' },
      { key: 'lr20', count: 1, location: 'Right Torso' },
      { key: 'sr6', count: 1, location: 'Left Torso' },
      { key: 'med_laser', count: 4, location: 'Center Torso' }
    ],
    armor: { head:9, ct:47, ct_rear:14, lt:32, lt_rear:10, rt:32, rt_rear:10, la:34, ra:34, ll:41, rl:41 },
    structure: { head:3, ct:31, lt:21, rt:21, la:17, ra:17, ll:21, rl:21 }
  },
  'hunchback-hbk-4g': {
    chassis: 'Hunchback', variant: 'HBK-4G', tonnage: 50, color: '#d4800a',
    movement: { walk: 3, run: 5, jump: 0 },
    heat_sinks: 10, heat_sink_type: 'single',
    weapons: [
      { key: 'erl', count: 1, location: 'Center Torso' },
      { key: 'lr6', count: 1, location: 'Right Torso' },
      { key: 'ac2', count: 1, location: 'Right Arm' }
    ],
    armor: { head:9, ct:19, ct_rear:5, lt:14, lt_rear:4, rt:14, rt_rear:4, la:9, ra:9, ll:14, rl:14 },
    structure: { head:3, ct:16, lt:11, rt:11, la:8, ra:8, ll:11, rl:11 }
  },
  'locust-lct-1v': {
    chassis: 'Locust', variant: 'LCT-1V', tonnage: 20, color: '#2a8a2a',
    movement: { walk: 3, run: 5, jump: 6 },
    heat_sinks: 4, heat_sink_type: 'single',
    weapons: [
      { key: 'erl', count: 1, location: 'Center Torso' },
      { key: 'streak_sr4', count: 1, location: 'Left Torso' }
    ],
    armor: { head:8, ct:10, ct_rear:4, lt:6, lt_rear:3, rt:6, rt_rear:3, la:4, ra:4, ll:6, rl:6 },
    structure: { head:3, ct:6, lt:5, rt:5, la:3, ra:3, ll:4, rl:4 }
  }
});

// Support status deliberately contains no copied unit statistics. Future
// MegaMek-derived records can be reviewed and enabled here by their catalogue
// ID after the VTT supports their equipment and rules.
const BT_UNIT_SUPPORT = Object.freeze({
  'atlas-as7-d': { status: 'supported' },
  'hunchback-hbk-4g': { status: 'supported' },
  'locust-lct-1v': { status: 'supported' }
});

// Existing saved games used these short prototype IDs. Keep them readable as
// the game transitions to durable catalogue IDs.
const BT_UNIT_ID_ALIASES = Object.freeze({
  atlas: 'atlas-as7-d',
  hunchback: 'hunchback-hbk-4g',
  locust: 'locust-lct-1v'
});

function canonicalUnitId(unitId) {
  return BT_UNIT_ID_ALIASES[unitId] || unitId;
}

function getSupportedUnit(unitId) {
  const id = canonicalUnitId(unitId);
  return BT_UNIT_SUPPORT[id]?.status === 'supported' ? BT_UNIT_CATALOGUE[id] || null : null;
}

function isSupportedUnit(unitId) {
  return Boolean(getSupportedUnit(unitId));
}

// Compatibility name used throughout the current game code.
const BT_UNITS = BT_UNIT_CATALOGUE;

// First-pass standard weapon data. Cluster weapons are deliberately treated as
// one simplified damage packet until their individual-cluster rules are added.
const BT_WEAPONS = {
  ac20:       { name: 'AC/20', damage: 20, heat: 7, range: [3, 6, 9] },
  lr20:       { name: 'LRM-20', damage: 20, heat: 6, range: [7, 14, 21] },
  sr6:        { name: 'SRM-6', damage: 6, heat: 4, range: [3, 6, 9] },
  med_laser:  { name: 'Medium Laser', damage: 5, heat: 3, range: [3, 6, 9] },
  erl:        { name: 'ER Large Laser', damage: 8, heat: 12, range: [7, 14, 19] },
  lr6:        { name: 'LRM-6', damage: 6, heat: 2, range: [7, 14, 21] },
  ac2:        { name: 'AC/2', damage: 2, heat: 1, range: [8, 16, 24] },
  streak_sr4: { name: 'Streak SRM-4', damage: 4, heat: 3, range: [3, 6, 9] }
};
