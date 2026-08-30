// Read-only live acceptance test for the expanded 75-unit catalogue.
// Start the local site first, then provide BT_H2H_HOST and BT_H2H_HOST_PASS.
// This test makes no games and changes no account or database rows.

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/mattperkins/.hermes/hermes-agent/node_modules/playwright');
const BASE = process.env.SHOT_URL || 'http://127.0.0.1:8790/index.html';
const HOST = { user: process.env.BT_H2H_HOST, pass: process.env.BT_H2H_HOST_PASS };
const VERSION = 'megamek-2026-08-curated-05';
const failures = [];

if (!HOST.user || !HOST.pass) {
  console.error('Set BT_H2H_HOST and BT_H2H_HOST_PASS to run the read-only live catalogue acceptance test.');
  process.exit(2);
}

function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

async function waitForScreen(page, id, timeout = 20000) {
  await page.waitForFunction(expected => Array.from(document.querySelectorAll('.screen')).some(screen => screen.id === expected && screen.classList.contains('active')), id, { timeout });
}

async function signIn(page) {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.fill('#login-username', HOST.user);
  await page.fill('#login-password', HOST.pass);
  await page.click('#btn-login');
  await waitForScreen(page, 'menu-screen');
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await signIn(page);
  const result = await page.evaluate(async version => {
    const release = await db.from('btech_catalogue_releases').select('version,content_sha256').eq('version', version).single();
    const units = await db.from('btech_catalogue_units').select('unit_id,definition', { count: 'exact' }).eq('catalogue_version', version).order('unit_id').range(0, 199);
    const mounts = await db.from('btech_catalogue_mounts').select('mount_id', { count: 'exact', head: true }).eq('catalogue_version', version);
    const slots = await db.from('btech_catalogue_critical_slots').select('slot_index', { count: 'exact', head: true }).eq('catalogue_version', version);
    const ammo = await db.from('btech_catalogue_ammo_bins').select('bin_id', { count: 'exact', head: true }).eq('catalogue_version', version);
    await loadUnitCatalogue(version, true);
    const dragon = BT_UNITS['grand-dragon-drg-5k'];
    const dragonWeapons = (dragon?.weapons || []).map(weapon => weapon.key).sort();
    const dragonIds = Object.keys(BT_UNITS).filter(id => id.startsWith('dragon-') || id.startsWith('grand-dragon-')).sort();
    const laterDragons = ['dragon-drg-7n','grand-dragon-drg-7k','grand-dragon-drg-9kc'].map(id => ({ id, weapons:(BT_UNITS[id]?.weapons || []).map(weapon => ({ key:weapon.key, rearMounted:Boolean(weapon.rearMounted) })) }));
    const mascUnits = ['fire-moth-prime','executioner-prime','shadow-cat-prime','black-lanner-prime'].filter(id => {
      const mech = { unitId: id, criticalSlotDamage: {}, destroyed: false, shutdown: false };
      return typeof hasOperationalMASC === 'function' && hasOperationalMASC(mech);
    });
    return {
      errors: [release.error, units.error, mounts.error, slots.error, ammo.error].filter(Boolean).map(error => error.message),
      release: release.data, unitCount: units.count, mountCount: mounts.count, slotCount: slots.count, ammoCount: ammo.count,
      loadedCount: databaseSupportedUnitIds.size, dragon: dragon && { chassis: dragon.chassis, variant: dragon.variant, mass: dragon.tonnage, movement: dragon.movement },
      dragonWeapons, dragonIds, laterDragons, mascUnits
    };
  }, VERSION);

  check('expanded catalogue queries return without an error', result.errors.length === 0, result.errors.join('; '));
  check('curated-05 immutable release exists', result.release?.version === VERSION);
  check('all expanded catalogue table counts match SQL 97 verification', result.unitCount === 75 && result.mountCount === 370 && result.slotCount === 3816 && result.ammoCount === 166, JSON.stringify({ units: result.unitCount, mounts: result.mountCount, slots: result.slotCount, ammo: result.ammoCount }));
  check('browser loads all 75 playable BattleMechs', result.loadedCount === 75, `loaded ${result.loadedCount}`);
  check('Grand Dragon DRG-5K identity and 6/9/0 movement load live', result.dragon?.chassis === 'Grand Dragon' && result.dragon?.variant === 'DRG-5K' && result.dragon?.mass === 60 && JSON.stringify(result.dragon?.movement) === JSON.stringify({ walk: 6, run: 9, jump: 0 }), JSON.stringify(result.dragon));
  check('Grand Dragon DRG-5K mounts load live', result.dragonWeapons.filter(key => key === 'med_laser').length === 3 && result.dragonWeapons.includes('er_ppc') && result.dragonWeapons.includes('lrm10'), result.dragonWeapons.join(','));
  check('ten supported Dragon-family records load together', result.dragonIds.length === 10, result.dragonIds.join(','));
  const laterWeapons = Object.fromEntries(result.laterDragons.map(dragon => [dragon.id, dragon.weapons]));
  check('later Dragon specialist armaments load live', laterWeapons['dragon-drg-7n']?.some(weapon => weapon.key === 'mrm10') && laterWeapons['grand-dragon-drg-7k']?.some(weapon => weapon.key === 'mrm10') && laterWeapons['grand-dragon-drg-9kc']?.some(weapon => weapon.key === 'mml5') && laterWeapons['grand-dragon-drg-9kc']?.some(weapon => weapon.key === 'snub_ppc') && laterWeapons['grand-dragon-drg-9kc']?.some(weapon => weapon.key === 'med_laser' && weapon.rearMounted), JSON.stringify(laterWeapons));
  check('all four imported MASC BattleMechs expose operational equipment', result.mascUnits.length === 4, result.mascUnits.join(','));

  await page.reload({ waitUntil: 'networkidle' });
  await waitForScreen(page, 'menu-screen');
  const reloadCount = await page.evaluate(async version => { await loadUnitCatalogue(version, true); return databaseSupportedUnitIds.size; }, VERSION);
  check('catalogue reload remains complete after reconnect', reloadCount === 75, `loaded ${reloadCount}`);
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} live catalogue acceptance check(s) failed.`);
  process.exit(1);
}
console.log('\nExpanded catalogue live acceptance passed.');
