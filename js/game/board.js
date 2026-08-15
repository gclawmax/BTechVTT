// ── GAME INIT (existing hex grid code) ───────────────────
// These are the original BTechVTT game functions, preserved from the Phase 1 prototype.

const HEX_SIZE = 32;
const GRID_COLS = 16;
const GRID_ROWS = 12;

function terrainAt(col, row) { return getMapDefinition(activeMapId).terrain[hexCode(col, row)] || 'clear'; }

function ensureMechCombatState(mech) {
  mech.unitId = canonicalUnitId(mech.unitId);
  const unit = getSupportedUnit(mech.unitId);
  if (!unit) {
    console.warn(`Unsupported unit in game state: ${mech.unitId}`);
    return false;
  }
  if (!mech.armor) mech.armor = { ...unit.armor };
  if (!mech.structure) mech.structure = { ...unit.structure };
  if (mech.heat == null) mech.heat = 0;
  if (mech.weaponHeat == null) mech.weaponHeat = 0;
  if (mech.movementHeat == null) mech.movementHeat = 0;
  if (mech.roundStartingHeat == null) mech.roundStartingHeat = mech.heat;
  if (mech.heatDissipated == null) mech.heatDissipated = 0;
  if (mech.hasFired == null) mech.hasFired = false;
  if (mech.hasPhysicalAttacked == null) mech.hasPhysicalAttacked = false;
  if (mech.hasManagedHeat == null) mech.hasManagedHeat = false;
  if (!Array.isArray(mech.ammoBins)) {
    mech.ammoBins = (unit.ammoBins || []).map(bin => ({ ...bin, maxShots: bin.shots }));
  }
  return true;
}

const MECH_COLORS = ['#c4302b', '#d4800a', '#2a8a2a', '#3060c4'];

let mechInstances = [];
let selectedInstanceId = null;
let canvas, ctx;
let gridOffsetX, gridOffsetY;
// View-only displacement of the board, controlled by right/middle-button drag.
// It is intentionally local to this browser and never written to game state.
let mapPanX = 0, mapPanY = 0;

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
