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
import { approachEvaluate, reactionActionEvaluate } from './step0-common.mjs';

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
  const p = { rpcs: [], submits: [], reactions: [] };
  const sandbox = {
    console, mechInstances: mechs, mySeatNumber: 1,
    currentGameId: 'g-1',
    currentGameState: { phase: 'movement', round: 5 },
    db: {
      rpc: async (name, args) => {
        p.rpcs.push({ name, id: args?.p_instance_id });
        if (name === 'remain_prone_battlemech') {
          const m = mechs.find(x => x.instanceId === args.p_instance_id);
          if (m) m.hasMoved = true;
        }
        return { error: null };
      }
    },
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

console.log(failures.length ? `\n${failures.length} FAILURE(S)` : '\nall rig-planner pins passed');
if (failures.length) process.exitCode = 1;
