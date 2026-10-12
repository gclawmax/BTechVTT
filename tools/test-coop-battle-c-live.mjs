// Battle-C live acceptance (co-op 1-a): one full scripted round, two real
// accounts, real UI/RPC paths. Asserts the core spec claims:
//   1. same-side join (both humans land on team A / force 1)
//   2. per-unit ownership: acting on a mate's unit is server-rejected
//   3. full-round lifecycle: movement → reaction → fire → physical → heat →
//      round 2 (async design survives contact)
//   4. mid-match rejoin lands back in the live game (issue found 6 Oct)
// Not committed until the battle passes (step-0 gate).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/mattperkins/.hermes/hermes-agent/node_modules/playwright');
const BASE = process.env.SHOT_URL || 'http://127.0.0.1:8080/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const failures = [];
const log = (...a) => console.log(...a);
const check = (label, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label + (detail ? ` — ${detail}` : ''));
};

const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox'] });
const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const A = await ctxA.newPage();   // tester1, seat 1 (host)
const B = await ctxB.newPage();   // tester2, seat 2

const errA = [], errB = [];
for (const [p, bag] of [[A, errA], [B, errB]]) {
  p.on('pageerror', e => bag.push('PAGEERROR: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') bag.push('CONSOLE: ' + m.text()); });
}

async function signIn(page, user, pass) {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.fill('#login-username', user);
  await page.fill('#login-password', pass);
  await page.click('#btn-login');
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    const scr = await page.evaluate(() => [...document.querySelectorAll('.screen')].find(s => !s.classList.contains('hidden') && s.style.display !== 'none')?.id);
    if (scr === 'menu-screen') return;
    await sleep(250);
  }
  throw new Error(`Could not sign in as ${user}`);
}

