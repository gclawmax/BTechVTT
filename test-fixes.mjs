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
  localStorage: { getItem: () => null, setItem: () => {} },
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
  mapZoom: 1, mapPanX: 0, mapPanY: 0, mapRotation: 0, gridOffsetX: 0, gridOffsetY: 0,
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
load('js/core/game-log.js');
load('js/game/critical-hits.js');
load('js/game/weapon-attack.js');
load('js/game/mech-designer.js');
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
const forwardSecondary = sandbox.evaluateWeaponAttack(aDefault, t3, wpn, { secondaryTarget: true });
check('#3 a secondary target in the forward arc adds +1', forwardSecondary.multipleTargets === 1 && forwardSecondary.targetNumber === tnDefault + 1, `tn=${forwardSecondary.targetNumber}`);
const originalTerrainAt = sandbox.terrainAt;
sandbox.terrainAt = (col, row) => col === t3.col && row === t3.row ? 'shallow_water' : 'clear';
const waterCoverShot = sandbox.evaluateWeaponAttack(aDefault, t3, wpn);
check('#3 a standing target in shallow water receives partial cover', waterCoverShot.targetNumber === tnDefault + 1 && waterCoverShot.breakdown.includes('partial cover 1'), waterCoverShot.breakdown);
sandbox.terrainAt = originalTerrainAt;

// A valid range is not enough: a blocked shot and a destroyed target must
// never become selectable in the attack panel.
sandbox.woodsBetween = () => 3;
check('#3 line of sight blocks dense intervening woods', !sandbox.evaluateWeaponAttack(aDefault, t3, wpn).valid && /line of sight/i.test(sandbox.evaluateWeaponAttack(aDefault, t3, wpn).reason));
sandbox.woodsBetween = () => 0;
sandbox.elevationBlocksLineOfSight = () => true;
check('#3 line of sight blocks an intervening ridge', !sandbox.evaluateWeaponAttack(aDefault, t3, wpn).valid && /ridge/i.test(sandbox.evaluateWeaponAttack(aDefault, t3, wpn).reason));
sandbox.elevationBlocksLineOfSight = () => false;
const destroyedTarget = { ...t3, destroyed: true };
check('#3 destroyed targets cannot be selected for weapon attacks', !sandbox.evaluateWeaponAttack(aDefault, destroyedTarget, wpn).valid);
const shutdownTarget = { ...t3, shutdown: true };
check('#3 shutdown BattleMechs remain selectable weapon targets', sandbox.canBeWeaponTarget(shutdownTarget) && sandbox.evaluateWeaponAttack(aDefault, shutdownTarget, wpn).valid);

// Indirect LRM fire is legal only when the attacker lacks LOS and a friendly
// spotter has LOS. It includes +1 indirect fire and the spotter's movement.
const lrm = { key: 'lrm10', name: 'LRM 10', location: 'Left Torso', weapon: { key: 'lrm10', name: 'LRM 10', damage: 10, heat: 4, range: [7, 14, 21], minimumRange: 6 } };
const spotter = { ...mkMech(4), instanceId: 's', col: 2, row: 1, movementMode: 'walk' };
sandbox.mechInstances = [aDefault, spotter, t3];
sandbox.elevationBlocksLineOfSight = observer => observer.instanceId === 'a';
const indirect = sandbox.evaluateWeaponAttack(aDefault, t3, lrm, { indirect: true, spotter });
check('#3 indirect LRM accepts a valid spotter when attacker LOS is blocked', indirect.valid, indirect.reason || indirect.breakdown);
check('#3 indirect LRM includes indirect and spotter movement modifiers', indirect.targetNumber === 10, `tn=${indirect.targetNumber}`);
const offArcTarget = { ...t3, instanceId: 'off-arc', col: 0, row: 3 };
sandbox.mechInstances = [aDefault, spotter, offArcTarget];
const offArcPrimary = sandbox.evaluateWeaponAttack(aDefault, offArcTarget, lrm, { indirect: true, spotter });
const offArcSecondary = sandbox.evaluateWeaponAttack(aDefault, offArcTarget, lrm, { indirect: true, spotter, secondaryTarget: true });
check('#3 a secondary target outside the forward arc adds +2', offArcSecondary.multipleTargets === 2 && offArcSecondary.targetNumber === offArcPrimary.targetNumber + 2, `tn=${offArcSecondary.targetNumber}`);
check('#3 non-LRM weapons cannot use indirect fire', !sandbox.evaluateWeaponAttack(aDefault, t3, wpn, { indirect: true, spotter }).valid);
sandbox.elevationBlocksLineOfSight = () => false;
sandbox.mechInstances = [];

const proneShooter = { ...aDefault, prone: true, proneSupportArm: 'la' };
check('#3 prone support-arm weapon cannot fire', !sandbox.evaluateWeaponAttack(proneShooter, t3, wpn).valid);
check('#3 prone leg-mounted weapon cannot fire', !sandbox.evaluateWeaponAttack({ ...proneShooter, proneSupportArm: 'ra' }, t3, { ...wpn, location: 'Left Leg' }).valid);
check('#3 prone firing requires both arms intact', !sandbox.evaluateWeaponAttack({ ...proneShooter, structure: { ...STRUCT, ra: 0 } }, t3, { ...wpn, location: 'Center Torso' }).valid);
const flippableMech = { ...aDefault, instanceId: 'flip-test' };
sandbox.BT_CRITICAL_LAYOUTS.testmech = { la: ['Shoulder', 'Upper Arm Actuator'], ra: ['Shoulder', 'Upper Arm Actuator'] };
check('#3 arm flipping requires actuator-free arms and no torso twist', sandbox.canFlipBattleMechArms(flippableMech) && !sandbox.canFlipBattleMechArms({ ...flippableMech, torsoFacing: 1 }));
check('#3 flipped arm weapons use only the three-hex rear arc', sandbox.isWeaponTargetInArc(wpn, flippableMech, 3, true) && !sandbox.isWeaponTargetInArc(wpn, flippableMech, 0, true));
check('#3 torso twisting rotates arm-mounted weapon arcs too', sandbox.isWeaponTargetInArc({ ...wpn, location: 'Right Arm' }, { ...flippableMech, torsoFacing: 1 }, 2, false));

