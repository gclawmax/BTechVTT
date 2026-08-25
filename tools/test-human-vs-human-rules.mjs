// Focused live regression for the authoritative rules added by SQL 62-71.
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
async function configureScenario(page, game, players, round, phase, rosters, positions, prepare = {}, options = {}) {
  return page.evaluate(async ({ game, players, round, phase, rosters, positions, prepare, options }) => {
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
      if (changes) {
        const { ammoLoadTypes, ...recordChanges } = changes;
        Object.assign(mech, recordChanges);
        if (ammoLoadTypes) mech.ammoBins = (mech.ammoBins || []).map(bin => ammoLoadTypes[bin.id] ? { ...bin, loadType: ammoLoadTypes[bin.id] } : bin);
      }
    }
    const hostPlayer = players.find(player => player.seat_number === 1);
    const guestPlayer = players.find(player => player.seat_number === 2);
    if (!hostPlayer || !guestPlayer) throw new Error('The focused regression requires both test players.');
    const initiative = [hostPlayer, guestPlayer].map(player => ({ player_id: player.id, seat_number: player.seat_number }));
    const state = {
      map_id: options.mapId || 'ridge-and-ford', catalogue_version: game.catalogue_version,
      ...(options.specialAmmo ? { special_ammo_setup_v1: true } : {}),
      mech_instances: units, initiative_order: initiative,
      active_player_player_id: hostPlayer.id, round
    };
    const { error } = await db.from('btech_games').update({ current_round: round, current_phase: phase, active_player_id: hostPlayer.id, state }).eq('id', game.id);
    if (error) throw error;
    return { state, hostPlayer, guestPlayer };
  }, { game, players, round, phase, rosters, positions, prepare, options });
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
async function specialAmmoFixtures(page, catalogueVersion) {
  return page.evaluate(async version => {
    await loadUnitCatalogue(version);
    const mountsResult = await db.from('btech_catalogue_mounts').select('unit_id,mount_id,weapon_key').eq('catalogue_version', version)
      .in('weapon_key', ['srm2', 'srm4', 'srm6', 'ac2', 'ac5', 'ac10', 'ac20']);
    const binsResult = await db.from('btech_catalogue_ammo_bins').select('unit_id,bin_id,ammo_type').eq('catalogue_version', version)
      .in('ammo_type', ['srm2', 'srm4', 'srm6', 'ac2', 'ac5', 'ac10', 'ac20']);
    if (mountsResult.error) throw mountsResult.error;
    if (binsResult.error) throw binsResult.error;
    const find = acceptedTypes => {
      const mount = (mountsResult.data || []).find(candidate => acceptedTypes.includes(candidate.weapon_key) &&
        (binsResult.data || []).some(bin => bin.unit_id === candidate.unit_id && bin.ammo_type === candidate.weapon_key));
      const bin = mount && binsResult.data.find(candidate => candidate.unit_id === mount.unit_id && candidate.ammo_type === mount.weapon_key);
      return mount && bin ? { unitId: mount.unit_id, mountId: mount.mount_id, binId: bin.bin_id, binType: bin.ammo_type } : null;
    };
    return { inferno: find(['srm2', 'srm4', 'srm6']), precision: find(['ac2', 'ac5', 'ac10', 'ac20']) };
  }, catalogueVersion);
}
async function submitDesiredAmmoLoadout(page, gameId, ownerSeat, desiredType) {
  return page.evaluate(async ({ gameId, ownerSeat, desiredType }) => {
    const { data: game, error: readError } = await db.from('btech_games').select('state').eq('id', gameId).single();
    if (readError) return { data: null, error: { message: readError.message, code: readError.code } };
    const state = typeof game.state === 'string' ? JSON.parse(game.state) : game.state;
    const loadouts = {};
    for (const mech of state.mech_instances || []) {
      if (mech.owner !== ownerSeat) continue;
      for (const bin of mech.ammoBins || []) {
        const choices = bin.type === 'lb10x' ? ['slug', 'cluster']
          : ['srm2', 'srm4', 'srm6'].includes(bin.type) ? ['standard', 'inferno']
            : ['ac2', 'ac5', 'ac10', 'ac20'].includes(bin.type) ? ['standard', 'precision'] : [];
        if (choices.length) loadouts[`${mech.instanceId}:${bin.id}`] = choices.includes(desiredType) ? desiredType : choices[0];
      }
    }
    const result = await db.rpc('submit_round_one_ammo_loadout', { p_game_id: gameId, p_loadouts: loadouts });
    return { data: result.data, error: result.error ? { message: result.error.message, code: result.error.code } : null, loadouts };
  }, { gameId, ownerSeat, desiredType });
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

  // SQL 70 advanced terrain: solid buildings, burning terrain, pavement
  // control, smoke/building LOS, and deep-water weapon restrictions.
  const fireRound = roundBase + 4;
  await configureScenario(host, game, players, fireRound, 'movement',
    { 1: ['locust-lct1e'], 2: ['locust-lct1e'] },
    { 1: [{ col: 9, row: 4, facing: 0 }], 2: [{ col: 14, row: 9, facing: 3 }] }, {}, { mapId: 'industrial-crossing' });
  const fireMove = await rpc(host, 'submit_battlemech_movement', {
    p_game_id: game.id, p_instance_id: 'locust-lct1e-p1-1', p_mode: 'walk',
    p_path: [{ action: 'step', col: 10, row: 4 }]
  });
  check('walking through fire records two immediate terrain heat', !fireMove.error && fireMove.data?.terrain_heat === 2, JSON.stringify(fireMove));
  const fireState = await host.evaluate(async gameId => {
    const { data, error } = await db.from('btech_games').select('state').eq('id', gameId).single();
    const state = typeof data?.state === 'string' ? JSON.parse(data.state) : data?.state;
    return { mech: state?.mech_instances?.find(unit => unit.instanceId === 'locust-lct1e-p1-1'), error: error?.message || null };
  }, game.id);
  check('ending Movement in fire schedules five additional Heat-Phase heat', !fireState.error && fireState.mech?.pendingTerrainHeat === 5, JSON.stringify(fireState));

  const buildingRound = roundBase + 5;
  await configureScenario(host, game, players, buildingRound, 'movement',
    { 1: ['locust-lct1e'], 2: ['locust-lct1e'] },
    { 1: [{ col: 5, row: 3, facing: 0 }], 2: [{ col: 14, row: 9, facing: 3 }] }, {}, { mapId: 'industrial-crossing' });
  expectedHttp400++;
  const buildingMove = await rpc(host, 'submit_battlemech_movement', {
    p_game_id: game.id, p_instance_id: 'locust-lct1e-p1-1', p_mode: 'walk',
    p_path: [{ action: 'step', col: 6, row: 3 }]
  });
  check('solid buildings reject ground movement authoritatively', /impassable/i.test(buildingMove.error?.message || ''), JSON.stringify(buildingMove));

  const pavementRound = roundBase + 6;
  await configureScenario(host, game, players, pavementRound, 'movement',
    { 1: ['locust-lct1e'], 2: ['locust-lct1e'] },
    { 1: [{ col: 7, row: 5, facing: 0 }], 2: [{ col: 14, row: 9, facing: 3 }] }, {}, { mapId: 'industrial-crossing' });
  const pavementTurn = await rpc(host, 'submit_battlemech_movement', {
    p_game_id: game.id, p_instance_id: 'locust-lct1e-p1-1', p_mode: 'run',
    p_path: [{ action: 'turn', direction: 'left' }]
  });
  check('a running pavement turn invokes the authoritative control check', !pavementTurn.error && pavementTurn.data?.terrain_check?.reasons?.includes('running turn on pavement'), JSON.stringify(pavementTurn));

  // SQL 87 weathered terrain: unstable ice, magma-crust heat/breach checks,
  // and liquid magma remaining unavailable to ordinary BattleMech movement.
  const iceRound = roundBase + 40;
  await configureScenario(host, game, players, iceRound, 'movement',
    { 1: ['locust-lct1e'], 2: ['locust-lct1e'] },
    { 1: [{ col: 2, row: 2, facing: 0 }], 2: [{ col: 14, row: 9, facing: 3 }] }, {}, { mapId: 'weathered-frontier' });
  const iceMove = await rpc(host, 'submit_battlemech_movement', {
    p_game_id: game.id, p_instance_id: 'locust-lct1e-p1-1', p_mode: 'walk',
    p_path: [{ action: 'step', col: 3, row: 2 }]
  });
  check('walking onto ice invokes the authoritative unstable-terrain Piloting check', !iceMove.error && iceMove.data?.terrain_check?.reasons?.includes('crossing unstable terrain'), JSON.stringify(iceMove));

  const magmaRound = roundBase + 41;
  await configureScenario(host, game, players, magmaRound, 'movement',
    { 1: ['locust-lct1e'], 2: ['locust-lct1e'] },
    { 1: [{ col: 2, row: 8, facing: 0 }], 2: [{ col: 14, row: 9, facing: 3 }] }, {}, { mapId: 'weathered-frontier' });
  const magmaMove = await rpc(host, 'submit_battlemech_movement', {
    p_game_id: game.id, p_instance_id: 'locust-lct1e-p1-1', p_mode: 'walk',
    p_path: [{ action: 'step', col: 3, row: 8 }]
  });
  check('magma crust adds transit heat and records its ground-movement breach roll', !magmaMove.error && magmaMove.data?.terrain_heat === 2 && magmaMove.data?.magma_crust_checks?.[0]?.target === 6, JSON.stringify(magmaMove));
  const magmaState = await host.evaluate(async gameId => {
    const { data, error } = await db.from('btech_games').select('state').eq('id', gameId).single();
    const state = typeof data?.state === 'string' ? JSON.parse(data.state) : data?.state;
    return { mech: state?.mech_instances?.find(unit => unit.instanceId === 'locust-lct1e-p1-1'), error: error?.message || null };
  }, game.id);
  const magmaBreached = magmaMove.data?.magma_crust_checks?.[0]?.breached === true;
  check('magma crust persists either its end-phase heat or the rolled breach consequences', !magmaState.error && (magmaBreached
    ? magmaMove.data?.magma_crust_checks?.[0]?.damage?.length === 2
    : magmaState.mech?.pendingTerrainHeat === 5), JSON.stringify({ magmaMove, magmaState }));

  const liquidRound = roundBase + 42;
  await configureScenario(host, game, players, liquidRound, 'movement',
    { 1: ['locust-lct1e'], 2: ['locust-lct1e'] },
    { 1: [{ col: 4, row: 8, facing: 0 }], 2: [{ col: 14, row: 9, facing: 3 }] }, {}, { mapId: 'weathered-frontier' });
  expectedHttp400++;
  const liquidMove = await rpc(host, 'submit_battlemech_movement', {
    p_game_id: game.id, p_instance_id: 'locust-lct1e-p1-1', p_mode: 'walk',
    p_path: [{ action: 'step', col: 5, row: 8 }]
  });
  check('liquid magma rejects ordinary BattleMech movement authoritatively', /impassable/i.test(liquidMove.error?.message || ''), JSON.stringify(liquidMove));

  const fixtures = await specialAmmoFixtures(host, game.catalogue_version);
  check('the pinned catalogue provides standard SRM and autocannon fixtures', fixtures.inferno && fixtures.precision, JSON.stringify(fixtures));

  const obscuredRound = roundBase + 7;
  await configureScenario(host, game, players, obscuredRound, 'weapon_attack',
    { 1: [fixtures.precision.unitId], 2: ['locust-lct1e'] },
    { 1: [{ col: 9, row: 4, facing: 0 }], 2: [{ col: 13, row: 4, facing: 3 }] }, {}, { mapId: 'industrial-crossing' });
  expectedHttp400++;
  const obscuredFire = await rpc(host, 'submit_simultaneous_weapon_declaration', {
    p_game_id: game.id, p_attacker_instance_id: `${fixtures.precision.unitId}-p1-1`, p_target_instance_id: 'locust-lct1e-p2-1',
    p_weapon_mounts: [fixtures.precision.mountId], p_ammo_bins: { [fixtures.precision.mountId]: fixtures.precision.binId, __fire_modes: {} }
  });
  check('combined fire and smoke obscure direct line of sight', /line of sight is blocked/i.test(obscuredFire.error?.message || ''), JSON.stringify(obscuredFire));

  const deepWaterRound = roundBase + 8;
  await configureScenario(host, game, players, deepWaterRound, 'weapon_attack',
    { 1: [fixtures.precision.unitId], 2: ['locust-lct1e'] },
    { 1: [{ col: 3, row: 5, facing: 0 }], 2: [{ col: 7, row: 5, facing: 3 }] }, {}, { mapId: 'industrial-crossing' });
  expectedHttp400++;
  const submergedFire = await rpc(host, 'submit_simultaneous_weapon_declaration', {
    p_game_id: game.id, p_attacker_instance_id: `${fixtures.precision.unitId}-p1-1`, p_target_instance_id: 'locust-lct1e-p2-1',
    p_weapon_mounts: [fixtures.precision.mountId], p_ammo_bins: { [fixtures.precision.mountId]: fixtures.precision.binId, __fire_modes: {} }
  });
  check('deep water blocks unsupported direct weapon fire', /terrain or water depth/i.test(submergedFire.error?.message || ''), JSON.stringify(submergedFire));

  // SQL 71 specialised ammunition: resolve one guaranteed Inferno hit and
  // one Precision shot through the simultaneous two-player collector.
  const infernoRound = roundBase + 9;
  const infernoAttackerId = `${fixtures.inferno.unitId}-p1-1`;
  await configureScenario(host, game, players, infernoRound, 'weapon_attack',
    { 1: [fixtures.inferno.unitId], 2: ['locust-lct1e'] },
    { 1: [{ col: 0, row: 0, facing: 0 }], 2: [{ col: 2, row: 0, facing: 3 }] },
    { [infernoAttackerId]: { ammoLoadTypes: { [fixtures.inferno.binId]: 'inferno' } } }, { specialAmmo: true });
  const infernoFire = await rpc(host, 'submit_simultaneous_weapon_declaration', {
    p_game_id: game.id, p_attacker_instance_id: infernoAttackerId, p_target_instance_id: 'locust-lct1e-p2-1',
    p_weapon_mounts: [fixtures.inferno.mountId], p_ammo_bins: { [fixtures.inferno.mountId]: fixtures.inferno.binId, __fire_modes: {} }
  });
  check('Inferno SRM declaration is accepted for the loaded bin', !infernoFire.error, JSON.stringify(infernoFire));
  const infernoGuest = await rpc(guest, 'submit_simultaneous_weapon_declaration', {
    p_game_id: game.id, p_attacker_instance_id: 'locust-lct1e-p2-1', p_target_instance_id: infernoAttackerId, p_weapon_mounts: [], p_ammo_bins: {}
  });
  check('the two-player Inferno attack resolves normally', !infernoGuest.error && infernoGuest.data?.status === 'resolved', JSON.stringify(infernoGuest));
  const infernoEvent = await weaponEvent(host, game.id, infernoRound, infernoAttackerId);
  const infernoResult = infernoEvent.data?.resolution?.results?.[0];
  check('Inferno missiles inflict heat instead of damage within the external cap', infernoResult?.hit && infernoResult?.ammo_load_type === 'inferno' && infernoResult?.heat_inflicted === Math.min(15, infernoResult?.missiles_hit * 2) && (infernoResult?.groups || []).every(group => group.damage === 0), JSON.stringify(infernoResult));

  const precisionRound = roundBase + 10;
  const precisionAttackerId = `${fixtures.precision.unitId}-p1-1`;
  await configureScenario(host, game, players, precisionRound, 'weapon_attack',
    { 1: [fixtures.precision.unitId], 2: ['locust-lct1e'] },
    { 1: [{ col: 0, row: 0, facing: 0 }], 2: [{ col: 2, row: 0, facing: 3 }] },
    { [precisionAttackerId]: { ammoLoadTypes: { [fixtures.precision.binId]: 'precision' } }, 'locust-lct1e-p2-1': { movementMode: 'run', hexesMoved: 5 } }, { specialAmmo: true });
  const precisionFire = await rpc(host, 'submit_simultaneous_weapon_declaration', {
    p_game_id: game.id, p_attacker_instance_id: precisionAttackerId, p_target_instance_id: 'locust-lct1e-p2-1',
    p_weapon_mounts: [fixtures.precision.mountId], p_ammo_bins: { [fixtures.precision.mountId]: fixtures.precision.binId, __fire_modes: {} }
  });
  check('Precision autocannon declaration is accepted for the loaded bin', !precisionFire.error, JSON.stringify(precisionFire));
  const precisionGuest = await rpc(guest, 'submit_simultaneous_weapon_declaration', {
    p_game_id: game.id, p_attacker_instance_id: 'locust-lct1e-p2-1', p_target_instance_id: precisionAttackerId, p_weapon_mounts: [], p_ammo_bins: {}
  });
  check('the two-player Precision attack resolves normally', !precisionGuest.error && precisionGuest.data?.status === 'resolved', JSON.stringify(precisionGuest));
  const precisionEvent = await weaponEvent(host, game.id, precisionRound, precisionAttackerId);
  const precisionResult = precisionEvent.data?.resolution?.results?.[0];
  check('Precision ammunition removes two points of target movement modifier', precisionResult?.ammo_load_type === 'precision' && precisionResult?.to_hit?.breakdown?.target_movement === 2 && precisionResult?.to_hit?.breakdown?.special_ammunition === -2, JSON.stringify(precisionResult));

  // Clear the disposable match's old Round 1 initiative rows with a legal tie,
  // then exercise the actual two-player Round 1 loadout RPC and its guard.
  await configureScenario(host, game, players, 1, 'initiative',
    { 1: ['locust-lct1e'], 2: ['locust-lct1e'] },
    { 1: [{ col: 4, row: 5, facing: 0 }], 2: [{ col: 11, row: 5, facing: 3 }] });
  const existingInitiative = await host.evaluate(async gameId => {
    const { data, error } = await db.from('btech_initiative').select('player_id,roll').eq('game_id', gameId).eq('round', 1);
    return { rows: data || [], error: error?.message || null };
  }, game.id);
  const guestPlayer = players.find(player => player.seat_number === 2);
  const tieTotal = existingInitiative.rows.find(row => row.player_id === guestPlayer?.id)?.roll || 6;
  const tieDieA = Math.max(1, tieTotal - 6), tieDieB = tieTotal - tieDieA;
  const clearHostInitiative = await rpc(host, 'submit_initiative_roll', { p_game_id: game.id, p_die_a: tieDieA, p_die_b: tieDieB });
  const clearGuestInitiative = clearHostInitiative.data?.status === 'tie' ? { data: clearHostInitiative.data, error: null }
    : await rpc(guest, 'submit_initiative_roll', { p_game_id: game.id, p_die_a: tieDieA, p_die_b: tieDieB });
  check('a disposable tied roll clears prior Round 1 initiative records', !existingInitiative.error && !clearHostInitiative.error && !clearGuestInitiative.error && clearGuestInitiative.data?.status === 'tie', JSON.stringify({ existingInitiative, clearHostInitiative, clearGuestInitiative }));

  await configureScenario(host, game, players, 1, 'initiative',
    { 1: [fixtures.inferno.unitId], 2: [fixtures.precision.unitId] },
    { 1: [{ col: 4, row: 5, facing: 0 }], 2: [{ col: 11, row: 5, facing: 3 }] }, {}, { specialAmmo: true });
  const hostLoadout = await submitDesiredAmmoLoadout(host, game.id, 1, 'inferno');
  const guestLoadout = await submitDesiredAmmoLoadout(guest, game.id, 2, 'precision');
  check('both players can submit their specialised Round 1 ammunition choices', !hostLoadout.error && !guestLoadout.error, JSON.stringify({ hostLoadout, guestLoadout }));
  const loadedBins = await host.evaluate(async gameId => {
    const { data, error } = await db.from('btech_games').select('state').eq('id', gameId).single();
    const state = typeof data?.state === 'string' ? JSON.parse(data.state) : data?.state;
    return { bins: (state?.mech_instances || []).flatMap(mech => (mech.ammoBins || []).map(bin => ({ ...bin, owner: mech.owner }))), error: error?.message || null };
  }, game.id);
  const liveInfernoBins = loadedBins.bins?.filter(bin => bin.owner === 1 && ['srm2', 'srm4', 'srm6'].includes(bin.type)) || [];
  const livePrecisionBins = loadedBins.bins?.filter(bin => bin.owner === 2 && ['ac2', 'ac5', 'ac10', 'ac20'].includes(bin.type)) || [];
  check('Round 1 persists Inferno loads and halves Precision bin capacity', !loadedBins.error && liveInfernoBins.length > 0 && liveInfernoBins.every(bin => bin.loadType === 'inferno') && livePrecisionBins.length > 0 && livePrecisionBins.every(bin => bin.loadType === 'precision' && bin.shots === Math.max(1, Math.floor(bin.standardShots / 2))), JSON.stringify(loadedBins));
  const loadedHostRoll = await rpc(host, 'submit_initiative_roll', { p_game_id: game.id, p_die_a: 1, p_die_b: 2 });
  const loadedGuestRoll = await rpc(guest, 'submit_initiative_roll', { p_game_id: game.id, p_die_a: 5, p_die_b: 6 });
  check('Initiative unlocks only after both specialised loadouts are saved', !loadedHostRoll.error && !loadedGuestRoll.error && loadedGuestRoll.data?.status === 'resolved', JSON.stringify({ loadedHostRoll, loadedGuestRoll }));

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
