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
// step0-common drives actions. Regex pairs an attack word with an outcome
// verb: unit names alone match turn-bookkeeping noise, not observability.

export async function auditPhysicalContract(page) {
  return page.evaluate(async () => {
    if (typeof db === 'undefined' || !currentGameId) return { error: 'no game context' };
    const gs = currentGameState || {};
    const { data, error } = await db.from('btech_combat_events')
      .select('round,phase,sequence,status,attacker_instance_id,target_instance_id,declaration,resolution')
      .eq('game_id', currentGameId).order('round').order('phase').order('sequence');
    if (error) return { error: error.message };
    const logText = JSON.stringify((typeof gameLog !== 'undefined' ? gameLog : []).map(e => e.msg || e.message || ''));
    const mapped = (data || []).map(r => {
      const t = (r.target_instance_id || '').slice(0, 6);
      // A resolved real attack must leave a RESULT-shaped line: attack word
      // (or "Physical Attack") near an outcome verb, mentioning the target.
      const visible = !t ? true : new RegExp(`(kick|punch|physical attack)[^"]{0,80}\\b(hit|miss|damage|fell|knocked|no effect)\\b[^"]*${t}|${t}[^"]{0,40}(hit|miss|damage|fell|knocked)`, 'i').test(logText);
      return { round: r.round, phase: r.phase, sequence: r.sequence, status: r.status, attacker: r.attacker_instance_id, target: r.target_instance_id, attackType: r.declaration?.attack_type || 'pass', visible };
    });
    return { error: null, round: gs.round, phase: gs.phase, rows: mapped,
      pausedInLog: /AI activation paused/i.test(logText),
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
