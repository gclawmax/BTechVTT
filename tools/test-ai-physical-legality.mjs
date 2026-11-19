// Hermetic contract tests for the AI fired-weapon mirror + rejection recovery
// (BTechVTT issue #28 defect 2: BT-CWWV R4 / BT-MJBJ R3,R8,R9 — the AI
// planner declared punches with arms whose weapons had already fired that
// round; the authoritative server rejected them with "A weapon fired from %
// this round" and every rejection latched the AI turn (failedAiTurnKey),
// wedging the round forever).
//
// The fix has two layers, both exercised here without any network/DB:
//   1. refreshAiFiredArmLimbs() reads the same facts the server checks
//      (this round's weapon_attack combat events + catalogue mount locations)
//      and generateAIPhysicalAction() filters limbs through it, so legal
//      single-arm punches survive while fired-arm punches are never planned.
//   2. executeAIPhysicalAttack() downgrades any unexpected declaration
//      rejection to a legal pass (same shape as the weapon package's no-fire
//      fallback), so the turn hands play back instead of latching.
//
// Run: node tools/test-ai-physical-legality.mjs
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

function chain(result, single = null) {
  const c = {
    select: () => c, eq: () => c, in: () => c, order: () => c, limit: () => c,
    single: () => Promise.resolve(single ?? { data: null, error: 'unexpected single()' }),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  };
  return c;
}

function makeSandbox({ combatEvents = [], catalogueMounts = [], rpcImpl = null, loadMain = false } = {}) {
  const rpcLog = [];
  const logs = [];
  const sandbox = {
    console: { info() {}, warn() {}, error() {}, log() {} },
    setTimeout: fn => { fn(); return 0; },
    currentGameId: '00000000-0000-0000-0000-000000000001',
    currentGameState: { round: 4, phase: 'physical_attack', active_player_id: 'ai-player',
      initiative_order: [{ player_id: 'human-player', seat_number: 1 }, { player_id: 'ai-player', seat_number: 2 }] },
    currentMatchConfig: { map_id: 'training-grounds', ruleset: 'advanced_3060' },
    vsAiMode: true,
    mechInstances: [],
    BT_UNITS: {},
    activeCatalogueVersion: 'bv3-test',
    window: { aiDifficulty: 'expert' },
    getActivePlayerRecord: () => ({ player_id: 'ai-player', seat_number: 2, is_ai: true }),
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
    canSearchForImprovisedClub: () => false,
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
    PHASE_LABELS: { physical_attack: 'Physical Attack' },
    logEvent: msg => logs.push(msg),
    syncMechInstances: async () => {},
    loadGameState: async () => {},
    loadResolvedPhysicalEvents: async () => {},
    checkForMatchEnd: async () => {},
    updateAdvanceButtonState: () => {},
    renderWeaponAttackPanel: () => {}, renderRoster: () => {}, renderDetail: () => {}, draw: () => {},
    db: {
      from: table => {
        if (table === 'btech_combat_events') return chain({ data: combatEvents, error: null });
        if (table === 'btech_catalogue_mounts') return chain({ data: catalogueMounts, error: null });
        if (table === 'btech_games') return chain(null, { data: { state: { ai_difficulty: 'expert' } }, error: null });
        return chain({ data: [], error: null });
      },
      rpc: async (name, args) => {
        const entry = { name, attackType: args?.p_attack_type ?? null, limbs: (args?.p_limbs ?? []).join('+') };
        rpcLog.push(entry);
        if (rpcImpl) return rpcImpl(name, args);
        return { data: { status: 'accepted' }, error: null };
      }
    }
  };
  vm.createContext(sandbox);
  const load = relative => vm.runInContext(fs.readFileSync(path.join(ROOT, relative), 'utf8'), sandbox, { filename: relative });
  load('js/game/team-model.js');
  load('js/ai/engine.js');
  load('js/ai/opponent.js');
  const ai = { instanceId: 'ai-1', unitId: 'brawler', owner: 2, col: 5, row: 5, facing: 0, torsoFacing: 0,
    armor: { ct: 20 }, structure: { ct: 15 } };
  const target = { instanceId: 'p-1', unitId: 'target', owner: 1, col: 5, row: 6, facing: 3, torsoFacing: 3,
    armor: { ct: 20 }, structure: { ct: 15 } };
  sandbox.BT_UNITS['brawler'] = { name: 'Brawler', movement: { walk: 4, run: 6, jump: 0 },
    weapons: [{ key: 'ml', location: 'Right Arm', count: 1 }, { key: 'ml', location: 'Left Arm', count: 1 }] };
  sandbox.BT_UNITS['target'] = { name: 'Target', movement: { walk: 4, run: 6, jump: 0 }, weapons: [] };
  sandbox.mechInstances = [ai, target];
  return { sandbox, rpcLog, logs, ai, target };
}

