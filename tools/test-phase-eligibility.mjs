// Hermetic contract tests for phase eligibility (BTechVTT issue #33:
// BT-6V7A R12 — an unmoved BattleMech whose pilot went unconscious had no
// legal action and no pass path: the server rejected every movement with a
// misleading "has not moved" error while activePlayerPhaseComplete kept
// demanding a move, so the human turn could never advance and the AI's
// double activation kept re-planning the un-act-able units).
//
// Both layers are exercised without network/DB:
//   1. getPhaseUnitsForActivePlayer() now excludes destroyed/shutdown/
//      unconscious-pilot units (the weapon phase already did via
//      canFireFromWeaponPhaseStart), so activePlayerPhaseComplete passes
//      with zero submissions and the advance button re-enables.
//   2. generateAIPlan() must never queue actions for those units in the
//      movement phase either (pins the planner filter that was bypassed
//      once by the double-activation defect).
//
// Note: phases.js declares `let currentGameState` at top level, so fixtures
// must assign it INSIDE the vm context (a seeded sandbox property would be
// shadowed by the lexical binding).
//
// Run: node tools/test-phase-eligibility.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const check = (label, condition, detail = '') => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures.push(label);
};

function makeSandbox(mechs, { phase = 'movement', activeSeat = 2 } = {}) {
  const sandbox = {
    console: { info() {}, warn() {}, error() {}, log() {} },
    setTimeout: fn => { fn(); return 0; },
    currentGameId: '00000000-0000-0000-0000-000000000001',
    currentMatchConfig: { map_id: 'training-grounds', ruleset: 'advanced_3060' },
    vsAiMode: true,
    BT_UNITS: {},
    activeCatalogueVersion: 'bv3-test',
    window: { aiDifficulty: 'expert' },
    mechLabel: mech => mech?.unitId || 'Unknown',
    axialDistance: (a, b, c, d) => Math.max(Math.abs(c - a), Math.abs(d - b)),
    hexNeighbor: (col, row, dir) => ({ col: col + [1, 1, 0, -1, -1, 0][dir], row: row + [0, -1, -1, 0, 1, 1][dir] }),
    terrainMovementBlocked: () => false,
    criticalMovementProfile: () => ({ walk: 4, run: 6, jump: 0 }),
    hasActiveTSM: () => false,
    boosterRunMP: () => 6,
    mascTargetNumber: () => 13,
    hasOperationalMASC: () => false,
    physicalLimbCandidates: () => ['la', 'ra'],
    physicalAttackTypesFor: () => ['punch'],
    evaluatePhysicalAttack: () => ({ valid: true, damage: 4, targetNumber: 5 }),
    evaluateWeaponAttack: () => ({ valid: false }),
    emptyWeaponAttackState: () => ({ attackerId: null, ammoBinsByMount: {}, fireModesByMount: {}, aimLocationsByMount: {} }),
    weaponAttackState: { attackerId: null, ammoBinsByMount: {}, fireModesByMount: {}, aimLocationsByMount: {} },
    weaponProfile: entry => entry?.weapon || { name: 'Laser', damage: 5, heat: 3 },
    weaponMountId: (entry, index) => entry.mountId || `${entry.key}:${entry.location}:${index}`,
    weaponPhaseStartMech: mech => mech,
    destroyedHeatSinkCapacity: () => 0,
    signatureHeat: () => 0,
    engineCriticalHeat: () => 0,
    currentActivationAllowance: () => 4,
    PHASE_LABELS: { movement: 'Movement' },
    logEvent: () => {},
    syncMechInstances: async () => {},
    loadGameState: async () => {},
    checkForMatchEnd: async () => {},
    updateAdvanceButtonState: () => {},
    renderRoster: () => {}, renderDetail: () => {}, draw: () => {},
    localStorage: { getItem: () => null, setItem: () => {} },
    GRID_COLS: 16, GRID_ROWS: 16,
    db: { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) }) }
  };
  vm.createContext(sandbox);
  const load = relative => vm.runInContext(fs.readFileSync(path.join(ROOT, relative), 'utf8'), sandbox, { filename: relative });
  load('js/game/team-model.js');
  load('js/game/phases.js');
  load('js/ai/engine.js');
  load('js/ai/opponent.js');
  sandbox.BT_UNITS['brawler'] = { name: 'Brawler', movement: { walk: 4, run: 6, jump: 0 }, weapons: [] };
  sandbox.BT_UNITS['target'] = { name: 'Target', movement: { walk: 4, run: 6, jump: 0 }, weapons: [] };
  // Assign inside the context so the lexical bindings declared by the loaded
  // scripts (not shadowed sandbox properties) receive the fixture data.
  vm.runInContext(`
    mechInstances = ${JSON.stringify(mechs)};
    currentGameState = {
      round: 12, phase: ${JSON.stringify(phase)},
      active_player_id: ${activeSeat === 1 ? "'human-player'" : "'ai-player'"},
      initiative_order: [{ player_id: 'human-player', seat_number: 1 }, { player_id: 'ai-player', seat_number: 2 }]
    };
  `, sandbox);
  return sandbox;
}

