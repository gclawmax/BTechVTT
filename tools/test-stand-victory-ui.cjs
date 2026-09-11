const { chromium } = require('/Users/mattperkins/.hermes/hermes-agent/node_modules/playwright');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage();
    await page.route('**/js/movement/movement.js?*', route => route.fulfill({
      path: path.resolve(__dirname, '../js/movement/movement.js'), contentType: 'application/javascript'
    }));
    await page.route('**/js/game/phases.js?*', route => route.fulfill({
      path: path.resolve(__dirname, '../js/game/phases.js'), contentType: 'application/javascript'
    }));
    await page.goto('https://gclawmax.github.io/BTechVTT/');
    await page.locator('#login-screen.active').waitFor();
    const result = await page.evaluate(async () => {
      const sequence = [];
      currentGameId = 'stand-victory-fixture';
      mySeatNumber = 1;
      currentGameState = { round: 3, phase: 'movement' };
      mechInstances = [{ instanceId: 'fallen', owner: 1, prone: true, hasMoved: false, pilot: { consciousness: 'conscious' } }];
      isMyActiveTurn = () => true;
      mechLabel = () => 'Test BattleMech';
      logEvent = () => {};
      flashMoveWarning = () => {};
      loadGameState = async () => { sequence.push('reload'); mechInstances[0].destroyed = true; mechInstances[0].pilot.consciousness = 'dead'; };
      checkForMatchEnd = async () => { sequence.push('match-end'); return { winner_seat: 2 }; };
      db.rpc = async () => ({ data: { passed: false, movement_points_spent: 2, to_hit: { target: 7, die_a: 1, die_b: 1, total: 2 } }, error: null });
      await attemptStand('fallen');
      await recoverFatalMatchEndOnLoad();
      return sequence;
    });
    assert.deepEqual(result, ['reload', 'match-end', 'match-end']);
    console.log('PASS a fatal failed stand resolves immediately; a rejoined match with a dead pilot retries the authoritative result check');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
