const { chromium } = require('/Users/mattperkins/.hermes/hermes-agent/node_modules/playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(`
      <div id="game-log-wrap"><div id="game-log" style="height:100px;overflow:auto"></div><button id="game-log-new-events" hidden></button></div>
      <button data-log-filter="all"></button><button data-log-filter="mine"></button><button data-log-filter="enemy"></button>
    `);
    await page.evaluate(() => {
      window.currentGameState = { round: 2, phase: 'weapon_attack' };
      window.PHASE_LABELS = { weapon_attack: 'Weapon Attack', movement: 'Movement' };
      window.mySeatNumber = 1;
      window.currentGameId = null;
      window.mechInstances = [
        { instanceId: 'dragon', owner: 1, label: 'Grand Dragon DRG-5K' },
        { instanceId: 'puma', owner: 2, label: 'Adder / Puma Prime' }
      ];
      window.mechLabel = mech => mech.label;
      window.skirmishAvatarForSeat = () => null;
      window.selectInstance = id => { window.selectedFromLog = id; };
    });
    await page.addScriptTag({ path: path.resolve(__dirname, '../js/core/game-log.js') });
    await page.evaluate(() => {
      logEvent('Grand Dragon DRG-5K fired ER PPC at Adder / Puma Prime — need 9, rolled 4 + 5 = 9: hit.', 'attack', 1);
      currentGameState = { round: 2, phase: 'movement' };
      logEvent('Adder / Puma Prime walked to 0910 (5 MP).', 'move', 2);
    });
    assert.equal(await page.locator('.log-phase-divider').count(), 2);
    assert.match(await page.locator('.log-action-detail summary').first().innerText(), /HIT/);
    assert.equal(await page.locator('.log-action-detail').first().evaluate(node => node.open), false);
    await page.locator('.log-mech-link[data-log-instance-id="dragon"]').first().click();
    assert.equal(await page.evaluate(() => window.selectedFromLog), 'dragon');
    await page.evaluate(() => setGameLogFilter('mine'));
    assert.match(await page.locator('#game-log').innerText(), /Grand Dragon/);
    assert.doesNotMatch(await page.locator('#game-log').innerText(), /walked to/);
    assert.deepEqual(errors, []);
    console.log('PASS game log groups phases, collapses roll detail, filters by side, and selects linked BattleMechs');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
