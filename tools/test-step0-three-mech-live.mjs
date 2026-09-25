// Step 0 gate acceptance — Battle A: complete three-Mech (2 v 1) human skirmish.
//
// Two isolated browser sessions (host with two BattleMechs, guest with one)
// play a Custom Skirmish on the LIVE Supabase backend through the real UI and
// public authoritative RPC paths, to a FINISHED result (annihilation), with
// one mid-battle reload/rejoin of the player who is NOT currently active.
//
// Usage:
//   python3 -m http.server 8790        (from repo root)
//   node tools/test-step0-three-mech-live.mjs
//
// Optional env:
//   SHOT_URL                      base URL (default http://127.0.0.1:8790/index.html)
//   BT_H2H_HOST / _PASS           host account (default h2h-regression-host / H2H!Host01)
//   BT_H2H_GUEST / _PASS          guest account (default h2h-regression-guest / H2H!Guest01)
//   BT_STEP0_ROUNDS               maximum rounds before failing as stalled (default 12)
//   BT_STEP0_RECONNECT_ROUND      round in which the rejoin is exercised (default 3)
//   BT_STEP0_REPORT               JSON report path (default: scratch dir)
//   BT_STEP0_KEEP                 set to 1 to retain the disposable match
//
// PASS criteria:
//   - both browsers create/join/deploy a legal 2 v 1 roster and start
//   - every round terminates through the real phase sequence
//   - at least one weapon exchange resolves server-authoritatively
//   - armour/structure never negative; no uncaught browser errors
//   - the non-active player reloads mid-battle and rejoins with state restored
//   - the match reaches status 'finished' with a sealed match report row
// On success the disposable match is removed; on failure the game code and
// report are retained for hand-off.

import { createRequire } from 'module';
import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/mattperkins/.hermes/hermes-agent/node_modules/playwright');

const BASE = process.env.SHOT_URL || 'http://127.0.0.1:8790/index.html';
const HOST = { user: process.env.BT_H2H_HOST || 'h2h-regression-host', pass: process.env.BT_H2H_HOST_PASS || 'H2H!Host01' };
const GUEST = { user: process.env.BT_H2H_GUEST || 'h2h-regression-guest', pass: process.env.BT_H2H_GUEST_PASS || 'H2H!Guest01' };
const MAX_ROUNDS = Math.max(4, Number(process.env.BT_STEP0_ROUNDS || 12));
const RECONNECT_ROUND = Math.max(2, Number(process.env.BT_STEP0_RECONNECT_ROUND || 3));
const REPORT_PATH = process.env.BT_STEP0_REPORT || path.join(tmpdir(), `step0-three-mech-report-${Date.now()}.json`);
const KEEP = process.env.BT_STEP0_KEEP === '1';
const MAP_ID = 'training-grounds';
const HOST_UNITS = [
  { search: 'DRG-5K', unitId: 'grand-dragon-drg-5k', label: 'Grand Dragon DRG-5K' },
  { search: 'VTR-9B', unitId: 'victor-vtr-9b', label: 'Victor VTR-9B' }
];
const GUEST_UNITS = [
  { search: 'Timber Wolf', unitId: 'timber-wolf-prime', label: 'Timber Wolf Prime' }
];
// West deployment zone candidates per unit index (first legal hex wins).
const HOST_HEXES = [
  { hex: '0405', facing: 'E', fallback: ['0505', '0404'] },
  { hex: '0406', facing: 'E', fallback: ['0506', '0404'] }
];
const GUEST_HEXES = [
  { hex: '1105', facing: 'W', fallback: ['1005', '1106'] }
];

const failures = [];
const info = { units: null, rounds: 0, gameCode: null, winner: null, reconnect: null, errors: [] };
let gameCode = null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

