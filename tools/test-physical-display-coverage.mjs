// Hermetic guard for the physical-result DISPLAY + PROBE pair (soak-3,
// BT-XP2P class): every resolved physical row that carries a real result
// must (a) produce a gameLog line — including rows resolved under
// 'physical-recovery-147' — and (b) that line must satisfy the probe's
// result-line predicate, for EVERY attack shape (punch/kick/push/charge/DFA).
// Soak-3 failed on both halves at once: recovery rows never rendered, and
// charge/push/DFA lines (when present) matched neither regex group, so a
// fixed display would still have read as a false C3.
//
// Run: node tools/test-physical-display-coverage.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { physicalResultLinePredicate, evaluatePhysicalContract } from './physical-contract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const check = (label, condition, detail = '') => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures.push(label);
};

const TARGET_LABEL = 'Wolflog WLF-2 (OpFor)';
const ATTACKER_LABEL = 'Atlas AS7-D (OpFor)';

function chain(data) {
  const c = {
    select: () => c, eq: () => c, in: () => c, order: () => c, limit: () => c,
    then: (resolve, reject) => Promise.resolve({ data, error: null }).then(resolve, reject)
  };
  return c;
}

async function runDisplay(rows) {
  const src = fs.readFileSync(path.join(ROOT, 'js/game/physical-attack.js'), 'utf8');
  const log = [];
  const ctx = vm.createContext({
    console: { warn() {}, log() {}, error() {}, info() {} },
    GAME_LOG_MAX: 200,
    currentGameId: '00000000-0000-0000-0000-000000000001',
    mechInstances: [
      { instanceId: 'atk-1', unitId: ATTACKER_LABEL },
      { instanceId: 'tgt-1', unitId: TARGET_LABEL }
    ],
    mechLabel: (m) => (m ? m.unitId : 'Unknown unit'),
    hitLocationLabel: (l) => String(l || 'center torso'),
    // Real versions live in weapon-attack.js (browser globals); the fixture
    // rows carry no criticals/pilot-checks, so faithful empties suffice.
    formatAuthoritativeCriticals: (checks) => (checks && checks.length ? ` crits:${checks.length}` : ''),
    formatAuthoritativePilotCheck: (check) => (check ? ` pilot check ${check.passed ? 'passed' : 'failed'}` : ''),
    mergeRemoteLog: (entries) => { for (const e of entries) log.push(e); },
    db: { from: () => chain(rows) }
  });
  vm.runInContext(src, ctx);
  // Top-level function declarations live on the context global; invoke the
  // one under test explicitly and surface any throw.
  const outcome = await vm.runInContext('(async () => { try { await loadResolvedPhysicalEvents(); return "ok"; } catch (e) { return "THREW: " + (e && e.message || e); } })()', ctx);
  if (outcome !== 'ok') console.log('  [display-run]', outcome, '| log entries:', log.length);
  return { ctx, log };
}

const roll = (t, a, b) => ({ die_a: a, die_b: b, total: a + b, target: t, damage_modifier: 2, situational_modifier: 0 });
const ROWS = [
  { id: 'e1', round: 5, phase: 'physical_attack', sequence: 1, status: 'resolved', attacker_instance_id: 'atk-1', target_instance_id: 'tgt-1',
    declaration: { attack_type: 'punch', limbs: ['RA'] },
    resolution: { state_version: 'authoritative-physical-01', results: [{ attack_type: 'punch', limb: 'RA', hit: true, location: 'Torso', damage: 4, to_hit: roll(9, 3, 4) }] } },
  { id: 'e2', round: 6, phase: 'physical_attack', sequence: 1, status: 'resolved', attacker_instance_id: 'atk-1', target_instance_id: 'tgt-1',
    declaration: { attack_type: 'kick', limbs: ['LL'] },
    resolution: { state_version: 'physical-recovery-147',
      results: [{ attack_type: 'kick', hit: false, to_hit: roll(7, 2, 2) }],
      piloting_checks: [{ instance_id: 'tgt-1', passed: false, automatic: false, fall_damage: 4, reasons: ['physical attack'], to_hit: roll(5, 1, 2) }] } },
  { id: 'e3', round: 6, phase: 'physical_attack', sequence: 2, status: 'resolved', attacker_instance_id: 'atk-1', target_instance_id: 'tgt-1',
    declaration: { attack_type: 'push', limbs: [] },
    resolution: { state_version: 'physical-recovery-147', results: [{ attack_type: 'push_attack', hit: true, to_hit: roll(7, 4, 4) }] } },
  { id: 'e4', round: 6, phase: 'physical_attack', sequence: 3, status: 'resolved', attacker_instance_id: 'atk-1', target_instance_id: 'tgt-1',
    declaration: { attack_type: 'charge', limbs: [] },
    resolution: { state_version: 'physical-recovery-147', results: [{ attack_type: 'charge_attack', hit: true, damage: 6, self_damage: 2, to_hit: roll(10, 5, 6) }] } },
  { id: 'e5', round: 6, phase: 'physical_attack', sequence: 4, status: 'resolved', attacker_instance_id: 'atk-1', target_instance_id: 'tgt-1',
    declaration: { attack_type: 'dfa', limbs: [] },
    resolution: { state_version: 'physical-recovery-147', results: [{ attack_type: 'dfa', hit: false, fall_damage: 3, to_hit: roll(12, 3, 3) }] } },
  { id: 'e6', round: 7, phase: 'physical_attack', sequence: 1, status: 'resolved', attacker_instance_id: 'atk-1', target_instance_id: null,
    declaration: { attack_type: 'pass', limbs: [] },
    resolution: { state_version: 'physical-recovery-147', results: [] } }
];