const rejectPunch = async (name, args) =>
  (name === 'submit_simultaneous_physical_declaration' && args.p_attack_type !== 'pass')
    ? { data: null, error: { message: 'A weapon fired from la this round' } }
    : { data: { status: 'accepted' }, error: null };

// ── 1. Contract mirror builds from the same facts the server reads ──
{
  const { sandbox } = makeSandbox({
    combatEvents: [{ attacker_instance_id: 'ai-1', declaration: { weapon_mounts: ['ml-l', 'sr-t'] } }],
    catalogueMounts: [{ unit_id: 'brawler', mount_id: 'ml-l', location: 'la' }, { unit_id: 'brawler', mount_id: 'sr-t', location: 'ct' }]
  });
  await sandbox.refreshAiFiredArmLimbs();
  check('fired left-arm mount blocks a left-arm punch', sandbox.firedArmLimbBlockers(sandbox.mechInstances[0], 'punch', 'la'));
  check('torso fire does not block punches', !sandbox.firedArmLimbBlockers(sandbox.mechInstances[0], 'punch', 'ra'));
  check('a fired arm blocks the whole two-arm club (SQL/88)', sandbox.firedArmLimbBlockers(sandbox.mechInstances[0], 'club', 'both'));
  check('legs are unaffected by fired-arm blockers', !sandbox.firedArmLimbBlockers(sandbox.mechInstances[0], 'kick', 'll'));
}

// ── 2. Planner excludes a punch whose arm already fired ──
{
  const armed = makeSandbox({
    combatEvents: [{ attacker_instance_id: 'ai-1', declaration: { weapon_mounts: ['ml-r'] } }],
    catalogueMounts: [{ unit_id: 'brawler', mount_id: 'ml-r', location: 'Right Arm' }]
  });
  await armed.sandbox.refreshAiFiredArmLimbs();
  const action = armed.sandbox.generateAIPhysicalAction(armed.ai, [armed.target], armed.sandbox.aiSettingsFor('expert', 'balanced'), null);
  check('fired-arm punch removed; unfired arm still offered', action?.attackType === 'punch' && action.limbs.join('+') === 'la', `limbs=${action?.limbs}`);

  const clean = makeSandbox();
  await clean.sandbox.refreshAiFiredArmLimbs();
  const bothArms = clean.sandbox.generateAIPhysicalAction(clean.ai, [clean.target], clean.sandbox.aiSettingsFor('expert', 'balanced'), null);
  check('unchanged selection while both arms are unfired', bothArms?.attackType === 'punch' && bothArms.limbs.join('+') === 'la+ra', `limbs=${bothArms?.limbs}`);

  const clubSandbox = makeSandbox({
    combatEvents: [{ attacker_instance_id: 'ai-1', declaration: { weapon_mounts: ['ml-l'] } }],
    catalogueMounts: [{ unit_id: 'brawler', mount_id: 'ml-l', location: 'la' }]
  });
  clubSandbox.sandbox.physicalAttackTypesFor = () => ['club', 'kick'];
  clubSandbox.sandbox.physicalLimbCandidates = type => (type === 'club' ? ['both'] : ['ll', 'rl']);
  await clubSandbox.sandbox.refreshAiFiredArmLimbs();
  const physical = clubSandbox.sandbox.generateAIPhysicalAction(clubSandbox.ai, [clubSandbox.target], clubSandbox.sandbox.aiSettingsFor('expert', 'balanced'), null);
  check('club dropped when an arm fired; kick still planned', physical?.attackType === 'kick', `type=${physical?.attackType}`);
}

