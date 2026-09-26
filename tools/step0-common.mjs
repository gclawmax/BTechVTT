// Step 0 shared harness helpers for Battle A (2v1 human skirmish) and Battle B
// (Vs-AI lifecycle). Verbatim-extracted from tools/test-step0-three-mech-live.mjs
// so both live-acceptance harnesses share one implementation of the login flow,
// the in-page state reader, the server-authoritative action evaluators, the
// phase driver, and the rejoin logic. Nothing here is game code — it only calls
// the shipped, public, server-authoritative UI functions and RPC paths.
//
// Every exported helper is browser-page scoped: it receives a Playwright page and
// delegates to game globals (mechInstances, currentGameId, db, ...) that exist in
// that page's window at call time.

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function activeScreen(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.screen')).find(s => s.classList.contains('active'))?.id || null);
}

export async function waitForScreen(page, id, timeout = 25000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await activeScreen(page) === id) return true;
    await sleep(250);
  }
  return false;
}

export async function signIn(page, BASE, credentials) {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.fill('#login-username', credentials.user);
  await page.fill('#login-password', credentials.pass);
  await page.click('#btn-login').catch(() => {});
  if (await waitForScreen(page, 'menu-screen', 12000)) return;
  await page.fill('#login-username', credentials.user);
  await page.fill('#login-password', credentials.pass);
  await page.click('#btn-signup').catch(() => {});
  if (!await waitForScreen(page, 'menu-screen', 20000)) throw new Error(`Could not sign in as ${credentials.user}`);
}

export function state(page) {
  return page.evaluate(() => ({
    screen: Array.from(document.querySelectorAll('.screen')).find(s => s.classList.contains('active'))?.id || null,
    phase: currentGameState?.phase || null,
    round: currentGameState?.round || null,
    myTurn: typeof isMyActiveTurn === 'function' && isMyActiveTurn(),
    activeSeat: (typeof getActivePlayerSeat === 'function' ? (getActivePlayerSeat() ?? null) : null),
    ownUnits: (mechInstances || []).filter(m => m.owner === mySeatNumber).length,
    allUnits: (mechInstances || []).map(m => ({
      id: m.instanceId, owner: m.owner, col: m.col, row: m.row, facing: m.facing ?? null,
      hasMoved: Boolean(m.hasMoved), hasFired: Boolean(m.hasFired),
      hasReacted: Boolean(m.hasReacted), hasPhysicalAttacked: Boolean(m.hasPhysicalAttacked),
      destroyed: Boolean(m.destroyed),
      prone: Boolean(m.prone), shutdown: Boolean(m.shutdown),
      consciousness: m.pilot?.consciousness ?? null
    })),
    ownPositions: (mechInstances || []).filter(m => m.owner === mySeatNumber).map(m => `${m.col}:${m.row}`).sort(),
    buildStamp: document.getElementById('map-build-stamp')?.textContent || ''
  }));
}

export function invariantSnapshot(page) {
  return page.evaluate(() => (mechInstances || []).map(m => {
    const cells = [...Object.values(m.armor || {}), ...Object.values(m.structure || {})];
    return {
      id: m.instanceId, owner: m.owner, destroyed: Boolean(m.destroyed),
      minArmor: Math.min(...cells), heat: m.heat ?? null,
      pilotHitCount: Array.isArray(m.pilot) ? m.pilot.length : null
    };
  }));
}

// Authoritative match-end detector. A natural victory resolves through
// resolve_btech_match_end (SQL 33), which writes state.match_result and sets
// current_phase='end' + active_player_id=NULL but does NOT flip btech_games.status
// (only Career settlement, SQL 135, does). So key off match_result, with
// status==='finished' retained as a secondary marker for Career matches.
export function finishedRow(page) {
  return page.evaluate(async () => {
    const { data, error } = await db.from('btech_games').select('*').eq('id', currentGameId).maybeSingle();
    if (error || !data) return null;
    let st = {};
    try { st = typeof data.state === 'string' ? JSON.parse(data.state) : (data.state || {}); } catch { st = {}; }
    const result = st.match_result && typeof st.match_result === 'object' ? st.match_result : null;
    const finished = Boolean(result) || data.status === 'finished';
    return {
      status: finished ? 'finished' : data.status,
      finished,
      winner_seat: result && result.winner_seat != null ? result.winner_seat : null,
      reason: result ? result.reason : null,
      game_code: data.game_code,
      current_phase: data.current_phase,
      raw_keys: Object.keys(data)
    };
  }).catch(() => null);
}

