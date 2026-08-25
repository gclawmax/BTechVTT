// End-to-end test for issue #6: vs-AI games must pin a catalogue_version so
// the authoritative server RPCs accept them, and a full vs-AI game must be
// able to advance through the phases.
//
// Usage:
//   1. Serve the repo:  python3 -m http.server 8790   (from the repo root)
//   2. Run:             node tools/test-vs-ai-fix.mjs
//   (Optional env: BT_USER / BT_PASS — defaults to a throwaway test account.)
//
// PASS criteria:
//   A. btech_games.catalogue_version is non-null after handleCreateVsAI
//   B. Guarded authoritative RPCs (submit_battlemech_movement,
//      resolve_heat_management, attempt_stand_battlemech) no longer raise
//      "This match is missing its pinned catalogue"
//   C. The phase advances past movement through the REAL UI: the Next Phase
//      button (#btn-advance-phase) + the Auto-next after AI checkbox
//      (#auto-ai-phase-checkbox), handling whichever seat wins initiative.
//   D. No "pinned catalogue" error appears in console/page errors

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/mattperkins/.hermes/hermes-agent/node_modules/playwright');

const BASE = process.env.SHOT_URL || 'http://localhost:8790/index.html';
const USER = process.env.BT_USER || 'vsai-fix-test';
const PASS = process.env.BT_PASS || 'Fix!TestPass01';

const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

const sleep = ms => page.waitForTimeout(ms);
const activeScreen = () => page.evaluate(() => Array.from(document.querySelectorAll('.screen')).filter(s => s.classList.contains('active')).map(s => s.id).join(','));
async function waitActive(id, ms = 20000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await activeScreen()).includes(id)) return true; await sleep(400); } return false; }
const state = () => page.evaluate(() => JSON.stringify({
  phase: currentGameState?.phase,
  active: getActivePlayerSeat?.(),
  my: mySeatNumber,
  myTurn: isMyActiveTurn?.(),
  advEnabled: (() => { const b = document.getElementById('btn-advance-phase'); return b ? (!b.disabled && !b.hidden) : false; })(),
  autoNext: document.getElementById('auto-ai-phase-checkbox')?.checked ?? false,
  catalogueVersion: currentGameState?.catalogue_version ?? null
}));

let passA = false, passB = null, passC = false, overall = false;
let finalState = null;

