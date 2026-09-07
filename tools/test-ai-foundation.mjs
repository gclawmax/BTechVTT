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
  physicalAttackTypesFor: () => ['kick'],
  evaluatePhysicalAttack: () => ({ valid: false, reason: 'not adjacent' }),
  canSearchForImprovisedClub: () => false,
  evaluateWeaponAttack: (_attacker, _target, weaponEntry) => ({ valid: true, targetNumber: 7, weapon: sandbox.BT_WEAPONS[weaponEntry.key], damage: sandbox.BT_WEAPONS[weaponEntry.key].damage }),
  emptyWeaponAttackState: () => ({ attackerId:null, ammoBinsByMount:{}, fireModesByMount:{}, aimLocationsByMount:{} }),
  weaponAttackState: { attackerId:null, ammoBinsByMount:{}, fireModesByMount:{}, aimLocationsByMount:{} },
  weaponProfile: entry => entry?.weapon || sandbox.BT_WEAPONS[entry?.key],
  weaponMountId: (entry, index) => entry.mountId || `${entry.key}:${entry.location}:${index}`,
  weaponPhaseStartMech: mech => mech,
  destroyedHeatSinkCapacity: () => 0,
  signatureHeat: () => 0,
  currentActivationAllowance: () => 1,
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
check('AI-5 contracts reject incomplete displacement and physical actions', !sandbox.validateAIActionContract({ type:'declare_dfa', instanceId:'ai-1', targetInstanceId:'human-1' }, 'movement').valid && !sandbox.validateAIActionContract({ type:'physical_attack', instanceId:'ai-1', targetInstanceId:'human-1', attackType:'kick', limbs:[] }, 'physical_attack').valid);

const weaponPlanA = sandbox.generateAIPlan('expert', null, { ai_seed: 'fixed-seed' }, []);
const weaponPlanB = sandbox.generateAIPlan('expert', null, { ai_seed: 'fixed-seed' }, []);
check('every eligible AI BattleMech receives an explicit weapon action or pass', weaponPlanA.actions.length === 1 && ['attack', 'no_fire'].includes(weaponPlanA.actions[0].type), JSON.stringify(weaponPlanA.actions));
check('the same phase snapshot produces the same planned action', JSON.stringify(weaponPlanA.actions) === JSON.stringify(weaponPlanB.actions));
check('plans carry the replay and audit envelope', weaponPlanA.decision?.engine_version === 'ai-7.1' && weaponPlanA.decision?.snapshot_hash && weaponPlanA.decision?.seed && weaponPlanA.decision?.personality === 'balanced');

const seatOnePlan = sandbox.generateAIPlan('expert', 'human-player', { ai_seed:'seat-one', ai_personality:'balanced', ai_evaluation_seat:1 }, [{ id:'human-player', seat_number:1 }]);
check('AI-7 can evaluate either force without changing unit ownership',seatOnePlan.seat===1&&seatOnePlan.actions[0]?.instanceId===human.instanceId,JSON.stringify(seatOnePlan.actions));

sandbox.currentGameState.phase = 'movement';
ai.hasMoved = false;
human.col = 1;
const movementPlanA = sandbox.generateAIPlan('expert', null, { ai_seed: 'movement-seed' }, []);
const movementPlanB = sandbox.generateAIPlan('expert', null, { ai_seed: 'movement-seed' }, []);
const move = movementPlanA.actions[0];
check('AI-3 movement planning is deterministic', JSON.stringify(movementPlanA.actions) === JSON.stringify(movementPlanB.actions));
check('AI-3 emits a server-compatible path and movement mode', move.type === 'move' && ['walk','run'].includes(move.movementMode) && move.path.every(step => step.action === 'step'), JSON.stringify(move));
check('AI-3 records tactical score components', Number.isFinite(move.scoreBreakdown?.total) && Number.isFinite(move.scoreBreakdown?.rangeScore));

const hiddenSearch = sandbox.generateAIMoveAction(ai, [], { ...sandbox.AI_SETTINGS?.expert, targetPriority:'optimal', planningHorizon:5 }, sandbox.createAIPlanningContext('expert', { ai_seed:'hidden-search' }, [ai]), { capabilities:{ [ai.instanceId]:{ probe:true } }, retreating:new Set() });
check('AI-5 searches the battlefield when every enemy contact is still hidden', hiddenSearch?.type === 'move' && hiddenSearch.scoreBreakdown?.searching === true, JSON.stringify(hiddenSearch));
const candidate = { col:7, row:8, facing:3, hexes:1 };
sandbox.currentMatchConfig.minefields = [{ owner:1, col:7, row:8, density:20, revealed_to:[2] }];
const minedScore = sandbox.aiScoreDestination(ai, candidate, [human], 'walk', { capabilities:{ [ai.instanceId]:{} }, retreating:new Set() });
sandbox.currentMatchConfig.minefields = [];
const clearScore = sandbox.aiScoreDestination(ai, candidate, [human], 'walk', { capabilities:{ [ai.instanceId]:{} }, retreating:new Set() });
check('AI-5 avoids enemy minefields only after they are known to its seat', minedScore.minefieldPenalty === 20 && clearScore.total > minedScore.total, JSON.stringify({ mined:minedScore.total, clear:clearScore.total }));