export async function waitFinished(pages, timeoutMs = 30000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    for (const page of pages) {
      const row = await finishedRow(page);
      if (row && row.status === 'finished') return row;
    }
    await sleep(500);
  }
  return null;
}

// ── In-page movement planner: step toward the nearest living enemy ─────────
export function approachEvaluate() {
  return async () => {
    const dist = (a, b) => {
      const aq = a.col - (a.row - (a.row & 1)) / 2, arx = a.row;
      const bq = b.col - (b.row - (b.row & 1)) / 2, brx = b.row;
      return Math.max(Math.abs(aq - bq), Math.abs(arx - brx),
                      Math.abs((-a.col + (a.row - (a.row & 1)) / 2 - a.row) - (-b.col + (b.row - (b.row & 1)) / 2 - b.row)));
    };
    const results = [];
    for (let guard = 0; guard < 8; guard++) {
      const mech = (mechInstances || []).find(m => m.owner === mySeatNumber && !m.destroyed && !m.hasMoved);
      if (!mech) break;
      if (mech.prone) {
        const { error } = await db.rpc('remain_prone_battlemech', { p_game_id: currentGameId, p_instance_id: mech.instanceId });
        const rp = (mechInstances || []).find(m => m.instanceId === mech.instanceId);
        if (!error && rp && rp.hasMoved) { results.push({ id: mech.instanceId, mode: 'prone', moved: 0 }); continue; }
        throw new Error(`remain_prone rejected for ${mech.instanceId}: ${error ? error.message : 'state unchanged after remain_prone'}`);
      }
      const enemies = (mechInstances || []).filter(m => m.owner !== mySeatNumber && !m.destroyed);
      if (!enemies.length) { await submitAuthoritativeMovement(mech, 'stand', []); results.push({ id: mech.instanceId, mode: 'stand', moved: 0 }); break; }
      const target = enemies.reduce((best, e) => (dist(mech, e) < dist(mech, best) ? e : best));
      const path = [];
      let cur = { col: mech.col, row: mech.row };
      for (let step = 0; step < 3; step++) {
        let best = null;
        for (let dir = 0; dir < 6; dir++) {
          const n = hexNeighbor(cur.col, cur.row, dir);
          if (!n) continue;
          if ((mechInstances || []).some(m => !m.destroyed && m.col === n.col && m.row === n.row)) continue;
          if (typeof terrainMovementBlocked === 'function' && terrainMovementBlocked(n.col, n.row)) continue;
          const d = dist(n, target);
          if (d < dist(cur, target) && (!best || d < best.d)) best = { col: n.col, row: n.row, d };
        }
        if (!best) break;
        path.push({ action: 'step', col: best.col, row: best.row });
        cur = { col: best.col, row: best.row };
      }
      const startCol = mech.col, startRow = mech.row;
      if (path.length) await submitAuthoritativeMovement(mech, 'run', path);
      else await submitAuthoritativeMovement(mech, 'stand', []);
      const re = (mechInstances || []).find(m => m.instanceId === mech.instanceId);
      let moved = re && (re.col !== startCol || re.row !== startRow);
      if (!moved && path.length) {
        await submitAuthoritativeMovement(mech, 'walk', path.slice(0, Math.max(1, path.length - 1)));
        const rw = (mechInstances || []).find(m => m.instanceId === mech.instanceId);
        moved = rw && (rw.col !== startCol || rw.row !== startRow);
        if (moved) { results.push({ id: mech.instanceId, mode: 'walk', moved }); continue; }
      }
      if (!moved) await submitAuthoritativeMovement(mech, 'stand', []);
      const rs = (mechInstances || []).find(m => m.instanceId === mech.instanceId);
      if (rs && rs.hasMoved) { results.push({ id: mech.instanceId, mode: 'stand', moved: 0 }); continue; }
      throw new Error(`Movement could not be completed for ${mech.instanceId} (run/walk/stand all rejected)`);
    }
    return results;
  };
}

