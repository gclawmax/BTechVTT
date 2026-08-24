// Live smoke test for the priority human-vs-human path.
//
// It uses two isolated browser sessions and exercises the real UI and
// Supabase calls: create lobby → join by code → build/deploy legal rosters
// → ready/start → separate initiative rolls → alternating movement → reload.
//
// Start a static server first, then run:
//   python3 -m http.server 8790
//   node tools/test-human-vs-human.mjs
//
// Optional credentials make repeated runs use dedicated disposable accounts:
//   BT_H2H_HOST, BT_H2H_HOST_PASS, BT_H2H_GUEST, BT_H2H_GUEST_PASS, SHOT_URL

import { createRequire } from 'module';
import { writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/mattperkins/.hermes/hermes-agent/node_modules/playwright');
const BASE = process.env.SHOT_URL || 'http://127.0.0.1:8790/index.html';
const HOST = { user: process.env.BT_H2H_HOST || 'h2h-regression-host', pass: process.env.BT_H2H_HOST_PASS || 'H2H!Host01' };
const GUEST = { user: process.env.BT_H2H_GUEST || 'h2h-regression-guest', pass: process.env.BT_H2H_GUEST_PASS || 'H2H!Guest01' };
const REPORT_PATH = process.env.BT_H2H_REPORT || null;
const failures = [];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}
async function activeScreen(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.screen')).find(screen => screen.classList.contains('active'))?.id || null);
}
async function waitForScreen(page, id, timeout = 25000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await activeScreen(page) === id) return true;
    await sleep(250);
  }
  return false;
}
async function waitForRestoredState(page, expected, timeout = 25000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const snapshot = await state(page);
    if (snapshot.phase === expected.phase && snapshot.round === expected.round &&
        snapshot.activePlayer === expected.activePlayer && snapshot.ownUnits === expected.ownUnits) return true;
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
async function addAndDeployLocust(page) {
  await page.waitForSelector('#lobby-roster-search', { timeout: 20000 });
  await page.fill('#lobby-roster-search', 'locust');
  const option = page.locator('.roster-option-wrap:not([hidden]) .roster-option').first();
  await option.waitFor({ state: 'visible', timeout: 45000 });
  await option.click();
  await page.waitForSelector('.hangar-entry', { timeout: 15000 });
  await page.getByRole('button', { name: 'Deploy', exact: true }).first().click();
  await page.waitForFunction(() => /Deployment:\s*[1-9]/.test(document.querySelector('.roster-summary')?.textContent || ''), null, { timeout: 15000 });
}
async function placeBattlefieldDeployment(page, hex, facing) {
  await page.locator('#lobby-deployment .deployment-grid').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator(`#lobby-deployment .deployment-hex[title^="${hex}"]`).click();
  await page.waitForFunction(() => /1\/1 placed/.test(document.querySelector('#lobby-deployment .deployment-help')?.textContent || ''), null, { timeout: 15000 });
  await page.getByRole('button', { name: facing, exact: true }).click();
}
async function state(page) {
  return page.evaluate(() => ({
    screen: Array.from(document.querySelectorAll('.screen')).find(screen => screen.classList.contains('active'))?.id || null,
    phase: currentGameState?.phase || null,
    round: currentGameState?.round || null,
    activePlayer: currentGameState?.active_player_id || null,
    myTurn: typeof isMyActiveTurn === 'function' && isMyActiveTurn(),
    ownUnits: (mechInstances || []).filter(mech => mech.owner === mySeatNumber).length,
    ownUnmoved: (mechInstances || []).filter(mech => mech.owner === mySeatNumber && !mech.hasMoved).length,
    ownFired: (mechInstances || []).filter(mech => mech.owner === mySeatNumber && mech.hasFired).length,
    ownPositions: (mechInstances || []).filter(mech => mech.owner === mySeatNumber).map(mech => `${hexCode(mech.col, mech.row)}:${HEX_DIR_LABELS[mech.facing]}`).sort(),
    guidance: document.getElementById('turn-guidance')?.textContent || ''
  }));
}
async function rollUntilResolved(host, guest) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    for (const page of [host, guest]) {
      const snapshot = await state(page);
      if (snapshot.phase !== 'initiative') continue;
      const button = page.locator('#btn-roll-initiative');
      if (await button.isVisible().catch(() => false) && await button.isEnabled().catch(() => false)) await button.click().catch(() => {});
    }
    const hostState = await state(host);
    const guestState = await state(guest);
    if (hostState.phase === 'movement' && guestState.phase === 'movement') return true;
    await sleep(750);
  }
  return false;
}
async function completeAlternatingMovement(host, guest) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const hostState = await state(host);
    const guestState = await state(guest);
    if (hostState.phase !== 'movement' && guestState.phase !== 'movement') return { hostState, guestState };
    for (const [page, snapshot] of [[host, hostState], [guest, guestState]]) {
      if (snapshot.phase !== 'movement' || !snapshot.myTurn) continue;
      if (snapshot.ownUnmoved > 0) {
        await page.evaluate(() => {
          const mech = (mechInstances || []).find(candidate => candidate.owner === mySeatNumber && !candidate.hasMoved);
          if (mech) { selectedInstanceId = mech.instanceId; startMovementMode(mech.instanceId, 'stand'); }
        });
        await sleep(750);
      }
      const next = page.locator('#btn-advance-phase');
      if (await next.isEnabled().catch(() => false)) await next.click().catch(() => {});
    }
    await sleep(750);
  }
  return { hostState: await state(host), guestState: await state(guest) };
}
async function completePhaseThroughHeat(host, guest) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const hostState = await state(host);
    const guestState = await state(guest);
    if (hostState.round >= 2 && guestState.round >= 2 && hostState.phase === 'initiative' && guestState.phase === 'initiative') return { hostState, guestState };
    for (const [page, snapshot] of [[host, hostState], [guest, guestState]]) {
      if (!snapshot.myTurn) continue;
      if (snapshot.phase === 'reaction') {
        await page.evaluate(() => {
          const mech = (mechInstances || []).find(candidate => candidate.owner === mySeatNumber && !candidate.hasReacted && !candidate.destroyed);
          if (mech) { selectedInstanceId = mech.instanceId; completeReaction(mech.instanceId); }
        });
      } else if (snapshot.phase === 'weapon_attack') {
        await page.evaluate(() => {
          const mech = (mechInstances || []).find(candidate => candidate.owner === mySeatNumber && !candidate.hasFired && !candidate.destroyed);
          const target = (mechInstances || []).find(candidate => candidate.owner !== mySeatNumber && !candidate.destroyed);
          if (!mech || !target) return;
          selectWeaponAttacker(mech.instanceId);
          selectWeaponTarget(target.instanceId);
          const entry = (BT_UNITS[mech.unitId]?.weapons || []).find((weapon, index) => evaluateWeaponAttack(mech, target, weapon).valid);
          if (entry) toggleWeaponForAttack(weaponMountId(entry, BT_UNITS[mech.unitId].weapons.indexOf(entry)));
          confirmWeaponAttack();
        });
      } else if (snapshot.phase === 'heat') {
        await page.evaluate(() => confirmHeatManagement());
      }
      await sleep(700);
      const next = page.locator('#btn-advance-phase');
      if (await next.isEnabled().catch(() => false)) await next.click().catch(() => {});
    }
    await sleep(700);
  }
  return { hostState: await state(host), guestState: await state(guest) };
}

