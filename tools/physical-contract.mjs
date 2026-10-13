// Shared physical-phase contract probe (issue #28 class).
//
// One in-page read that answers the question no earlier suite asked: did the
// PHYSICAL exchanges actually resolve, and did anyone SEE them? Returns the
// btech_combat_events ledger (status + declaration + resolution per row) plus
// gameLog text signals. evaluateContract() then maps raw rows to violations:
//   stranded  — 'declared' rows left behind when the round advanced past
//               them (BT-FFBQ variant A; also current-round rows once every
//               BattleMech has acted = wedged, BT-MZHP/BT-AZML variant B).
//   invisible — rows that ARE resolved but produced no result-shaped line in
//               gameLog (loadResolvedPhysicalEvents early-return under
//               vsAiMode hid exactly this while the engine worked fine).
// Kept separate from step0-common because it audits outcomes, while
// step0-common drives actions.
//
// Visibility predicate (v2 — calibrated on BT-CWWV replay ground truth):
// the v1 cross-message regex matched target-name-before-outcome-verb shapes
// only within 40 chars, so REAL result lines ("kicked Timber Wolf … hit …")
// read as invisible — false-C3 class, caught before any fix claim. v2 tests
// line-by-line: a line is a result trace for target T iff it mentions T,
// pairs a physical-declaration word with an outcome verb (or carries the
// PSR/fall shape outright). Bookkeeping noise ("AI turn started (Physical
// Attack)", "submitted kick for authoritative resolution") pairs no
// declaration+outcome, so it cannot satisfy the predicate.

export function physicalResultLinePredicate(targetName) {
  const decl = /kick|punch|physical attack|piloting skill roll/i;
  const outcome = /\b(hit|miss|damaged?|fell|fall|knocked|no effect)\b/i;
  const needle = targetName.toLowerCase();
  return (msg) => {
    const m = msg.toLowerCase();
    return m.includes(needle) && decl.test(m) && outcome.test(m);
  };
}

export async function auditPhysicalContract(page) {
  return page.evaluate(async () => {
    if (typeof db === 'undefined' || !currentGameId) return { error: 'no game context' };
    const gs = currentGameState || {};
    const { data, error } = await db.from('btech_combat_events')
      .select('round,phase,sequence,status,attacker_instance_id,target_instance_id,declaration,resolution')
      .eq('game_id', currentGameId).order('round').order('phase').order('sequence');
    if (error) return { error: error.message };
    const logLines = (typeof gameLog !== 'undefined' ? gameLog : []).map(e => e.msg || e.message || '');
    // NOTE: everything inside page.evaluate must be self-contained (page
    // serialization cannot carry outer functions — see skill rule on plain
    // JSON across the bridge). This mirrors physicalResultLinePredicate
    // above; keep both in sync and re-run the calibration probe when editing.
    const visibleFor = (needleLower) => {
      const decl = /kick|punch|physical attack|piloting skill roll/i;
      const outcome = /\b(hit|miss|damaged?|fell|fall|knocked|no effect)\b/i;
      return logLines.some(msg => {
        const m = msg.toLowerCase();
        return m.includes(needleLower) && decl.test(m) && outcome.test(m);
      });
    };
    const nameOf = (id) => {
      const inst = (typeof mechInstances !== 'undefined' ? mechInstances : []).find(m => m.instanceId === id || m.id === id);
      if (!inst) return id || '';
      const u = (typeof displayUnitFor === 'function') ? displayUnitFor(inst.unitId) : null;
      // mechLabel shows `${chassis} ${variant} (owner)` — the needle is the
      // chassis+variant part, exactly as display lines spell it.
      return u ? `${u.chassis} ${u.variant}` : (inst.unitId || id);
    };
    const mapped = (data || []).map(r => {
      const tName = nameOf(r.target_instance_id);
      // A resolved real attack must leave a RESULT-shaped line naming the
      // target (see predicate header). No target (pass) is always 'visible'.
      const visible = !r.target_instance_id ? true : visibleFor(tName.toLowerCase());
      return { round: r.round, phase: r.phase, sequence: r.sequence, status: r.status, attacker: r.attacker_instance_id, target: r.target_instance_id, targetName: tName, attackType: r.declaration?.attack_type || 'pass', visible };
    });
    return { error: null, round: gs.round, phase: gs.phase, rows: mapped,
      pausedInLog: logLines.some(l => /AI activation paused/i.test(l)),
      wedgeAllActed: gs.phase === 'physical_attack' && (mechInstances || []).filter(m => !m.destroyed).length > 0 && (mechInstances || []).every(m => m.destroyed || m.hasPhysicalAttacked) };
  });
}

export function evaluatePhysicalContract(audit) {
  // Rows from any round BELOW the live round are history: 'declared' means
  // nobody will ever resolve them.
  const stranded = audit.rows.filter(r => r.status === 'declared' && r.round < audit.round);
  // A physical phase the state has already left — or one where every living
  // BattleMech has finished acting — can hold no in-flight rows either;
  // those are stranding, not pending work.
  if (audit.phase !== 'physical_attack' || audit.wedgeAllActed) {
    for (const r of audit.rows) if (r.round === audit.round && r.phase === 'physical_attack' && r.status === 'declared') stranded.push(r);
  }
  const realAttacks = audit.rows.filter(r => r.phase === 'physical_attack' && r.attackType !== 'pass');
  const invisible = realAttacks.filter(r => r.status === 'resolved' && r.visible === false);
  return { stranded, realAttacks, invisible };
}