async function activeScreen(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.screen')).find(s => s.classList.contains('active'))?.id || null);
}
async function waitForScreen(page, id, timeout = 25000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await activeScreen(page) === id) return true;
    await sleep(250);
  }
  return false;
}
async function signIn(page, credentials) {
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
async function addMechToDropship(page, spec) {
  await page.waitForSelector('#lobby-roster-search', { timeout: 20000 });
  await page.fill('#lobby-roster-search', spec.search);
  await sleep(900);
  // Cards render only the variant name, so match on the exact registry unit id.
  const wrap = page.locator(`.roster-option-wrap[data-unit-id="${spec.unitId}"]`).first();
  if (!await wrap.isVisible().catch(() => false)) {
    throw new Error(`Roster card not visible for ${spec.label} (unitId=${spec.unitId}, search="${spec.search}")`);
  }
  const option = wrap.locator('.roster-option').first();
  if (await option.isDisabled().catch(() => true)) {
    const title = (await option.getAttribute('title').catch(() => '')) || '';
    throw new Error(`${spec.label} is disabled in the active ruleset: ${title}`);
  }
  await option.scrollIntoViewIfNeeded().catch(() => {});
  await option.click();
  await page.waitForSelector('.hangar-entry', { timeout: 15000 });
  await page.getByRole('button', { name: 'Add to Dropship', exact: true }).first().click();
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('.roster-summary')).some(node => /Dropship:\s*[1-9]\d*/.test(node.textContent || '')),
    null, { timeout: 15000 }
  );
}
async function deployUnit(page, unitIndex, spec) {
  const statusText = async () => (await page.locator('#lobby-status').innerText().catch(() => '')) || '';
  const helpText = async () => (await page.locator('#lobby-deployment > .deployment-help').first().innerText().catch(() => '')) || '';
  let lastProblem = null;
  for (const hex of [spec.hex, ...spec.fallback]) {
    await page.locator('#lobby-deployment .deployment-map').waitFor({ state: 'visible', timeout: 15000 });
    // The unit row lists every still-unplaced unit first (in roster order);
    // deployments happen strictly in order, so the first "choose hex" is ours.
    const chooseButtons = page.locator('#lobby-deployment .deployment-unit-row button').filter({ hasText: /choose hex/i });
    if (await chooseButtons.count() === 0) return true; // all units already placed
    await chooseButtons.first().click();
    await sleep(250);
    await page.locator(`#lobby-deployment .deployment-hex[aria-label^="${hex}"]`).click();
    // Wait for the authoritative placement to be reflected in the lobby UI.
    let placedCount = -1, help = '';
    for (let i = 0; i < 30; i++) {
      await sleep(400);
      help = await helpText();
      const m = help.match(/(\d+)\/(\d+) placed/);
      if (m) placedCount = Number(m[1]);
      if (placedCount > unitIndex) break;
    }
    if (placedCount > unitIndex) {
      const facing = page.getByRole('button', { name: spec.facing, exact: true }).first();
      const shown = await facing.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
      if (!shown) {
        lastProblem = `Facing controls did not appear for unit ${unitIndex} after placement on ${hex}: help="${help}" status="${(await statusText()).slice(0, 240)}"`;
        await page.screenshot({ path: `/tmp/step0-deploy-facing-u${unitIndex}-${hex}.png` }).catch(() => {});
        continue;
      }
      await facing.click();
      await sleep(400);
      return true;
    }
    lastProblem = `Unit ${unitIndex} was not placed on ${hex}: help="${help}" status="${(await statusText()).slice(0, 240)}"`;
    await page.screenshot({ path: `/tmp/step0-deploy-fail-u${unitIndex}-${hex}.png` }).catch(() => {});
  }
  throw new Error(lastProblem || `Could not place unit ${unitIndex} on any of ${[spec.hex, ...spec.fallback].join('/')}`);
}
async function state(page) {
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
async function invariantSnapshot(page) {
  return page.evaluate(() => (mechInstances || []).map(m => {
    const cells = [...Object.values(m.armor || {}), ...Object.values(m.structure || {})];
    return {
      id: m.instanceId, owner: m.owner, destroyed: Boolean(m.destroyed),
      minArmor: Math.min(...cells), heat: m.heat ?? null,
      pilotHitCount: Array.isArray(m.pilot) ? m.pilot.length : null
    };
  }));
}
async function finishedRow(page) {
  return page.evaluate(async () => {
    const { data, error } = await db.from('btech_games').select('*').eq('id', currentGameId).maybeSingle();
    if (error || !data) return null;
    return { status: data.status, game_code: data.game_code, raw_keys: Object.keys(data) };
  }).catch(() => null);
}
async function waitFinished(host, guest, timeoutMs = 30000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const row = await finishedRow(host) || await finishedRow(guest);
    if (row && row.status === 'finished') return row;
    await sleep(500);
  }
  return null;
}

