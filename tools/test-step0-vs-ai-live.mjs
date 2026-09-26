// Step 0 gate acceptance — Battle B: full Play-vs-AI lifecycle to victory.
//
// A single browser session plays the human seat (seat 1) of a configured
// Play vs AI skirmish against the pre-seeded AI seat (seat 2) on the LIVE
// Supabase backend, through the real UI and public authoritative paths.
// The battle plays to a FINISHED result (annihilation or objective), and the
// harness performs a mid-AI-turn browser refresh to prove the AI's turn does
// not produce duplicated server actions/declarations when the client reloads
// while it is acting.
//
// Usage:
//   python3 -m http.server 8790            (from repo root)
//   node tools/test-step0-vs-ai-live.mjs
//
// Optional env:
//   SHOT_URL                      base URL (default http://127.0.0.1:8790/index.html)
//   BT_H2H_HOST / _PASS           host account (default h2h-regression-host / H2H!Host01)
//   BT_VS_AI_TONNAGE              dropship tonnage per side (default 150)
//   BT_VS_AI_ROUNDS               maximum rounds before failing as stalled (default 20)
//   BT_VS_AI_REPORT               JSON report path (default: scratch dir)
//   BT_VS_AI_KEEP                 set to 1 to retain the disposable match
//
// PASS criteria:
//   - the host creates a configured Vs-AI lobby (player seat 1, AI seat 2)
//   - the board shows a player vs AI force split with the real server roster
//   - every round terminates through the real phase sequence; the AI acts
//     through the game's own auto-advance; the human seat is driven by the UI
//   - at least one weapon exchange resolves server-authoritatively
//   - a browser refresh DURING an AI turn: the AI turn still completes, and
//     btech_combat_events shows the same count and NO duplicated (round,
//     phase, sequence) declarations before vs after the refresh
//   - the match reaches a finished result with a sealed match report row
//   - armour/structure never negative; no uncaught browser errors
// On success the disposable match is removed; on failure the game code and
// report are retained for hand-off.

import { createRequire } from 'module';
import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  activeScreen, waitForScreen, signIn, state, invariantSnapshot,
  finishedRow, waitFinished, approachEvaluate, weaponActionEvaluate,
  reactionActionEvaluate, physicalActionEvaluate, drivePhase, rollInitiativeFor,
  reloadAndRejoin, sleep
} from './step0-common.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/mattperkins/.hermes/hermes-agent/node_modules/playwright');

const BASE = process.env.SHOT_URL || 'http://127.0.0.1:8790/index.html';
const HOST = { user: process.env.BT_H2H_HOST || 'h2h-regression-host', pass: process.env.BT_H2H_HOST_PASS || 'H2H!Host01' };
const MAP_ID = 'training-grounds';
const TONNAGE = Number(process.env.BT_VS_AI_TONNAGE || 150);
const MAX_ROUNDS = Math.max(4, Number(process.env.BT_VS_AI_ROUNDS || 20));
const KEEP = process.env.BT_VS_AI_KEEP === '1';
const REPORT_PATH = process.env.BT_VS_AI_REPORT || path.join(tmpdir(), `step0-vs-ai-report-${Date.now()}.json`);

const failures = [];
const info = { units: null, rounds: 0, gameCode: null, winner: null, buildStamp: null, aiTurnRefresh: null, errors: [] };
let gameCode = null;

function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

// Read btech_combat_events as the authenticated host (RLS allows participants):
// returns the total row count plus any duplicated (round, phase, sequence)
// triples — a refresh that re-submitted an AI declaration would create or leave
// a duplicate sequence, which the UNIQUE constraint should also forbid.
function combatEventsLedger(page) {
  return page.evaluate(async () => {
    const { data, error } = await db.from('btech_combat_events')
      .select('round,phase,sequence,status,attacker_instance_id')
      .eq('game_id', currentGameId).order('round', { ascending: true })
      .order('phase').order('sequence');
    if (error) return { error: error.message, count: 0, duplicates: [], rows: [] };
    const rows = data || [];
    const seen = new Map();
    const duplicates = [];
    for (const r of rows) {
      const k = `${r.round}|${r.phase}|${r.sequence}`;
      if (seen.has(k)) duplicates.push({ key: k, status: r.status, attacker: r.attacker_instance_id });
      seen.set(k, r);
    }
    return { error: null, count: rows.length, duplicates, rows };
  }).catch(e => ({ error: String(e && e.message || e), count: 0, duplicates: [], rows: [] }));
}

