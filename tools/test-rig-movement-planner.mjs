// Hermetic pin for the rig's movement/reaction phase planners (issue #33
// recurrence, soak11 BT-5TNM): selection must skip units the shipped phase
// gate excludes (unconscious pilot / shutdown), or the rig chokes on a unit
// that can never complete the phase and the movement phase wedges at
// "myTurn:true, hasMoved:false" until the driver deadline fires.
//
// The planners are page-scope function sources (they get serialised into
// page.evaluate); here they run in a vm with fake page globals. The real
// phaseUnitsAbleToAct is extracted verbatim from js/game/phases.js so the
// test also pins the mirror field names and fails on a rename.
//
// Run: node tools/test-rig-movement-planner.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { approachEvaluate, reactionActionEvaluate, physicalActionEvaluate } from './step0-common.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const check = (label, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures.push(label);
};

const gateSrc = fs.readFileSync(path.join(ROOT, 'js/game/phases.js'), 'utf8')
  .match(/function phaseUnitsAbleToAct\(mech\) \{[\s\S]*?\n\}/);
check('phaseUnitsAbleToAct still exists in phases.js (rig planner calls it by name)',
  Boolean(gateSrc), gateSrc ? '' : 'renamed or removed — rig selectors now ReferenceError');
if (!gateSrc) process.exit(1);

const mech = (id, owner, opts = {}) => ({
  instanceId: id, owner, col: opts.col ?? 5, row: opts.row ?? 5, facing: 0,
  hasMoved: false, hasFired: false, hasReacted: false, hasPhysicalAttacked: false,
  destroyed: false, prone: Boolean(opts.prone), shutdown: Boolean(opts.shutdown),
  pilot: { consciousness: opts.consciousness ?? 'conscious' },
  armor: {}, structure: {}
});

