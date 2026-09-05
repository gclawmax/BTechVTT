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
  currentGameId: '00000000-0000-0000-0000-000000000001',
  currentGameState: { round: 3, phase: 'weapon_attack', active_player_id: 'ai-player' },
  currentMatchConfig: { map_id: 'training-grounds', ruleset: 'advanced_3060' },
  mechInstances: [],
  GRID_COLS: 16,
  GRID_ROWS: 17,
  BT_UNITS: {},
  getActivePlayerRecord: () => ({ player_id: 'ai-player', seat_number: 2, is_ai: true }),
  mechLabel: mech => mech?.unitId || 'Unknown',
  axialDistance: (a, b, c, d) => Math.max(Math.abs(c - a), Math.abs(d - b)),
  hexNeighbor: (col, row, direction) => ({ col: col + [1, 1, 0, -1, -1, 0][direction], row: row + [0, -1, -1, 0, 1, 1][direction] }),
  terrainMovementBlocked: () => false,
  criticalMovementProfile: () => ({ walk: 4, run: 6, jump: 0 }),
  hasActiveTSM: () => false,
  boosterRunMP: () => 6,
  mascTargetNumber: () => 13,
  hasOperationalMASC: () => false,
  physicalLimbCandidates: () => ['ll', 'rl'],
  evaluatePhysicalAttack: () => ({ valid: false, reason: 'not adjacent' }),
  evaluateWeaponAttack: (_attacker, _target, weaponEntry) => ({ valid: true, targetNumber: 7, weapon: sandbox.BT_WEAPONS[weaponEntry.key], damage: sandbox.BT_WEAPONS[weaponEntry.key].damage }),
  BT_WEAPONS: { laser: { name: 'Laser', damage: 5, heat: 3 } }
};
vm.createContext(sandbox);
const load = relative => vm.runInContext(fs.readFileSync(path.join(ROOT, relative), 'utf8'), sandbox, { filename: relative });
load('js/ai/engine.js');
load('js/ai/opponent.js');

const ai = { instanceId: 'ai-1', unitId: 'ai-test', owner: 2, col: 8, row: 8, facing: 3, torsoFacing: 3, armor: { ct: 20 }, structure: { ct: 15 } };
const human = { instanceId: 'human-1', unitId: 'human-test', owner: 1, col: 5, row: 8, facing: 0, torsoFacing: 0, armor: { ct: 20 }, structure: { ct: 15 } };
sandbox.BT_UNITS['ai-test'] = { name: 'AI Test', movement: { walk: 4, run: 6, jump: 0 }, weapons: [{ key: 'laser', location: 'Right Arm', count: 1 }] };
sandbox.BT_UNITS['human-test'] = { name: 'Human Test', movement: { walk: 4, run: 6, jump: 0 }, weapons: [] };
sandbox.mechInstances = [ai, human];

const contextA = sandbox.createAIPlanningContext('expert', { ai_seed: 'fixed-seed' }, sandbox.mechInstances);
const contextB = sandbox.createAIPlanningContext('expert', { ai_seed: 'fixed-seed' }, sandbox.mechInstances);
check('identical battlefield snapshots produce the same decision identity and seed', contextA.decisionId === contextB.decisionId && contextA.seed === contextB.seed);
check('seeded AI randomness is replayable', [contextA.random(), contextA.random(), contextA.random()].join(',') === [contextB.random(), contextB.random(), contextB.random()].join(','));

const changed = [{ ...ai, heat: 1 }, human];
const contextChanged = sandbox.createAIPlanningContext('expert', { ai_seed: 'fixed-seed' }, changed);
check('a meaningful battlefield change produces a different snapshot hash', contextChanged.snapshotHash !== contextA.snapshotHash);
check('phase contracts reject actions in the wrong phase', !sandbox.validateAIActionContract({ type: 'move', instanceId: 'ai-1' }, 'weapon_attack').valid);
check('phase contracts require weapon and target identities', !sandbox.validateAIActionContract({ type: 'attack', instanceId: 'ai-1' }, 'weapon_attack').valid);

const weaponPlanA = sandbox.generateAIPlan('expert', null, { ai_seed: 'fixed-seed' }, []);
const weaponPlanB = sandbox.generateAIPlan('expert', null, { ai_seed: 'fixed-seed' }, []);
check('every eligible AI BattleMech receives an explicit weapon action or pass', weaponPlanA.actions.length === 1 && ['attack', 'no_fire'].includes(weaponPlanA.actions[0].type), JSON.stringify(weaponPlanA.actions));
check('the same phase snapshot produces the same planned action', JSON.stringify(weaponPlanA.actions) === JSON.stringify(weaponPlanB.actions));
check('plans carry the replay and audit envelope', weaponPlanA.decision?.engine_version === 'ai-1.0' && weaponPlanA.decision?.snapshot_hash && weaponPlanA.decision?.seed);

sandbox.currentGameState.phase = 'physical_attack';
ai.hasPhysicalAttacked = false;
const physicalPlan = sandbox.generateAIPlan('expert', null, { ai_seed: 'fixed-seed' }, []);
check('no legal physical target produces an explicit pass', physicalPlan.actions.length === 1 && physicalPlan.actions[0].type === 'no_physical_attack');

const movementSource = fs.readFileSync(path.join(ROOT, 'js/movement/movement.js'), 'utf8');
const movementRulesSource = fs.readFileSync(path.join(ROOT, 'js/movement/rules.js'), 'utf8');
const lobbySource = fs.readFileSync(path.join(ROOT, 'js/network/lobby.js'), 'utf8');
const sqlSource = fs.readFileSync(path.join(ROOT, 'SQL/123_ai_authoritative_foundation.sql'), 'utf8');
check('Play vs AI snapshots use the guarded RPC rather than a direct table update', movementSource.includes("db.rpc('submit_ai_phase_state'") && !movementSource.includes("db.from('btech_games').update({ state: JSON.stringify(gameState)"));
check('a fresh AI match persists the same canonical starting force that the board displays', movementRulesSource.includes('function buildDefaultVsAIMechInstances()') && lobbySource.includes('gameState.mech_instances = buildDefaultVsAIMechInstances()'));
check('SQL 123 verifies controller, AI turn, unit identities and phase actions', ['Only the seated human participant', 'An AI decision was submitted outside the AI turn', 'attempted to replace a deployed BattleMech identity', 'outside the active phase'].every(marker => sqlSource.includes(marker)));
check('SQL 123 keeps a durable participant-readable decision record', sqlSource.includes('CREATE TABLE IF NOT EXISTS public.btech_ai_decisions') && sqlSource.includes('Participants can view AI decisions'));

if (failures.length) {
  console.error(`\n${failures.length} AI-1 regression failure(s).`);
  process.exitCode = 1;
} else {
  console.log('\nAI-1 decision foundation regression passed.');
}