try {
  await signIn(A, 'tester1', '123456');
  await signIn(B, 'tester2', '123456');
  log('— both accounts signed in —');

  // ---------- create + join (assertion 1) ----------
  await A.evaluate(() => { window.confirm = () => true; });
  await A.evaluate(async () => { handleCreateCoop(); });
  await sleep(500);
  await A.evaluate(async () => { await handleCreateConfiguredCoop(); });
  await sleep(9000);
  const gameCode = await A.evaluate(() => currentGameCode);
  const gameId = await A.evaluate(() => currentGameId);
  check('coop match created', Boolean(gameId), 'code ' + gameCode);

  await B.evaluate(() => { window.confirm = () => true; });
  await B.fill('#join-code', gameCode);
  await B.evaluate(() => handleJoinGame());
  await sleep(8000);
  const seatB = await B.evaluate(() => mySeatNumber);
  const teamOf = page => page.evaluate(async () => btBuildTeamModel(currentGameState ?? await (async () => { const { data } = await db.from('btech_games').select('state').eq('id', currentGameId).single(); const st = typeof data.state === 'string' ? JSON.parse(data.state) : data.state; return st; })()).forceOfSeat(mySeatNumber));
  const teamA = await teamOf(A); const teamB = await teamOf(B);
  check('1. same-side join: both humans on force 1', teamA === '1' && teamB === '1' && seatB === 2, `A force ${teamA} / B force ${teamB} seat ${seatB}`);

  // ---------- hangars + deploy (host's centurion-style path, proven 6 Oct) ----------
  await A.evaluate(async () => {
    const id = 'bc-a1';
    await saveSkirmishHangar([{ id, unit_id: 'wolverine-wvr-6k', pilot: { id: 'pilot-' + id, name: 'MechWarrior', gunnery: 4, piloting: 5 } }], [id]);
    await loadLobbyUI();
    await selectLobbyDeploymentUnit(0);
    await placeLobbyDeployment(1, 0);
  });
  await B.evaluate(async () => {
    const id = 'bc-b1';
    await saveSkirmishHangar([{ id, unit_id: 'centurion-cn9-a', pilot: { id: 'pilot-' + id, name: 'MechWarrior', gunnery: 4, piloting: 5 } }], [id]);
    await loadLobbyUI();
    await selectLobbyDeploymentUnit(0);
    await placeLobbyDeployment(3, 0);
  });
  await sleep(1000);

  // ---------- ready: guest self-ready, host force-reads the team ----------
  await B.evaluate(() => document.getElementById('btn-ready').click());
  await sleep(1200);
  await A.evaluate(async () => {
    await loadLobbyUI();
    const btn = [...document.querySelectorAll('button')].find(b => (b.getAttribute('onclick') || '').includes('handleForceLobbyReady'));
    if (!btn) throw new Error('force-ready button missing on host');
    btn.click();
  });
  await sleep(1200);
  const readyRows = await A.evaluate(async () => (await db.from('btech_players').select('seat_number,ready').eq('game_id', currentGameId).order('seat_number')).data.map(r => `${r.seat_number}:${r.ready}`).join(' '));
  check('force-ready flips whole team (correct arity)', /2:true/.test(readyRows) && /1:true/.test(readyRows), readyRows);

  // ---------- start (assertion: no ammo deadlock for AI) ----------
  await A.evaluate(async () => { await handleStartGame(); });
  await sleep(2500);
  const started = await A.evaluate(async () => {
    const { data } = await db.from('btech_games').select('status,current_phase,state').eq('id', currentGameId).single();
    const st = typeof data.state === 'string' ? JSON.parse(data.state) : data.state;
    return { status: data.status, phase: data.current_phase, aiAmmo: (st.mech_instances || []).filter(m => m.owner === 3).flatMap(m => (m.ammoBins || []).map(b => `${b.type}=${b.loadType}`)) };
  });
  check('match enters play, AI ammo pre-seeded', started.status === 'in-progress' && started.aiAmmo.length > 0 && !started.aiAmmo.includes('undefined') && !started.aiAmmo.some(x => x.endsWith('=undefined')), JSON.stringify(started));

  await B.evaluate(async () => { await loadGameState(); });
  await A.evaluate(async () => {
    const mine = mechInstances.filter(m => m.owner === 1);
    for (const m of mine) for (const b of (m.ammoBins || []).filter(x => ammoSetupRequiredForBin(x))) {
      const k = `${m.instanceId}:${b.id}`; setRoundOneAmmoChoice(k, 'standard'); await submitRoundOneAmmoLoadout(k);
    }
  });
  await B.evaluate(async () => {
    const mine = mechInstances.filter(m => m.owner === 2);
    for (const m of mine) for (const b of (m.ammoBins || []).filter(x => ammoSetupRequiredForBin(x))) {
      const k = `${m.instanceId}:${b.id}`; setRoundOneAmmoChoice(k, 'standard'); await submitRoundOneAmmoLoadout(k);
    }
  });
  await sleep(600);

  // ---------- initiative rolled by the GUEST (issue-21 either-pilot claim) ----------
  await B.evaluate(async () => { await loadGameState(); await new Promise(r => setTimeout(r, 400)); });
  const rollBtn = await B.evaluate(() => { const b = document.getElementById('btn-roll-initiative'); return b ? (b.hidden ? 'hidden' : b.disabled ? 'disabled' : 'enabled') : 'none'; });
  check('guest roll button enabled (seats 1 & 2 may roll)', rollBtn === 'enabled', rollBtn);
  await B.evaluate(() => document.getElementById('btn-roll-initiative').click());
  await sleep(2500);
  const init = await A.evaluate(async () => {
    const { data } = await db.from('btech_games').select('current_phase,state').eq('id', currentGameId).single();
    const st = typeof data.state === 'string' ? JSON.parse(data.state) : data.state;
    return { phase: data.current_phase, n: (st.initiative_order || []).length };
  });
  check('force initiative resolved (3 actors in order)', init.n === 3 || init.phase === 'movement', JSON.stringify(init));

  // ---------- full round driver ----------
  // Each page: whenever it is MY active turn, burn the phase actions with the
  // real RPCs; the host page additionally pumps the AI and calls advancePhase
  // when the phase sits stalled (last-actor case). Hard cap keeps a stall
  // from hanging the run; stalls are reported with the state at stall time.
  async function pageStep(page, isHost) {
    return page.evaluate(async isHostPage => {
      if (!currentGameState || currentGameState.match_result) return 'skip';
      const snap = () => `${currentGameState.phase}/act=${getActivePlayerSeat()}`;
      const activeEntry = getActivePlayerRecord();
      // last-actor hand-over: if all remaining units are nobody's turn, host nudges
      if (!isMyActiveTurn() && !(isHostPage && activeEntry?.is_ai)) {
        if (['movement', 'reaction', 'weapon_attack', 'physical_attack', 'heat'].includes(currentGameState.phase)
            && isHostPage && !activeEntry?.is_ai && activePlayerPhaseComplete(currentGameState.phase)) {
          await advancePhase(); return 'advance:' + snap();
        }
        return 'wait:' + snap();
      }
      const mine = mechInstances.filter(m => m.owner === mySeatNumber && !m.destroyed);
      const ph = currentGameState.phase;
      if (ph === 'movement' && !isMyActiveTurn()) return 'wait-move:' + snap();
      if (ph === 'movement') {
        const todo = mine.filter(m => !m.hasMoved);
        if (!todo.length) { await advancePhase(); return 'advance:' + snap(); }
        const m = todo[0];
        const { error } = await db.rpc('submit_battlemech_movement', { p_game_id: currentGameId, p_instance_id: m.instanceId, p_mode: 'stand', p_path: [] });
        await loadGameState();
        return error ? 'MVERR:' + error.message.slice(0, 60) : 'moved:' + m.instanceId;
      }
      if (ph === 'reaction') {
        const todo = mine.filter(m => !m.hasReacted);
        if (!todo.length) { await advancePhase(); return 'advance:' + snap(); }
        const m = todo[0];
        const { error } = await db.rpc('submit_torso_twist_reaction', { p_game_id: currentGameId, p_instance_id: m.instanceId, p_torso_facing: m.facing });
        await loadGameState();
        return error ? 'REACTERR:' + error.message.slice(0, 60) : 'reacted:' + m.instanceId;
      }
      if (ph === 'weapon_attack') {
        const todo = mine.filter(m => !m.hasFired && m.weaponPhaseStart);
        if (!todo.length || !todo.length) {
          // no shots scripted this round: pass by advancing once every unit is done
          if (mechInstances.filter(m => !m.destroyed).every(m => m.hasFired || m.owner === null)) { await advancePhase(); return 'advance:' + snap(); }
          const t = todo[0];
          const { error } = await db.rpc('submit_multi_target_weapon_declaration', { p_game_id: currentGameId, p_attacker_instance_id: t.instanceId, p_target_allocations: [] });
          await loadGameState();
          return error ? 'FIREERR:' + error.message.slice(0, 60) : 'fired(pass):' + t.instanceId;
        }
        const t = todo[0];
        const { error } = await db.rpc('submit_multi_target_weapon_declaration', { p_game_id: currentGameId, p_attacker_instance_id: t.instanceId, p_target_allocations: [] });
        await loadGameState();
        return error ? 'FIREERR:' + error.message.slice(0, 60) : 'fired(pass):' + t.instanceId;
      }
      if (ph === 'physical_attack' || ph === 'heat') {
        if (activePlayerPhaseComplete(ph)) {
          if (isMyActiveTurn() || isHostPage) { await advancePhase(); return 'advance:' + snap(); }
        }
        return 'wait-phys/heat:' + snap();
      }
      return 'idle:' + snap();
    }, isHost);
  }

  // ownership probe: while any page is mid-round, guest attempts a move on
  // the HOST's unit during the guest's own activation (server must reject)
  let ownershipProbe = null;
  let stall = 0, steps = 0, lastState = null;
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline && stall < 25) {
    const rA = await pageStep(A, true);
    const rB = await pageStep(B, false);
    if (!ownershipProbe) {
      ownershipProbe = await B.evaluate(async () => {
        if (!currentGameState || currentGameState.phase !== 'movement' || !isMyActiveTurn()) return null;
        const foreign = mechInstances.find(m => m.owner === 1 && !m.hasMoved && !m.destroyed) || mechInstances.find(m => m.owner === 1);
        if (!foreign) return null;
        const { error } = await db.rpc('submit_battlemech_movement', { p_game_id: currentGameId, p_instance_id: foreign.instanceId, p_mode: 'stand', p_path: [] });
        return `${foreign.instanceId} → ${error ? 'REJECTED: ' + error.message.slice(0, 60) : 'ACCEPTED (!)'}`;
      });
    }
    const st = await A.evaluate(() => currentGameState ? `${currentGameState.round}|${currentGameState.phase}|${getActivePlayerSeat()}` : 'none');
    if (st === lastState) stall++; else { stall = 0; lastState = st; }
    steps++;
    if (steps % 15 === 0) log(`  [${steps}] A:${rA} B:${rB} now=${st}`);
    if (st.startsWith('2|')) break;   // round 2 reached
    if (st.includes('|end|')) break;
    await sleep(450);
  }
  const endState = await A.evaluate(async () => {
    const { data } = await db.from('btech_games').select('current_round,current_phase,active_player_id,state').eq('id', currentGameId).single();
    const st = typeof data.state === 'string' ? JSON.parse(data.state) : data.state;
    return { round: data.current_round, phase: data.current_phase, tracker: st.phase_activation || null, moved: (st.mech_instances || []).filter(m => !m.destroyed).every(m => m.hasMoved), fired: (st.mech_instances || []).filter(m => !m.destroyed).every(m => m.hasFired) };
  });
  check('round 1 completed to round 2', endState.round === 2, JSON.stringify(endState));
  check('2. ownership: acting on a mate\u2019s unit rejected', Boolean(ownershipProbe) && /REJECTED/.test(ownershipProbe), ownershipProbe || 'probe never ran');

  // ---------- 4. mid-match rejoin ----------
  await ctxB.close();
  const ctxB2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const B2 = await ctxB2.newPage();
  await signIn(B2, 'tester2', '123456');
  await B2.fill('#join-code', gameCode);
  await B2.evaluate(() => handleJoinGame());
  await sleep(8000);
  const rejoin = await B2.evaluate(() => ({ scr: [...document.querySelectorAll('.screen')].find(s => !s.classList.contains('hidden') && s.style.display !== 'none')?.id, seat: mySeatNumber }));
  check('4. mid-match rejoin lands back in live game', rejoin.scr === 'game-screen' && rejoin.seat === 2, JSON.stringify(rejoin));

  // cleanup: remove the fixture so we don't add to the stale-game pile
  if (!failures.length) {
    const del = await A.evaluate(async id => (await db.from('btech_games').delete().eq('id', id)).error?.message || null, gameId);
    check('fixture match deleted after passing', !del, del || gameCode);
  } else {
    log(`(fixture ${gameCode} retained for inspection)`);
  }
} catch (e) {
  failures.push('fatal: ' + e.message);
  log('FATAL:', e.message, '\n', e.stack?.slice(0, 400));
} finally {
  log(`\nBATTLE-C ${failures.length ? 'FAILED (' + failures.length + ')' : 'PASSED'}`);
  const errs = [...errA, ...errB];
  if (errs.length) log(`page/console errors: ${errs.length}\n${[...new Set(errs)].slice(0, 12).join('\n')}`);
  await browser.close();
  process.exit(failures.length ? 1 : 0);
}
