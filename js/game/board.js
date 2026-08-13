// ── GAME INIT (existing hex grid code) ───────────────────
// These are the original BTechVTT game functions, preserved from the Phase 1 prototype.

const HEX_SIZE = 32;
const GRID_COLS = 16;
const GRID_ROWS = 12;

const BT_UNITS = {
  atlas: {
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
  hunchback: {
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
  locust: {
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
};

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

function ensureMechCombatState(mech) {
  const unit = BT_UNITS[mech.unitId];
  if (!unit) return;
  if (!mech.armor) mech.armor = { ...unit.armor };
  if (!mech.structure) mech.structure = { ...unit.structure };
  if (mech.heat == null) mech.heat = 0;
  if (mech.weaponHeat == null) mech.weaponHeat = 0;
  if (mech.hasFired == null) mech.hasFired = false;
  if (mech.hasPhysicalAttacked == null) mech.hasPhysicalAttacked = false;
}

const MECH_COLORS = ['#c4302b', '#d4800a', '#2a8a2a', '#3060c4'];

let mechInstances = [];
let selectedInstanceId = null;
let canvas, ctx;
let gridOffsetX, gridOffsetY;

// Short human-readable label for a mech instance, e.g. "Atlas AS7-D (P1)".
function mechLabel(mech) {
  if (!mech) return 'Unknown \'Mech';
  const unit = BT_UNITS[mech.unitId];
  const chassisLabel = unit ? `${unit.chassis} ${unit.variant}` : mech.unitId;
  const owner = mech.owner === mySeatNumber ? `P${mech.owner}` : (mech.instanceId && mech.instanceId.includes('ai') ? 'AI' : `P${mech.owner}`);
  return `${chassisLabel} (${owner})`;
}

function hexCode(col, row) {
  return `${String(col).padStart(2,'0')}${String(row).padStart(2,'0')}`;
}

function offsetToAxial(col, row) {
  const q = col - (row - (row & 1)) / 2;
  const r = row;
  return { q, r };
}

function axialToOffset(q, r) {
  const col = q + (r - (r & 1)) / 2;
  const row = r;
  return { col, row };
}