// ── 3. Full AI physical turn recovers from a server rejection ──
{
  const { sandbox, rpcLog, logs } = makeSandbox({ rpcImpl: rejectPunch });
  const completed = await sandbox.aiTurnHandler();
  const submits = rpcLog.filter(e => e.name === 'submit_simultaneous_physical_declaration');
  check('rejected punch hands play back with a pass (no turn latch)',
    completed === true && submits[0]?.attackType === 'punch' && submits[1]?.attackType === 'pass',
    `submits=${submits.map(s => s.attackType).join(',')}`);
  check('rejection is logged loudly while play hands back',
    logs.some(entry => entry.includes('was rejected') && entry.includes('declaring no physical attack instead')));
}

// ── 4. With the mirror, a both-arms-fired turn plans a pass, not a wedge ──
{
  const { sandbox, rpcLog } = makeSandbox({
    combatEvents: [{ attacker_instance_id: 'ai-1', declaration: { weapon_mounts: ['ml-l', 'ml-r'] } }],
    catalogueMounts: [{ unit_id: 'brawler', mount_id: 'ml-l', location: 'la' }, { unit_id: 'brawler', mount_id: 'ml-r', location: 'ra' }],
    rpcImpl: rejectPunch
  });
  const completed = await sandbox.aiTurnHandler();
  const submits = rpcLog.filter(e => e.name === 'submit_simultaneous_physical_declaration');
  check('fired-arms turn plans no punch and submits only the legal pass',
    completed === true && submits.length === 1 && submits[0].attackType === 'pass',
    `submits=${submits.map(s => s.attackType).join(',')}`);
}

// ── 5. Single unfired arm: punch planned, accepted, no fallback needed ──
{
  const { sandbox, rpcLog } = makeSandbox({
    combatEvents: [{ attacker_instance_id: 'ai-1', declaration: { weapon_mounts: ['ml-r'] } }],
    catalogueMounts: [{ unit_id: 'brawler', mount_id: 'ml-r', location: 'ra' }]
  });
  const completed = await sandbox.aiTurnHandler();
  const submits = rpcLog.filter(e => e.name === 'submit_simultaneous_physical_declaration');
  check('planned punch uses the unfired arm only', completed === true
    && submits.length === 1 && submits[0].attackType === 'punch' && submits[0].limbs === 'la',
    `submits=${submits.map(s => `${s.attackType}:${s.limbs}`).join(',')}`);
}

// ── 6. Failure containment: push rejection still fails loudly, no silent pass ──
{
  const { sandbox, rpcLog } = makeSandbox({
    rpcImpl: async () => ({ data: null, error: { message: 'Push target is no longer adjacent.' } })
  });
  let threw = false;
  try {
    await sandbox.executeAIPhysicalAttack({ type: 'physical_attack', instanceId: 'ai-1', targetInstanceId: 'p-1', attackType: 'push', limbs: [] });
  } catch { threw = true; }
  check('push rejection is not downgraded to a pass', threw
    && rpcLog.some(e => e.name === 'resolve_push_attack') && !rpcLog.some(e => e.attackType === 'pass'),
    `rpc=${rpcLog.map(e => e.name).join(',')}`);
  const { sandbox: stubborn } = makeSandbox({
    rpcImpl: async (name, args) => ({ data: null, error: { message: 'Physical Attack phase has no legal declaration.' } })
  });
  let threw2 = false;
  try {
    await stubborn.executeAIPhysicalAttack({ type: 'physical_attack', instanceId: 'ai-1', targetInstanceId: 'p-1', attackType: 'punch', limbs: ['la'] });
  } catch { threw2 = true; }
  check('a rejected pass still fails loudly (no infinite fallback)', threw2);
}

if (failures.length) { console.log(`FAILURES: ${failures.length}`); process.exit(1); }
console.log('all AI physical-legality checks passed');