// ── #3b LB-X Cluster ammunition starts in its declared mode ───────────────
const lbxMount = { key: 'lb10x', location: 'Left Arm', mountId: 'lb10x:la:0' };
sandbox.BT_UNITS.testmech.weapons = [lbxMount];
sandbox.BT_WEAPONS.lb10x = { name: 'LB 10-X AC', damage: 10, heat: 2, range: [6, 12, 18], ammoType: 'lb10x' };
const lbxMech = { ...mkMech(4), ammoBins: [{ id: 'la:7', type: 'lb10x', loadType: 'cluster', shots: 10 }], weaponPhaseStart: { round: 1, mech: { structure: { ...STRUCT }, ammoBins: [{ id: 'la:7', type: 'lb10x', loadType: 'cluster', shots: 10 }] } } };
sandbox.mechInstances = [lbxMech, t3];
sandbox.currentGameState.phase = 'weapon_attack';
vm.runInContext("weaponAttackState={attackerId:'a',targetId:'t',primaryTargetId:null,targetAssignments:{},weaponKeys:[],ammoBinsByMount:{},fireModesByMount:{}}", sandbox);
check('#3b Cluster-loaded LB-X is selectable', sandbox.compatibleAmmoBins(lbxMech, lbxMount).length === 1);
sandbox.toggleWeaponForAttack('lb10x:la:0');
check('#3b Cluster is selected from the declared ammo bin', vm.runInContext("weaponAttackState.fireModesByMount['lb10x:la:0']", sandbox) === 'cluster');
const slugBin = { id: 'la:8', type: 'lb10x', loadType: 'slug', shots: 10 };
lbxMech.ammoBins.push(slugBin); lbxMech.weaponPhaseStart.mech.ammoBins.push(slugBin);
sandbox.selectAmmoBinForMount('lb10x:la:0', 'la:8');
check('#3b selecting an LB-X bin selects its declared munition', vm.runInContext("weaponAttackState.fireModesByMount['lb10x:la:0']", sandbox) === 'slug');
sandbox.selectAmmoBinForMount('lb10x:la:0', 'la:7');
check('#3b LB-X Cluster applies -1 to the displayed target number', sandbox.evaluateWeaponAttack(lbxMech, t3, lbxMount).targetNumber === 3);
check('#3b ammo picker labels declared munition', sandbox.ammoBinLabel({ location: 'Left Arm', loadType: 'cluster', shots: 10, maxShots: 10 }) === 'Left Arm · Cluster · 10/10 shots');
check('#3b per-mount profile overrides shared weapon key', sandbox.weaponProfile({ key: 'erl', weapon: { name: 'Clan ER Large Laser', damage: 10 } }).damage === 10);
check('#3b explicit combat-log team takes precedence over target label', sandbox.logTeamClass({ team: 2, msg: 'Dire Wolf (P2) fired at Summoner (P1).' }) === 'team-p2');
check('#3b authoritative target breakdown is readable', sandbox.formatAuthoritativeTargetNumber({ breakdown: { gunnery: 4, attacker_movement: 3, lb_x_cluster: -1 } }) === ' (Gunnery 4 + attacker movement 3 − LB-X cluster 1)');

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

// ── #4b Physical attacks and match end ───────────────────────────────────
// Load these after the movement state-machine checks: phases.js owns a local
// game-state object, while the jump test intentionally controls the stub.
load('js/game/physical-attack.js');
load('js/game/phases.js');
sandbox.BT_UNITS.testmech.tonnage = 50;
const physicalAttacker = { ...mkMech(4), col: 4, row: 4, facing: 0, structure: { ...STRUCT, ll: 7, rl: 7 } };
const adjacentTarget = { ...t3, col: 5, row: 4, facing: 3, structure: { ...STRUCT } };
const kick = sandbox.evaluatePhysicalAttack(physicalAttacker, adjacentTarget, 'kick', 'll');
check('#4b adjacent forward kick is legal', kick.valid && kick.damage === 10 && kick.targetNumber === 3, `damage=${kick.damage} tn=${kick.targetNumber}`);
const push = sandbox.evaluatePhysicalAttack(physicalAttacker, adjacentTarget, 'push', 'push');
check('#4b push is legal only directly ahead with both arms', push.valid && push.damage === 0 && !sandbox.evaluatePhysicalAttack({ ...physicalAttacker, facing: 3 }, adjacentTarget, 'push', 'push').valid);
sandbox.BT_CRITICAL_LAYOUTS.testmech = { la: ['Shoulder', 'Upper Arm Actuator', 'Lower Arm Actuator', 'Hand Actuator', 'Sword'], ra: ['Shoulder', 'Upper Arm Actuator', 'Lower Arm Actuator', 'Hand Actuator', 'Hatchet'] };
const sword = sandbox.evaluatePhysicalAttack(physicalAttacker, adjacentTarget, 'physical_sword', 'la');
check('#4b catalogue physical weapons use their own damage and to-hit rules', sword.valid && sword.damage === 6 && sword.targetNumber === 3, `damage=${sword.damage} tn=${sword.targetNumber}`);
const aimedSword = sandbox.evaluatePhysicalAttack(physicalAttacker, adjacentTarget, 'physical_sword__punch', 'la');
check('#4b physical weapons can choose a punch or kick location table at +4', aimedSword.valid && aimedSword.targetNumber === sword.targetNumber + 4);
check('#4b physical weapons are discovered from critical layouts', sandbox.availablePhysicalWeapons(physicalAttacker).some(weapon => weapon.type === 'physical_sword' && weapon.limbs.includes('la')));
check('#4b a physical weapon cannot attack from the wrong arm', !sandbox.evaluatePhysicalAttack(physicalAttacker, adjacentTarget, 'physical_sword', 'ra').valid);
const clubAttacker = { ...physicalAttacker, improvisedClub: { type: 'tree' } };
const club = sandbox.evaluatePhysicalAttack(clubAttacker, adjacentTarget, 'physical_club', 'both');
check('#4b an improvised club uses both working hands and floor(weight/5) damage', club.valid && club.damage === 10 && club.targetNumber === 4, `damage=${club.damage} tn=${club.targetNumber}`);
check('#4b a club is unavailable after either hand is damaged', !sandbox.evaluatePhysicalAttack({ ...clubAttacker, criticalSlotDamage: { la: [3] } }, adjacentTarget, 'physical_club', 'both').valid);
sandbox.elevationAt = (col, row) => col === adjacentTarget.col && row === adjacentTarget.row ? 1 : 0;
check('#4b different levels allow punches but not kicks against a higher target', sandbox.evaluatePhysicalAttack(physicalAttacker, adjacentTarget, 'punch', 'la').valid && !sandbox.evaluatePhysicalAttack(physicalAttacker, adjacentTarget, 'kick', 'll').valid);
sandbox.elevationAt = () => 0;
check('#4b physical attacks reject non-adjacent targets', !sandbox.evaluatePhysicalAttack(physicalAttacker, { ...adjacentTarget, col: 7 }, 'kick', 'll').valid);
check('#4b destroyed limbs cannot make physical attacks', !sandbox.evaluatePhysicalAttack({ ...physicalAttacker, structure: { ...physicalAttacker.structure, ll: 0 } }, adjacentTarget, 'kick', 'll').valid);
sandbox.mechInstances = [physicalAttacker, adjacentTarget];
check('#4b opposing survivors keep the match open', sandbox.determineMatchResult() === null);
sandbox.mechInstances = [physicalAttacker, { ...adjacentTarget, destroyed: true }];
check('#4b destroyed opposing force awards the surviving player victory', sandbox.determineMatchResult()?.winner_seat === 1);
sandbox.mechInstances = [{ ...physicalAttacker, destroyed: true }, { ...adjacentTarget, destroyed: true }];
check('#4b mutually destroyed forces produce a draw', sandbox.determineMatchResult()?.winner_seat === null);

