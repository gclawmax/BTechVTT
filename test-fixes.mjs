// Headless test for the four issue fixes. Loads the REAL source files with
// browser globals stubbed, then drives the pure functions + movement state machine.
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = process.cwd();
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

// ── Stub browser / app globals the modules reference ──────────────────────
function fakeEl() {
  return {
    addEventListener: () => {}, removeEventListener: () => {},
    getContext: () => ({ clearRect: () => {}, fillRect: () => {}, beginPath: () => {},
      moveTo: () => {}, lineTo: () => {}, closePath: () => {}, fill: () => {}, stroke: () => {},
      arc: () => {}, save: () => {}, restore: () => {}, translate: () => {}, rotate: () => {},
      scale: () => {}, setTransform: () => {}, fillText: () => {}, measureText: () => ({ width: 0 }),
      drawImage: () => {}, globalAlpha: 1, font: '', fillStyle: '', strokeStyle: '', lineWidth: 1 }),
    style: {}, classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    appendChild: () => {}, removeChild: () => {}, setAttribute: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    textContent: '', innerHTML: '', value: '', disabled: false,
  };
}
const sandbox = {
  console, Math, JSON, Object, Array, Number, String, Boolean, Promise,
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  document: { getElementById: (id) => (id === 'hexmap' ? fakeEl() : null), querySelector: () => null, querySelectorAll: () => [],
    createElement: () => fakeEl(), addEventListener: () => {}, body: { appendChild: () => {} } },
  window: {},
  // board / map
  activeMapId: 'training-grounds',
  getMapDefinition: () => ({ terrain: {}, elevation: {}, width: 16, height: 12 }),
  hexCode: (c, r) => `${String(c).padStart(2, '0')}${String(r).padStart(2, '0')}`,
  // odd-r offset grid (matches js/game/board.js)
  offsetToAxial: (col, row) => ({ q: col - (row - (row & 1)) / 2, r: row }),
  axialToOffset: (q, r) => ({ col: q + (r - (r & 1)) / 2, row: r }),
  elevationAt: () => 0,
  terrainAt: () => 'clear',
  terrainMovementBlocked: () => false,
  woodsBetween: () => 0,
  elevationBlocksLineOfSight: () => false,
  // data
  BT_UNITS: { testmech: { name: 'TestMech', movement: { walk: 4, run: 7, jump: 5 }, weapons: [] } },
  BT_WEAPONS: { medium_laser: { name: 'Medium Laser', damage: 5, heat: 2, range: [4, 8, 16], minimumRange: 0, ammoType: null } },
  BT_CRITICAL_LAYOUTS: {},
  mechInstances: [],
  currentGameState: { round: 1, phase: 'movement' },
  mySeatNumber: 1,
  currentGameId: 'test-game',
  vsAiMode: false,
  selectedInstanceId: null,
  // render / ui no-ops
  draw: () => {}, renderRoster: () => {}, renderDetail: () => {},
  renderMovementPanel: () => {}, renderReactionPanel: () => {},
  updateAdvanceButtonState: () => {},
  logEvent: () => {}, appendGameLog: () => {},
  loadGameState: async () => {}, syncMechInstances: async () => {},
  isMyActiveTurn: () => true,
  criticalToHitModifier: () => 0,
  gyroDestroyedByCritical: () => false,
  criticalLocationKey: () => null, criticalSlotName: (s) => String(s),
  mechLabel: (m) => (m && m.unitId ? m.unitId : 'mech'),
  // canvas + 2d context (rules.js assigns these as implicit globals; draw() guards on them)
  canvas: fakeEl(),
  mapZoom: 1, mapPanX: 0, mapPanY: 0, gridOffsetX: 0, gridOffsetY: 0,
  GRID_ROWS: 12, GRID_COLS: 16, HEX_SIZE: 28,
  // Proxy: any ctx method call is a no-op that returns a gradient/text stub
  // (so chained calls like createLinearGradient().addColorStop() work); property
  // sets are accepted. Lets rules.js's full draw() loop run harmlessly headless.
  ctx: new Proxy({}, {
    get: (t, prop) => {
      if (prop === 'measureText') return () => ({ width: 0 });
      if (prop in t) return t[prop];
      return () => ({ addColorStop: () => {}, width: 0 });
    },
    set: (t, prop, v) => { t[prop] = v; return true; },
  }),
  // db capture
  _rpcCalls: [],
  db: { rpc: async (fn, args) => { sandbox._rpcCalls.push({ fn, args }); return { data: { hexes_moved: 1, mp_used: 1, mp_max: 5 }, error: null }; } },
};
sandbox.window = sandbox;
vm.createContext(sandbox);

