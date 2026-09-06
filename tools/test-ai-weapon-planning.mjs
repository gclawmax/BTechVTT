import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const check = (label, condition, detail = '') => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures.push(label);
};

const sandbox = {
  console: { info() {}, warn() {}, error() {}, log() {} },
  currentGameId: '00000000-0000-0000-0000-000000000002',
  currentGameState: { round: 4, phase: 'weapon_attack', active_player_id: 'ai-player' },
  currentMatchConfig: { map_id: 'training-grounds', ruleset: 'advanced_3060' },
  GRID_COLS: 16, GRID_ROWS: 17,
  BT_UNITS: {}, BT_WEAPONS: {}, mechInstances: [],
  getActivePlayerRecord: () => ({ player_id:'ai-player', seat_number:2, is_ai:true }),
  currentActivationAllowance: () => 1,
  mechLabel: mech => mech?.unitId || 'Unknown',
  axialDistance: (a, b, c, d) => Math.max(Math.abs(c - a), Math.abs(d - b)),
  hexNeighbor: (col, row, direction) => ({ col:col + [1,1,0,-1,-1,0][direction], row:row + [0,-1,-1,0,1,1][direction] }),
  terrainMovementBlocked: () => false,
  criticalMovementProfile: () => ({ walk:4, run:6, jump:0 }),
  hasActiveTSM: () => false, boosterRunMP: () => 6, mascTargetNumber: () => 13, hasOperationalMASC: () => false,
  physicalLimbCandidates: () => ['ll','rl'], evaluatePhysicalAttack: () => ({ valid:false }),
  emptyWeaponAttackState: () => ({ attackerId:null, ammoBinsByMount:{}, fireModesByMount:{}, aimLocationsByMount:{} }),
  weaponAttackState: { attackerId:null, ammoBinsByMount:{}, fireModesByMount:{}, aimLocationsByMount:{} },
  weaponProfile: entry => entry?.weapon || sandbox.BT_WEAPONS[entry?.key],
  weaponMountId: (entry, index) => entry.mountId || `${entry.key}:${entry.location}:${index}`,
  weaponPhaseStartMech: mech => mech,
  destroyedHeatSinkCapacity: () => 0,
  signatureHeat: () => 0,
  targetGuidanceEcm: () => false
};
sandbox.evaluateWeaponAttack = (_attacker, target, entry, options = {}) => {
  const mode = sandbox.weaponAttackState.fireModesByMount[entry.mountId] || 'single';
  const base = entry.key === 'laser' ? (target.instanceId === 'near' ? 4 : 11)
    : entry.key === 'uac5' ? (target.instanceId === 'far' ? 5 : 9) : 4;
  return {
    valid:true,
    targetNumber:base + (options.secondaryTarget ? 1 : 0),
    weapon:entry.weapon,
    damage:entry.weapon.damage,
    mode
  };
};
vm.createContext(sandbox);
const load = relative => vm.runInContext(fs.readFileSync(path.join(ROOT, relative), 'utf8'), sandbox, { filename:relative });
load('js/ai/engine.js');
load('js/ai/opponent.js');

const weapons = [
  { key:'laser', mountId:'ra:laser:1', location:'Right Arm', count:1, weapon:{ key:'laser', name:'Medium Laser', damage:5, heat:3 } },
  { key:'uac5', mountId:'lt:uac5:1', location:'Left Torso', count:1, weapon:{ key:'uac5', name:'Ultra AC/5', damage:5, heat:1, ammoType:'uac5' } },
  { key:'uac5', mountId:'lt:uac5:2', location:'Left Torso', count:1, weapon:{ key:'uac5', name:'Ultra AC/5', damage:5, heat:1, ammoType:'uac5' } },
  { key:'ppc', mountId:'la:ppc:1', location:'Left Arm', count:1, weapon:{ key:'ppc', name:'PPC', damage:10, heat:10 } }
];
const ai = {
  instanceId:'ai-1', unitId:'package-test', owner:2, col:8, row:8, facing:3, torsoFacing:3,
  roundStartingHeat:10, movementHeat:0, externalHeat:0, armor:{ ct:30 }, structure:{ ct:20 },
  ammoBins:[{ id:'uac-bin', type:'uac5', location:'Left Torso', shots:3, maxShots:20 }]
};
const near = { instanceId:'near', unitId:'near-target', owner:1, col:7, row:8, facing:0, armor:{ ct:20, lt:10 }, structure:{ ct:15, lt:10 } };
const far = { instanceId:'far', unitId:'far-target', owner:1, col:2, row:8, facing:0, armor:{ ct:20, lt:10 }, structure:{ ct:15, lt:10 } };
sandbox.BT_UNITS['package-test'] = { heat_sinks:10, heat_sink_capacity:10, weapons };
sandbox.BT_UNITS['near-target'] = { weapons:[] };
sandbox.BT_UNITS['far-target'] = { weapons:[] };
sandbox.BT_WEAPONS = Object.fromEntries(weapons.map(entry => [entry.key, entry.weapon]));
sandbox.mechInstances = [ai, near, far];