sandbox.currentGameState.phase = 'weapon_attack';
sandbox.currentActivationAllowance = () => 3;
sandbox.BT_WEAPONS.tag = { name: 'TAG', damage: 0, heat: 0, ranges: { short: 5, medium: 9, long: 15 } };
sandbox.BT_UNITS['ai-tagger'] = { name: 'Tagger', tonnage: 35, movement: { walk: 6, run: 9, jump: 0 }, weapons: [{ key: 'tag', location: 'Right Arm', count: 1 }] };
const tagger = { ...ai, instanceId: 'ai-tagger', unitId: 'ai-tagger', col: 7, hasFired: false };
const striker = { ...ai, instanceId: 'ai-striker', hasFired: false };
const weakened = { ...human, col: 4, armor: { ct: 2 }, structure: { ct: 3 } };
sandbox.mechInstances = [striker, tagger, weakened];
const coordinated = sandbox.generateAIPlan('expert', null, { ai_seed: 'coordination-seed' }, []);
check('AI-4 records a force-level coordinated doctrine', coordinated.coordination?.doctrine === 'coordinated' && coordinated.coordination?.focus_target_id === weakened.instanceId, JSON.stringify(coordinated.coordination));
check('AI-4 activates a support designator before a striker', coordinated.actions[0]?.instanceId === tagger.instanceId, JSON.stringify(coordinated.actions));
check('AI-4 keeps attacks focused on the ranked target', coordinated.actions.filter(action => action.type === 'attack').every(action => action.focusTargetId === weakened.instanceId));

const directEvaluator = sandbox.evaluateWeaponAttack;
sandbox.BT_WEAPONS.lrm5 = { name: 'LRM 5', damage: 5, heat: 2, ammoType: 'lrm5', clusterSize: 5, range: [7,14,21] };
sandbox.BT_UNITS['ai-lrm'] = { name: 'Missile Support', tonnage: 55, movement: { walk: 4, run: 6, jump: 0 }, weapons: [{ key: 'lrm5', location: 'Left Torso', count: 1 }] };
const missile = { ...ai, instanceId: 'ai-lrm', unitId: 'ai-lrm', ammoBins: [{ id: 'lt:1', type: 'lrm5', shots: 12 }] };
const spotter = { ...tagger, instanceId: 'ai-spotter' };
sandbox.isIndirectCapableWeapon = () => true;
sandbox.eligibleIndirectSpotters = () => [spotter];
sandbox.evaluateWeaponAttack = (_attacker, _target, entry, options = {}) => options.indirect
  ? { valid: true, targetNumber: 8, weapon: sandbox.BT_WEAPONS[entry.key], damage: sandbox.BT_WEAPONS[entry.key].damage }
  : { valid: false, reason: 'blocked line of sight' };
sandbox.mechInstances = [missile, spotter, weakened];
const expertSettings = { targetPriority:'optimal',planningHorizon:5,maxProjectedHeat:7,ammoConservation:.15 };
const indirect = sandbox.scoreWeaponAttack(missile, weakened, sandbox.BT_UNITS['ai-lrm'].weapons[0], { settings:expertSettings, coordination:sandbox.buildAIForceCoordination([missile, spotter], [weakened], expertSettings, null) });
check('AI-4 uses a legal friendly spotter when direct LRM fire is blocked', indirect?.indirect === true && indirect?.spotterId === spotter.instanceId, JSON.stringify(indirect && { indirect:indirect.indirect,spotterId:indirect.spotterId }));
sandbox.evaluateWeaponAttack = directEvaluator;

sandbox.physicalAttackTypesFor = () => ['punch','kick'];
sandbox.physicalLimbCandidates = type => type === 'punch' ? ['la','ra'] : ['ll','rl'];
sandbox.evaluatePhysicalAttack = (_attacker,_target,type) => ({ valid:true,targetNumber:type==='punch'?5:7,damage:type==='punch'?5:10 });
const physicalChoice=sandbox.generateAIPhysicalAction(ai,[human],sandbox.aiSettingsFor('expert','balanced'),sandbox.createAIPlanningContext('expert',{ai_seed:'physical',ai_personality:'balanced'},[ai,human]));
check('AI-5 scores every legal physical attack and limb combination',physicalChoice?.attackType==='punch'&&physicalChoice?.limbs?.length===2,JSON.stringify(physicalChoice));
const dfaChoice=sandbox.generateAIPhysicalAction({...ai,dfaDeclaration:{target_instance_id:human.instanceId}},[human]);
check('AI-5 preserves and resolves Movement-declared DFA',dfaChoice?.type==='resolve_dfa'&&dfaChoice?.targetInstanceId===human.instanceId);