export function weaponActionEvaluate() {
  return async () => {
    // Server-authoritative read of the game row — the same source
    // loadGameState() consumes. Selection and verification run off this so a
    // lagging window.mechInstances can never send a declaration for a mech
    // the server has already marked fired (that rejection stalls the whole
    // simultaneous-weapon phase: see BT-XNA2, round 3).
    const read = async () => {
      const { data } = await db.from('btech_games')
        .select('state,active_player_id,current_phase,current_round')
        .eq('id', currentGameId).maybeSingle();
      if (!data) return null;
      const st = typeof data.state === 'string' ? JSON.parse(data.state) : (data.state || {});
      return { mechs: st.mech_instances || [], phase: data.current_phase, round: data.current_round };
    };
    const before = await read();
    if (!before) return { acted: false, note: 'no game row' };
    const mech = before.mechs.find(m => m.owner === mySeatNumber && !m.destroyed && !m.hasFired);
    if (!mech) return { acted: false };
    const enemies = before.mechs.filter(m => m.owner !== mySeatNumber && !m.destroyed);
    if (!enemies.length) return { acted: false };
    const list = (BT_UNITS[mech.unitId] && BT_UNITS[mech.unitId].weapons) || [];
    // Try every living enemy, not just the first: a single fixed target can
    // be out of range/arc while another is in weapon reach (e.g. range 7 vs
    // range 2 in the same phase).
    let fired = false; let target = null;
    for (const enemy of enemies) {
      selectWeaponAttacker(mech.instanceId);
      selectWeaponTarget(enemy.instanceId);
      for (let i = 0; i < list.length; i++) {
        let valid = false;
        try { valid = Boolean(evaluateWeaponAttack(mech, enemy, list[i]).valid); } catch (e) { valid = false; }
        if (valid) { toggleWeaponForAttack(weaponMountId(list[i], i)); fired = true; target = enemy; break; }
      }
      if (fired) break;
    }
    // Fire — or, when nothing is legally in reach, the shipped "Confirm No
    // Fire" pass (confirmWeaponAttack with zero selected weapons). The
    // server records either as a declaration and marks the mech fired, so a
    // mech that cannot shoot still completes the simultaneous-weapon phase
    // instead of dead-locking it.
    await confirmWeaponAttack();
    await new Promise(r => setTimeout(r, 1500)); // let the commit settle before verifying
    const after = await read();
    const now = after && after.mechs.find(m => m.instanceId === mech.instanceId);
    const confirmed = Boolean(now && now.hasFired) || Boolean(after && after.phase !== before.phase);
    return { acted: confirmed, mech: mech.instanceId, fired, target: target && target.instanceId, confirmed, serverPhase: after ? after.phase : null };
  };
}

export function reactionActionEvaluate() {
  return async () => {
    const mech = (mechInstances || []).find(m => m.owner === mySeatNumber && !m.destroyed && !m.hasReacted);
    if (!mech) return { acted: false };
    selectedInstanceId = mech.instanceId;
    await completeReaction(mech.instanceId);
    return { acted: true, mech: mech.instanceId };
  };
}