const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const host = await context.newPage();
host.on('pageerror', error => info.errors.push(`PAGEERROR: ${error.message}`));
host.on('console', message => { if (message.type() === 'error') info.errors.push(`CONSOLE: ${message.text()}`); });
// Gate rejections in the lobby surface as alerts or #lobby-status text —
// capture both, otherwise a start rejection is invisible to the harness.
host.on('dialog', dialog => { info.dialogs = info.dialogs || []; info.dialogs.push(dialog.message()); dialog.dismiss().catch(() => {}); });
let fatal = null;

try {
  await signIn(host, BASE, HOST);
  check('host reaches the main menu', await activeScreen(host) === 'menu-screen');

  // Instrument showScreen so a late redirect to login-screen is explainable:
  // record every screen transition with its call site, and auth events.
  await host.evaluate(() => {
    window.__screenLog = [];
    window.__authLog = [];
    try {
      const origShow = window.showScreen;
      window.showScreen = function (id) {
        window.__screenLog.push({ id, at: Date.now(), stack: (new Error().stack || '').split('\n').slice(1, 4).map(s => s.trim()).join(' <- ') });
        return origShow.apply(this, arguments);
      };
      const sub = db.auth.onAuthStateChange((event, session) => {
        window.__authLog.push({ event, hasSession: Boolean(session?.user), at: Date.now() });
      });
      window.__authUnsub = sub;
    } catch (e) { window.__screenLog.push({ id: 'hook-error', msg: String(e) }); }
  });

  // ── Create a configured Play vs AI lobby (player seat 1, AI seat 2) ─────
  await host.getByRole('button', { name: /Play vs AI/ }).first().click();
  check('host opens the Vs AI setup screen', await waitForScreen(host, 'vs-ai-setup-screen'));
  await host.selectOption('#vs-ai-map-select', MAP_ID);
  await host.selectOption('#vs-ai-force-format-select', 'tonnage');
  await host.selectOption('#vs-ai-tonnage-select', String(TONNAGE));
  await host.selectOption('#vs-ai-victory-select', 'annihilation');
  await host.evaluate(() => handleCreateConfiguredVsAI());
  check('host creates the Vs AI lobby', await waitForScreen(host, 'lobby-screen'));
  const code = (await host.locator('#lobby-code').innerText()).trim();
  gameCode = code;
  check('lobby provides a game code', /^BT-[A-Z0-9]{4}$/.test(code), code || 'missing code');
  info.gameCode = code;

  // Both rosters are generated by the client and pre-deployed (the AI is
  // deployed automatically). In Vs-AI the human seat is inserted ready=true
  // at creation, so the Ready button must NOT be clicked — doing so toggles
  // the seat to UNREADY and the start gate rejects ("Ready Up before
  // starting the AI match"). Poll until the lobby has rendered the button's
  // true label (renderLobby sets it from the isReady flag), then only click
  // if the seat is genuinely not ready yet.
  let readyLabel = '';
  for (let tries = 0; tries < 40; tries++) {
    readyLabel = await host.evaluate(() => {
      const t = document.getElementById('btn-ready')?.textContent?.trim();
      if (t === 'Ready Up' || t === 'Unready') return t;
      return (typeof isReady !== 'undefined' && isReady) ? 'Unready' : '';
    }).catch(() => '');
    if (readyLabel) break;
    await sleep(250);
  }
  if (readyLabel === 'Ready Up') {
    await host.locator('#btn-ready').click().catch(() => {});
    await sleep(750); // let the ready toggle land server-side before the start gate reads it
  }
  await host.waitForFunction(() => !document.getElementById('btn-start')?.disabled, null, { timeout: 25000 });
  await host.locator('#btn-start').click();
  // Sample #lobby-status while the start attempt runs: the gate rejections
  // land there but the next renderLobby overwrites them with the generic
  // "N/2 players in lobby" line, so capture any informative text as it goes.
  const statusSampler = (async () => {
    const seen = new Set();
    const end = Date.now() + 9000;
    while (Date.now() < end) {
      const t = await host.evaluate(() => document.getElementById('lobby-status')?.textContent?.trim() || '').catch(() => '');
      if (t && !/^\d\/2 (players|human players)/.test(t)) seen.add(t);
      await sleep(300);
    }
    return [...seen];
  })();
  const started = await waitForScreen(host, 'game-screen');
  const statusesSeen = await statusSampler;
  if (!started) {
    // The start gate rejected and wrote its reason to #lobby-status (or an
    // alert). Capture the exact gate failure instead of guessing.
    const diag = await host.evaluate(() => ({
      screen: document.querySelector('.screen.active')?.id || null,
      lobbyStatus: document.getElementById('lobby-status')?.textContent?.trim() || '',
      btnStartDisabled: document.getElementById('btn-start')?.disabled ?? null,
      isHost: typeof isHost !== 'undefined' ? isHost : null,
      vsAiMode: typeof vsAiMode !== 'undefined' ? vsAiMode : null,
      gameId: typeof currentGameId !== 'undefined' ? currentGameId : null,
      rosterLens: (() => { const s = (typeof currentGameState !== 'undefined' && currentGameState) || {};
        return { p1: (s.rosters?.['1'] || []).length, p2: (s.rosters?.['2'] || []).length,
                 dep1: (s.deployment_positions?.['1'] || []).length, dep2: (s.deployment_positions?.['2'] || []).length,
                 tonnage: s.dropship_tonnage, vs_ai_mode: s.vs_ai_mode }; })(),
    })).catch(e => ({ error: String(e) }));
    const traces = await host.evaluate(async () => {
      const out = { screenLog: (window.__screenLog || []).slice(-8), authLog: (window.__authLog || []).slice(-8) };
      try { const { data } = await db.auth.getSession(); out.sessionUser = Boolean(data?.session?.user); } catch (e) { out.sessionError = String(e); }
      return out;
    }).catch(e => ({ error: String(e) }));
    diag.traces = traces;
    info.startDiagnostics = { ...(info.startDiagnostics || {}), ...diag, dialogs: (info.dialogs || []).slice(), statusesSeen };
    console.log('START-FAIL DIAG: ' + JSON.stringify(diag));
  }
  check('host starts the Vs AI battle', started);

  // The game screen first shows a demo placeholder force; loadGameState()
  // swaps in the real server instances (~1s later). Poll until the real
  // board is present before asserting the player-vs-AI split.
  const DEMO_IDS = new Set(['atlas-1', 'hunchback-1', 'locust-1']);
  const boardDeadline = Date.now() + 20000;
  let board = await state(host);
  while (Date.now() < boardDeadline) {
    board = await state(host);
    const realBoard = board.screen === 'game-screen' && board.allUnits.length > 1 &&
      board.allUnits.every(u => !DEMO_IDS.has(u.id));
    if (realBoard) break;
    await sleep(300);
  }
  const pUnits = board.allUnits.filter(u => u.owner === 1).length;
  const aiUnits = board.allUnits.filter(u => u.owner === 2).length;
  info.units = { player: pUnits, ai: aiUnits };
  check('board shows a player vs AI force split',
    pUnits > 0 && aiUnits > 0 && board.allUnits.length === pUnits + aiUnits,
    JSON.stringify({ player: pUnits, ai: aiUnits, total: board.allUnits.length }));
  info.buildStamp = board.buildStamp;

  // Round 1 specialised ammunition: the host declares the human force's
  // pending bins (the AI's bins are pre-configured server-side).
  const ammoDeadline = Date.now() + 30000;
  let ammoResult = null;
  while (Date.now() < ammoDeadline) {
    ammoResult = await host.evaluate(async () => {
      const pending = (mechInstances || [])
        .filter(m => m.owner === mySeatNumber && !m.destroyed)
        .flatMap(m => (m.ammoBins || []).filter(bin => ammoSetupRequiredForBin(bin))
          .map(bin => ({ key: `${m.instanceId}:${bin.id}`, binId: bin.id })));
      for (const p of pending) await submitRoundOneAmmoLoadout(p.key);
      const remaining = (mechInstances || [])
        .filter(m => m.owner === mySeatNumber)
        .flatMap(m => (m.ammoBins || []).filter(bin => ammoSetupRequiredForBin(bin)).map(b => b.id));
      return { attempted: pending.map(p => p.binId), remaining };
    }).catch(e => ({ error: String(e && e.message || e), remaining: [] }));
    if (ammoResult.remaining.length === 0) break;
    await sleep(600);
  }
  check('Round 1 player ammunition confirmed where required',
    ammoResult && !ammoResult.error && ammoResult.remaining.length === 0, JSON.stringify(ammoResult));

  // Enable the game's own AI auto-advance so the AI turn advances itself.
  await host.evaluate(async () => { if (typeof setAutoAdvanceAfterAi === 'function') setAutoAdvanceAfterAi(true); });

  const weaponExchanges = [];
  let roundsPlayed = 0;
  let finish = null;
  let refreshedDuringAiTurn = false;

  for (let round = 1; round <= MAX_ROUNDS && !finish; round++) {
    const inv = await invariantSnapshot(host);
    check(`round ${round}: armour/structure non-negative on all ${inv.length} BattleMechs`,
      inv.every(m => m.minArmor >= 0), JSON.stringify(inv.filter(m => m.minArmor < 0)));
    roundsPlayed = round;

    const init = await rollInitiativeFor([host]);
    if (init.finished) { finish = init.finished; break; }

    const phases = [
      ['movement', approachEvaluate()],
      ['reaction', reactionActionEvaluate()],
      ['weapon_attack', weaponActionEvaluate()],
      ['physical_attack', physicalActionEvaluate()],
      ['heat', async () => { await confirmHeatManagement(); return { acted: true }; }]
    ];

    for (const [phaseName, actionFactory] of phases) {
      const hook = async states => {
        if (refreshedDuringAiTurn) return;
        // Mid-AI-turn refresh: fire it exactly once, while the active player
        // is the AI seat (activeSeat 2) and NOT the host's turn — and only
        // once the AI has already produced at least one combat event, so the
        // no-duplication proof has a non-zero baseline to compare against.
        const s = states[0];
        if (s.phase !== phaseName || s.myTurn || s.activeSeat !== 2) return;
        const probe = await combatEventsLedger(host);
        if (probe.count === 0) return;
        refreshedDuringAiTurn = true;
        const before = await state(host);
        const eventsBefore = probe;
        info.aiTurnRefresh = { ...(info.aiTurnRefresh || {}), round, phase: before.phase,
          eventsBefore: eventsBefore.count, duplicatesBefore: eventsBefore.duplicates.length };
        console.log(`round ${round}: mid-AI-turn refresh in ${before.phase} (events=${eventsBefore.count})`);
        const rejoin = await reloadAndRejoin(host, code, 'host');
        info.aiTurnRefresh.returnedToMenu = rejoin.returnedToMenu;
        info.aiTurnRefresh.entryVisible = rejoin.entryVisible;
        info.aiTurnRefresh.rejoined = rejoin.rejoined;
        info.aiTurnRefresh.restored = rejoin.restored;
        // Re-enable auto-advance after the reload (localStorage persists the
        // choice, but a fresh load re-initialises the module flag from it —
        // explicitly assert it is on).
        await host.evaluate(async () => { if (typeof setAutoAdvanceAfterAi === 'function') setAutoAdvanceAfterAi(true); }).catch(() => {});
        // In Vs-AI mode an empty physical phase is skipped automatically at
        // phase ENTRY; if the rejoin lands us already inside one with no legal
        // attacks (nobody adjacent), the host may need to advance it manually —
        // the #btn-advance-phase click below would otherwise spin forever.
        const physEmpty = (phaseName === 'physical_attack' && typeof anyLegalPhysicalAttackExists === 'function' && anyLegalPhysicalAttackExists() === false);
        if (physEmpty) await host.evaluate(async () => { try { if (typeof passRemainingPhysicalAttacks === 'function') await passRemainingPhysicalAttacks(); } catch (e) {} }).catch(() => {});
        // Wait for the AI turn to finish (the phase leaves phaseName, or the
        // match finishes, or a few seconds pass) before comparing event counts.
        const settle = Date.now() + 20000;
        let after = await state(host);
        while (Date.now() < settle && after.phase === before.phase) {
          const fin = await finishedRow(host);
          if (fin && fin.status === 'finished') break;
          await sleep(400);
          after = await state(host);
        }
        const eventsAfter = await combatEventsLedger(host);
        info.aiTurnRefresh.eventsBeforeReload = eventsBefore.count;
        info.aiTurnRefresh.eventsAfterTurnSettled = eventsAfter.count;
        info.aiTurnRefresh.duplicates = eventsAfter.duplicates;
        info.aiTurnRefresh.postReloadPhase = after.phase;
        check(`round ${round}: reload during AI turn rejoins with state restored`,
          rejoin.rejoined && rejoin.restored,
          JSON.stringify({ returnedToMenu: rejoin.returnedToMenu, entryVisible: rejoin.entryVisible, rejoined: rejoin.rejoined, restored: rejoin.restored }));
        check(`round ${round}: AI turn did not duplicate combat events across the reload`,
          eventsBefore.count > 0 && eventsAfter.count >= eventsBefore.count && eventsAfter.duplicates.length === 0,
          JSON.stringify({ beforeReload: eventsBefore.count, afterTurnSettled: eventsAfter.count, duplicates: eventsAfter.duplicates }));
      };
      const result = await drivePhase([host], phaseName, actionFactory, { hook });
      if (result.finished) { finish = result.finished; break; }
      for (const a of result.actions) if (a.action && a.action.fired) weaponExchanges.push({ round, phase: phaseName, ...a.action });
      if (phaseName === 'physical_attack' && result.stall) {
        info.physicalStalls = (info.physicalStalls || []).concat([{ round, ...result.stall }]);
        console.log(`round ${round}: physical phase deadlock recovered — advanced=${result.stall.advanced}`);
      }
      if (result.stall && phaseName !== 'physical_attack') {
        info.genericStalls = (info.genericStalls || []).concat([{ round, phase: phaseName, ...result.stall }]);
        console.log(`round ${round}: ${phaseName} phase stall recovered — advanced=${result.stall.advanced}`);
      }
    }
    if (finish) break;
    await waitFinished([host], 20000);
  }

  if (!finish) {
    const probe = await finishedRow(host);
    check('battle finished within the round budget', probe && probe.status === 'finished',
      `stalled after ${roundsPlayed} rounds; last status ${probe ? probe.status : 'unknown'} — game ${code} retained for inspection`);
  } else {
    info.rounds = roundsPlayed;
    info.winner = finish;
    check('battle reaches a finished result', true, `status=finished after ~${roundsPlayed} rounds; reason=${finish.reason}, winner_seat=${finish.winner_seat}`);
  }

  if (!refreshedDuringAiTurn) {
    check('a mid-AI-turn refresh was exercised', false,
      'no AI turn was reached before the match ended; the no-duplication check could not run');
  }

  if (weaponExchanges.length) {
    const ledger = await combatEventsLedger(host);
    const resolvedWeapon = (ledger.rows || []).filter(e => e.phase === 'weapon_attack' && e.status === 'resolved');
    check('server stores resolved weapon declarations',
      !ledger.error && resolvedWeapon.length >= weaponExchanges.length,
      `client saw ${weaponExchanges.length} fires; server resolved weapon rows ${resolvedWeapon.length}`);
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
  check('no uncaught browser errors across the session', !info.errors.some(e => e.startsWith('PAGEERROR')), info.errors.filter(e => e.startsWith('PAGEERROR')).join(' | ').slice(0, 400));

  if (!KEEP && failures.length === 0) {
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
  console.log('\n--- failure hand-off ---');
  console.log(`Game: ${gameCode || 'not created'} | rounds: ${info.rounds} | aiTurnRefresh: ${JSON.stringify(info.aiTurnRefresh)}`);
  console.log(`First failure: ${failures[0]}`);
  console.log(`${failures.length} Step 0 Vs-AI acceptance failure(s)`);
  process.exit(1);
}
console.log('\nStep 0 Vs-AI (Battle B) live acceptance PASSED');
