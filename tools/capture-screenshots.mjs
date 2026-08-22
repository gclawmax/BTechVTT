// Capture How-to-Play screenshots from the running BTechVTT app.
//
// Usage:
//   1. Serve the repo:  python3 -m http.server 8790   (from the repo root)
//   2. Run:             node tools/capture-screenshots.mjs
//   (Optional env: BT_USER / BT_PASS — defaults to a throwaway test account.)
//
// Output: PNGs in /tmp/bt_shots/ (and, if desired, convert to JPEG for the
// page). The flow drives the REAL app headlessly (Playwright + system Chrome):
//   login -> menu -> lobby -> board -> detail -> initiative -> movement
//   -> weapon attack -> combat result.
//
// NOTE on the weapon/combat shots: AI-mode games currently do not pin a
// catalogue_version, so the server rejects authoritative movement ("This match
// is missing its pinned catalogue") and the phase cannot advance through the
// normal UI. To still document the Weapon Attack panel, this script renders it
// client-side by setting the phase directly. The board/detail/movement shots
// are fully real. See docs/HOW_TO_PLAY_PROPOSAL.md §4.11.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/mattperkins/.hermes/hermes-agent/node_modules/playwright');
import fs from 'fs';

const BASE = process.env.SHOT_URL || 'http://localhost:8790/index.html';
const OUTDIR = process.env.SHOT_OUTDIR || '/tmp/bt_shots';
fs.mkdirSync(OUTDIR, { recursive: true });
const USER = process.env.BT_USER || 'screenshot-bot';
const PASS = process.env.BT_PASS || 'Shot!Passw0rd';

const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

const sleep = ms => page.waitForTimeout(ms);
const activeScreen = () => page.evaluate(() => Array.from(document.querySelectorAll('.screen')).filter(s => s.classList.contains('active')).map(s => s.id).join(','));
async function waitActive(id, ms = 20000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await activeScreen()).includes(id)) return true; await sleep(400); } return false; }
const shot = async (name) => { await sleep(900); const p = `${OUTDIR}/${name}.png`; await page.screenshot({ path: p }); console.log(`SHOT ${name} | ${await page.evaluate(() => JSON.stringify({ phase: currentGameState?.phase, myTurn: isMyActiveTurn?.(), status: document.getElementById('status-readout')?.textContent }))}`); return p; };
const state = () => page.evaluate(() => JSON.stringify({ phase: currentGameState?.phase, active: getActivePlayerSeat?.(), my: mySeatNumber, myTurn: isMyActiveTurn?.(), advDisabled: document.getElementById('btn-advance-phase')?.disabled }));
async function waitMyTurn(phase, ms = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = JSON.parse(await state());
    if (s.phase === phase && s.myTurn) return s;
    if (s.phase && !['movement','reaction','weapon_attack','physical_attack','heat'].includes(s.phase)) return s;
    await sleep(600);
  }
  return JSON.parse(await state());
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => errors.push('GOTO: ' + e.message));
  await sleep(1200);

  // 1. Login (create the account on first run)
  await shot('01_login');
  await page.fill('#login-username', USER);
  await page.fill('#login-password', PASS);
  await page.click('#login-screen button:has-text("LOGIN")').catch(() => {});
  await waitActive('menu-screen', 15000);
  if (!(await activeScreen()).includes('menu-screen')) {
    await page.fill('#login-username', USER); await page.fill('#login-password', PASS);
    await page.click('#login-screen button:has-text("CREATE ACCOUNT")').catch(() => {});
    await waitActive('menu-screen', 20000);
  }
  await shot('02_menu');

  // 2. Play vs AI -> lobby
  await page.click('#menu-screen button:has-text("Play vs AI")').catch(() => {});
  await waitActive('lobby-screen', 20000);
  await sleep(1500);
  await shot('03_lobby');

  // 3. Start game -> board
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('#lobby-screen button')).find(x => /start game/i.test(x.textContent)); if (b) b.click(); });
  await waitActive('game-screen', 25000);
  await sleep(2500);
  await shot('05_board');

  // 4. Select my 'Mech -> detail panel
  await page.evaluate(() => { const r = document.getElementById('roster-list'); const first = r?.querySelector('button, .roster-item, [onclick]'); if (first) first.click(); });
  await sleep(1200);
  await shot('06_detail');

  // 5. Roll initiative
  await page.click('#btn-roll-initiative').catch(() => {});
  await sleep(2500);
  await shot('07_after_initiative');

  // 6. Advance to movement, stand still
  await page.click('#btn-advance-phase').catch(() => {});
  await sleep(1500);
  let s = await waitMyTurn('movement');
  if (s.phase === 'movement' && s.myTurn) {
    await page.evaluate(() => { const m = (mechInstances||[]).find(x => x.owner === mySeatNumber); if (m) startMovementMode(m.instanceId, 'stand'); });
    await sleep(1500);
    await shot('08_movement_stand');
  }

  // 7. Render the Weapon Attack panel (client-side; see header note)
  await page.evaluate(() => {
    try {
      currentGameState.phase = 'weapon_attack';
      if (typeof setPhaseActivePlayer === 'function') setPhaseActivePlayer(mySeatNumber);
      ['renderWeaponAttackPanel','renderMovementPanel','updateAdvanceButtonState','updateGameHeader','draw'].forEach(fn => { if (typeof window[fn] === 'function') window[fn](); });
    } catch (e) { console.log('force-phase err: ' + e.message); }
  });
  await sleep(1500);
  await shot('09_weapon_panel');

  // 8. Select attacker + target + first weapon
  await page.evaluate(() => {
    try {
      const atk = (mechInstances||[]).find(x => x.owner === mySeatNumber);
      const tgt = (mechInstances||[]).find(x => x.owner !== mySeatNumber && !x.destroyed);
      if (atk && typeof selectWeaponAttacker === 'function') selectWeaponAttacker(atk.instanceId);
      if (tgt && typeof selectWeaponTarget === 'function') selectWeaponTarget(tgt.instanceId);
      const btns = Array.from(document.querySelectorAll('#movement-panel button')).filter(b => /dmg|damage|heat/i.test(b.textContent) && !b.disabled);
      const unchecked = btns.find(b => !b.textContent.startsWith('✓'));
      if (unchecked) unchecked.click();
    } catch (e) { console.log('select err: ' + e.message); }
  });
  await sleep(1200);
  await shot('10_weapon_selected');

  // 9. Confirm fire -> combat result
  await page.click('#weapon-submit').catch(() => {});
  await sleep(3500);
  await shot('11_combat_result');

  console.log('--- errors ---');
  console.log(errors.slice(0, 30).join('\n') || '(none)');
} catch (e) {
  console.log('FATAL', e.message);
  await shot('FATAL').catch(() => {});
  console.log(errors.slice(0, 30).join('\n'));
} finally {
  await browser.close();
}