function load(rel) {
  const code = fs.readFileSync(`${ROOT}/${rel}`, 'utf8');
  vm.runInContext(code, sandbox, { filename: rel });
}
load('js/movement/rules.js');
load('js/game/weapon-attack.js');
load('js/movement/movement.js');
// moveState is a top-level `let` in rules.js → lives in the context's lexical
// scope, not on the sandbox object. Expose it through a getter that reads it
// in-context so the #4 assertions can observe live state.
Object.defineProperty(sandbox, 'moveState', {
  get: () => vm.runInContext('moveState', sandbox),
  configurable: true,
});

// ── #1 Front hit table: roll 12 → head ─────────────────────────────────────
check('#1 front roll 12 → head', sandbox.hitLocationForRoll(12, 'front') === 'head', `got ${sandbox.hitLocationForRoll(12, 'front')}`);
check('#1 front roll 10 → la', sandbox.hitLocationForRoll(10, 'front') === 'la');
check('#1 front roll 11 → la', sandbox.hitLocationForRoll(11, 'front') === 'la');
check('#1 front roll 2 → ct', sandbox.hitLocationForRoll(2, 'front') === 'ct');

// ── #2 Mirrored side tables ────────────────────────────────────────────────
check('#2 side-right roll 3 → ra', sandbox.hitLocationForRoll(3, 'side-right') === 'ra', `got ${sandbox.hitLocationForRoll(3, 'side-right')}`);
check('#2 side-right roll 6 → rt', sandbox.hitLocationForRoll(6, 'side-right') === 'rt');
check('#2 side-left roll 3 → la (mirrored)', sandbox.hitLocationForRoll(3, 'side-left') === 'la', `got ${sandbox.hitLocationForRoll(3, 'side-left')}`);
check('#2 side-left roll 6 → lt (mirrored)', sandbox.hitLocationForRoll(6, 'side-left') === 'lt', `got ${sandbox.hitLocationForRoll(6, 'side-left')}`);
check('#2 side-left roll 9 → rt (mirrored)', sandbox.hitLocationForRoll(9, 'side-left') === 'rt', `got ${sandbox.hitLocationForRoll(9, 'side-left')}`);
check('#2 side-left roll 11 → ra (mirrored)', sandbox.hitLocationForRoll(11, 'side-left') === 'ra', `got ${sandbox.hitLocationForRoll(11, 'side-left')}`);
check('#2 rear unchanged roll 12 → head', sandbox.hitLocationForRoll(12, 'rear') === 'head');

// attackDirection returns side-left / side-right
const tgt = { col: 5, row: 5, facing: 0 };
// (6,4) is the NE neighbor of (5,5) → direction 1 → side-right; (6,6) is SE → direction 5 → side-left
const atkRight = { col: 6, row: 4 };
const atkLeft = { col: 6, row: 6 };
const dRight = sandbox.attackDirection(atkRight, tgt);
const dLeft = sandbox.attackDirection(atkLeft, tgt);
check('#2 attackDirection distinguishes flanks', dRight !== dLeft && (dRight === 'side-right' || dRight === 'side-left'), `right=${dRight} left=${dLeft}`);
check('#2 attackDirection front', sandbox.attackDirection({ col: 6, row: 5 }, tgt) === 'front');
check('#2 attackDirection rear', sandbox.attackDirection({ col: 4, row: 5 }, tgt) === 'rear');

// ── #3 Gunnery from pilot ──────────────────────────────────────────────────
const STRUCT = { head: 3, ct: 10, lt: 8, rt: 8, la: 5, ra: 5, ll: 7, rl: 7 };
const mkMech = (gun) => ({ instanceId: 'a', unitId: 'testmech', owner: 1, col: 0, row: 0, facing: 0, torsoFacing: 0,
  structure: { ...STRUCT }, armor: {}, hexesMoved: 0, movementMode: 'stand', roundStartingHeat: 0, movementHeat: 0, weaponHeat: 0, externalHeat: 0,
  prone: false, destroyed: false, shutdown: false, pilot: gun == null ? undefined : { consciousness: 'conscious', gunnery: gun } });
const t3 = { instanceId: 't', unitId: 'testmech', owner: 2, col: 3, row: 0, facing: 0, torsoFacing: 0,
  structure: { ...STRUCT }, armor: {}, hexesMoved: 0, movementMode: 'stand', roundStartingHeat: 0, movementHeat: 0, weaponHeat: 0, externalHeat: 0,
  prone: false, destroyed: false, shutdown: false, pilot: { consciousness: 'conscious' } };