function makePage(mechs) {
  const p = { rpcs: [], submits: [], reactions: [], declares: [] };
  const sandbox = {
    console, mechInstances: mechs, mySeatNumber: 1,
    currentGameId: 'g-1',
    currentGameState: { phase: 'movement', round: 5 },
    submitAuthoritativeMovement: async (m, mode) => {
      p.submits.push({ id: m.instanceId, mode });
      if (!sandbox.__rejectAll) m.hasMoved = true;
    },
    hexNeighbor: (col, row, dir) => ({ col: col + [1, 1, 0, -1, -1, 0][dir], row: row + [0, -1, -1, 0, 1, 1][dir] }),
    terrainMovementBlocked: () => false,
    completeReaction: async id => {
      p.reactions.push(id);
      const m = mechs.find(x => x.instanceId === id);
      if (m) m.hasReacted = true;
    },
    // Physical-phase page globals (unused by movement/reaction planners).
    window: {}, physicalAttackState: null, declares: [],
    evaluatePhysicalAttack: () => ({ valid: true }),
    selectPhysicalAttacker: id => { sandbox.physicalAttackState = { attackerId: id, limbs: [] }; },
    selectPhysicalTarget: id => { sandbox.physicalAttackState.targetId = id; },
    selectPhysicalAttackType: t => { sandbox.physicalAttackState.type = t; sandbox.physicalAttackState.limbs = ['Right Arm']; },
    confirmPhysicalAttack: async () => {
      const st = { ...sandbox.physicalAttackState };
      p.declares.push(st);
      if (!sandbox.__physConfirmFail) {
        const m = mechs.find(x => x.instanceId === st.attackerId);
        if (m) m.hasPhysicalAttacked = true;
      }
    },
    skipEmptyPhysicalPhase: async () => {},
    db: {
      rpc: async (name, args) => {
        p.rpcs.push({ name, id: args?.p_instance_id ?? args?.p_attacker_instance_id });
        if (name === 'remain_prone_battlemech') {
          const m = mechs.find(x => x.instanceId === args.p_instance_id);
          if (m) m.hasMoved = true;
        }
        if (name === 'submit_simultaneous_physical_declaration' && sandbox.__physPassMsg) {
          return { error: { message: sandbox.__physPassMsg } };
        }
        return { error: null };
      }
    }
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(gateSrc[0], ctx);
  p.sandbox = sandbox; p.ctx = ctx;
  return p;
}

function runPlanner(fnFactory, p) {
  const f = vm.runInContext(`(${fnFactory().toString()})`, p.ctx);
  return f();
}

// 1. BT-5TNM replay: unconscious unit must NOT block the prone unit's action.
{
  const mechs = [
    mech('stone-rhino-p1-1', 1, { consciousness: 'unconscious', col: 10, row: 9 }),
    mech('executioner-prime-p1-2', 1, { prone: true, col: 7, row: 7 }),
    mech('atlas-as7-d-p2-1', 2, { col: 8, row: 6 }),
    mech('dire-wolf-prime-p2-2', 2, { col: 11, row: 9 })
  ];
  const p = makePage(mechs);
  let err = null;
  try { await runPlanner(approachEvaluate, p); } catch (e) { err = e; }
  check('unconscious teammate no longer wedges the movement planner', !err, err ? String(err).slice(0, 120) : '');
  check('no movement submissions wasted on the unconscious unit',
    !p.submits.some(s => s.id === 'stone-rhino-p1-1'), JSON.stringify(p.submits));
  check('prone unit got its remain_prone action',
    p.rpcs.some(r => r.name === 'remain_prone_battlemech' && r.id === 'executioner-prime-p1-2'));
}

// 2. Regression: all-conscious roster still drives every unit.
{
  const mechs = [
    mech('a-p1-1', 1, { col: 4, row: 4 }), mech('b-p1-2', 1, { col: 6, row: 6 }),
    mech('e-p2-1', 2, { col: 1, row: 1 })
  ];
  const p = makePage(mechs);
  await runPlanner(approachEvaluate, p);
  check('conscious units all still submitted',
    p.submits.some(s => s.id === 'a-p1-1') && p.submits.some(s => s.id === 'b-p1-2'),
    JSON.stringify(p.submits));
}

// 3. Detection preserved: a REAL stuck unit (submits rejected) still throws.
{
  const mechs = [mech('a-p1-1', 1, { col: 4, row: 4 }), mech('e-p2-1', 2, { col: 1, row: 1 })];
  const p = makePage(mechs);
  p.sandbox.__rejectAll = true;
  let err = null;
  try { await runPlanner(approachEvaluate, p); } catch (e) { err = e; }
  check('genuine movement failure still throws (no silent stall)', Boolean(err));
}

// 4. Reaction selector skips un-act-able units too.
{
  const mechs = [
    mech('a-p1-1', 1, { consciousness: 'unconscious' }), mech('b-p1-2', 1, {}),
    mech('e-p2-1', 2, {})
  ];
  const p = makePage(mechs);
  const r1 = await runPlanner(reactionActionEvaluate, p);
  check('reaction acts on the conscious unit only',
    r1.acted && r1.mech === 'b-p1-2' && !p.reactions.includes('a-p1-1'), JSON.stringify(p.reactions));
}

// 5. Physical selector: BT-TFTJ R4 replay — unconscious Rhino (no adjacent
//    enemy) must not abort the phase evaluation; Executioner is adjacent to
//    the Atlas and must get its punch declared. Pre-fix, the doomed Rhino
//    pass-probe (or its punch attempt) returned early and the phase wedged
//    for the full 2400s driver deadline with myTurn:true, both my units
//    hasPhysicalAttacked:false.
{
  const mechs = [
    mech('stone-rhino-p1-1', 1, { consciousness: 'unconscious', col: 7, row: 11, prone: true }),
    mech('executioner-prime-p1-2', 1, { col: 8, row: 10 }),
    mech('dire-wolf-prime-p2-1', 2, { col: 11, row: 9 }),
    mech('atlas-as7-d-p2-2', 2, { col: 8, row: 9 })
  ];
  const p = makePage(mechs);
  p.sandbox.currentGameState.phase = 'physical_attack';
  let err = null, res = null;
  try { res = await runPlanner(physicalActionEvaluate, p); } catch (e) { err = e; }
  check('physical planner does not abort on the unconscious unit', !err && res && !res.passError,
    String(err || (res && res.passError) || '').slice(0, 120));
  check('the conscious neighbour actually declared its punch',
    p.declares.some(d => d.attackerId === 'executioner-prime-p1-2' && d.targetId === 'atlas-as7-d-p2-2'),
    JSON.stringify(p.declares.map(d => `${d.attackerId}->${d.targetId}:${d.type}`)));
  check('no pass RPC wasted on the unconscious unit',
    !p.rpcs.some(r => r.name === 'submit_simultaneous_physical_declaration' && r.id === 'stone-rhino-p1-1'),
    JSON.stringify(p.rpcs.filter(r => r.name === 'submit_simultaneous_physical_declaration')));
}

// 6. Pass-rejection self-heal with the REAL server 400 wording (captured
//    from soak13 BT-TFTJ): "not eligible" never appears in production text,
//    so the old regex kept re-attempting the doomed pass until the deadline.
{
  const mechs = [mech('a-p1-1', 1, { col: 4, row: 4 }), mech('e-p2-1', 2, { col: 4, row: 3 })];
  const p = makePage(mechs);
  p.sandbox.currentGameState.phase = 'physical_attack';
  p.sandbox.__physConfirmFail = true; // punch attempts fail (no limbs)
  p.sandbox.__physPassMsg = 'Server rejected the Physical Attack declaration: Choose an eligible enemy target';
  let err = null, res = null;
  try { res = await runPlanner(physicalActionEvaluate, p); } catch (e) { err = e; }
  check('production-wording pass rejection self-heals instead of aborting',
    !err && res && res.passError === undefined, JSON.stringify({ err: String(err), res }).slice(0, 160));
  check('rejected unit is remembered as ineligible for the round',
    p.sandbox.window.__step0PhysIneligible?.ids['a-p1-1'] === true);
}

console.log(failures.length ? `\n${failures.length} FAILURE(S)` : '\nall rig-planner pins passed');
if (failures.length) process.exitCode = 1;
