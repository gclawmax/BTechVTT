// Live Level 2 Dragon acceptance test.
//
// This reuses the disposable in-progress match made by
// test-human-vs-human.mjs. Each case installs a small server-authoritative
// fixture, fires one real weapon declaration from a Dragon-family variant,
// and verifies the resolved event and saved unit invariants. It is intentionally
// data-driven so new 3060 variants can join the acceptance force cheaply.
//
// Run after tools/test-human-vs-human.mjs:
//   node tools/test-dragon-level2-live.mjs
// Set BT_SOAK_CLEANUP=1 to remove the disposable match only after every case
// passes. A failed match is left in place for inspection.

import { createRequire } from 'module';
import { writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/mattperkins/.hermes/hermes-agent/node_modules/playwright');
const BASE = process.env.SHOT_URL || 'http://127.0.0.1:8790/index.html';
const HOST = { user: process.env.BT_H2H_HOST || 'h2h-regression-host', pass: process.env.BT_H2H_HOST_PASS || 'H2H!Host01' };
const GUEST = { user: process.env.BT_H2H_GUEST || 'h2h-regression-guest', pass: process.env.BT_H2H_GUEST_PASS || 'H2H!Guest01' };
const REPORT_PATH = process.env.BT_DRAGON_REPORT || null;
const failures = [];
const errors = [];
let gameCode = null;

const CASES = [
  { label: 'Grand Dragon DRG-5K ER PPC', unitId: 'grand-dragon-drg-5k', weapon: 'er_ppc' },
  { label: 'Dragon DRG-5N Ultra AC/5 rapid fire', unitId: 'dragon-drg-5n', weapon: 'uac5', mode: 'rapid' },
  { label: 'Dragon DRG-7N Gauss Rifle', unitId: 'dragon-drg-7n', weapon: 'gauss_rifle' },
  { label: 'Dragon DRG-7N MRM 10', unitId: 'dragon-drg-7n', weapon: 'mrm10' },
  { label: 'Grand Dragon DRG-7K ER PPC', unitId: 'grand-dragon-drg-7k', weapon: 'er_ppc' },
  { label: 'Grand Dragon DRG-7K MRM 10', unitId: 'grand-dragon-drg-7k', weapon: 'mrm10' },
  { label: 'Grand Dragon DRG-9KC Snub-Nose PPC', unitId: 'grand-dragon-drg-9kc', weapon: 'snub_ppc' },
  { label: 'Grand Dragon DRG-9KC MML 5 (SRM load)', unitId: 'grand-dragon-drg-9kc', weapon: 'mml5', loadType: 'srm' },
  { label: 'Grand Dragon DRG-9KC C3 Master TAG', unitId: 'grand-dragon-drg-9kc', weapon: 'c3_master_tag' }
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function check(name, condition, detail = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
async function activeScreen(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.screen')).find(screen => screen.classList.contains('active'))?.id || null);
}
async function signIn(page, credentials) {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.fill('#login-username', credentials.user);
  await page.fill('#login-password', credentials.pass);
  await page.click('#btn-login').catch(() => {});
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await activeScreen(page) === 'menu-screen') return;
    await sleep(250);
  }
  throw new Error(`Could not sign in as ${credentials.user}`);
}
async function latestHostMatch(page) {
  return page.evaluate(async () => {
    const { data: game, error } = await db.from('btech_games').select('*')
      .eq('host_id', currentUser.id).eq('status', 'in-progress').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!game) throw new Error('Run tools/test-human-vs-human.mjs first to create the disposable match.');
    const players = await db.from('btech_players').select('*').eq('game_id', game.id).eq('role', 'player').order('seat_number');
    if (players.error) throw players.error;
    return { game, players: players.data || [] };
  });
}
async function runCase(host, guest, game, players, spec, round) {
  const fixture = await host.evaluate(async ({ game, players, spec, round }) => {
    await loadUnitCatalogue(game.catalogue_version, true);
    const attackerId = `${spec.unitId}-p1-1`;
    const targetId = 'locust-lct1e-p2-1';
    const units = buildRosterInstances({ 1: [spec.unitId], 2: ['locust-lct1e'] }, {}, {
      1: [{ col: 2, row: 5, facing: 0 }], 2: [{ col: 6, row: 5, facing: 3 }]
    });
    const attacker = units.find(unit => unit.instanceId === attackerId);
    const target = units.find(unit => unit.instanceId === targetId);
    if (!attacker || !target) throw new Error(`Could not build ${spec.unitId} fixture.`);
    for (const unit of units) {
      Object.assign(unit, { hasMoved:false, hasReacted:true, hasFired:false, hasPhysicalAttacked:false, hasManagedHeat:false,
        prone:false, destroyed:false, shutdown:false, movementMode:'stand', hexesMoved:0, heat:0, roundStartingHeat:0,
        movementHeat:0, weaponHeat:0, externalHeat:0 });
      unit.pilot = { ...(unit.pilot || {}), gunnery:-6, piloting:5, hits:0, consciousness:'conscious' };
    }
    const mount = (BT_UNITS[spec.unitId]?.weapons || []).find(entry => entry.key === spec.weapon);
    if (!mount) throw new Error(`${spec.unitId} has no ${spec.weapon} mount in the pinned catalogue.`);
    if (spec.loadType) {
      const bin = (attacker.ammoBins || []).find(entry => entry.type === mount.weapon?.ammoType);
      if (!bin) throw new Error(`${spec.unitId} has no ammunition bin for ${spec.weapon}.`);
      bin.loadType = spec.loadType;
    }
    const hostPlayer = players.find(player => player.seat_number === 1);
    const state = { map_id:'training-grounds', catalogue_version:game.catalogue_version, special_ammo_setup_v1:true,
      mech_instances:units, initiative_order:players.map(player => ({ player_id:player.id, seat_number:player.seat_number })),
      active_player_player_id:hostPlayer?.id, round };
    const update = await db.from('btech_games').update({ current_round:round, current_phase:'weapon_attack', active_player_id:hostPlayer?.id, state }).eq('id', game.id);
    if (update.error) throw update.error;
    const ammoBin = mount.weapon?.ammoType ? (attacker.ammoBins || []).find(entry => entry.type === mount.weapon.ammoType) : null;
    return { attackerId, targetId, mountId:mount.mountId, ammoBins: ammoBin ? { [mount.mountId]:ammoBin.id, __fire_modes: spec.mode ? { [mount.mountId]:spec.mode } : {} } : { __fire_modes:{} } };
  }, { game, players, spec, round });
  const hostFire = await host.evaluate(async ({ gameId, fixture }) => {
    const result = await db.rpc('submit_simultaneous_weapon_declaration', { p_game_id:gameId, p_attacker_instance_id:fixture.attackerId,
      p_target_instance_id:fixture.targetId, p_weapon_mounts:[fixture.mountId], p_ammo_bins:fixture.ammoBins });
    return { data:result.data, error:result.error?.message || null };
  }, { gameId:game.id, fixture });
  const guestPass = await guest.evaluate(async ({ gameId, fixture }) => {
    const result = await db.rpc('submit_simultaneous_weapon_declaration', { p_game_id:gameId, p_attacker_instance_id:fixture.targetId,
      p_target_instance_id:fixture.attackerId, p_weapon_mounts:[], p_ammo_bins:{} });
    return { data:result.data, error:result.error?.message || null };
  }, { gameId:game.id, fixture });
  const resolved = await host.evaluate(async ({ gameId, round, attackerId }) => {
    const event = await db.from('btech_combat_events').select('status,resolution').eq('game_id', gameId).eq('round', round)
      .eq('phase','weapon_attack').eq('attacker_instance_id', attackerId).maybeSingle();
    const saved = await db.from('btech_games').select('state,current_phase').eq('id', gameId).single();
    const state = typeof saved.data?.state === 'string' ? JSON.parse(saved.data.state) : saved.data?.state;
    const values = (state?.mech_instances || []).flatMap(unit => [
      ...Object.values(unit.armor || {}), ...Object.values(unit.structure || {}), ...(unit.ammoBins || []).map(bin => bin.shots)
    ]).map(Number);
    return { event:event.data, eventError:event.error?.message || null, values, phase:saved.data?.current_phase, stateError:saved.error?.message || null };
  }, { gameId:game.id, round, attackerId:fixture.attackerId });
  const result = resolved.event?.resolution?.results?.[0];
  check(`${spec.label} declaration resolves through the public server RPC`, !hostFire.error && !guestPass.error && resolved.event?.status === 'resolved', JSON.stringify({ hostFire, guestPass, eventError:resolved.eventError }));
  check(`${spec.label} records the selected mount`, result?.mount_id === fixture.mountId, JSON.stringify(result));
  check(`${spec.label} leaves only valid non-negative battle values`, !resolved.stateError && resolved.values.every(value => Number.isFinite(value) && value >= 0), JSON.stringify(resolved));
}

