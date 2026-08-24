// Focused live regression for the authoritative rules added by SQL 62-68.
// Run after tools/test-human-vs-human.mjs so the dedicated accounts share a
// disposable in-progress match. The host may update its own match under the
// normal RLS policy; every rule action still runs through the public RPC used
// by the game.

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/mattperkins/.hermes/hermes-agent/node_modules/playwright');
const BASE = process.env.SHOT_URL || 'http://127.0.0.1:8790/index.html';
const HOST = { user: process.env.BT_H2H_HOST || 'h2h-regression-host', pass: process.env.BT_H2H_HOST_PASS || 'H2H!Host01' };
const GUEST = { user: process.env.BT_H2H_GUEST || 'h2h-regression-guest', pass: process.env.BT_H2H_GUEST_PASS || 'H2H!Guest01' };
const failures = [];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
async function activeScreen(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.screen')).find(screen => screen.classList.contains('active'))?.id || null);
}
async function waitForScreen(page, id, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await activeScreen(page) === id) return true;
    await sleep(250);
  }
  return false;
}
async function signIn(page, credentials) {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.fill('#login-username', credentials.user);
  await page.fill('#login-password', credentials.pass);
  await page.click('#btn-login');
  if (!await waitForScreen(page, 'menu-screen', 15000)) throw new Error(`Could not sign in as ${credentials.user}`);
}
async function latestHostMatch(page) {
  return page.evaluate(async () => {
    const { data, error } = await db.from('btech_games').select('*').eq('host_id', currentUser.id).eq('status', 'in-progress').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Run tools/test-human-vs-human.mjs first to create a disposable match.');
    const playersResult = await db.from('btech_players').select('*').eq('game_id', data.id).eq('role', 'player').order('seat_number');
    if (playersResult.error) throw playersResult.error;
    return { game: data, players: playersResult.data };
  });
}
async function configureScenario(page, game, players, round, phase, rosters, positions, prepare = {}) {
  return page.evaluate(async ({ game, players, round, phase, rosters, positions, prepare }) => {
    await loadUnitCatalogue(game.catalogue_version);
    const units = buildRosterInstances(rosters, {}, positions);
    for (const mech of units) {
      Object.assign(mech, {
        hasMoved: false, hasReacted: false, hasFired: false, hasPhysicalAttacked: false, hasManagedHeat: false,
        prone: false, destroyed: false, shutdown: false, movementMode: 'stand', hexesMoved: 0,
        heat: 0, roundStartingHeat: 0, movementHeat: 0, weaponHeat: 0, externalHeat: 0
      });
      mech.pilot = { ...(mech.pilot || {}), gunnery: -6, piloting: 5, hits: 0, consciousness: 'conscious' };
      mech.pilotingSkill = 5;
      const changes = prepare[mech.instanceId];
      if (changes) Object.assign(mech, changes);
    }
    const hostPlayer = players.find(player => player.seat_number === 1);
    const guestPlayer = players.find(player => player.seat_number === 2);
    if (!hostPlayer || !guestPlayer) throw new Error('The focused regression requires both test players.');
    const initiative = [hostPlayer, guestPlayer].map(player => ({ player_id: player.id, seat_number: player.seat_number }));
    const state = {
      map_id: 'ridge-and-ford', catalogue_version: game.catalogue_version,
      mech_instances: units, initiative_order: initiative,
      active_player_player_id: hostPlayer.id, round
    };
    const { error } = await db.from('btech_games').update({ current_round: round, current_phase: phase, active_player_id: hostPlayer.id, state }).eq('id', game.id);
    if (error) throw error;
    return { state, hostPlayer, guestPlayer };
  }, { game, players, round, phase, rosters, positions, prepare });
}
async function rpc(page, name, args) {
  return page.evaluate(async ({ name, args }) => {
    const result = await db.rpc(name, args);
    return { data: result.data, error: result.error ? { message: result.error.message, code: result.error.code } : null };
  }, { name, args });
}
async function weaponEvent(page, gameId, round, attackerId) {
  return page.evaluate(async ({ gameId, round, attackerId }) => {
    const { data, error } = await db.from('btech_combat_events').select('*').eq('game_id', gameId).eq('round', round).eq('phase', 'weapon_attack').eq('attacker_instance_id', attackerId).single();
    return { data, error: error?.message || null };
  }, { gameId, round, attackerId });
}