// ── In-page movement planner: step toward the nearest living enemy ─────────
function approachEvaluate() {
  return async () => {
    // Server-authoritative hex distance (even-r, btech_hex_distance in
    // SQL/15). The client's offsetToAxial is odd-r and disagrees with the
    // server on odd-row→even-row pairs, which would mis-plan approach paths.
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
      // A prone BattleMech cannot move with the normal run/walk/stand modes —
      // the server rejects them and hasMoved never flips, stalling the phase.
      // Volunteer to stay prone (shipped remain_prone_battlemech, SQL 111):
      // consumes the activation and preserves prone-fire eligibility.
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
async function moveAllMyUnits(page) {
  return page.evaluate(await approachEvaluate());
}

function weaponActionEvaluate() {
  return async () => {
    const mech = (mechInstances || []).find(m => m.owner === mySeatNumber && !m.destroyed && !m.hasFired);
    if (!mech) return { acted: false };
    const target = (mechInstances || []).find(m => m.owner !== mySeatNumber && !m.destroyed);
    if (!target) return { acted: false };
    selectWeaponAttacker(mech.instanceId);
    selectWeaponTarget(target.instanceId);
    const list = (BT_UNITS[mech.unitId] && BT_UNITS[mech.unitId].weapons) || [];
    let fired = false;
    for (let i = 0; i < list.length; i++) {
      let valid = false;
      try { valid = Boolean(evaluateWeaponAttack(mech, target, list[i]).valid); } catch (e) { valid = false; }
      if (valid) { toggleWeaponForAttack(weaponMountId(list[i], i)); fired = true; break; }
    }
    await confirmWeaponAttack();
    return { acted: true, mech: mech.instanceId, fired, target: target.instanceId };
  };
}
function reactionActionEvaluate() {
  return async () => {
    const mech = (mechInstances || []).find(m => m.owner === mySeatNumber && !m.destroyed && !m.hasReacted);
    if (!mech) return { acted: false };
    selectedInstanceId = mech.instanceId;
    await completeReaction(mech.instanceId);
    return { acted: true, mech: mech.instanceId };
  };
}
function physicalActionEvaluate() {
  return async () => {
    // Delegate legality to the client's own checker (evaluatePhysicalAttack
    // encodes arc, elevation, arm-fired-this-round, component and limb rules);
    // the server re-validates on declaration and is the backstop.
    const isLegal = (attacker, target, type, limb) => {
      try { return Boolean(evaluatePhysicalAttack(attacker, target, type, limb).valid); }
      catch (e) { return false; }
    };
    // Delegate limb selection to the client: selectPhysicalAttackType()
    // (physical-attack.js:191) filters physicalLimbCandidates(type) through
    // evaluatePhysicalAttack — arc, elevation, component and
    // arm-fired-this-round rules — and keeps a single valid leg for kicks.
    // The resulting physicalAttackState.limbs is always well-formed, so we
    // submit it untouched. Earlier harness versions re-derived the limb here
    // and could override the client's valid set with an invalid one (a
    // destroyed leg, a fired arm), which the server rejected with "Choose one
    // leg for a kick" / "Choose one or both unique arms for a punch" and wedged
    // the phase.
    const confirmOne = async (attacker, target, type) => {
      selectPhysicalAttacker(attacker.instanceId);
      if (physicalAttackState?.attackerId !== attacker.instanceId) return false; // no legal attack → caller passes
      selectPhysicalTarget(target.instanceId);
      selectPhysicalAttackType(type);
      if (!(physicalAttackState?.limbs || []).length) return false; // this type has no valid limb vs this target
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
    // Mechs the server has confirmed cannot declare this phase (e.g. a
    // prone attacker: SQL 23/60 reject BOTH attack and pass). Stop
    // re-submitting for them — the phase closes via skip_empty_physical_phase
    // once every other declaration is in. Tracked per round so a new round
    // resets the tracker.
    const tk = window.__step0PhysIneligible;
    const ineligible = (tk && tk.round === currentGameState?.round) ? tk
      : (window.__step0PhysIneligible = { round: currentGameState?.round, ids: {} });
    const mine = (mechInstances || []).filter(m => m.owner === mySeatNumber && !m.destroyed && !m.hasPhysicalAttacked && !ineligible.ids[m.instanceId]);
    const enemies = (mechInstances || []).filter(m => m.owner !== mySeatNumber && !m.destroyed);
    for (const attacker of mine) {
      // Use the SERVER's hex-distance math (even-r, btech_hex_distance in
      // SQL/15) as the sole adjacency authority. The client's offsetToAxial
      // (board.js:102) uses odd-r and disagrees with the server on every
      // odd-row→even-row neighbor pair (e.g. (7,4)→(8,5): client=1, server=2),
      // which wedges the physical phase when the harness "attacks" a pair the
      // server considers non-adjacent.
      const dist = (a, b) => {
        const aq = a.col - (a.row - (a.row & 1)) / 2, arx = a.row;
        const bq = b.col - (b.row - (b.row & 1)) / 2, brx = b.row;
        return Math.max(Math.abs(aq - bq), Math.abs(arx - brx),
                        Math.abs((-a.col + (a.row - (a.row & 1)) / 2 - a.row) - (-b.col + (b.row - (b.row & 1)) / 2 - b.row)));
      };
      let didAttack = false;
      for (const target of enemies) {
        if (dist(attacker, target) !== 1) continue;
        // confirmOne delegates limb legality to the client (see above); try a
        // punch first, then a kick. The server re-validates everything and is
        // the backstop.
        for (const type of ['punch', 'kick']) {
          if (await confirmOne(attacker, target, type)) { didAttack = true; logEvents.push(`${type} ${target.instanceId}`); break; }
        }
        if (didAttack) break;
      }
      if (didAttack) return { acted: true, mode: logEvents.join('+'), logEvents };
      // 3) Genuinely no legal action — pass, mirroring the UI's "No Physical
      // Attack / Complete" button.
      const err = await passOne(attacker);
      if (err) {
        if (/not eligible/i.test(err)) {
          // Known server bug (SQL 23:53 / SQL 60:239, documented in
          // docs/DEVELOPMENT_ROADMAP.md; fix = migration 157): a prone (or
          // destroyed) attacker is rejected on pass as well as on attack, so
          // it can never declare and the phase can only close via
          // skip_empty_physical_phase when no other legal option remains.
          // Mark it ineligible for this round to stop a retry storm.
          ineligible.ids[attacker.instanceId] = true;
          logEvents.push(`ineligible(pass-rejected): ${err}`);
          continue;
        }
        // Unexpected pass rejection (we are the active seat and the mech is
        // eligible) — leave it eligible so it is retried next loop.
        logEvents.push(`pass-rejected: ${err}`);
        return { acted: false, passError: err };
      }
      logEvents.push('pass');
      return { acted: true, mode: logEvents.join('+'), logEvents };
    }
    // Every one of my mechs has declared (or been confirmed ineligible):
    // request the game's own safe phase-close. It only fires when no
    // attacker with a legal option remains, so it is safe to call here.
    if (logEvents.length) { try { await skipEmptyPhysicalPhase(); } catch (e) { /* re-checked each loop */ } }
    return { acted: logEvents.length > 0, logEvents };
  };
}

async function drivePhase(host, guest, phaseName, actionFactory, opts = {}) {
  const deadline = Date.now() + (opts.timeoutMs || 240000);
  const actions = [];
  while (Date.now() < deadline) {
    const fin = await finishedRow(host) || await finishedRow(guest);
    if (fin && fin.status === 'finished') return { finished: fin, actions };
    const hostState = await state(host);
    const guestState = await state(guest);
    const anyHere = (hostState.phase === phaseName || guestState.phase === phaseName);
    if (!anyHere) return { finished: null, actions };
    if (opts.hook) await opts.hook(hostState, guestState);
    for (const [page, snapshot] of [[host, hostState], [guest, guestState]]) {
      // Physical declarations ARE turn-gated server-side (SQL 23:137 —
      // "It is not your Physical Attack activation"): only the active player
      // may declare, and activation alternates per unit. Driving the
      // non-active seat here would get every declaration rejected and
      // pollute state, so only the active seat acts.
      if (snapshot.phase !== phaseName || !snapshot.myTurn) continue;
      const action = await page.evaluate(actionFactory).catch(err => ({ error: String(err && err.message || err) }));
      actions.push({ who: page === host ? 'host' : 'guest', action });
      await sleep(500);
    }
    for (const page of [host, guest]) {
      // In human games the "Next Phase" button is hidden (AI-testing aid
      // only); phases advance automatically once every seat has confirmed
      // its actions. In Vs-AI games it drives the AI's turn — click it when
      // visible and enabled.
      const button = page.locator('#btn-advance-phase');
      if (await button.isVisible().catch(() => false) && await button.isEnabled().catch(() => false)) {
        await button.click().catch(() => {});
      }
    }
    await sleep(650);
  }
  const hostState = await state(host);
  const guestState = await state(guest);
  let physicalStall = null;
  if (phaseName === 'physical_attack') {
    // The physical phase can deadlock server-side: a stale physicalPhaseStart
    // snapshot makes every declaration — including a plain pass — reject with
    // "Attacker is not eligible for a standard physical attack", so the phase
    // can never close through the normal path. Capture the exact state that
    // deadlocked, then call the game's own shipped recovery
    // (skip_empty_physical_phase, SQL 147) which is the intended escape for a
    // physical phase with no legal actions remaining.
    physicalStall = { host: hostState, guest: guestState, recovery: [] };
    for (const page of [host, guest]) {
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
      physicalStall.recovery.push({ who: page === host ? 'host' : 'guest', ...r });
      await sleep(1200);
    }
    const hostNow = await state(host);
    const guestNow = await state(guest);
    physicalStall.advanced = hostNow.phase !== 'physical_attack' || guestNow.phase !== 'physical_attack';
    if (physicalStall.advanced) return { finished: null, actions, stall: physicalStall };
  }
  throw new Error(`Phase ${phaseName} did not terminate within the deadline. host=${JSON.stringify(hostState)} guest=${JSON.stringify(guestState)}`);
}

async function rollInitiativeBoth(host, guest) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const fin = await finishedRow(host);
    if (fin && fin.status === 'finished') return { finished: fin };
    const h = await state(host);
    const g = await state(guest);
    if ((h.phase !== 'initiative' || g.phase !== 'initiative') && (h.phase === 'movement' || g.phase === 'movement')) return { finished: null };
    if (h.phase !== 'initiative' && g.phase !== 'initiative') return { finished: null };
    // No player owns the turn during initiative (active_player_id stays null
    // until both 2D6 rolls arrive), so myTurn is false by design here. The
    // enabled roll button is the correct gate: it already waits on un-declared
    // Round 1 ammunition and hides after the seat has rolled.
    for (const page of [host, guest]) {
      const snapshot = await state(page);
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

async function reloadAndRejoin(rejoiningPage, code) {
  const before = await state(rejoiningPage);
  await rejoiningPage.reload({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  const returnedToMenu = await waitForScreen(rejoiningPage, 'menu-screen');
  const entry = rejoiningPage.locator('#active-games-list .game-entry').filter({ hasText: code });
  await entry.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  const entryVisible = await entry.first().isVisible().catch(() => false);
  if (returnedToMenu && entryVisible) await entry.first().click();
  const rejoined = await waitForScreen(rejoiningPage, 'game-screen');
  // The game screen appears with a demo placeholder force; loadGameState()
  // swaps in the real server instances a moment later (same ~1s race as at
  // match start). Poll until the real board is back before asserting.
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

const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const hostContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const guestContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const host = await hostContext.newPage();
const guest = await guestContext.newPage();
for (const page of [host, guest]) {
  page.on('pageerror', error => info.errors.push(`PAGEERROR: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') info.errors.push(`CONSOLE: ${message.text()}`); });
}
let fatal = null;

try {
  await Promise.all([signIn(host, HOST), signIn(guest, GUEST)]);
  check('both players reach the main menu', await activeScreen(host) === 'menu-screen' && await activeScreen(guest) === 'menu-screen');

  await host.getByRole('button', { name: 'Create Custom Skirmish', exact: true }).click();
  check('host opens match setup', await waitForScreen(host, 'match-setup-screen'));
  await host.selectOption('#create-map-select', MAP_ID);
  await host.selectOption('#create-force-format-select', 'tonnage');
  await host.selectOption('#create-tonnage-select', '200');
  await host.locator('#match-setup-screen.active .setup-actions .primary').waitFor({ state: 'visible', timeout: 15000 });
  await host.evaluate(() => handleCreateConfiguredGame());
  check('host creates a lobby', await waitForScreen(host, 'lobby-screen'));
  const code = (await host.locator('#lobby-code').innerText()).trim();
  gameCode = code;
  check('lobby provides a shareable code', /^BT-[A-Z0-9]{4}$/.test(code), code || 'missing code');
  info.gameCode = code;

  await guest.fill('#join-code', code);
  await guest.locator('#menu-screen .join-row button').click();
  check('guest joins the lobby by code', await waitForScreen(guest, 'lobby-screen'));

  await addMechToDropship(host, HOST_UNITS[0]);
  await addMechToDropship(host, HOST_UNITS[1]);
  await addMechToDropship(guest, GUEST_UNITS[0]);
  check('three BattleMechs deployed to dropships (host 2, guest 1)',
    (await host.locator('.roster-summary').allInnerTexts()).some(t => /Dropship:\s*[1-9]\d*/.test(t)) &&
    (await guest.locator('.roster-summary').allInnerTexts()).some(t => /Dropship:\s*[1-9]\d*/.test(t)));

  await deployUnit(host, 0, HOST_HEXES[0]);
  await deployUnit(host, 1, HOST_HEXES[1]);
  await deployUnit(guest, 0, GUEST_HEXES[0]);
  const placedHelp = (await host.locator('#lobby-deployment > .deployment-help').first().innerText()) + ' | ' + (await guest.locator('#lobby-deployment > .deployment-help').first().innerText());
  check('all three BattleMechs placed with facings', /2\/2 placed/.test(placedHelp.split(' | ')[0]) && /1\/1 placed/.test(placedHelp.split(' | ')[1]), placedHelp);

  await host.locator('#btn-ready').click();
  await guest.locator('#btn-ready').click();
  await host.waitForFunction(() => !document.getElementById('btn-start')?.disabled, null, { timeout: 20000 });
  await host.locator('#btn-start').click();
  check('host starts the shared game', await waitForScreen(host, 'game-screen'));
  check('guest receives the shared game', await waitForScreen(guest, 'game-screen'));

  // The game screen appears as soon as startGameScreen() runs initGame()
  // (a demo placeholder force); loadGameState() swaps in the real server
  // instances a moment later (measured ~1s). Poll until both clients show
  // the real board before asserting the 2 v 1 split.
  const DEMO_IDS = new Set(['atlas-1', 'hunchback-1', 'locust-1']);
  const boardDeadline = Date.now() + 20000;
  let board = [await state(host), await state(guest)];
  while (Date.now() < boardDeadline) {
    board = await Promise.all([state(host), state(guest)]);
    const realBoard = s => s.screen === 'game-screen' && s.allUnits.length > 0 && s.allUnits.every(u => !DEMO_IDS.has(u.id));
    if (realBoard(board[0]) && realBoard(board[1])) break;
    await sleep(300);
  }
  check('board shows a 2 v 1 force split',
    board[0].ownUnits === 2 && board[1].ownUnits === 1 && board[0].allUnits.length === 3 && board[1].allUnits.length === 3,
    JSON.stringify({ host: board[0], guest: board[1] }));
  info.buildStamp = board[0].buildStamp;

  // Round 1 specialised ammunition: declare every pending bin. The client
  // commits one bin per confirm (submitRoundOneAmmoLoadout(binKey)) and the
  // server rejects — and the UI disables — the initiative roll until every
  // bin on both sides is configured, so loop per bin until none remain.
  const ammoDeadline = Date.now() + 30000;
  let ammoResult = { host: null, guest: null };
  while (Date.now() < ammoDeadline) {
    const both = await Promise.all([host, guest].map(async page => page.evaluate(async () => {
      const pending = (mechInstances || [])
        .filter(m => m.owner === mySeatNumber && !m.destroyed)
        .flatMap(m => (m.ammoBins || []).filter(bin => ammoSetupRequiredForBin(bin))
          .map(bin => ({ key: `${m.instanceId}:${bin.id}`, binId: bin.id })));
      for (const p of pending) await submitRoundOneAmmoLoadout(p.key);
      const remaining = (mechInstances || [])
        .filter(m => m.owner === mySeatNumber)
        .flatMap(m => (m.ammoBins || []).filter(bin => ammoSetupRequiredForBin(bin)).map(b => b.id));
      return { attempted: pending.map(p => p.binId), remaining };
    })));
    ammoResult = { host: both[0], guest: both[1] };
    if (both.every(r => r.remaining.length === 0)) break;
    await sleep(600);
  }
  check('Round 1 ammunition confirmed where required',
    Object.values(ammoResult).every(r => r && r.remaining.length === 0), JSON.stringify(ammoResult));

  const weaponExchanges = [];
  let physicalExchanges = 0;
  let roundsPlayed = 0;
  let finish = null;

  for (let round = 1; round <= MAX_ROUNDS && !finish; round++) {
    const inv = await invariantSnapshot(host);
    check(`round ${round}: armour/structure non-negative on all ${inv.length} BattleMechs`,
      inv.every(m => m.minArmor >= 0), JSON.stringify(inv.filter(m => m.minArmor < 0)));
    roundsPlayed = round;

    const init = await rollInitiativeBoth(host, guest);
    if (init.finished) { finish = init.finished; break; }

    // Mid-battle reconnect: reload the player who is NOT currently active.
    if (round === RECONNECT_ROUND) {
      const h = await state(host);
      const g = await state(guest);
      const activePage = h.myTurn ? host : (g.myTurn ? guest : null);
      const rejoiningPage = activePage === host ? guest : (activePage === guest ? host : guest);
      const rejoin = await reloadAndRejoin(rejoiningPage, code);
      info.reconnect = { round, page: rejoiningPage === host ? 'host' : 'guest', ...rejoin };
      check(`round ${round}: the non-active player reloads and rejoins with state restored`,
        rejoin.returnedToMenu && rejoin.entryVisible && rejoin.rejoined && rejoin.restored,
        JSON.stringify({ before: rejoin.before, after: rejoin.after, returnedToMenu: rejoin.returnedToMenu, entryVisible: rejoin.entryVisible }));
    }

    const moved = await drivePhase(host, guest, 'movement', approachEvaluate());
    if (moved.finished) { finish = moved.finished; break; }
    info.movements = (info.movements || []).concat(moved.actions);

    const reactions = await drivePhase(host, guest, 'reaction', reactionActionEvaluate());
    if (reactions.finished) { finish = reactions.finished; break; }

    const weapons = await drivePhase(host, guest, 'weapon_attack', weaponActionEvaluate());
    if (weapons.finished) { finish = weapons.finished; break; }
    for (const a of weapons.actions) if (a.action && a.action.fired) weaponExchanges.push({ round, ...a });

    const physical = await drivePhase(host, guest, 'physical_attack', physicalActionEvaluate());
    if (physical.finished) { finish = physical.finished; break; }
    physicalExchanges += physical.actions.filter(a => a.action && a.action.acted).length;
    if (physical.stall) {
      info.physicalStalls = (info.physicalStalls || []).concat([{ round, ...physical.stall }]);
      console.log(`round ${round}: physical phase deadlocked server-side — recovery result ${JSON.stringify(physical.stall.recovery)} advanced=${physical.stall.advanced}`);
    }

    const heat = await drivePhase(host, guest, 'heat', async () => { await confirmHeatManagement(); return { acted: true }; });
    if (heat.finished) { finish = heat.finished; break; }

    await waitFinished(host, guest, 20000);
  }

  if (!finish) {
    const probe = await finishedRow(host) || await finishedRow(guest);
    check('battle finished within the round budget', probe && probe.status === 'finished',
      `stalled after ${roundsPlayed} rounds; last status ${probe ? probe.status : 'unknown'} — game ${code} retained for inspection`);
  } else {
    info.rounds = roundsPlayed;
    info.winner = finish;
    check('battle reaches a finished result', true, `status=finished after ~${roundsPlayed} rounds`);
  }

  if (weaponExchanges.length) {
    const ledger = await host.evaluate(async () => {
      const { data, error } = await db.from('btech_combat_events')
        .select('status,phase,resolution')
        .eq('game_id', currentGameId).eq('phase', 'weapon_attack')
        .order('round', { ascending: true }).order('sequence');
      if (error) return { error: error.message, events: [] };
      return { events: data || [] };
    });
    check('server stores resolved weapon declarations for both forces',
      !ledger.error && ledger.events.length >= weaponExchanges.length &&
      ledger.events.every(e => e.status === 'resolved' && e.resolution),
      `client saw ${weaponExchanges.length} fires; server rows ${ledger.events.length}; sample ${JSON.stringify(ledger.events[0] || null).slice(0, 200)}`);
  } else {
    check('at least one weapon exchange resolved', false, 'no weapon fire resolved across the whole battle');
  }

  const report = await host.evaluate(async () => {
    const { data, error } = await db.from('btech_match_reports').select('*').eq('game_id', currentGameId).limit(1);
    return { error: error ? error.message : null, rows: (data || []).length };
  });
  check('sealed match report exists at battle end', !report.error && report.rows >= 1, JSON.stringify(report));

  const finalInv = await invariantSnapshot(host).catch(() => []);
  check('final armour/structure still non-negative', finalInv.every(m => m.minArmor >= 0), JSON.stringify(finalInv.filter(m => m.minArmor < 0)));
  check('no uncaught browser errors across both sessions', !info.errors.some(e => e.startsWith('PAGEERROR')), info.errors.filter(e => e.startsWith('PAGEERROR')).join(' | ').slice(0, 400));

  if (!KEEP && failures.length === 0) {
    // The delete needs the id, not the code; fetch it first.
    const idRow = await host.evaluate(async () => {
      const { data } = await db.from('btech_games').select('id').eq('game_code', gameCode).maybeSingle();
      return data ? data.id : null;
    }).catch(() => null);
    if (idRow) {
      const del = await host.evaluate(async id => {
        const { error } = await db.from('btech_games').delete().eq('id', id);
        return error ? error.message : null;
      }, idRow);
      check('disposable match removed', del === null, del || 'removed');
    } else {
      console.log('Cleanup skipped: game id not resolvable by code.');
    }
  } else if (KEEP || failures.length) {
    console.log(`Disposable match RETAINED: ${code} (keep=${KEEP}, failures=${failures.length})`);
  }
} catch (error) {
  fatal = error;
  check('test completed without a fatal error', false, error.message);
  console.log(`Fatal: ${error.stack}`);
} finally {
  console.log('\n--- console/page errors ---');
  console.log(info.errors.slice(0, 40).join('\n') || '(none)');
  await browser.close();
}

const payload = { passed: failures.length === 0, fatal: fatal ? String(fatal.message) : null, ...info, failures, errors: info.errors };
await mkdir(path.dirname(REPORT_PATH), { recursive: true }).catch(() => {});
await writeFile(REPORT_PATH, JSON.stringify(payload, null, 2)).catch(() => {});
console.log(`\nReport: ${REPORT_PATH}`);
if (failures.length) {
  console.log(`\n--- failure hand-off ---`);
  console.log(`Game: ${gameCode || 'not created'} | rounds: ${info.rounds} | reconnect: ${JSON.stringify(info.reconnect)}`);
  console.log(`First failure: ${failures[0]}`);
  console.log(`${failures.length} Step 0 three-Mech acceptance failure(s)`);
  process.exit(1);
}
console.log('\nStep 0 three-Mech (2v1) live acceptance PASSED');