const wpn = { key: 'medium_laser', name: 'Medium Laser', location: 'Left Arm', damage: 5, heat: 2, range: [4, 8, 16], minimumRange: 0 };
const aDefault = mkMech(undefined);
const aG6 = mkMech(6);
const tnDefault = sandbox.evaluateWeaponAttack(aDefault, t3, wpn).targetNumber;
const tnG6 = sandbox.evaluateWeaponAttack(aG6, t3, wpn).targetNumber;
// distance 3 is short range (mod 0), both stand (move 0): base is just gunnery
check('#3 default gunnery = 4', tnDefault === 4, `tn=${tnDefault} (expect 4)`);
check('#3 gunnery 6 feeds formula', tnG6 === tnDefault + 2, `default=${tnDefault} g6=${tnG6}`);
check('#3 breakdown shows gunnery', sandbox.evaluateWeaponAttack(aG6, t3, wpn).breakdown.includes('Gunnery 6'));

// ── #4 Jump landing free facing ────────────────────────────────────────────
sandbox.mechInstances = [{ instanceId: 'j1', unitId: 'testmech', owner: 1, col: 2, row: 2, facing: 0, torsoFacing: 0,
  structure: { ...STRUCT }, armor: {}, jumpMP: 5, hexesMoved: 0, mpUsed: 0, hasMoved: false, hasFired: false, shutdown: false, destroyed: false,
  roundStartingHeat: 0, movementHeat: 0, weaponHeat: 0, externalHeat: 0, heat: 0, pilot: { consciousness: 'conscious' } }];
sandbox.currentGameState.phase = 'movement';
await sandbox.startMovementMode('j1', 'jump');
check('#4 jump mode starts', sandbox.moveState.active === true && sandbox.moveState.mode === 'jump');
// land 2 hexes east
sandbox.attemptMoveStep(4, 2);
const jm = sandbox.mechInstances[0];
check('#4 landed, move still active (awaiting facing confirm)', sandbox.moveState.active === true, `active=${sandbox.moveState.active}`);
check('#4 jumpFacing micro-state set', sandbox.moveState.jumpFacing === true);
check('#4 initial facing = travel dir (E=0)', jm.facing === 0, `facing=${jm.facing}`);
const mpBefore = sandbox.moveState.mpUsed;
sandbox.turnMovementFacing('j1', 'left');
check('#4 free turn does NOT cost MP', sandbox.moveState.mpUsed === mpBefore, `mp ${mpBefore}→${sandbox.moveState.mpUsed}`);
check('#4 facing rotated', jm.facing === 1, `facing=${jm.facing}`);
sandbox._rpcCalls.length = 0;
await sandbox.confirmMove();
const rpc = sandbox._rpcCalls.find(c => c.fn === 'submit_battlemech_movement');
check('#4 submit called', !!rpc);
const jumpAction = rpc?.args.p_path?.find(p => p.action === 'jump');
check('#4 chosen facing sent to server', jumpAction?.facing === 1, `facing=${jumpAction?.facing}`);
check('#4 moveState cleared after confirm', sandbox.moveState.active === false);

// ── #5 Release migration guardrails ───────────────────────────────────────
const migration = fs.readFileSync(`${ROOT}/SQL/45_preserve_current_rules_fixes.sql`, 'utf8');
check('#5 migration patches the live weapon resolver', migration.includes("to_regprocedure('public.btech_process_weapon_declaration"));
check('#5 migration preserves later weapon extensions', migration.includes('btech_elevation_blocks_los') && migration.includes('btech_expand_ultra_ac_mounts') && migration.includes('lb_x_ammo_setup_v1'));
check('#5 migration patches the live movement resolver', migration.includes("to_regprocedure('public.submit_battlemech_movement"));
check('#5 migration preserves later movement extensions', migration.includes('btech_elevation') && migration.includes('btech_resolve_rough_ground_piloting_check'));
check('#5 migration validates jump facing', migration.includes("Jump landing facing must be between 0 and 5"));
check('#5 migration tolerates live resolver formatting', (migration.match(/regexp_replace\(patched|regexp_replace\(source/g) || []).length >= 3);
check('#5 migration preserves extra live to-hit modifiers', migration.includes("'base_tn[[:space:]]*:=[[:space:]]*4'"));
check('#5 migration patches the jump assignment directly', migration.includes("'current_facing[[:space:]]*:=[[:space:]]*btech_direction_to"));

// ── Summary ────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log('FAILURES:'); failed.forEach(f => console.log('  ✗ ' + f.name + (f.detail ? ' — ' + f.detail : ''))); process.exit(1); }
console.log('ALL TESTS PASSED');