const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const hostContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const guestContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const host = await hostContext.newPage();
const guest = await guestContext.newPage();
const errors = [];
let expectedHttp400 = 0;
for (const page of [host, guest]) {
  page.on('pageerror', error => errors.push(`PAGEERROR: ${error.message}`));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (expectedHttp400 > 0 && /status of 400/i.test(message.text())) { expectedHttp400--; return; }
    errors.push(`CONSOLE: ${message.text()}`);
  });
}

try {
  await Promise.all([signIn(host, HOST), signIn(guest, GUEST)]);
  const { game, players } = await latestHostMatch(host);
  const roundBase = 100000 + Math.floor(Date.now() / 1000) % 100000;
  check('focused regression found the disposable two-player match', players.length === 2, game.game_code);

  // Terrain: 0505 -> 0605 enters depth-one water and changes one level, for
  // 1 base MP + 1 water MP + 1 level MP. The PSR may pass or fail, but its
  // reason and movement cost are deterministic.
  await configureScenario(host, game, players, roundBase, 'movement',
    { 1: ['locust-lct1e'], 2: ['locust-lct1e'] },
    { 1: [{ col: 5, row: 5, facing: 0 }], 2: [{ col: 12, row: 5, facing: 3 }] });
  const terrainMove = await rpc(host, 'submit_battlemech_movement', {
    p_game_id: game.id, p_instance_id: 'locust-lct1e-p1-1', p_mode: 'walk',
    p_path: [{ action: 'step', col: 6, row: 5 }]
  });
  check('walking into shallow water is accepted with complete MP accounting', !terrainMove.error && terrainMove.data?.mp_used === 3, JSON.stringify(terrainMove));
  check('entering water invokes the authoritative terrain Piloting check', terrainMove.data?.terrain_check?.reasons?.includes('entering water'), JSON.stringify(terrainMove.data?.terrain_check));

  // Indirect fire: a ridge blocks the Trebuchet at 0801 from the target in
  // shallow water at 0605; the Locust at 0000 has LOS and walks while spotting.
  const indirectRound = roundBase + 1;
  await configureScenario(host, game, players, indirectRound, 'weapon_attack',
    { 1: ['trebuchet-tbt3c', 'locust-lct1e'], 2: ['locust-lct1e'] },
    { 1: [{ col: 8, row: 1, facing: 0 }, { col: 0, row: 0, facing: 0 }], 2: [{ col: 6, row: 5, facing: 3 }] },
    { 'locust-lct1e-p1-2': { movementMode: 'walk', hexesMoved: 1 } });
  const indirectAmmo = { 'lrm15:la:0': 'lt:3', __fire_modes: {}, __indirect: true, __spotter: 'locust-lct1e-p1-2' };
  const indirectDeclaration = await rpc(host, 'submit_simultaneous_weapon_declaration', {
    p_game_id: game.id, p_attacker_instance_id: 'trebuchet-tbt3c-p1-1', p_target_instance_id: 'locust-lct1e-p2-1',
    p_weapon_mounts: ['lrm15:la:0'], p_ammo_bins: indirectAmmo
  });
  check('ridge-blocked LRM indirect fire accepts a legal moving spotter', !indirectDeclaration.error, JSON.stringify(indirectDeclaration));
  const spotterDeclaration = await rpc(host, 'submit_simultaneous_weapon_declaration', {
    p_game_id: game.id, p_attacker_instance_id: 'locust-lct1e-p1-2', p_target_instance_id: 'locust-lct1e-p2-1', p_weapon_mounts: [], p_ammo_bins: {}
  });
  check('the spotter can declare no fire and hand play to the opponent', !spotterDeclaration.error, JSON.stringify(spotterDeclaration));
  const guestDeclaration = await rpc(guest, 'submit_simultaneous_weapon_declaration', {
    p_game_id: game.id, p_attacker_instance_id: 'locust-lct1e-p2-1', p_target_instance_id: 'trebuchet-tbt3c-p1-1', p_weapon_mounts: [], p_ammo_bins: {}
  });
  check('the final declaration resolves the simultaneous indirect attack', !guestDeclaration.error && guestDeclaration.data?.status === 'resolved', JSON.stringify(guestDeclaration));
  const indirectEvent = await weaponEvent(host, game.id, indirectRound, 'trebuchet-tbt3c-p1-1');
  const indirectResult = indirectEvent.data?.resolution?.results?.[0];
  const indirectBreakdown = indirectResult?.to_hit?.breakdown;
  check('server result records indirect, moving-spotter and shallow-water modifiers', indirectBreakdown?.indirect_fire === 1 && indirectBreakdown?.spotter_movement === 1 && indirectBreakdown?.partial_cover === 1, JSON.stringify(indirectBreakdown));
  check('Artemis-capable ammunition applies its cluster-table guidance', indirectResult?.hit && indirectResult?.artemis_guided === true && indirectResult?.cluster_roll?.modified_total >= indirectResult?.cluster_roll?.total, JSON.stringify(indirectResult));

  // Narc-capable ammunition receives the same cluster-table bonus when the
  // target has an attached pod. The pod is part of the authoritative snapshot.
  const narcRound = roundBase + 2;
  await configureScenario(host, game, players, narcRound, 'weapon_attack',
    { 1: ['kintaro-kto19'], 2: ['locust-lct1e'] },
    { 1: [{ col: 0, row: 0, facing: 0 }], 2: [{ col: 4, row: 0, facing: 3 }] },
    { 'locust-lct1e-p2-1': { narcPod: { round: narcRound, source: 'test-narc-pod' } } });
  const narcFire = await rpc(host, 'submit_simultaneous_weapon_declaration', {
    p_game_id: game.id, p_attacker_instance_id: 'kintaro-kto19-p1-1', p_target_instance_id: 'locust-lct1e-p2-1',
    p_weapon_mounts: ['lrm5:la:0'], p_ammo_bins: { 'lrm5:la:0': 'lt:0', __fire_modes: {} }
  });
  check('Narc-capable missile fire accepts an attached target pod', !narcFire.error, JSON.stringify(narcFire));
  const narcGuest = await rpc(guest, 'submit_simultaneous_weapon_declaration', {
    p_game_id: game.id, p_attacker_instance_id: 'locust-lct1e-p2-1', p_target_instance_id: 'kintaro-kto19-p1-1', p_weapon_mounts: [], p_ammo_bins: {}
  });
  check('the Narc-guided phase resolves normally for both players', !narcGuest.error && narcGuest.data?.status === 'resolved', JSON.stringify(narcGuest));
  const narcEvent = await weaponEvent(host, game.id, narcRound, 'kintaro-kto19-p1-1');
  const narcResult = narcEvent.data?.resolution?.results?.[0];
  check('Narc-capable ammunition applies its cluster-table guidance', narcResult?.hit && narcResult?.narc_guided === true && narcResult?.cluster_roll?.modified_total >= narcResult?.cluster_roll?.total, JSON.stringify(narcResult));

  // Prone fire: support the left arm, prove its LRM is rejected, then fire the
  // torso-mounted LRM legally and verify the +2 prone modifier.
  const proneRound = roundBase + 3;
  await configureScenario(host, game, players, proneRound, 'weapon_attack',
    { 1: ['trebuchet-tbt3c'], 2: ['locust-lct1e'] },
    { 1: [{ col: 0, row: 0, facing: 0 }], 2: [{ col: 4, row: 0, facing: 3 }] },
    { 'trebuchet-tbt3c-p1-1': { prone: true } });
  const support = await rpc(host, 'set_prone_weapon_support_arm', { p_game_id: game.id, p_instance_id: 'trebuchet-tbt3c-p1-1', p_arm: 'la' });
  check('a prone BattleMech can authoritatively choose its supporting arm', !support.error, JSON.stringify(support));
  expectedHttp400++;
  const blockedSupportWeapon = await rpc(host, 'submit_simultaneous_weapon_declaration', {
    p_game_id: game.id, p_attacker_instance_id: 'trebuchet-tbt3c-p1-1', p_target_instance_id: 'locust-lct1e-p2-1',
    p_weapon_mounts: ['lrm15:la:0'], p_ammo_bins: { 'lrm15:la:0': 'lt:3', __fire_modes: {} }
  });
  check('the server rejects a weapon mounted in the supporting arm', /Supporting-arm weapons cannot fire while prone/i.test(blockedSupportWeapon.error?.message || ''), JSON.stringify(blockedSupportWeapon));
  const proneFire = await rpc(host, 'submit_simultaneous_weapon_declaration', {
    p_game_id: game.id, p_attacker_instance_id: 'trebuchet-tbt3c-p1-1', p_target_instance_id: 'locust-lct1e-p2-1',
    p_weapon_mounts: ['lrm15:rt:4'], p_ammo_bins: { 'lrm15:rt:4': 'rt:7', __fire_modes: {} }
  });
  check('a non-supporting torso weapon remains legal while prone', !proneFire.error, JSON.stringify(proneFire));
  const proneGuest = await rpc(guest, 'submit_simultaneous_weapon_declaration', {
    p_game_id: game.id, p_attacker_instance_id: 'locust-lct1e-p2-1', p_target_instance_id: 'trebuchet-tbt3c-p1-1', p_weapon_mounts: [], p_ammo_bins: {}
  });
  check('the prone-fire phase resolves normally for both players', !proneGuest.error && proneGuest.data?.status === 'resolved', JSON.stringify(proneGuest));
  const proneEvent = await weaponEvent(host, game.id, proneRound, 'trebuchet-tbt3c-p1-1');
  check('resolved prone fire records the +2 target-number modifier', proneEvent.data?.resolution?.results?.[0]?.to_hit?.breakdown?.prone === 2, JSON.stringify(proneEvent.data?.resolution?.results?.[0]?.to_hit?.breakdown));

  // Destruction consequences use pure authoritative functions with real
  // catalogue records. The Trebuchet's explicit CASE must vent side-torso
  // overflow; the unprotected Locust must transfer it into and destroy the CT.
  const consequences = await host.evaluate(async ({ version }) => {
    await loadUnitCatalogue(version);
    const makeMech = (unitId, id) => {
      const unit = BT_UNITS[unitId];
      return {
        instanceId: id, unitId, catalogueVersion: version, owner: 1,
        structure: { ...unit.structure }, armor: { ...unit.armor },
        criticalSlotDamage: {}, pilot: { hits: 0, consciousness: 'conscious', piloting: 5 }, destroyed: false
      };
    };
    const caseMech = makeMech('trebuchet-tbt3c', 'explicit-case');
    const unprotectedMech = makeMech('locust-lct1e', 'no-case');
    const caseCt = caseMech.structure.ct;
    const clan = await db.rpc('btech_apply_ammunition_explosion', { p_mech: caseMech, p_location: 'lt', p_damage: 100 });
    const innerSphere = await db.rpc('btech_apply_ammunition_explosion', { p_mech: unprotectedMech, p_location: 'lt', p_damage: 100 });
    return {
      clan: { data: clan.data, error: clan.error?.message || null, caseCt },
      innerSphere: { data: innerSphere.data, error: innerSphere.error?.message || null }
    };
  }, { version: game.catalogue_version });
  const clanResult = consequences.clan.data;
  check('CASE vents ammunition overflow outside the centre torso', !consequences.clan.error && clanResult?.case_protected === true && clanResult?.vented_damage > 0 && clanResult?.mech?.structure?.ct === consequences.clan.caseCt && clanResult?.mech?.pilot?.hits === 2, JSON.stringify(consequences.clan));
  const isResult = consequences.innerSphere.data;
  check('an unprotected ammunition explosion transfers inward and destroys the pilot with the centre torso', !consequences.innerSphere.error && isResult?.case_protected === false && isResult?.mech?.destroyed === true && isResult?.mech?.structure?.ct === 0 && isResult?.mech?.pilot?.consciousness === 'dead', JSON.stringify(consequences.innerSphere));
} catch (error) {
  check('focused live rules regression completed without a fatal error', false, error.message);
} finally {
  console.log('\n--- console/page errors ---');
  console.log(errors.join('\n') || '(none)');
  await browser.close();
}

if (failures.length) {
  console.log(`\n${failures.length} focused human-vs-human rules regression failure(s)`);
  process.exit(1);
}
console.log('\nFocused human-vs-human rules regression passed');