export function physicalActionEvaluate() {
  return async () => {
    const isLegal = (attacker, target, type, limb) => {
      try { return Boolean(evaluatePhysicalAttack(attacker, target, type, limb).valid); }
      catch (e) { return false; }
    };
    const confirmOne = async (attacker, target, type) => {
      selectPhysicalAttacker(attacker.instanceId);
      if (physicalAttackState?.attackerId !== attacker.instanceId) return false;
      selectPhysicalTarget(target.instanceId);
      selectPhysicalAttackType(type);
      if (!(physicalAttackState?.limbs || []).length) return false;
      await confirmPhysicalAttack();
      return (mechInstances || []).find(m => m.instanceId === attacker.instanceId)?.hasPhysicalAttacked === true;
    };
    const passOne = async attacker => {
      const { error } = await db.rpc('submit_simultaneous_physical_declaration', {
        p_game_id: currentGameId, p_attacker_instance_id: attacker.instanceId,
        p_target_instance_id: null, p_attack_type: 'pass', p_limbs: []
      });
      return error ? String(error.message) : null;
    };
    const logEvents = [];
    const tk = window.__step0PhysIneligible;
    const ineligible = (tk && tk.round === currentGameState?.round) ? tk
      : (window.__step0PhysIneligible = { round: currentGameState?.round, ids: {} });
    const mine = (mechInstances || []).filter(m => m.owner === mySeatNumber && !m.destroyed && !m.hasPhysicalAttacked && !ineligible.ids[m.instanceId]);
    const enemies = (mechInstances || []).filter(m => m.owner !== mySeatNumber && !m.destroyed);
    for (const attacker of mine) {
      const dist = (a, b) => {
        const aq = a.col - (a.row - (a.row & 1)) / 2, arx = a.row;
        const bq = b.col - (b.row - (b.row & 1)) / 2, brx = b.row;
        return Math.max(Math.abs(aq - bq), Math.abs(arx - brx),
                        Math.abs((-a.col + (a.row - (a.row & 1)) / 2 - a.row) - (-b.col + (b.row - (b.row & 1)) / 2 - b.row)));
      };
      let didAttack = false;
      for (const target of enemies) {
        if (dist(attacker, target) !== 1) continue;
        for (const type of ['punch', 'kick']) {
          if (await confirmOne(attacker, target, type)) { didAttack = true; logEvents.push(`${type} ${target.instanceId}`); break; }
        }
        if (didAttack) break;
      }
      if (didAttack) return { acted: true, mode: logEvents.join('+'), logEvents };
      const err = await passOne(attacker);
      if (err) {
        if (/not eligible/i.test(err)) {
          ineligible.ids[attacker.instanceId] = true;
          logEvents.push(`ineligible(pass-rejected): ${err}`);
          continue;
        }
        logEvents.push(`pass-rejected: ${err}`);
        return { acted: false, passError: err };
      }
      logEvents.push('pass');
      return { acted: true, mode: logEvents.join('+'), logEvents };
    }
    if (logEvents.length) { try { await skipEmptyPhysicalPhase(); } catch (e) { /* re-checked each loop */ } }
    return { acted: logEvents.length > 0, logEvents };
  };
}

// Waits up to `ms` for every page to leave `phaseName`, clicking a live
// #btn-advance-phase along the way (Vs-AI auto-advance keeps the button
// visible). Returns true once no page reports the phase anymore.
async function waitToLeavePhase(pages, phaseName, ms) {
  const d = Date.now() + ms;
  while (Date.now() < d) {
    const s = await Promise.all(pages.map(state));
    if (s.every(x => x.phase !== phaseName)) return true;
    for (const page of pages) {
      const btn = page.locator('#btn-advance-phase');
      if (await btn.isVisible().catch(() => false) && await btn.isEnabled().catch(() => false)) await btn.click().catch(() => {});
    }
    await sleep(700);
  }
  return (await Promise.all(pages.map(state))).every(s => s.phase !== phaseName);
}

