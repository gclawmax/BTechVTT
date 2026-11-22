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
  // Keywords must cover EVERY line shape authoritativePhysicalResultMessage
  // can emit for a real attack (kick/punch, push, charge, DFA). Soak-3 found
  // 'charged ...' and 'pushed ... displaced' lines exist but matched neither
  // group, which would read as a false C3 once recovery-147 rows render.
  const decl = /kick|punch|physical attack|piloting skill roll|push|charge|death from above/i;
  const outcome = /\b(hit|miss(ed)?|damaged?|fell|fall(ing)?|knocked|no effect|displaced)\b/i;
  const needle = targetName.toLowerCase();
  return (msg) => {
    const m = msg.toLowerCase();
    return m.includes(needle) && decl.test(m) && outcome.test(m);
  };
}

// C2 recalibration (soak v4, 21 Nov): 6/6 real matches contained a
// self-recovering pause blip, so a window-presence check failed every honest
// game — a checker that cries wolf teaches nobody to trust it. A pause is a
// violation only while it is the LATEST AI turn-status line: the AI gave up
// and no activation completed since. The in-battle twin lives inside
// auditPhysicalContract's page.evaluate (page serialization cannot carry
// imports); keep both in sync, covered by test-physical-contract-calibration.
export function aiPauseActive(logLines) {
  for (let i = logLines.length - 1; i >= 0; i--) {
    if (/AI (turn|activation) (paused|complete)/i.test(logLines[i])) return /paused/i.test(logLines[i]);
  }
  return false;
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
      const decl = /kick|punch|physical attack|piloting skill roll|push|charge|death from above/i;
      const outcome = /\b(hit|miss(ed)?|damaged?|fell|fall(ing)?|knocked|no effect|displaced)\b/i;
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
    // In-page mirror of aiPauseActive — keep in sync (see header note).
    const statusRe = /AI (turn|activation) (paused|complete)/i;
    let pauseActive = false;
    for (let i = logLines.length - 1; i >= 0; i--) {
      if (statusRe.test(logLines[i])) { pauseActive = /paused/i.test(logLines[i]); break; }
    }
    // statusTail: full AI status sequence (bounded) so a failed rig run can
    // be forensicked from the report alone — the DB may purge combat rows and
    // the console only echoes error-level lines.
    const statusTail = logLines.filter(l => statusRe.test(l)).slice(-12);
    return { error: null, round: gs.round, phase: gs.phase, rows: mapped,
      pauseActive, over: !!gs.match_result, statusTail,
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
  // Rolling-window calibration (soak-3): gameLog is a rolling 200-line window
  // (GAME_LOG_MAX), so by mid-battle older rounds' RESULT LINES age out of
  // the log even though they printed live at the time. Scanning full history
  // made every long match fail C3 on aged-out lines (BT-XP2P: 17 of 21
  // "invisible", most of them printed-and-trimmed). The live bug class this
  // check must catch — a version that never renders (e.g. recovery-147, fixed
  // alongside) — always shows inside a 2-round window, so scan only the live
  // round plus the previous one. Full-history visibility belongs to the
  // forensic probes against retained games, not the in-battle tripwire.
  const invisible = realAttacks.filter(r => r.status === 'resolved' && r.visible === false && r.round >= audit.round - 1);
  return { stranded, realAttacks, invisible };
}