const mech = (id, owner, extra = {}) => ({
  instanceId: id, unitId: owner === 2 ? 'brawler' : 'target', owner, col: 4, row: 4,
  facing: 0, torsoFacing: 0, hasMoved: false, hasReacted: false, hasFired: false,
  hasPhysicalAttacked: false, hasManagedHeat: false, heat: 0, shutdown: false,
  prone: false, destroyed: false, pilot: { consciousness: 'conscious' },
  armor: { ct: 20 }, structure: { ct: 15 }, ...extra
});

// ── 1. The #33 wedge: last unmoved unit has an unconscious pilot ──
{
  const sb = makeSandbox([
    mech('orion', 1, { pilot: { consciousness: 'unconscious' } }),
    mech('timber', 2, { hasMoved: true })
  ], { activeSeat: 1 });
  // Human seat 1 owns only the unconscious Orion: no legal move exists,
  // so the phase must complete with zero submissions (button enabled).
  const humanTurn = vm.runInContext(`activePlayerPhaseComplete('movement')`, sb);
  check('movement completes when the only unmoved unit is unconscious', humanTurn === true,
    `complete=${humanTurn}`);
}

// ── 2. No over-permissiveness: a healthy unmoved unit still blocks ──
{
  const sb = makeSandbox([
    mech('orion', 1, { pilot: { consciousness: 'unconscious' } }),
    mech('warhammer', 1),
    mech('timber', 2, { hasMoved: true })
  ], { activeSeat: 1 });
  const units = vm.runInContext(`getPhaseUnitsForActivePlayer().map(m => m.instanceId)`, sb);
  const humanTurn = vm.runInContext(`activePlayerPhaseComplete('movement')`, sb);
  check('the gate still sees the conscious unit', JSON.stringify(units) === '["warhammer"]', `units=${JSON.stringify(units)}`);
  check('a conscious unmoved BattleMech still blocks the phase', humanTurn === false, `complete=${humanTurn}`);
}

// ── 3. Shutdown units are skipped like the server's gate does ──
{
  const sb = makeSandbox([mech('orion', 1, { shutdown: true }), mech('timber', 2, { hasMoved: true })], { activeSeat: 1 });
  const humanTurn = vm.runInContext(`activePlayerPhaseComplete('movement')`, sb);
  check('movement completes when the only unmoved unit is shutdown', humanTurn === true);
}

// ── 4. AI movement plan never queues actions for un-act-able units ──
{
  const sb = makeSandbox([
    mech('ai-un', 2, { pilot: { consciousness: 'unconscious' } }),
    mech('ai-ok', 2),
    mech('p-1', 1, { col: 5, row: 4 })
  ]);
  const plan = sb.generateAIPlan('expert', 'ai-player', vm.runInContext('currentGameState', sb),
    [{ player_id: 'ai-player', seat_number: 2, is_ai: true }]);
  const forUnconscious = plan.actions.filter(a => a.instanceId === 'ai-un');
  const forConscious = plan.actions.filter(a => a.instanceId === 'ai-ok');
  check('unconscious-pilot unit receives no movement action', forUnconscious.length === 0,
    `actions=${JSON.stringify(forUnconscious)}`);
  check('conscious unit still receives its movement activation', forConscious.length === 1,
    `actions=${forConscious.length}`);
}

if (failures.length) { console.log(`FAILURES: ${failures.length}`); process.exit(1); }
console.log('all phase-eligibility checks passed');