// ── #4c Critical mobility consequences ───────────────────────────────────
sandbox.BT_CRITICAL_LAYOUTS.testmech = {
  ct: ['Gyro', 'Gyro'],
  ll: ['Hip', 'Upper Leg Actuator', 'Lower Leg Actuator', 'Foot Actuator', 'Jump Jet'],
  rl: ['Hip', 'Upper Leg Actuator', 'Lower Leg Actuator', 'Foot Actuator', 'Jump Jet']
};
const actuatorDamaged = { ...mkMech(4), structure: { ...STRUCT }, criticalSlotDamage: { ll: [1, 3] } };
const actuatorProfile = sandbox.criticalMovementProfile(actuatorDamaged);
check('#4c leg and foot actuator hits reduce walking and recalculated running MP', actuatorProfile.walk === 2 && actuatorProfile.run === 3 && actuatorProfile.pilotingModifier === 2, JSON.stringify(actuatorProfile));
const hipDamaged = { ...mkMech(4), structure: { ...STRUCT }, criticalSlotDamage: { ll: [0, 1, 2, 3], rl: [1] } };
const hipProfile = sandbox.criticalMovementProfile(hipDamaged);
check('#4c hip damage halves walking before unaffected-leg deductions', hipProfile.walk === 1 && hipProfile.run === 2 && hipProfile.pilotingModifier === 3, JSON.stringify(hipProfile));
const oneLegged = { ...mkMech(4), structure: { ...STRUCT, ll: 0 }, criticalSlotDamage: {} };
const oneLegProfile = sandbox.criticalMovementProfile(oneLegged);
check('#4c one destroyed leg permits one walking MP but no running', oneLegProfile.walk === 1 && oneLegProfile.run === 0 && oneLegProfile.pilotingModifier === 5, JSON.stringify(oneLegProfile));
const gyroDestroyed = { ...mkMech(4), structure: { ...STRUCT }, criticalSlotDamage: { ct: [0, 1] } };
check('#4c two gyro hits destroy the gyro and impose the automatic-fall modifier', sandbox.criticalMobilityState(gyroDestroyed).gyroDestroyed && sandbox.criticalMobilityState(gyroDestroyed).pilotingModifier === 6);

const repeatedLasers = [
  { key: 'med_laser', location: 'Left Arm', mountId: 'med_laser:la:0' },
  { key: 'med_laser', location: 'Left Arm', mountId: 'med_laser:la:1' }
];
sandbox.BT_UNITS.testmech.weapons = repeatedLasers;
sandbox.BT_CRITICAL_LAYOUTS.testmech.la = ['Medium Laser', 'Medium Laser'];
const oneLaserDestroyed = { ...mkMech(4), criticalSlotDamage: { la: [0] }, destroyedMounts: ['med_laser:la:0'] };
check('#4c identical weapon mounts are destroyed individually', sandbox.isWeaponCriticallyDestroyed(oneLaserDestroyed, repeatedLasers[0]) && !sandbox.isWeaponCriticallyDestroyed(oneLaserDestroyed, repeatedLasers[1]));
const cockpitDestroyed = { ...mkMech(4), pilot: { hits: 0, consciousness: 'conscious' } };
sandbox.criticalEffectMessage(cockpitDestroyed, 'head', 'Cockpit');
check('#4c cockpit destruction persists pilot death', cockpitDestroyed.destroyed && cockpitDestroyed.pilot.hits === 6 && cockpitDestroyed.pilot.consciousness === 'dead');
sandbox.BT_CRITICAL_LAYOUTS.testmech.la = ['Medium Laser', 'Heat Sink', 'IS Ammo AC/5'];
const blownOffArm = { ...mkMech(4), structure: { ...STRUCT }, criticalSlotDamage: {}, ammoBins: [{ id: 'la:2', type: 'ac5', location: 'Left Arm', shots: 20 }] };
sandbox.finalizeBlownOffLocation(blownOffArm, 'la');
check('#4c a blown-off limb retires all slots and ammunition in that location', blownOffArm.structure.la === 0 && blownOffArm.criticalSlotDamage.la.length === 3 && blownOffArm.ammoBins[0].destroyed && blownOffArm.ammoBins[0].shots === 0);