const { log } = await runDisplay(ROWS);
const msgs = log.map(e => e.msg || e.message || '');
// Entries carry ids; map row -> its entry messages directly.
const rowsWithLines = new Map(ROWS.map(r => [r.id, log.filter(e => String(e.id).includes(r.id)).map(e => e.msg)]));
check('T1a -01 punch renders', (rowsWithLines.get('e1') || []).length === 1, (rowsWithLines.get('e1') || [])[0]);
check('T1b recovery kick + PSR render (2 lines)', (rowsWithLines.get('e2') || []).length === 2, (rowsWithLines.get('e2') || []).join(' / ')?.slice(0, 90));
check('T1c recovery push renders', (rowsWithLines.get('e3') || []).length === 1, (rowsWithLines.get('e3') || [])[0]);
check('T1d recovery charge renders', (rowsWithLines.get('e4') || []).length === 1, (rowsWithLines.get('e4') || [])[0]);
check('T1e recovery DFA renders', (rowsWithLines.get('e5') || []).length === 1, (rowsWithLines.get('e5') || [])[0]);
check('T1f recovery pass renders pass line', (rowsWithLines.get('e6') || []).length === 1, (rowsWithLines.get('e6') || [])[0]);

// T2 — predicate alignment: the ATTACK line for every real row matches the
// probe predicate with the target-name needle.
const attackLine = (row) => (rowsWithLines.get(row.id) || [])[0] || '';
for (const row of ROWS.filter(r => r.declaration.attack_type !== 'pass')) {
  const line = attackLine(row);
  const hit = line && physicalResultLinePredicate(TARGET_LABEL)(line);
  check(`T2 predicate matches ${row.declaration.attack_type} line (R${row.round})`, !!hit, line.slice(0, 90));
}

// T3 — evaluatePhysicalContract closed loop over the real rendered log.
const auditFull = {
  round: 7, phase: 'heat',
  rows: ROWS.map(r => ({
    round: r.round, phase: r.phase, sequence: r.sequence, status: r.status,
    attackType: r.declaration.attack_type,
    visible: r.declaration.attack_type === 'pass' || r.target_instance_id === null
      ? true
      : (rowsWithLines.get(r.id) || []).some(m => physicalResultLinePredicate(TARGET_LABEL)(m))
  })),
  wedgeAllActed: true, pausedInLog: false
};
const eval1 = evaluatePhysicalContract(auditFull);
check('T3a fully-rendered log => zero invisible', eval1.invisible.length === 0, JSON.stringify(eval1.invisible.map(r => `R${r.round}-${r.attackType}`)));

// T3b — tripwire stays armed: strip the charge + DFA lines (recent round).
const auditStripped = {
  ...auditFull,
  rows: auditFull.rows.map(r => ({ ...r, visible: (r.round === 6 && ['charge', 'dfa'].includes(r.attackType)) ? false : r.visible }))
};
const eval2 = evaluatePhysicalContract(auditStripped);
check('T3b stripped recent lines ARE flagged', eval2.invisible.length === 2, JSON.stringify(eval2.invisible.map(r => `R${r.round}-${r.attackType}`)));

// T3c — rolling-window calibration: an aged-out line (round < live-1) is NOT
// a violation (rolling 200-line gameLog trims it by design).
const auditAged = {
  ...auditFull, round: 12,
  rows: [
    { round: 5, phase: 'physical_attack', sequence: 1, status: 'resolved', attackType: 'punch', visible: false },
    { round: 11, phase: 'physical_attack', sequence: 1, status: 'resolved', attackType: 'punch', visible: true },
    { round: 12, phase: 'physical_attack', sequence: 1, status: 'resolved', attackType: 'kick', visible: true }
  ]
};
const eval3 = evaluatePhysicalContract(auditAged);
check('T3c aged-out invisible not counted; recent still would be', eval3.invisible.length === 0, JSON.stringify(eval3.invisible));

// T4 — predicate copies stay in sync (module fn vs in-page mirror).
const srcTool = fs.readFileSync(path.join(ROOT, 'tools/physical-contract.mjs'), 'utf8');
const declCopies = (srcTool.match(/kick\|punch\|physical attack\|piloting skill roll\|push\|charge\|death from above/g) || []).length;
check('T4 predicate exists in exactly 2 synced copies', declCopies === 2, `found ${declCopies}`);

if (failures.length) { console.error(`\n${failures.length} FAILURES`); process.exitCode = 1; }
else console.log('\nAll physical display-coverage checks passed.');