// Drives `phaseName` across the given pages until it leaves that phase (or the
// match finishes). `pages` are the player-controlled sessions; each acts only on
// its own turn (snapshot.myTurn) and clicks #btn-advance-phase when available.
// In Vs-AI games the AI is driven by the game itself (auto-advance) — it is not
// in `pages`. On a physical_attack stall it captures state and invokes the
// shipped recovery (skip_empty_physical_phase / recover_stalled_physical_phase).
export async function drivePhase(pages, phaseName, actionFactory, opts = {}) {
  const actions = [];
  let recoveryCycles = 0;
  recoveryLoop: while (true) {
  const deadline = Date.now() + (opts.timeoutMs || 240000);
  while (Date.now() < deadline) {
    for (const page of pages) {
      const fin = await finishedRow(page);
      if (fin && fin.status === 'finished') return { finished: fin, actions };
    }
    const states = await Promise.all(pages.map(state));
    const anyHere = states.some(s => s.phase === phaseName);
    if (!anyHere) return { finished: null, actions };
    if (opts.hook) await opts.hook(states);
    for (let k = 0; k < pages.length; k++) {
      const page = pages[k], snapshot = states[k];
      if (snapshot.phase !== phaseName || !snapshot.myTurn) continue;
      // Re-sync the client's authoritative view immediately before acting.
      // A just-accepted submission can lag in window.mechInstances (the
      // realtime handler skips it while moveState.active, and the post-RPC
      // reload can be raced), and acting off the stale view re-submits an
      // already-declared unit forever ("Invalid attacker or duplicate
      // declaration" / "Choose one of your eligible BattleMechs that has
      // not moved"). loadGameState() is the shipped full refresh (rejoin
      // uses the same path) — zero game-code changes.
      await page.evaluate(async () => { if (typeof loadGameState === 'function') await loadGameState(); }).catch(() => {});
      const action = await page.evaluate(actionFactory).catch(err => ({ error: String(err && err.message || err) }));
      actions.push({ who: opts.labelFor ? opts.labelFor(page) : k, action });
      await sleep(500);
    }
    for (const page of pages) {
      const button = page.locator('#btn-advance-phase');
      if (await button.isVisible().catch(() => false) && await button.isEnabled().catch(() => false)) {
        await button.click().catch(() => {});
      }
    }
    await sleep(650);
  }
  const finalStates = await Promise.all(pages.map(state));
  let physicalStall = null;
  if (phaseName === 'physical_attack') {
    physicalStall = { states: finalStates, recovery: [] };
    for (const page of pages) {
      const snap = await state(page);
      if (snap.phase !== 'physical_attack') continue;
      const r = await page.evaluate(async () => {
        try {
          if (typeof skipEmptyPhysicalPhase === 'function') {
            const { data, error } = await db.rpc('skip_empty_physical_phase', { p_game_id: currentGameId });
            return { via: 'skip_empty_physical_phase', data, error: error ? String(error.message) : null };
          }
          const { data, error } = await db.rpc('recover_stalled_physical_phase', { p_game_id: currentGameId });
          return { via: 'recover_stalled_physical_phase', data, error: error ? String(error.message) : null };
        } catch (e) { return { via: 'exception', error: String(e && e.message || e) }; }
      }).catch(err => ({ via: 'evaluate-failed', error: String(err && err.message || err) }));
      physicalStall.recovery.push({ who: opts.labelFor ? opts.labelFor(page) : 'page', ...r });
      await sleep(1200);
    }
    const nowStates = await Promise.all(pages.map(state));
    physicalStall.advanced = nowStates.some(s => s.phase !== 'physical_attack');
    if (physicalStall.advanced) return { finished: null, actions, stall: physicalStall };
    physicalStall.advanced = await waitToLeavePhase(pages, 'physical_attack', 30000);
    // Step 2: the shipped rejoin path. A page reload clears the client's
    // paused-AI latch (failedAiTurnKey) and re-runs loadGameState() →
    // scheduleActiveAiTurn(), so the AI's own physical pass logic gets a
    // second attempt. Demonstrated on BT-KE46: the AI's first R5 pass raced
    // the preceding kick commit, the activation column went stale on the AI
    // seat, both sides waited forever, and a plain reload cleared it.
    for (const page of pages) {
      const snap = await state(page);
      if (snap.phase !== 'physical_attack') continue;
      const code = await page.evaluate(() => currentGameCode || null).catch(() => null);
      if (!code) continue;
      const rj = await reloadAndRejoin(page, code).catch(err => ({ rejoined: false, restored: false, error: String(err && err.message || err) }));
      physicalStall.recovery.push({ via: 'reload-rejoin', rejoined: Boolean(rj.rejoined), restored: Boolean(rj.restored), error: rj.error || null });
    }
    physicalStall.advanced = await waitToLeavePhase(pages, 'physical_attack', 30000);
    if (physicalStall.advanced) return { finished: null, actions, stall: physicalStall };
    // Step 3 (Vs-AI): submit the AI's passes with the exact RPC the AI
    // itself ships (completeAIUnitPhaseAction, opponent.js) for every
    // undeclared AI 'Mech. The server stays authoritative on eligibility and
    // activation order ("It is not your Physical Attack activation"), so
    // iterate: each round, passes for pending AI mechs are offered and the
    // ones the tracker accepts clear it; stop when the AI side is fully
    // declared or a round produces no accepts. Demonstrated on BT-U4MD:
    // one accepted pass (grasshopper) advanced the tracker onto the human
    // seat's remaining activation, which the main loop then drove.
    for (const page of pages) {
      const snap = await state(page);
      if (snap.phase !== 'physical_attack') continue;
      // Vs-AI only: in human games the other seat has its own driven page.
      const vsAi = await page.evaluate(() => vsAiMode === true).catch(() => false);
      if (!vsAi) continue;
      for (let round = 0; round < 6; round++) {
        const r = await page.evaluate(async () => {
          const out = [];
          const { data } = await db.from('btech_games').select('state,current_phase').eq('id', currentGameId).maybeSingle();
          if (!data) return { error: 'no game row', phaseNow: null };
          const st = typeof data.state === 'string' ? JSON.parse(data.state) : (data.state || {});
          const pending = (st.mech_instances || []).filter(m => m.owner !== mySeatNumber && !m.destroyed && !m.hasPhysicalAttacked);
          if (!pending.length) return { results: [], allAiDeclared: true, phaseNow: data.current_phase };
          for (const m of pending) {
            const { error } = await db.rpc('submit_simultaneous_physical_declaration', {
              p_game_id: currentGameId, p_attacker_instance_id: m.instanceId,
              p_target_instance_id: null, p_attack_type: 'pass', p_limbs: []
            });
            out.push({ mech: m.instanceId, error: error ? error.message : null });
          }
          return { results: out, allAiDeclared: false, phaseNow: data.current_phase };
        }).catch(err => ({ error: String(err && err.message || err), phaseNow: null }));
        physicalStall.recovery.push({ via: 'ai_pass_on_behalf', round, ...r });
        if (r.allAiDeclared) break;
        if (!(r.results || []).some(x => !x.error)) break; // no accepts → nothing to wait on
        await sleep(1200);
      }
    }
    physicalStall.advanced = await waitToLeavePhase(pages, 'physical_attack', 30000);
    if (physicalStall.advanced) return { finished: null, actions, stall: physicalStall };
    // Recovery can clear the AI side and leave the phase on a seat the main
    // loop itself drives (a human pass, or an un-latched AI after rejoin).
    // In that case hand control back with a fresh deadline instead of
    // failing — verified on BT-U4MD R12, where exactly this sequence
    // (auto-passed prone marauder + accepted AI pass + human pass) reached
    // the heat phase.
    if (recoveryCycles < 2) {
      recoveryCycles++;
      physicalStall.recovery.push({ via: 'resume-main-loop', cycle: recoveryCycles, states: (await Promise.all(pages.map(state))).map(s => ({ phase: s.phase, myTurn: s.myTurn, activeSeat: s.activeSeat })) });
      continue recoveryLoop; // next iteration gets a fresh full deadline
    }
  }
  // Generic stall recovery (any phase, not just physical_attack).
  // A rejected one-off AI decision can pause the client AI turn and leave
  // the game stuck on an AI-active seat; the shipped reload-rejoin path
  // clears the paused-AI latch and re-runs loadGameState() →
  // scheduleActiveAiTurn(). Verified live on BT-AXN6 (R3 heat): one rejoin
  // carried the match from a stalled heat phase to R4 initiative.
  const stillHere = (await Promise.all(pages.map(state))).some(s => s.phase === phaseName);
  if (stillHere && recoveryCycles < 3) {
    const stall = { states: await Promise.all(pages.map(state)), recovery: [] };
    for (const page of pages) {
      const snap = await state(page);
      if (snap.phase !== phaseName) continue;
      const code = await page.evaluate(() => currentGameCode || null).catch(() => null);
      if (!code) continue;
      const rj = await reloadAndRejoin(page, code).catch(err => ({ rejoined: false, restored: false, error: String(err && err.message || err) }));
      stall.recovery.push({ who: opts.labelFor ? opts.labelFor(page) : 'page', via: 'reload-rejoin', rejoined: Boolean(rj.rejoined), restored: Boolean(rj.restored), error: rj.error || null });
    }
    stall.advanced = await waitToLeavePhase(pages, phaseName, 30000);
    stall.recovery.push({ via: 'resume-main-loop', cycle: recoveryCycles + 1, states: (await Promise.all(pages.map(state))).map(s => ({ phase: s.phase, myTurn: s.myTurn, activeSeat: s.activeSeat })) });
    recoveryCycles++;
    if (stall.advanced) return { finished: null, actions, stall };
    continue recoveryLoop; // fresh full deadline, harness re-drives the rest
  }
  throw new Error(`Phase ${phaseName} did not terminate within the deadline. states=${JSON.stringify(finalStates)}`);
  }
}