const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const hostContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const guestContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const host = await hostContext.newPage();
const guest = await guestContext.newPage();
const errors = [];
for (const page of [host, guest]) {
  page.on('pageerror', error => errors.push(`PAGEERROR: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`CONSOLE: ${message.text()}`); });
}

try {
  await Promise.all([signIn(host, HOST), signIn(guest, GUEST)]);
  check('both players reach the main menu', await activeScreen(host) === 'menu-screen' && await activeScreen(guest) === 'menu-screen');

  await host.getByRole('button', { name: 'Create Game', exact: true }).click();
  check('host opens match setup', await waitForScreen(host, 'match-setup-screen'));
  await host.selectOption('#create-tonnage-select', '100');
  await host.getByRole('button', { name: 'Create Lobby', exact: true }).click();
  check('host creates a lobby', await waitForScreen(host, 'lobby-screen'));
  const code = (await host.locator('#lobby-code').innerText()).trim();
  check('lobby provides a shareable code', /^BT-[A-Z0-9]{4}$/.test(code), code || 'missing code');

  await guest.fill('#join-code', code);
  await guest.locator('#menu-screen .join-row button').click();
  check('guest joins the lobby by code', await waitForScreen(guest, 'lobby-screen'));

  await Promise.all([addAndDeployLocust(host), addAndDeployLocust(guest)]);
  check('both players deploy a legal roster', /Deployment:\s*[1-9]/.test(await host.locator('.roster-summary').innerText()) && /Deployment:\s*[1-9]/.test(await guest.locator('.roster-summary').innerText()));
  await Promise.all([placeBattlefieldDeployment(host, '0101', 'NE'), placeBattlefieldDeployment(guest, '1410', 'SW')]);
  check('both players choose deployment hexes and facings', /1\/1 placed/.test(await host.locator('#lobby-deployment .deployment-help').innerText()) && /1\/1 placed/.test(await guest.locator('#lobby-deployment .deployment-help').innerText()));

  await host.locator('#btn-ready').click();
  await guest.locator('#btn-ready').click();
  await host.waitForFunction(() => !document.getElementById('btn-start')?.disabled, null, { timeout: 20000 });
  await host.locator('#btn-start').click();
  check('host starts the shared game', await waitForScreen(host, 'game-screen'));
  check('guest receives the shared game', await waitForScreen(guest, 'game-screen'));
  const deployedBoard = { host: await state(host), guest: await state(guest) };
  check('shared battlefield uses the selected deployment positions and facings',
    deployedBoard.host.ownPositions.includes('0101:NE') && deployedBoard.guest.ownPositions.includes('1410:SW'), JSON.stringify(deployedBoard));

  const initiativeResolved = await rollUntilResolved(host, guest);
  const initiativeState = { host: await state(host), guest: await state(guest) };
  check('separate initiative rolls resolve into movement', initiativeResolved, JSON.stringify(initiativeState));
  check('turn guidance explains the active player’s next action', Boolean(initiativeState.host.guidance) && Boolean(initiativeState.guest.guidance));
  const afterMovement = await completeAlternatingMovement(host, guest);
  check('both players advance beyond movement', afterMovement.hostState.phase !== 'movement' && afterMovement.guestState.phase !== 'movement', `${afterMovement.hostState.phase}/${afterMovement.guestState.phase}`);

  const afterRound = await completePhaseThroughHeat(host, guest);
  check('both players complete Reaction, weapon declaration, Heat, and reach Round 2 Initiative',
    afterRound.hostState.round >= 2 && afterRound.guestState.round >= 2 && afterRound.hostState.phase === 'initiative' && afterRound.guestState.phase === 'initiative',
    `${JSON.stringify(afterRound.hostState)}/${JSON.stringify(afterRound.guestState)}`);
  check('both players resolve a real weapon declaration before heat management',
    afterRound.hostState.ownFired > 0 && afterRound.guestState.ownFired > 0,
    `${afterRound.hostState.ownFired}/${afterRound.guestState.ownFired}`);

  // Reload the player who is NOT currently active, so reconnect is covered
  // while the opponent owns the live turn rather than only between actions.
  const hostBeforeReload = await state(host);
  const guestBeforeReload = await state(guest);
  const rejoiningPage = hostBeforeReload.myTurn ? guest : host;
  const beforeReload = rejoiningPage === host ? hostBeforeReload : guestBeforeReload;
  await rejoiningPage.reload({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  const returnedToMenu = await waitForScreen(rejoiningPage, 'menu-screen');
  const activeMatch = rejoiningPage.locator('#active-games-list .game-entry').filter({ hasText: code });
  const matchingEntries = await activeMatch.count();
  const menuMatches = await activeMatch.allTextContents();
  const entryVisible = await activeMatch.first().isVisible().catch(() => false);
  if (returnedToMenu && entryVisible) await activeMatch.first().click();
  const rejoined = await waitForScreen(rejoiningPage, 'game-screen');
  const restored = rejoined && await waitForRestoredState(rejoiningPage, beforeReload);
  const afterReload = await state(rejoiningPage);
  check('a player can rejoin the active shared match during the opponent’s turn', returnedToMenu && entryVisible && rejoined && restored && !afterReload.myTurn,
    JSON.stringify({ returnedToMenu, matchingEntries, menuMatches, entryVisible, beforeReload, afterReload }));
} catch (error) {
  check('test completed without a fatal error', false, error.message);
} finally {
  console.log('\n--- console/page errors ---');
  console.log(errors.join('\n') || '(none)');
  await browser.close();
}

if (failures.length) {
  if (REPORT_PATH) await writeFile(REPORT_PATH, JSON.stringify({ passed: false, failures, errors }, null, 2));
  console.log(`\n${failures.length} human-vs-human regression failure(s)`);
  process.exit(1);
}
if (REPORT_PATH) await writeFile(REPORT_PATH, JSON.stringify({ passed: true, failures: [], errors }, null, 2));
console.log('\nHuman-vs-human regression smoke test passed');