const context = sandbox.createAIPlanningContext('expert', { ai_seed:'ai-2-test' }, sandbox.mechInstances);
const expertSettings = vm.runInContext('AI_SETTINGS.expert', sandbox);
const action = sandbox.generateAIAttackAction(ai, [near, far], expertSettings, context);
const mounts = action?.allocations?.flatMap(allocation => allocation.weapon_mounts) || [];
const uacAllocation = action?.allocations?.find(allocation => allocation.weapon_mounts.includes('lt:uac5:1'));
check('AI-2 produces one complete authoritative declaration', action?.type === 'attack' && action.allocations.length >= 1, JSON.stringify(action));
check('package planning selects multiple useful mounts rather than one catalogue entry', mounts.includes('ra:laser:1') && mounts.includes('lt:uac5:1'));
check('heat planning excludes a weapon that would exceed the configured post-sink ceiling', !mounts.includes('la:ppc:1') && action.weaponHeat <= 7, `heat ${action?.weaponHeat}`);
check('Ultra AC rapid fire includes its mode and ammunition-bin declaration', uacAllocation?.ammo_bins?.__fire_modes?.['lt:uac5:1'] === 'rapid' && uacAllocation.ammo_bins['lt:uac5:1'] === 'uac-bin');
check('shared ammunition limits downgrade another Ultra mount to a legal single shot', mounts.includes('lt:uac5:2') && !uacAllocation?.ammo_bins?.__fire_modes?.['lt:uac5:2'] && uacAllocation?.ammo_bins?.['lt:uac5:2'] === 'uac-bin');
check('per-mount target scoring can produce legal split fire', action.allocations.length === 2, JSON.stringify(action?.allocations));
check('the action contract accepts the complete package', sandbox.validateAIActionContract(action, 'weapon_attack').valid);
check('the action contract rejects an incomplete single-weapon legacy action', !sandbox.validateAIActionContract({ type:'attack', instanceId:'ai-1', targetInstanceId:'near', weaponKey:'laser' }, 'weapon_attack').valid);

const sql = fs.readFileSync(path.join(ROOT, 'SQL/124_ai_authoritative_weapon_packages.sql'), 'utf8');
const opponentSource = fs.readFileSync(path.join(ROOT, 'js/ai/opponent.js'), 'utf8');
check('SQL 124 routes AI fire through the maintained human weapon resolver', sql.includes('btech_authorized_weapon_player') && sql.includes('submit_multi_target_weapon_declaration'));
check('SQL 124 limits AI authority to an authenticated seated human controller', sql.includes("controller.user_id=auth.uid()") && sql.includes("NOT coalesce(controller.is_ai,false)"));
check('SQL 124 finalizes audit data without accepting BattleMech state', sql.includes('finalize_ai_decision') && !/finalize_ai_decision\([^)]*mech/i.test(sql));
const weaponExecutor = opponentSource.slice(opponentSource.indexOf('async function executeAIWeaponDeclaration'), opponentSource.indexOf('// AI turn handler'));
check('AI weapon execution calls the shared resolver and performs no local dice or damage', weaponExecutor.includes("db.rpc('submit_multi_target_weapon_declaration'") && !weaponExecutor.includes('roll2d6') && !weaponExecutor.includes('applyWeaponDamage'));

if (failures.length) {
  console.error(`\n${failures.length} AI-2 weapon-package regression failure(s).`);
  process.exitCode = 1;
} else {
  console.log('\nAI-2 weapon-package regression passed.');
}