const browser = await chromium.launch({ headless:true, channel:'chrome', args:['--no-sandbox','--disable-dev-shm-usage'] });
const hostContext = await browser.newContext({ viewport:{ width:1280, height:900 } });
const guestContext = await browser.newContext({ viewport:{ width:1280, height:900 } });
const host = await hostContext.newPage();
const guest = await guestContext.newPage();
for (const page of [host, guest]) {
  page.on('pageerror', error => errors.push(`PAGEERROR: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`CONSOLE: ${message.text()}`); });
}

try {
  await Promise.all([signIn(host, HOST), signIn(guest, GUEST)]);
  const { game, players } = await latestHostMatch(host);
  gameCode = game.game_code;
  check('Dragon acceptance finds the disposable two-player match', players.length === 2, gameCode);
  const roundBase = 200000 + Math.floor(Date.now() / 1000) % 100000;
  for (const [index, spec] of CASES.entries()) await runCase(host, guest, game, players, spec, roundBase + index);
  check('Dragon acceptance produces no browser or console errors', errors.length === 0, errors.join('\n'));
  if (!failures.length && process.env.BT_SOAK_CLEANUP === '1') {
    const cleanup = await host.evaluate(async gameId => {
      const preflight = await db.from('btech_games').update({ active_player_id:null, initiative_winner:null }).eq('id', gameId);
      if (preflight.error) return preflight.error.message;
      const removed = await db.from('btech_games').delete().eq('id', gameId);
      return removed.error?.message || null;
    }, game.id);
    check('successful soak fixture is removed', !cleanup, cleanup || 'removed');
  }
} catch (error) {
  check('Dragon Level 2 acceptance completed without a fatal error', false, error.message);
} finally {
  const report = { passed:failures.length === 0, gameCode, failures, errors, cases:CASES.map(item => item.label) };
  if (REPORT_PATH && failures.length) await writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log('\n--- console/page errors ---');
  console.log(errors.join('\n') || '(none)');
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} Dragon Level 2 acceptance failure(s). Match ${gameCode || 'unknown'} was retained.`);
  process.exit(1);
}
console.log('\nDragon Level 2 live acceptance passed.');
