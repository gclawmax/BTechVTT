// Live smoke test for the priority human-vs-human path.
//
// It uses two isolated browser sessions and exercises the real UI and
// Supabase calls: create lobby → join by code → build/deploy legal rosters
// → ready/start → separate initiative rolls → converge into contact → declare
// no weapon fire → exchange simultaneous kicks → Heat → reload.
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
let gameCode = null;
let soakSelections = null;
const failures = [];

// Each soak iteration selects one safe, single-BattleMech custom skirmish.
// Keeping forces to one per side preserves the alternating-activation and
// physical-contact assertions below, while exercising genuinely different
// supported equipment and map data through the normal lobby UI.
const SOAK_MATRIX = Object.freeze([
  { name:'Training Grounds', mapId:'training-grounds', fallback:['locust','locust'] },
  { name:'Woodland Approach', mapId:'woodland-approach', fallback:['wolverine','panther'] },
  { name:'Open Engagement', mapId:'open-engagement', fallback:['griffin','blackjack'] },
  { name:'Flatlands', mapId:'flatlands-open-terrain', fallback:['dragon drg-5n','panther'] },
  { name:'Ridge and Ford', mapId:'ridge-and-ford', fallback:['kintaro','dervish'] }
]);
const soakProfileIndex = Math.max(0, Number(process.env.BT_SOAK_PROFILE || 0) || 0);
const soakProfile = SOAK_MATRIX[soakProfileIndex % SOAK_MATRIX.length];
const soakSeed = String(process.env.BT_SOAK_SEED || `local-${soakProfileIndex}`);
const fixedForces = process.env.BT_SOAK_FORCE_MODE === 'fixed';

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
async function waitForDeploymentState(page, expectedPosition, timeout = 25000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const snapshot = await state(page);
    if (snapshot.ownUnits === 1 && snapshot.ownPositions.includes(expectedPosition)) return true;
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
async function addAndDeployBattleMech(page, selection) {
  await page.waitForSelector('#lobby-roster-search', { timeout: 20000 });
  await page.fill('#lobby-roster-search', selection.search);
  const option = page.locator(`.roster-option-wrap[data-unit-id="${selection.unitId}"] .roster-option`).first();
  await option.waitFor({ state: 'visible', timeout: 45000 });
  await option.click();
  await page.waitForSelector('.hangar-entry', { timeout: 15000 });
  await page.getByRole('button', { name: 'Deploy', exact: true }).first().click();
  await page.waitForFunction(() => /Deployment:\s*[1-9]/.test(document.querySelector('.roster-summary')?.textContent || ''), null, { timeout: 15000 });
}
async function chooseSoakForce(page) {
  if (fixedForces) return {
    host: { unitId:null, search:soakProfile.fallback[0] }, guest: { unitId:null, search:soakProfile.fallback[1] },
    seed:soakSeed, mode:'fixed fallback'
  };
  return page.evaluate(({ seed }) => {
    let value = 2166136261;
    for (const character of seed) value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0;
    const next = () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
    const candidates = [...databaseSupportedUnitIds].map(unitId => ({ unitId, unit:getSupportedUnit(unitId) }))
      .filter(({ unit }) => unit && !unit.customDesign && Number(unit.tonnage) <= 100 && Number(unit.movement?.run || 0) >= 6 && (unit.weapons || []).some(weapon => !weapon.weapon?.supportOnly))
      .sort((left, right) => left.unitId.localeCompare(right.unitId));
    if (candidates.length < 2) throw new Error('The pinned catalogue has fewer than two eligible supported soak BattleMechs.');
    const host = candidates[Math.floor(next() * candidates.length)];
    const guestChoices = candidates.filter(candidate => candidate.unitId !== host.unitId);
    const guest = guestChoices[Math.floor(next() * guestChoices.length)];
    const selection = candidate => ({ unitId:candidate.unitId, search:`${candidate.unit.chassis} ${candidate.unit.variant}` });
    return { host:selection(host), guest:selection(guest), seed, mode:'seeded random', eligible:candidates.length };
  }, { seed:soakSeed });
}
async function placeBattlefieldDeployment(page, hex, facing) {
  await page.locator('#lobby-deployment .deployment-map').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator(`#lobby-deployment .deployment-hex[aria-label^="${hex}"]`).click();
  await page.waitForFunction(() => /1\/1 placed/.test(document.querySelector('#lobby-deployment > .deployment-help')?.textContent || ''), null, { timeout: 15000 });
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
    // Map configuration lives outside the phase snapshot so it survives a
    // rejoin without duplicating static match data in currentGameState.
    mapId: currentMatchConfig?.map_id || null,
    guidance: document.getElementById('turn-guidance')?.textContent || ''
  }));
}
async function initiativeDiagnostics(page) {
  return page.evaluate(() => {
    const button = document.getElementById('btn-roll-initiative');
    return {
      phase: currentGameState?.phase || null,
      round: currentGameState?.round || null,
      initiativePending: currentGameState?.initiative_pending || [],
      initiativeRolls: currentGameState?.initiative_rolls || [],
      button: button ? { hidden:button.hidden, disabled:button.disabled, title:button.title || '' } : null,
      ownAmmo: (mechInstances || []).filter(mech => mech.owner === mySeatNumber).flatMap(mech => (mech.ammoBins || []).map(bin => ({
        mech:mech.instanceId, bin:bin.id, type:bin.type, loadType:bin.loadType || null,
        needsChoice: typeof ammoSetupRequiredForBin === 'function' && ammoSetupRequiredForBin(bin)
      }))),
      recentLog: (gameLog || []).slice(-8).map(entry => entry.text || entry.message || String(entry))
    };
  });
}
async function saveRequiredRoundOneAmmo(page) {
  return page.evaluate(async () => {
    const pending = (mechInstances || []).some(mech => mech.owner === mySeatNumber && (mech.ammoBins || []).some(bin => ammoSetupRequiredForBin(bin)));
    if (pending) await submitRoundOneAmmoLoadout();
    return { pending, after: (mechInstances || []).filter(mech => mech.owner === mySeatNumber).flatMap(mech => (mech.ammoBins || []).filter(bin => ammoSetupRequiredForBin(bin)).map(bin => `${mech.instanceId}:${bin.id}`)) };
  });
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
    if (hostState.phase === 'movement' && guestState.phase === 'movement') return { resolved:true, host:await initiativeDiagnostics(host), guest:await initiativeDiagnostics(guest) };
    await sleep(750);
  }
  return { resolved:false, host:await initiativeDiagnostics(host), guest:await initiativeDiagnostics(guest) };
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
        await page.evaluate(async () => {
          const mech = (mechInstances || []).find(candidate => candidate.owner === mySeatNumber && !candidate.hasMoved);
          if (!mech) return;
          selectedInstanceId = mech.instanceId;
          const path = [];
          let col = mech.col;
          let row = mech.row;
          for (let step = 0; step < 3; step++) {
            const next = hexNeighbor(col, row, mech.facing);
            path.push({ action: 'step', col: next.col, row: next.row });
            col = next.col;
            row = next.row;
          }
          await submitAuthoritativeMovement(mech, 'run', path);
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
async function advanceThroughNoFireToPhysical(host, guest) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const hostState = await state(host);
    const guestState = await state(guest);
    if (hostState.phase === 'physical_attack' && guestState.phase === 'physical_attack') return { hostState, guestState };
    for (const [page, snapshot] of [[host, hostState], [guest, guestState]]) {
      if (!snapshot.myTurn) continue;
      if (snapshot.phase === 'reaction') {
        await page.evaluate(() => {
          const mech = (mechInstances || []).find(candidate => candidate.owner === mySeatNumber && !candidate.hasReacted && !candidate.destroyed);
          if (mech) { selectedInstanceId = mech.instanceId; completeReaction(mech.instanceId); }
        });
      } else if (snapshot.phase === 'weapon_attack') {
        await page.evaluate(async () => {
          const mech = (mechInstances || []).find(candidate => candidate.owner === mySeatNumber && !candidate.hasFired && !candidate.destroyed);
          if (!mech) return;
          selectWeaponAttacker(mech.instanceId);
          await confirmWeaponAttack();
        });
      }
      await sleep(700);
      const next = page.locator('#btn-advance-phase');
      if (await next.isEnabled().catch(() => false)) await next.click().catch(() => {});
    }
    await sleep(700);
  }
  return { hostState: await state(host), guestState: await state(guest) };
}
async function completePhysicalExchange(host, guest) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const hostState = await state(host);
    const guestState = await state(guest);
    if (hostState.phase === 'heat' && guestState.phase === 'heat') return { hostState, guestState };
    for (const [page, snapshot] of [[host, hostState], [guest, guestState]]) {
      if (snapshot.phase !== 'physical_attack' || !snapshot.myTurn) continue;
      await page.evaluate(async () => {
        const attacker = (mechInstances || []).find(candidate => candidate.owner === mySeatNumber && !candidate.hasPhysicalAttacked && !candidate.destroyed);
        const target = (mechInstances || []).find(candidate => candidate.owner !== mySeatNumber && !candidate.destroyed);
        if (!attacker || !target) return;
        selectPhysicalAttacker(attacker.instanceId);
        selectPhysicalTarget(target.instanceId);
        selectPhysicalAttackType('kick');
        await confirmPhysicalAttack();
      });
      await sleep(900);
    }
    await sleep(700);
  }
  return { hostState: await state(host), guestState: await state(guest) };
}
async function physicalLedger(page) {
  return page.evaluate(async () => {
    const { data, error } = await db.from('btech_combat_events')
      .select('status,attacker_instance_id,target_instance_id,resolution')
      .eq('game_id', currentGameId).eq('round', 1).eq('phase', 'physical_attack').order('sequence');
    if (error) return { error: error.message, events: [] };
    return { events: data || [] };
  });
}
async function sharedCombatSignature(page) {
  return page.evaluate(() => (mechInstances || []).map(mech => ({
    id: mech.instanceId, col: mech.col, row: mech.row, facing: mech.facing,
    prone: Boolean(mech.prone), destroyed: Boolean(mech.destroyed),
    armor: mech.armor, structure: mech.structure,
    pilot: mech.pilot
  })).sort((a, b) => a.id.localeCompare(b.id)));
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

  await host.getByRole('button', { name: 'Create Custom Skirmish', exact: true }).click();
  check('host opens match setup', await waitForScreen(host, 'match-setup-screen'));
  await host.selectOption('#create-map-select', soakProfile.mapId);
  await host.selectOption('#create-tonnage-select', '100');
  await host.getByRole('button', { name: 'Create Lobby', exact: true }).click();
  check('host creates a lobby', await waitForScreen(host, 'lobby-screen'));
  const code = (await host.locator('#lobby-code').innerText()).trim();
  gameCode = code;
  check('lobby provides a shareable code', /^BT-[A-Z0-9]{4}$/.test(code), code || 'missing code');

  await guest.fill('#join-code', code);
  await guest.locator('#menu-screen .join-row button').click();
  check('guest joins the lobby by code', await waitForScreen(guest, 'lobby-screen'));

  const selections = await chooseSoakForce(host);
  // Fixed mode remains an escape hatch for isolating a failure; normal soak
  // runs always choose catalogue-backed BattleMechs from the supplied seed.
  if (!selections.host.unitId) {
    const resolve = async (page, search) => page.evaluate(searchText => {
      const card = [...document.querySelectorAll('.roster-option-wrap[data-unit-id]')].find(entry => (entry.dataset.search || '').includes(searchText));
      if (!card) throw new Error(`No fixed soak card matches ${searchText}.`);
      return { unitId:card.dataset.unitId, search:searchText };
    }, search);
    selections.host = await resolve(host, selections.host.search);
    selections.guest = await resolve(guest, selections.guest.search);
  }
  soakSelections = selections;
  console.log(`SOAK FORCE: ${selections.host.unitId} versus ${selections.guest.unitId} (${selections.mode}, seed ${selections.seed})`);
  await Promise.all([addAndDeployBattleMech(host, selections.host), addAndDeployBattleMech(guest, selections.guest)]);
  check(`both players deploy the ${selections.mode} ${soakProfile.name} roster`, /Deployment:\s*[1-9]/.test(await host.locator('.roster-summary').innerText()) && /Deployment:\s*[1-9]/.test(await guest.locator('.roster-summary').innerText()));
  await Promise.all([placeBattlefieldDeployment(host, '0405', 'E'), placeBattlefieldDeployment(guest, '1105', 'W')]);
  check('both players choose deployment hexes and facings', /1\/1 placed/.test(await host.locator('#lobby-deployment > .deployment-help').innerText()) && /1\/1 placed/.test(await guest.locator('#lobby-deployment > .deployment-help').innerText()));

  await host.locator('#btn-ready').click();
  await guest.locator('#btn-ready').click();
  await host.waitForFunction(() => !document.getElementById('btn-start')?.disabled, null, { timeout: 20000 });
  await host.locator('#btn-start').click();
  check('host starts the shared game', await waitForScreen(host, 'game-screen'));
  check('guest receives the shared game', await waitForScreen(guest, 'game-screen'));
  await Promise.all([waitForDeploymentState(host, '0405:E'), waitForDeploymentState(guest, '1105:W')]);
  const deployedBoard = { host: await state(host), guest: await state(guest) };
  check('shared battlefield uses the selected deployment positions and facings',
    deployedBoard.host.ownPositions.includes('0405:E') && deployedBoard.guest.ownPositions.includes('1105:W'), JSON.stringify(deployedBoard));
  check(`custom skirmish uses the selected ${soakProfile.mapId} battlefield`, deployedBoard.host.mapId === soakProfile.mapId && deployedBoard.guest.mapId === soakProfile.mapId, JSON.stringify(deployedBoard));

  const ammoSave = await Promise.all([saveRequiredRoundOneAmmo(host), saveRequiredRoundOneAmmo(guest)]);
  check('both players save any specialised Round 1 ammunition required by the selected BattleMechs', ammoSave.every(result => result.after.length === 0), JSON.stringify(ammoSave));
  const initiativeResolution = await rollUntilResolved(host, guest);
  const initiativeState = { host: await state(host), guest: await state(guest) };
  check('separate initiative rolls resolve into movement', initiativeResolution.resolved, JSON.stringify({ initiativeState, diagnostics:{ host:initiativeResolution.host, guest:initiativeResolution.guest } }));
  check('turn guidance explains the active player’s next action', Boolean(initiativeState.host.guidance) && Boolean(initiativeState.guest.guidance));
  const afterMovement = await completeAlternatingMovement(host, guest);
  check('both players advance beyond movement', afterMovement.hostState.phase !== 'movement' && afterMovement.guestState.phase !== 'movement', `${afterMovement.hostState.phase}/${afterMovement.guestState.phase}`);

  const contact = { host: await state(host), guest: await state(guest) };
  check('both BattleMechs finish movement adjacent and facing one another',
    contact.host.ownPositions.includes('0705:E') && contact.guest.ownPositions.includes('0805:W'), JSON.stringify(contact));

  const beforePhysical = await advanceThroughNoFireToPhysical(host, guest);
  check('both players reach the shared Physical Attack phase',
    beforePhysical.hostState.phase === 'physical_attack' && beforePhysical.guestState.phase === 'physical_attack',
    `${beforePhysical.hostState.phase}/${beforePhysical.guestState.phase}`);

  const afterPhysical = await completePhysicalExchange(host, guest);
  check('both kick declarations resolve and advance both players to Heat',
    afterPhysical.hostState.phase === 'heat' && afterPhysical.guestState.phase === 'heat',
    `${afterPhysical.hostState.phase}/${afterPhysical.guestState.phase}`);
  const ledger = await physicalLedger(host);
  check('the server stores both resolved physical declarations',
    !ledger.error && ledger.events.length === 2 && ledger.events.every(event => event.status === 'resolved' && event.resolution?.state_version === 'authoritative-physical-01' && event.resolution?.results?.[0]?.attack_type === 'kick'),
    JSON.stringify(ledger));
  const [hostCombat, guestCombat] = await Promise.all([sharedCombatSignature(host), sharedCombatSignature(guest)]);
  check('both browsers receive identical physical damage, facing, fall, and pilot state',
    JSON.stringify(hostCombat) === JSON.stringify(guestCombat), JSON.stringify({ hostCombat, guestCombat }));

  const afterRound = await completePhaseThroughHeat(host, guest);
  check('both players complete Reaction, weapon declaration, Heat, and reach Round 2 Initiative',
    afterRound.hostState.round >= 2 && afterRound.guestState.round >= 2 && afterRound.hostState.phase === 'initiative' && afterRound.guestState.phase === 'initiative',
    `${JSON.stringify(afterRound.hostState)}/${JSON.stringify(afterRound.guestState)}`);
  check('both players persist their no-fire weapon declarations before physical combat',
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
  if (REPORT_PATH) await writeFile(REPORT_PATH, JSON.stringify({ passed: false, gameCode, soakProfile, soakSeed, fixedForces, soakSelections, failures, errors }, null, 2));
  console.log('\n--- failure hand-off ---');
  console.log(`Game: ${gameCode || 'not created'} | Force: ${soakSelections ? `${soakSelections.host.unitId} vs ${soakSelections.guest.unitId}` : 'not selected'} | Seed: ${soakSeed}`);
  console.log(`First failure: ${failures[0] || 'unknown'}`);
  console.log(REPORT_PATH ? `Report: ${REPORT_PATH}` : 'Report: not requested (the soak runner always requests one).');
  console.log(`\n${failures.length} human-vs-human regression failure(s)`);
  process.exit(1);
}
if (REPORT_PATH) await writeFile(REPORT_PATH, JSON.stringify({ passed: true, gameCode, soakProfile, soakSeed, fixedForces, soakSelections, failures: [], errors }, null, 2));
console.log('\nHuman-vs-human regression smoke test passed');