try {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => errors.push('GOTO: ' + e.message));
  await sleep(1200);

  // ── Login (create the account on first run) ─────────────────────────
  await page.fill('#login-username', USER);
  await page.fill('#login-password', PASS);
  await page.click('#btn-login').catch(() => {});
  await waitActive('menu-screen', 15000);
  if (!(await activeScreen()).includes('menu-screen')) {
    await page.fill('#login-username', USER);
    await page.fill('#login-password', PASS);
    await page.click('#btn-signup').catch(() => {});
    await waitActive('menu-screen', 20000);
  }
  if (!(await activeScreen()).includes('menu-screen')) throw new Error('Login failed');
  console.log('Logged in.');

  // ── Create vs-AI game -> lobby ───────────────────────────────────────
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('#menu-screen button')).find(x => /play vs ai/i.test(x.textContent)); b?.click(); });
  await waitActive('lobby-screen', 20000);
  await sleep(1500);

  // A. catalogue_version pinned on the game row (table column)
  const pinned = await page.evaluate(async () => {
    try {
      const { data, error } = await db.from('btech_games').select('id, catalogue_version').eq('id', currentGameId).maybeSingle();
      return { error: error?.message || null, catalogue_version: data?.catalogue_version ?? null };
    } catch (e) { return { error: e.message, catalogue_version: null }; }
  });
  console.log('A. DB row catalogue_version:', JSON.stringify(pinned));
  passA = Boolean(pinned.catalogue_version) && !pinned.error;

  // ── Start game -> board ──────────────────────────────────────────────
  await page.click('#btn-start').catch(() => {});
  await waitActive('game-screen', 25000);
  await sleep(2500);

  // Enable the "Auto-next after AI" checkbox so the AI hands off its turn
  // automatically (the user's hint). Works even while the control is hidden.
  await page.evaluate(() => {
    const cb = document.getElementById('auto-ai-phase-checkbox');
    if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await sleep(500);

  // Roll initiative
  await page.click('#btn-roll-initiative').catch(() => {});
  await sleep(3000);

  // Advance to movement (Next Phase button)
  await page.click('#btn-advance-phase').catch(() => {});
  await sleep(2000);

  // C. Drive the REAL UI to advance past movement, handling either seat
  // winning initiative. On MY turn: complete movement (Standing Still) then
  // click Next Phase. On the AI's turn: the Auto-next checkbox makes it
  // complete + advance on its own, so we just wait.
  let s = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    s = JSON.parse(await state());
    if (s.phase && s.phase !== 'movement') { passC = true; break; }
    if (s.phase === 'movement' && s.myTurn) {
      // Complete my movement through the real code path (stand in place).
      await page.evaluate(() => {
        const m = (mechInstances || []).find(x => x.owner === mySeatNumber);
        if (m && !m.hasMoved) { selectedInstanceId = m.instanceId; startMovementMode(m.instanceId, 'stand'); }
      });
      await sleep(1500);
    }
    // Click Next Phase whenever it's enabled (my completed turn, or the AI's).
    if (s.advEnabled) await page.click('#btn-advance-phase').catch(() => {});
    await sleep(2000);
  }
  finalState = JSON.parse(await state());
  console.log('C. State after driving UI:', JSON.stringify(finalState));
  if (!passC && finalState.phase && finalState.phase !== 'movement') passC = true;

  // B. Direct probe of the guarded authoritative RPCs. Before the fix each
  // raised "This match is missing its pinned catalogue" because the vs-AI
  // insert left catalogue_version NULL. After the fix the catalogue guard
  // passes (they may still return other, non-catalogue errors).
  const probe = await page.evaluate(async () => {
    const out = {};
    const m = (mechInstances || []).find(x => x.owner === mySeatNumber);
    const id = m ? m.instanceId : null;
    const call = async (name, args) => {
      try {
        const r = await db.rpc(name, args);
        return { error: r.error?.message || null, ok: !r.error };
      } catch (e) { return { error: e.message, ok: false }; }
    };
    out.submit_battlemech_movement = await call('submit_battlemech_movement', { p_game_id: currentGameId, p_instance_id: id, p_mode: 'stand', p_path: [] });
    out.attempt_stand_battlemech = await call('attempt_stand_battlemech', { p_game_id: currentGameId, p_instance_id: id });
    out.resolve_heat_management = await call('resolve_heat_management', { p_game_id: currentGameId });
    return out;
  });
  console.log('B. Guarded RPC probe:', JSON.stringify(probe, null, 2));
  const catalogueBlocked = Object.values(probe).some(r => /pinned catalogue/i.test(r.error || ''));
  passB = !catalogueBlocked;

  const hasCatalogueError = errors.some(e => /pinned catalogue/i.test(e));
  console.log('D. "pinned catalogue" in console/page errors:', hasCatalogueError);

  console.log('\n=== RESULTS ===');
  console.log('A. catalogue_version pinned on game row :', passA ? 'PASS' : 'FAIL');
  console.log('B. guarded RPCs pass the catalogue check:', passB ? 'PASS' : 'FAIL');
  console.log('C. phase advanced past movement (UI)    :', passC ? 'PASS' : 'FAIL');
  console.log('D. no "pinned catalogue" error          :', hasCatalogueError ? 'FAIL' : 'PASS');
  overall = passA && passB && passC && !hasCatalogueError;
  console.log('OVERALL:', overall ? 'PASS ✅' : 'FAIL ❌');
  await page.screenshot({ path: 'assets/screenshots/test-vs-ai-after-fix.jpg', type: 'jpeg', quality: 70 }).catch(() => {});
} catch (e) {
  console.log('FATAL', e.message);
  console.log('OVERALL: FAIL ❌');
} finally {
  console.log('--- console/page errors (first 25) ---');
  console.log(errors.slice(0, 25).join('\n') || '(none)');
  await browser.close();
}

if (!overall) process.exitCode = 1;