// Rolls initiative for every page still in the initiative phase. In human games
// each seat rolls its own; in Vs-AI the single host rolls for both sides.
export async function rollInitiativeFor(pages, labelFor) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    for (const page of pages) {
      const fin = await finishedRow(page);
      if (fin && fin.status === 'finished') return { finished: fin };
    }
    const states = await Promise.all(pages.map(state));
    const allLeft = states.every(s => s.phase !== 'initiative');
    const anyNonInit = states.some(s => s.phase !== 'initiative');
    if (allLeft || anyNonInit) return { finished: null };
    for (const [page, snapshot] of pages.map((p, i) => [p, states[i]])) {
      if (snapshot.phase !== 'initiative') continue;
      const button = page.locator('#btn-roll-initiative');
      if (await button.isVisible().catch(() => false) && await button.isEnabled().catch(() => false)) {
        await page.evaluate(async () => { await rollInitiative(); }).catch(() => {});
      }
    }
    await sleep(400);
  }
  throw new Error('Initiative rolls did not resolve into Movement');
}

// Reloads `rejoiningPage` mid-battle and rejoins via the active-games list.
// Returns before/after snapshots + booleans. The rejoiner must be a session
// that can return to the menu and see the game entry (a normal player seat).
export async function reloadAndRejoin(rejoiningPage, code, label = 'player') {
  const before = await state(rejoiningPage);
  await rejoiningPage.reload({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  const returnedToMenu = await waitForScreen(rejoiningPage, 'menu-screen');
  const entry = rejoiningPage.locator('#active-games-list .game-entry').filter({ hasText: code });
  await entry.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  const entryVisible = await entry.first().isVisible().catch(() => false);
  if (returnedToMenu && entryVisible) await entry.first().click();
  const rejoined = await waitForScreen(rejoiningPage, 'game-screen');
  const DEMO_IDS = new Set(['atlas-1', 'hunchback-1', 'locust-1']);
  const expectIds = new Set(before.allUnits.map(u => u.id));
  const rejoinDeadline = Date.now() + 20000;
  let after = await state(rejoiningPage);
  while (Date.now() < rejoinDeadline) {
    after = await state(rejoiningPage);
    const realBoard = after.screen === 'game-screen' && after.allUnits.length > 0 &&
      after.allUnits.every(u => !DEMO_IDS.has(u.id) && expectIds.has(u.id));
    if (realBoard && after.round === before.round) break;
    await sleep(300);
  }
  const restored = Boolean(
    rejoined && after.phase === before.phase && after.round === before.round &&
    JSON.stringify(after.ownPositions) === JSON.stringify(before.ownPositions)
  );
  return { before, after, returnedToMenu, entryVisible, rejoined, restored };
}

export { sleep };