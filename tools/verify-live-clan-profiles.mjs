// Read-only verification of the catalogue visible to a normal signed-in player.
// Start a static server, then run: node tools/verify-live-clan-profiles.mjs
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/mattperkins/.hermes/hermes-agent/node_modules/playwright');
const BASE = process.env.SHOT_URL || 'http://127.0.0.1:8790/index.html';
const USER = process.env.BT_H2H_HOST || 'h2h-regression-host';
const PASS = process.env.BT_H2H_HOST_PASS || 'H2H!Host01';

const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
const sleep = ms => page.waitForTimeout(ms);
const activeScreen = () => page.evaluate(() => Array.from(document.querySelectorAll('.screen')).find(screen => screen.classList.contains('active'))?.id || null);

try {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.fill('#login-username', USER);
  await page.fill('#login-password', PASS);
  await page.click('#btn-login').catch(() => {});
  for (let i = 0; i < 60 && await activeScreen() !== 'menu-screen'; i++) await sleep(250);
  if (await activeScreen() !== 'menu-screen') throw new Error('Could not sign in with the dedicated regression account.');

  const report = await page.evaluate(async () => {
    const version = await loadLatestUnitCatalogue();
    await loadUnitCatalogue(version);
    const clanWeapons = Object.values(BT_UNITS)
      .filter(unit => unit.techBase === 'Clan')
      .flatMap(unit => unit.weapons || [])
      .map(entry => entry.weapon)
      .filter(profile => profile?.techBase === 'Clan');
    const clanErMedium = clanWeapons.filter(profile => profile.key === 'er_med_laser');
    return {
      version,
      clanWeaponMounts: clanWeapons.length,
      clanErMediumProfiles: clanErMedium.map(profile => ({ damage: profile.damage, heat: profile.heat, range: profile.range, techBase: profile.techBase })),
      allClanProfilesTagged: clanWeapons.every(profile => profile.techBase === 'Clan'),
      erMediumOverrideCorrect: clanErMedium.length > 0 && clanErMedium.every(profile => profile.damage === 7 && JSON.stringify(profile.range) === JSON.stringify([5, 10, 15]))
    };
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.allClanProfilesTagged || !report.erMediumOverrideCorrect) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