// ── #4d Custom BattleMech construction ───────────────────────────────────
const baseCustomDesign = sandbox.newCustomDesign();
const baseCustomCalculation = sandbox.calculateCustomDesign(baseCustomDesign);
check('#4d a standard 50-ton chassis passes baseline construction', baseCustomCalculation.valid && baseCustomCalculation.rating === 200, JSON.stringify(baseCustomCalculation.errors));
check('#4d maximum armour follows the internal-structure location caps', baseCustomCalculation.armorPoints === 169 && baseCustomCalculation.weights.armor === 11, `armor=${baseCustomCalculation.armorPoints} weight=${baseCustomCalculation.weights.armor}`);
const customAmmoWithoutWeapon = structuredClone(baseCustomDesign);
customAmmoWithoutWeapon.ammo.push({ type: 'ac20', location: 'lt', bins: 1 });
check('#4d ammunition without a matching weapon is rejected', !sandbox.calculateCustomDesign(customAmmoWithoutWeapon).valid && sandbox.calculateCustomDesign(customAmmoWithoutWeapon).errors.some(error => /no matching weapon/i.test(error)));
const customSlotOverflow = structuredClone(baseCustomDesign);
customSlotOverflow.weapons.push({ key: 'ac20', location: 'head' });
check('#4d equipment cannot exceed a location critical-slot capacity', sandbox.calculateCustomDesign(customSlotOverflow).errors.some(error => /Head is over critical-slot capacity/i.test(error)));
const customEngineOverflow = { ...structuredClone(baseCustomDesign), tonnage: 100, walking_mp: 5, armor: sandbox.customMaximumArmor(100) };
check('#4d engine ratings above 400 are rejected', sandbox.calculateCustomDesign(customEngineOverflow).errors.some(error => /400 or less/i.test(error)));
const advancedCustomDesign = { ...structuredClone(baseCustomDesign), engine_type:'is_xl', structure_type:'is_endo_steel', armor_type:'is_ferro_fibrous' };
const advancedCustomCalculation = sandbox.calculateCustomDesign(advancedCustomDesign);
check('#4d IS XL, Endo Steel and Ferro-Fibrous save the correct construction mass', advancedCustomCalculation.valid && advancedCustomCalculation.weights.engine === 4.25 && advancedCustomCalculation.weights.structure === 2.5 && advancedCustomCalculation.weights.armor === 10, JSON.stringify(advancedCustomCalculation.weights));
const clanCustomDesign = { ...structuredClone(baseCustomDesign), tech_base:'clan', engine_type:'clan_xl', structure_type:'clan_endo_steel', armor_type:'clan_ferro_fibrous', weapons:[{key:'clan_er_medium_laser',location:'ra'}] };
const clanCustomCalculation = sandbox.calculateCustomDesign(clanCustomDesign);
check('#4d Clan construction uses Clan slot savings and equipment', clanCustomCalculation.valid && clanCustomCalculation.weights.engine === 4.25 && clanCustomCalculation.weights.armor === 9 && clanCustomCalculation.weaponHeat === 5, JSON.stringify(clanCustomCalculation));
const mixedTechCustomDesign = { ...structuredClone(baseCustomDesign), engine_type:'clan_xl' };
check('#4d mixed Inner Sphere and Clan construction is rejected', !sandbox.calculateCustomDesign(mixedTechCustomDesign).valid && sandbox.calculateCustomDesign(mixedTechCustomDesign).errors.some(error => /tech base/i.test(error)));

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
const clusterMigration = fs.readFileSync(`${ROOT}/SQL/47_lb_x_cluster_target_number.sql`, 'utf8');
check('#5 Cluster migration patches the authoritative target number', clusterMigration.includes('lb_x_cluster_tn_v1') && clusterMigration.includes("THEN tn:=tn-1"));
check('#5 Cluster migration records target-number breakdowns', clusterMigration.includes("''breakdown'',jsonb_build_object"));
const lbxSnapshotMigration = fs.readFileSync(`${ROOT}/SQL/48_fix_lb_x_snapshot_validation.sql`, 'utf8');
check('#5 LB-X snapshot migration validates persisted bins', lbxSnapshotMigration.includes("'attacker_start->''ammoBins''','attacker->''ammoBins''"));
const dfaMigration = fs.readFileSync(`${ROOT}/SQL/55_death_from_above.sql`, 'utf8');
check('#5 Death From Above migration preserves the authoritative physical resolver', dfaMigration.includes("to_regprocedure('public.btech_process_physical_declaration") && dfaMigration.includes("'self_damage'"));
check('#5 Death From Above migration creates shared piloting checks', dfaMigration.includes('btech_resolve_physical_piloting_checks') && dfaMigration.includes('hit by Death From Above'));
const dfaCorrection = fs.readFileSync(`${ROOT}/SQL/56_correct_dfa_movement_declaration.sql`, 'utf8');
check('#5 DFA correction blocks the obsolete Physical Attack declaration', dfaCorrection.includes("p_attack_type NOT IN (''punch'',''kick'',''hatchet'',''dfa'')") && dfaCorrection.includes("p_attack_type NOT IN (''punch'',''kick'',''hatchet'')"));
check('#5 DFA correction declares the attack authoritatively in Movement', dfaCorrection.includes('declare_death_from_above') && dfaCorrection.includes('DFA staging hex must be one hex short'));
const movementSource = fs.readFileSync(`${ROOT}/js/movement/movement.js`, 'utf8');
check('#5 DFA is offered from Movement rather than the Physical Attack panel', movementSource.includes('declareDeathFromAbove') && !fs.readFileSync(`${ROOT}/js/game/physical-attack.js`, 'utf8').includes("attackTypes.push('dfa')"));
const dfaResolution = fs.readFileSync(`${ROOT}/SQL/57_resolve_declared_dfa.sql`, 'utf8');
check('#5 DFA resolution applies Total Warfare grouped damage', dfaResolution.includes('attacker_mass*3/10.0') && dfaResolution.includes('attacker_mass/5.0') && dfaResolution.includes('least(5,remaining)'));
check('#5 DFA resolution lands and displaces in Physical Attacks', dfaResolution.includes('btech_neighbor_hex') && dfaResolution.includes("g.current_phase<>'physical_attack'"));
check('#5 DFA attacker cannot fire weapons', dfaResolution.includes('A BattleMech executing Death From Above cannot fire weapons'));
const chargeMigration = fs.readFileSync(`${ROOT}/SQL/58_charge_attacks.sql`, 'utf8');
check('#5 Charge is declared in Movement and resolved in Physical Attacks', chargeMigration.includes('declare_charge_attack') && chargeMigration.includes('resolve_declared_charge') && chargeMigration.includes("g.current_phase<>'physical_attack'"));
check('#5 Charge damage and counter-damage use unit weights', chargeMigration.includes('att_mass/10.0*') && chargeMigration.includes('tgt_mass/10.0'));
const pushMigration = fs.readFileSync(`${ROOT}/SQL/59_push_attacks.sql`, 'utf8');
check('#5 Push validates both arms and displaces the target', pushMigration.includes('Both arms are required to Push') && pushMigration.includes('btech_neighbor_hex'));
check('#5 Push blocks arm weapon conflicts and rolls target Piloting', pushMigration.includes('cannot Push after firing an arm-mounted weapon') && pushMigration.includes('target_piloting_check'));
const completedPhysicalMigration = fs.readFileSync(`${ROOT}/SQL/60_complete_displacement_physical_falls.sql`, 'utf8');
check('#5 displacement recursively resolves occupied domino chains', completedPhysicalMigration.includes('btech_displace_battlemech_chain') && completedPhysicalMigration.includes('p_depth+1') && completedPhysicalMigration.includes("'domino effect'"));
check('#5 displacement resolves accidental falls from above', completedPhysicalMigration.includes('accidental fall from above') && completedPhysicalMigration.includes('impact_damage') && completedPhysicalMigration.includes('drop_levels>=2'));
check('#5 every complete fall changes facing and checks pilot injury', completedPhysicalMigration.includes('facing_delta') && completedPhysicalMigration.includes('fall_direction_die') && completedPhysicalMigration.includes("btech_apply_pilot_hit(m,'fall')"));
check('#5 ordinary combat and failed stands share complete fall handling', completedPhysicalMigration.includes('CREATE OR REPLACE FUNCTION public.attempt_stand_battlemech') && completedPhysicalMigration.includes('CREATE OR REPLACE FUNCTION public.btech_resolve_physical_piloting_checks') && completedPhysicalMigration.includes('CREATE OR REPLACE FUNCTION public.btech_resolve_weapon_piloting_checks'));
check('#5 Total Warfare physical-equipment table is data driven', ['backhoe','chainsaw','dual_saw','hatchet','mining_drill','retractable_blade','spot_welder','sword','wrecking_ball'].every(key => completedPhysicalMigration.includes(`WHEN '${key}'`)));
check('#5 physical resolver installs deterministically', completedPhysicalMigration.includes('CREATE OR REPLACE FUNCTION public.btech_process_physical_declaration') && !completedPhysicalMigration.includes('Could not safely extend every required physical declaration rule'));
check('#5 blocked DFA searches alternate legal displacement hexes', completedPhysicalMigration.includes('candidate_direction') && completedPhysicalMigration.includes('btech_mark_mech_destroyed'));
const criticalConsequencesMigration = fs.readFileSync(`${ROOT}/SQL/61_critical_hit_consequences.sql`, 'utf8');
check('#5 critical consequences share one mobility model', criticalConsequencesMigration.includes('btech_critical_mobility_state') && criticalConsequencesMigration.includes('btech_critical_movement_profile'));
check('#5 critical consequences compare phase-start snapshots', criticalConsequencesMigration.includes("'weaponPhaseStart'") && criticalConsequencesMigration.includes("'physicalPhaseStart'") && criticalConsequencesMigration.includes('gyro critical hit'));
check('#5 critical movement rolls after running and jump landing', criticalConsequencesMigration.includes('running with damaged hip or gyro') && criticalConsequencesMigration.includes('jump landing with gyro or leg damage'));
check('#5 one-legged standing and automatic falls are authoritative', criticalConsequencesMigration.includes('A BattleMech with both legs destroyed cannot stand') && criticalConsequencesMigration.includes("reasons||jsonb_build_array('leg destroyed')") && criticalConsequencesMigration.includes('automatic_fall:=true'));
const destructionMigration = fs.readFileSync(`${ROOT}/SQL/62_complete_destruction_consequences.sql`, 'utf8');
check('#5 destruction consequences include CASE, ammo pilot hits and location equipment loss', destructionMigration.includes('btech_location_has_case') && destructionMigration.includes('btech_apply_ammunition_explosion') && destructionMigration.includes('btech_destroy_location_components'));
check('#5 a centre-torso ammunition explosion kills the pilot', destructionMigration.includes('centre torso destroyed by ammunition explosion') && destructionMigration.includes("'{pilot,consciousness}'"));
check('#5 SQL 62 patch markers are PostgreSQL string literals, not quoted identifiers', !/^\s*"/m.test(destructionMigration) && destructionMigration.includes("'''inert'',ammo_damage=0)'") && destructionMigration.includes("'''damage'',(bin->>''shots'')::int*ammo_damage)'"));
const terrainMigration = fs.readFileSync(`${ROOT}/SQL/63_complete_common_terrain.sql`, 'utf8');
check('#5 terrain rules cover bundled maps, water, rubble and level costs', terrainMigration.includes('flatlands-open-terrain') && terrainMigration.includes('desert-hills') && terrainMigration.includes('entering water') && terrainMigration.includes('entering rubble') && terrainMigration.includes('abs(next_level-current_level)'));
const proneMigration = fs.readFileSync(`${ROOT}/SQL/64_complete_prone_weapon_fire.sql`, 'utf8');
check('#5 prone fire requires both arms and blocks supporting-arm and leg weapons', proneMigration.includes('after either arm is destroyed') && proneMigration.includes('Leg-mounted weapons cannot fire while prone'));
const indirectMigration = fs.readFileSync(`${ROOT}/SQL/65_lrm_indirect_fire.sql`, 'utf8');
check('#5 indirect LRM resolves spotter movement and simultaneous spotter fire', indirectMigration.includes('spotter_move_mod') && indirectMigration.includes('__spotter_fired') && indirectMigration.includes('A spotter may spot only one target'));
const guidedMigration = fs.readFileSync(`${ROOT}/SQL/66_guided_ammunition_consequences.sql`, 'utf8');
check('#5 supported guided ammunition applies Artemis and Narc cluster modifiers', guidedMigration.includes('artemis_guided') && guidedMigration.includes('narc_guided'));
const systemMigration = fs.readFileSync(`${ROOT}/SQL/67_complete_system_destruction.sql`, 'utf8');
check('#5 repeated weapon mounts and life support consequences are authoritative', systemMigration.includes('btech_mount_for_critical_slot') && systemMigration.includes('life_support_heat_v1'));
const waterCoverMigration = fs.readFileSync(`${ROOT}/SQL/68_shallow_water_partial_cover.sql`, 'utf8');
check('#5 shallow water adds partial cover and absorbs leg hits', waterCoverMigration.includes('shallow_cover_mod') && waterCoverMigration.includes("IN (''ll'',''rl'')") && waterCoverMigration.includes("''partial_cover''"));
const legacyCatalogueMigration = fs.readFileSync(`${ROOT}/SQL/69_repair_legacy_catalogue_pins.sql`, 'utf8');
check('#5 legacy catalogue repair is restricted to a human match participant', legacyCatalogueMigration.includes('p.user_id = auth.uid()') && legacyCatalogueMigration.includes("p.role = 'player'"));
check('#5 legacy catalogue repair requires every deployed unit in one release', legacyCatalogueMigration.includes('unnest(deployed_unit_ids)') && legacyCatalogueMigration.includes('u.catalogue_version = r.version AND u.unit_id = unit_id'));
check('#5 legacy catalogue repair can identify pre-deployment matches from their rosters', legacyCatalogueMigration.includes("jsonb_typeof(match_state->'rosters')") && legacyCatalogueMigration.includes('roster_unit'));
check('#5 legacy catalogue repair stamps the match and each deployed BattleMech', legacyCatalogueMigration.includes("'{catalogueVersion}'") && legacyCatalogueMigration.includes('SET catalogue_version = selected_version'));
check('#5 game loading invokes the narrowly scoped legacy repair', fs.readFileSync(`${ROOT}/js/game/phases.js`, 'utf8').includes('repairLegacyMatchCatalogue(loadedGame)'));
const advancedTerrainMigration = fs.readFileSync(`${ROOT}/SQL/70_advanced_terrain.sql`, 'utf8');
check('#5 advanced terrain adds the Industrial Crossing battlefield', advancedTerrainMigration.includes("WHEN 'industrial-crossing'") && advancedTerrainMigration.includes("'building'") && advancedTerrainMigration.includes("'deep_water'"));
check('#5 smoke, fire, and buildings authoritatively obscure line of sight', advancedTerrainMigration.includes("WHEN 'heavy_smoke' THEN 2") && advancedTerrainMigration.includes("WHEN 'fire' THEN 1") && advancedTerrainMigration.includes("WHEN 'building' THEN 3"));
check('#5 advanced movement resolves pavement control and terrain heat', advancedTerrainMigration.includes('running turn on pavement') && advancedTerrainMigration.includes('pendingTerrainHeat') && advancedTerrainMigration.includes("fire_hexes*2"));
const specialisedAmmoMigration = fs.readFileSync(`${ROOT}/SQL/71_specialised_ammunition.sql`, 'utf8');
check('#5 specialised ammunition supports Inferno and Precision choices', specialisedAmmoMigration.includes("ARRAY['standard','inferno']") && specialisedAmmoMigration.includes("ARRAY['standard','precision']"));
check('#5 Inferno heat and Precision target-modifier reduction are authoritative', specialisedAmmoMigration.includes('missiles_hit*2') && specialisedAmmoMigration.includes("-least(2,target_mod)"));
check('#5 Precision bins carry half shots and legacy matches retain LB-X-only setup', specialisedAmmoMigration.includes('floor(standard_shots/2.0)') && specialisedAmmoMigration.includes("bin->>'type'='lb10x' OR special_setup"));
const advancedMapSource = fs.readFileSync(`${ROOT}/js/game/maps.js`, 'utf8');
const advancedWeaponSource = fs.readFileSync(`${ROOT}/js/game/weapon-attack.js`, 'utf8');
check('#5 client exposes advanced map terrain and specialised ammunition', advancedMapSource.includes("'industrial-crossing'") && advancedWeaponSource.includes("ammoLoadType === 'precision'") && advancedWeaponSource.includes("ammo_load_type === 'inferno'"));
const criticalEdgesMigration = fs.readFileSync(`${ROOT}/SQL/72_complete_critical_effect_edges.sql`, 'utf8');
check('#5 cockpit criticals persist pilot death authoritatively', criticalEdgesMigration.includes('btech_destroy_cockpit') && criticalEdgesMigration.includes("'{pilot,consciousness}'") && criticalEdgesMigration.includes("'{pilot,hits}'"));
check('#5 blown-off locations destroy every component and ammunition bin', criticalEdgesMigration.includes('btech_finalize_blown_off_location') && criticalEdgesMigration.includes('btech_destroy_location_components') && criticalEdgesMigration.includes("'{destroyed}'"));
const terrainInteractionsMigration = fs.readFileSync(`${ROOT}/SQL/73_complete_advanced_terrain_interactions.sql`, 'utf8');
check('#5 dynamic terrain overlays are shared by movement and weapon LOS', terrainInteractionsMigration.includes('btech_state_terrain') && terrainInteractionsMigration.includes('btech_intervening_terrain'));
check('#5 failed pavement checks resolve full skid movement and damage', terrainInteractionsMigration.includes('btech_apply_skid') && terrainInteractionsMigration.includes('hexes_required') && terrainInteractionsMigration.includes('damage_groups'));
check('#5 skids damage buildings and collapse exhausted CF into rubble', terrainInteractionsMigration.includes('construction_factor_after') && terrainInteractionsMigration.includes("'\"rubble\"'::jsonb"));
check('#5 fire advances smoke and building damage once per completed round', terrainInteractionsMigration.includes('btech_advance_terrain_round') && terrainInteractionsMigration.includes('generated_smoke_hexes') && terrainInteractionsMigration.includes('terrain_advanced_after_round'));
const weatheredTerrainMigration = fs.readFileSync(`${ROOT}/SQL/87_weathered_advanced_terrain.sql`, 'utf8');
const mapCatalogueSource = fs.readFileSync(`${ROOT}/js/game/maps.js`, 'utf8');
const weatheredRulesSource = fs.readFileSync(`${ROOT}/js/movement/rules.js`, 'utf8');
const weatheredBoardSource = fs.readFileSync(`${ROOT}/js/game/board.js`, 'utf8');
check('#5 weathered terrain is shared by the map, client movement, rendering and authoritative server', mapCatalogueSource.includes("'weathered-frontier'") && ['ice','deep_snow','mud','sand','swamp','magma_crust','magma_liquid','bridge'].every(type => mapCatalogueSource.includes(`'${type}'`)) && movementSource.includes('deep_snow: 1') && weatheredRulesSource.includes("['ice','deep_snow','mud','sand','swamp','magma_crust','magma_liquid','bridge']") && weatheredTerrainMigration.includes('weathered_terrain_v1'));
check('#5 unstable terrain triggers Piloting, liquid magma is blocked, and magma adds heat', weatheredTerrainMigration.includes("terrain_name IN (''ice'',''swamp'')") && weatheredTerrainMigration.includes("''magma_liquid''") && weatheredTerrainMigration.includes("IN (''fire'',''magma_crust'')") && weatheredBoardSource.includes("'magma_liquid'"));
check('#5 magma crust uses authoritative 1D6 breach thresholds and damages both legs', weatheredTerrainMigration.includes('btech_resolve_magma_crust') && weatheredTerrainMigration.includes("CASE WHEN p_mode='jump' THEN 4 ELSE 6 END") && weatheredTerrainMigration.includes("btech_apply_direct_damage(m,damage,'ll',false)") && weatheredTerrainMigration.includes("btech_apply_direct_damage(m,damage,'rl',false)") && movementSource.includes('magma_crust_checks'));
check('#5 maintained Heat Management consumes end-of-movement fire and magma heat exactly once', weatheredTerrainMigration.includes('weathered_heat_v1') && weatheredTerrainMigration.includes("+(engine_hits*5)+coalesce((mech->>''pendingTerrainHeat'')::int,0)") && weatheredTerrainMigration.includes("'{pendingTerrainHeat}'',''0''::jsonb"));
const multiTargetMigration = fs.readFileSync(`${ROOT}/SQL/74_multi_target_fire_and_ams.sql`, 'utf8');
check('#5 split fire has one primary target and unique weapon allocations', multiTargetMigration.includes('Choose exactly one primary target') && multiTargetMigration.includes('A weapon mount may be allocated only once') && multiTargetMigration.includes('at least one allocated weapon'));
check('#5 split fire enforces forward-arc primary and secondary penalties', multiTargetMigration.includes('A target in the forward arc must be the primary target') && multiTargetMigration.includes('__secondary_modifier') && multiTargetMigration.includes("'multiple_targets'"));
check('#5 split fire preserves indirect spotter restrictions', multiTargetMigration.includes('btech_prepare_multi_target_spotters') && multiTargetMigration.includes('A spotter may designate only one target') && multiTargetMigration.includes('__spotting_while_firing'));
check('#5 standard AMS tracks each mount once per round and consumes ammunition', multiTargetMigration.includes('amsEngagements') && multiTargetMigration.includes('btech_consume_one_live_ammo') && multiTargetMigration.includes("NOT (used ? mount.mount_id)"));
check('#5 AMS uses the correct Streak base and intercepts single Narc missiles', multiTargetMigration.includes('greatest(2,11+ams_modifier)') && multiTargetMigration.includes('single_missile_roll') && multiTargetMigration.includes('intercept_roll<=3'));
const multiTargetClient = fs.readFileSync(`${ROOT}/js/game/weapon-attack.js`, 'utf8');
check('#5 client submits grouped target allocations to the new RPC', multiTargetClient.includes("db.rpc('submit_multi_target_weapon_declaration'") && multiTargetClient.includes('targetAssignments') && multiTargetClient.includes('primaryTargetId'));
const objectiveMigration = fs.readFileSync(`${ROOT}/SQL/75_objectives_and_victory_conditions.sql`, 'utf8');
check('#5 objective modes score control and breakthrough at round end', objectiveMigration.includes("mode='control'") && objectiveMigration.includes("mode='breakthrough'") && objectiveMigration.includes('btech_score_scenario_round'));
check('#5 objective victory thresholds and annihilation fallback are authoritative', objectiveMigration.includes('threshold:=5') && objectiveMigration.includes('threshold:=2') && objectiveMigration.includes("'reason','annihilation'"));
check('#5 objective scoring is idempotent and follows terrain lifecycle', objectiveMigration.includes('objectives_scored_after_round') && objectiveMigration.includes('PERFORM btech_advance_terrain_round') && objectiveMigration.includes('PERFORM btech_score_scenario_round'));
const createGameSource = fs.readFileSync(`${ROOT}/js/network/create-game.js`, 'utf8');
check('#5 match creation records the chosen victory condition', createGameSource.includes("['annihilation', 'control', 'breakthrough']") && createGameSource.includes('objective_hexes'));
const customDesignMigration = fs.readFileSync(`${ROOT}/SQL/76_custom_battlemech_designs.sql`, 'utf8');
check('#5 custom designs are validated and published as immutable catalogue units', customDesignMigration.includes('btech_validate_custom_design') && customDesignMigration.includes('save_btech_custom_design') && customDesignMigration.includes('INSERT INTO btech_catalogue_units'));
check('#5 custom construction validates engine, weight, armour, ammunition and critical slots', customDesignMigration.includes('btech_standard_engine_weight') && customDesignMigration.includes('Design is overweight') && customDesignMigration.includes('Armor exceeds a location maximum') && customDesignMigration.includes('Every ammunition weapon needs at least one compatible bin') && customDesignMigration.includes('btech_build_custom_layout'));
check('#5 custom roster and Hangar entries remain owner-only', customDesignMigration.includes("custom_owner_id''=auth.uid()::text") && customDesignMigration.includes('custom_design_hangar_owner_v1'));
const customDesignerSource = fs.readFileSync(`${ROOT}/js/game/mech-designer.js`, 'utf8');
check('#5 MechLab exposes live construction reporting and server publication', customDesignerSource.includes('calculateCustomDesign') && customDesignerSource.includes("db.rpc('save_btech_custom_design'") && customDesignerSource.includes('Construction report'));
const advancedCustomMigration = fs.readFileSync(`${ROOT}/SQL/78_advanced_custom_mech_construction.sql`, 'utf8');
check('#5 advanced MechLab construction is enforced on the server', advancedCustomMigration.includes("'is_xl'") && advancedCustomMigration.includes("'clan_xl'") && advancedCustomMigration.includes("'is_endo_steel'") && advancedCustomMigration.includes("'clan_endo_steel'") && advancedCustomMigration.includes("'is_ferro_fibrous'") && advancedCustomMigration.includes("'clan_ferro_fibrous'") && advancedCustomMigration.includes('Construction equipment must match the selected tech base'));
check('#5 advanced MechLab publishes resolved Clan equipment and critical-slot layouts', advancedCustomMigration.includes("'clan_er_medium_laser'") && advancedCustomMigration.includes("'lrm20_clan'") && advancedCustomMigration.includes("'Fusion Engine',1") && advancedCustomMigration.includes("'Endo Steel'") && advancedCustomMigration.includes("'Ferro-Fibrous Armour'"));
const lobbySource = fs.readFileSync(`${ROOT}/js/network/lobby.js`, 'utf8');
const mainCssSource = fs.readFileSync(`${ROOT}/css/main.css`, 'utf8');
check('#5 Hangar catalogue groups variants beneath collapsible chassis', lobbySource.includes('expandedLobbyChassis') && lobbySource.includes('chassisGroups(entries)') && lobbySource.includes('roster-chassis-toggle'));
check('#5 roster searches reveal matching chassis without losing saved expansion choices', lobbySource.includes('revealMatches') && lobbySource.includes('expandedLobbyChassis.has(chassis.dataset.chassisKey)') && mainCssSource.includes('.roster-chassis-variants[hidden] { display:none; }'));
check('#5 expanded chassis cards show a variant with movement and weapons', lobbySource.includes('const movementSummary') && lobbySource.includes('const weaponSummary') && lobbySource.includes('roster-option-speed') && lobbySource.includes('roster-option-weapons') && mainCssSource.includes('.roster-option .roster-option-weapons'));
check('#5 deployment uses the battlefield’s staggered hex geometry rather than square cells', lobbySource.includes('function deploymentHexPoints') && lobbySource.includes('<svg class="deployment-map"') && lobbySource.includes('viewBox="0 0 ${mapWidth.toFixed(3)} ${mapHeight}"') && mainCssSource.includes('.deployment-map') && mainCssSource.includes('.deployment-hex { fill:'));
const movementRulesSource = fs.readFileSync(`${ROOT}/js/movement/rules.js`, 'utf8');
check('#5 board redraw restores its device-pixel baseline before applying view transforms', movementRulesSource.includes('ctx.setTransform(dpr, 0, 0, dpr, 0, 0);') && movementRulesSource.includes('stale browser') && movementRulesSource.includes('ctx.rotate(mapRotation'));
const indexSource = fs.readFileSync(`${ROOT}/index.html`, 'utf8');
const supabaseSource = fs.readFileSync(`${ROOT}/js/network/supabase.js`, 'utf8');
const heatSource = fs.readFileSync(`${ROOT}/js/game/heat.js`, 'utf8');
check('#5 dropship and fixed build stamps share the one visible release marker', indexSource.includes('data-build="20260826-shutdown-target-19"') && indexSource.includes('id="map-build-stamp"') && supabaseSource.includes("document.body.dataset.build") && supabaseSource.includes("#bt-build-stamp, #map-build-stamp"));
const catalogueSource = fs.readFileSync(`${ROOT}/js/game/unit-catalogue.js`, 'utf8');
const boardSource = fs.readFileSync(`${ROOT}/js/game/board.js`, 'utf8');
const panelSource = fs.readFileSync(`${ROOT}/js/ui/panels.js`, 'utf8');
check('#5 unarmed custom BattleMechs remain in the pinned catalogue and legacy gaps cannot block rejoin', !catalogueSource.includes('if (!mounts.length || mounts.some') && catalogueSource.includes('An unarmed custom BattleMech') && boardSource.includes('function unavailableUnitRecord') && boardSource.includes('function displayUnitFor') && boardSource.includes('catalogueUnavailable = true') && panelSource.includes('displayUnitFor(inst.unitId)'));
const phasesSource = fs.readFileSync(`${ROOT}/js/game/phases.js`, 'utf8');
check('#5 rejoin verifies every saved unit against its pinned catalogue and isolates any unresolved record once', catalogueSource.includes('async function verifyMatchCatalogueUnits') && catalogueSource.includes('loadUnitCatalogue(catalogueVersion, true)') && phasesSource.includes('verifyMatchCatalogueUnits(game.catalogue_version, gameState.mech_instances)') && phasesSource.includes('could not be loaded from this match') && panelSource.includes('CATALOGUE UNAVAILABLE'));
const scenarioRepairMigration = fs.readFileSync(`${ROOT}/SQL/80_repair_scenario_catalogue_unit_ids.sql`, 'utf8');
check('#5 scenarios persist exact pinned-catalogue IDs and repair untouched historical scenarios safely', scenarioRepairMigration.includes('repair_btech_match_catalogue_unit_ids') && scenarioRepairMigration.includes("g.current_round<>1 OR g.current_phase<>'initiative'") && scenarioRepairMigration.includes("replace(u.unit_id,'-','')") && createGameSource.includes('const resolvedRosters') && catalogueSource.includes('repairScenarioCatalogueUnitIds'));
check('#5 scenario catalogue repair has a visible, cache-busting build marker', indexSource.includes('20260826-shutdown-target-19'));
check('#5 initiative waits for every player to commit Round 1 ammunition without breaking later phase refreshes', phasesSource.includes('const unconfiguredAmmo') && phasesSource.includes('currentGameState.round === 1') && phasesSource.includes(': [];') && phasesSource.includes('const ownAmmoSetupPending') && phasesSource.includes('Waiting for the other player to declare their specialised ammunition.'));
const individualAmmoMigration = fs.readFileSync(`${ROOT}/SQL/81_allow_individual_ammunition_bin_confirmation.sql`, 'utf8');
check('#5 each Round 1 ammunition button commits only its own physical bin', individualAmmoMigration.includes('IF load_type IS NOT NULL THEN') && individualAmmoMigration.includes('IF provided=0') && phasesSource.includes('submitRoundOneAmmoLoadout(binKey = null)') && phasesSource.includes('pendingEntries.filter') && panelSource.includes("Confirm this ammunition bin"));
const allocationAmbiguityMigration = fs.readFileSync(`${ROOT}/SQL/82_fix_weapon_allocation_ambiguity.sql`, 'utf8');
check('#5 multi-target ammunition allocation uses distinct SQL variable and row alias names', allocationAmbiguityMigration.includes('CREATE OR REPLACE FUNCTION public.btech_process_multi_target_declaration') && allocationAmbiguityMigration.includes('target_allocation jsonb') && allocationAmbiguityMigration.includes('allocation_row') && allocationAmbiguityMigration.includes('FOR target_allocation IN') && !allocationAmbiguityMigration.includes('DO $$'));
const roundEndAliasMigration = fs.readFileSync(`${ROOT}/SQL/83_fix_round_end_terrain_and_objective_aliases.sql`, 'utf8');
check('#5 final Heat resolution has unambiguous terrain and objective hex aliases', roundEndAliasMigration.includes('smoke_code text') && roundEndAliasMigration.includes('base.base_hex') && roundEndAliasMigration.includes('objective_hex text') && roundEndAliasMigration.includes('FOR objective_hex IN'));
const weaponArcMigration = fs.readFileSync(`${ROOT}/SQL/84_correct_battlemech_weapon_arcs.sql`, 'utf8');
check('#5 BattleMech torso, left-arm, and right-arm firing arcs follow Total Warfare', sandbox.isWeaponTargetInArc({ location: 'Left Torso' }, aDefault, 2) === false && sandbox.isWeaponTargetInArc({ location: 'Left Arm' }, aDefault, 2) === true && sandbox.isWeaponTargetInArc({ location: 'Left Arm' }, aDefault, 3) === false && sandbox.isWeaponTargetInArc({ location: 'Right Arm' }, aDefault, 4) === true && sandbox.isWeaponTargetInArc({ location: 'Right Arm' }, aDefault, 3) === false && weaponArcMigration.includes('btech_mech_weapon_arc_allows') && weaponArcMigration.includes('IN (0,1,2,5)') && weaponArcMigration.includes('IN (0,1,4,5)'));
check('#5 shutdown startup controls are visible only to the eligible player and explain a blocked attempt', movementSource.includes('You cannot attempt startup for the other player') && movementSource.includes('Startup has already been attempted this round') && movementSource.includes('const canAttempt = isMine && !mech.hasMoved') && movementSource.includes("<button onclick=\"attemptStartup"));
check('#5 Heat Management visibly dissipates first, then resolves post-sink checks', heatSource.includes('previewHeatSinkDissipation') && heatSource.includes('remaining Heat Level') && heatSource.includes('Resolve Remaining Heat Checks') && heatSource.includes('Declare Post-Sink Shutdown Override'));
const shutdownRulesSql = fs.readFileSync(`${ROOT}/SQL/85_shutdown_restart_and_override.sql`, 'utf8');
const startupRulesSql = fs.readFileSync(`${ROOT}/SQL/86_authoritative_startup_pilot_rules.sql`, 'utf8');
check('#5 shutdown SQL automatically restarts below 14 and requires an explicit conscious-pilot override', shutdownRulesSql.includes('shutdown AND shutdown_target=0 THEN shutdown:=false;automatic_restart:=true') && shutdownRulesSql.includes('override_requested AND coalesce(mech->\'pilot\'->>\'consciousness\',\'conscious\')=\'conscious\'') && shutdownRulesSql.includes('declare_shutdown_override'));
check('#5 startup SQL permits automatic recovery without spending Movement and guards manual rolls', startupRulesSql.includes('IF target_number<=2 THEN passed:=true;automatic_restart:=true') && startupRulesSql.includes('A conscious MechWarrior is required for a manual startup attempt') && startupRulesSql.includes('IF NOT automatic_restart THEN mech:=jsonb_set'));
const battleRunnerSource = fs.readFileSync(`${ROOT}/tools/run-battle-regression.mjs`, 'utf8');
const vsAiBattleSource = fs.readFileSync(`${ROOT}/tools/test-vs-ai-fix.mjs`, 'utf8');
const humanBattleSource = fs.readFileSync(`${ROOT}/tools/test-human-vs-human.mjs`, 'utf8');
check('#5 battle regression is one command, runs real battle types, and fails honestly', battleRunnerSource.includes("'tools/test-human-vs-human.mjs'") && battleRunnerSource.includes("'tools/test-vs-ai-fix.mjs'") && battleRunnerSource.includes('BATTLE REGRESSION PASSED') && vsAiBattleSource.includes('if (!overall) process.exitCode = 1;') && humanBattleSource.includes('#lobby-deployment .deployment-map'));
check('#5 detail panel presents one clear Heat Level without source breakdown', panelSource.includes('<div class="k">Heat Level</div><div class="v">${inst.heat || 0}</div>') && !panelSource.includes('move +${inst.movementHeat'));
const sequentialDeploymentMigration = fs.readFileSync(`${ROOT}/SQL/79_allow_sequential_match_deployment.sql`, 'utf8');
check('#5 deployment saves each valid placement while Ready still verifies the complete roster', sequentialDeploymentMigration.includes("jsonb_array_length(p_positions)>count_required") && !sequentialDeploymentMigration.includes("jsonb_array_length(p_positions)<>count_required") && lobbySource.includes('Place BattleMechs in roster order') && lobbySource.includes('deployment_positions?.[String(player.seat_number)] || []).length !=='));
const electronicWarfareMigration = fs.readFileSync(`${ROOT}/SQL/77_electronic_warfare_and_targeting_support.sql`, 'utf8');
const phaseSource = fs.readFileSync(`${ROOT}/js/game/phases.js`, 'utf8');
const weaponAttackSource = fs.readFileSync(`${ROOT}/js/game/weapon-attack.js`, 'utf8');
check('#5 electronic warfare suppresses guidance at an ECM-protected target', electronicWarfareMigration.includes('btech_target_guidance_ecm') && electronicWarfareMigration.includes('guided_ammunition_v1') && electronicWarfareMigration.includes('narc_guided:=narc_guided AND NOT ecm_guidance') && electronicWarfareMigration.includes('artemis_guided:=artemis_guided AND NOT ecm_guidance'));
check('#5 TAG-assisted semi-guided LRM ammunition is selectable and authoritative', electronicWarfareMigration.includes("ARRAY['standard','semi_guided']") && electronicWarfareMigration.includes("ammo_load_type=''semi_guided''") && phaseSource.includes("['standard', 'semi_guided']") && weaponAttackSource.includes('tagGuided'));
check('#5 client reports operational ECM and Beagle probe equipment honestly', weaponAttackSource.includes('hasOperationalEcm') && weaponAttackSource.includes('hasOperationalActiveProbe') && weaponAttackSource.includes('ECM suppressed Narc/Artemis guidance'));
const armClubMigration = fs.readFileSync(`${ROOT}/SQL/88_arm_flipping_and_improvised_clubs.sql`, 'utf8');
check('#5 arm flipping is authoritative, rear-only, and mutually exclusive with torso twisting', armClubMigration.includes('btech_can_flip_battlemech_arms') && armClubMigration.includes('IN (2,3,4)') && armClubMigration.includes('__arms_flipped') && weaponAttackSource.includes('toggleWeaponArmFlip'));
check('#5 arm-flip migration patches the maintained simultaneous-fire snapshot', armClubMigration.includes("coalesce((attacker_start->>''torsoFacing'')::int,(attacker_start->>''facing'')::int") && !armClubMigration.includes("coalesce((attacker->>''torsoFacing'')::int,(attacker->>''facing'')::int"));
check('#5 improvised clubs are found in Weapon Attacks and swung with both arms in Physical Attacks', armClubMigration.includes('find_improvised_club') && armClubMigration.includes("terrain_name IN ('light_woods','heavy_woods')") && armClubMigration.includes("physical_key=''club''") && weaponAttackSource.includes('findImprovisedClub') && fs.readFileSync(`${ROOT}/js/game/physical-attack.js`, 'utf8').includes('bothArms: true'));
check('#5 the detail panel identifies a carried improvised club', panelSource.includes('inst.improvisedClub') && panelSource.includes('uses both arms'));
check('#5 live regression targets SVG deployment hexes and SQL 87 terrain interactions', humanBattleSource.includes('.deployment-hex[aria-label^=') && fs.readFileSync(`${ROOT}/tools/test-human-vs-human-rules.mjs`, 'utf8').includes('magma crust adds transit heat'));
check('#5 realtime subscription catches phase changes missed while connecting', lobbySource.includes("status === 'SUBSCRIBED'") && lobbySource.includes('loadGameState()'));
const scenarioEditorSource = fs.readFileSync(`${ROOT}/js/game/scenario-editor.js`, 'utf8');
const customScenarioMigration = fs.readFileSync(`${ROOT}/SQL/89_custom_map_and_scenario_editor.sql`, 'utf8');
check('#5 map editor paints supported terrain and elevation on the native hex grid', scenarioEditorSource.includes('SCENARIO_TERRAIN') && scenarioEditorSource.includes("type === 'elevation'") && scenarioEditorSource.includes('scenarioEditorHexPoints') && scenarioEditorSource.includes('GRID_COLS'));
check('#5 scenario editor saves drafts and supports JSON import/export', scenarioEditorSource.includes('localStorage.setItem') && scenarioEditorSource.includes('exportScenarioEditor') && scenarioEditorSource.includes('importScenarioEditor'));
check('#5 custom scenarios launch through the normal human lobby', scenarioEditorSource.includes("db.rpc('save_btech_custom_scenario'") && scenarioEditorSource.includes('createHumanGame({') && createGameSource.includes('custom_scenario: customScenario') && lobbySource.includes('gameState.custom_scenario'));
check('#5 custom terrain, elevation and deployment zones are authoritative', customScenarioMigration.includes('CREATE OR REPLACE FUNCTION public.btech_terrain') && customScenarioMigration.includes('CREATE OR REPLACE FUNCTION public.btech_elevation') && customScenarioMigration.includes('btech_scenario_zone_contains') && customScenarioMigration.includes('btech_state_terrain(st'));
check('#5 custom breakthrough uses the opponent authored deployment zone', customScenarioMigration.includes("CASE WHEN unit_owner=1 THEN 2 ELSE 1 END") && customScenarioMigration.includes("mode='breakthrough'"));

// ── Summary ────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log('FAILURES:'); failed.forEach(f => console.log('  ✗ ' + f.name + (f.detail ? ' — ' + f.detail : ''))); process.exit(1); }
console.log('ALL TESTS PASSED');