sandbox.canSearchForImprovisedClub=()=>true;
const clubChoice=sandbox.generateAIClubSearchAction(ai,[{...human,col:8,row:7}],expertSettings);
check('AI-5 can spend Weapon Attack searching for a club before adjacent physical combat',clubChoice?.type==='find_club',JSON.stringify(clubChoice));
sandbox.canSearchForImprovisedClub=()=>false;

const proneAction=sandbox.generateAIAttackAction({...ai,prone:true,structure:{...ai.structure,la:8,ra:8}},[human],expertSettings);
check('AI-5 braces a prone shooter with the intact arm that sacrifices less weapon value',proneAction?.proneSupportArm==='la',JSON.stringify(proneAction));

sandbox.canFlipBattleMechArms=()=>true;
sandbox.weaponDirectionTo=()=>0;
sandbox.evaluateWeaponAttack=(_attacker,_target,entry)=>sandbox.weaponAttackState.armsFlipped?{valid:true,targetNumber:7,weapon:sandbox.BT_WEAPONS[entry.key],damage:5}:{valid:false,reason:'rear arc'};
sandbox.mechInstances=[ai,human];
const rearAction=sandbox.generateAIPlan('expert',null,{ai_seed:'rear-fire'},[]).actions[0];
check('AI-5 flips eligible arms for a rear target',rearAction?.allocations?.[0]?.ammo_bins?.__arms_flipped===true,JSON.stringify(rearAction));
sandbox.evaluateWeaponAttack=directEvaluator;

sandbox.currentGameState.phase = 'physical_attack';
sandbox.evaluatePhysicalAttack = () => ({ valid: false, reason: 'not adjacent' });
ai.hasPhysicalAttacked = false;
sandbox.mechInstances = [ai, human];
const physicalPlan = sandbox.generateAIPlan('expert', null, { ai_seed: 'fixed-seed' }, []);
check('no legal physical target produces an explicit pass', physicalPlan.actions.length === 1 && physicalPlan.actions[0].type === 'no_physical_attack');

const movementSource = fs.readFileSync(path.join(ROOT, 'js/movement/movement.js'), 'utf8');
const movementRulesSource = fs.readFileSync(path.join(ROOT, 'js/movement/rules.js'), 'utf8');
const lobbySource = fs.readFileSync(path.join(ROOT, 'js/network/lobby.js'), 'utf8');
const sqlSource = fs.readFileSync(path.join(ROOT, 'SQL/123_ai_authoritative_foundation.sql'), 'utf8');
const ai3SqlSource = fs.readFileSync(path.join(ROOT, 'SQL/125_ai_authoritative_tactical_movement.sql'), 'utf8');
const ai5SqlSource = fs.readFileSync(path.join(ROOT, 'SQL/126_ai_authoritative_reactions_and_physical.sql'), 'utf8');
check('Play vs AI snapshots use the guarded RPC rather than a direct table update', movementSource.includes("db.rpc('submit_ai_phase_state'") && !movementSource.includes("db.from('btech_games').update({ state: JSON.stringify(gameState)"));
check('a fresh AI match persists the same canonical starting force that the board displays', movementRulesSource.includes('function buildDefaultVsAIMechInstances()') && lobbySource.includes('gameState.mech_instances = buildDefaultVsAIMechInstances()'));
check('SQL 123 verifies controller, AI turn, unit identities and phase actions', ['Only the seated human participant', 'An AI decision was submitted outside the AI turn', 'attempted to replace a deployed BattleMech identity', 'outside the active phase'].every(marker => sqlSource.includes(marker)));
check('SQL 123 keeps a durable participant-readable decision record', sqlSource.includes('CREATE TABLE IF NOT EXISTS public.btech_ai_decisions') && sqlSource.includes('Participants can view AI decisions'));
check('SQL 125 routes AI movement through the authoritative human resolver', ai3SqlSource.includes('btech_authorized_movement_player') && ai3SqlSource.includes('submit_battlemech_movement(uuid,text,text,jsonb)'));
check('SQL 126 authorizes only the active AI seat controlled by its seated human', ai5SqlSource.includes('btech_authorized_ai_phase_player') && ai5SqlSource.includes('coalesce(actor.is_ai,false)') && ai5SqlSource.includes("st->>'vs_ai_mode'"));
check('SQL 126 covers reaction, physical, prone-support, club and displacement actions', ['submit_torso_twist_reaction','submit_simultaneous_physical_declaration','set_prone_weapon_support_arm','find_improvised_club','declare_death_from_above','declare_charge_attack','resolve_push_attack_legacy','resolve_declared_charge_legacy','resolve_declared_death_from_above_legacy'].every(name => ai5SqlSource.includes(name)));

if (failures.length) {
  console.error(`\n${failures.length} AI-1 regression failure(s).`);
  process.exitCode = 1;
} else {
  console.log('\nAI decision, movement and coordination regression passed.');
}
