// Dedicated AI-2 live acceptance. Creates a real Play-vs-AI match, installs a
// deterministic weapon-phase fixture, then lets the production AI planner and
// shared authoritative weapon resolver perform one complete activation.

import { createRequire } from 'module';
import { writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/mattperkins/.hermes/hermes-agent/node_modules/playwright');
const BASE = process.env.SHOT_URL || 'http://127.0.0.1:8790/index.html';
const USER = process.env.BT_AI2_USER || 'ai2-live-acceptance';
const PASS = process.env.BT_AI2_PASS || 'AI2!Live01';
const SEED = String(process.env.BT_AI2_SEED || 'ai2-live-acceptance');
const PROFILE = Number(process.env.BT_AI2_PROFILE || 0) || 0;
const RANDOMIZE = process.env.BT_AI2_RANDOMIZE === '1';
const KEEP_PASSED = process.env.BT_AI2_KEEP_PASSED === '1';
const REPORT_PATH = process.env.BT_AI2_REPORT || null;
const failures = [];
const consoleErrors = [];
let result = null;
let gameId = null;
let gameCode = null;

function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({ headless:true, channel:'chrome', args:['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport:{ width:1440, height:900 } });
page.on('pageerror', error => consoleErrors.push(`PAGEERROR: ${error.message}`));
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(`CONSOLE: ${message.text()}`); });

async function activeScreen() {
  return page.evaluate(() => Array.from(document.querySelectorAll('.screen')).find(screen => screen.classList.contains('active'))?.id || null);
}
async function waitForScreen(id, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await activeScreen() === id) return true;
    await page.waitForTimeout(250);
  }
  return false;
}
async function signIn() {
  await page.goto(BASE, { waitUntil:'networkidle', timeout:30000 }).catch(() => {});
  await page.fill('#login-username', USER);
  await page.fill('#login-password', PASS);
  await page.click('#btn-login').catch(() => {});
  if (await waitForScreen('menu-screen',12000)) return;
  await page.fill('#login-username', USER);
  await page.fill('#login-password', PASS);
  await page.click('#btn-signup').catch(() => {});
  if (!await waitForScreen('menu-screen',20000)) throw new Error(`Could not sign in as ${USER}`);
}

try {
  await signIn();
  await page.evaluate(async () => { handleCreateVsAI(); await handleCreateConfiguredVsAI(); });
  if (!await waitForScreen('lobby-screen')) throw new Error('Play vs AI did not open its lobby.');
  await page.evaluate(async () => { await handleStartGame(); });
  if (!await waitForScreen('game-screen',25000)) throw new Error('Play vs AI did not reach the battlefield.');

  result = await page.evaluate(async ({ seed,profile,randomize }) => {
    const copy = value => JSON.parse(JSON.stringify(value));
    const hash = text => {
      let value = 2166136261;
      for (const char of text) { value ^= char.charCodeAt(0); value = Math.imul(value,16777619); }
      return value >>> 0;
    };
    const rotate = (items,offset) => items.length ? [...items.slice(offset % items.length),...items.slice(0,offset % items.length)] : [];
    const { data:game,error:gameError } = await db.from('btech_games').select('*').eq('id',currentGameId).single();
    if (gameError) throw gameError;
    const { data:players,error:playerError } = await db.from('btech_players').select('*').eq('game_id',currentGameId).eq('role','player').order('seat_number');
    if (playerError) throw playerError;
    const human = players.find(player => player.seat_number === 1);
    const ai = players.find(player => player.seat_number === 2 && player.is_ai);
    if (!human || !ai) throw new Error('The Play-vs-AI match does not contain its human and AI seats.');
    await loadUnitCatalogue(game.catalogue_version);

    const allUnitIds = [...databaseSupportedUnitIds].filter(unitId => {
      const unit = getSupportedUnit(unitId);
      return unit && unit.armor && unit.structure;
    }).sort();
    if (!allUnitIds.length) throw new Error('The pinned catalogue contains no supported BattleMechs.');
    const mapIds = Object.keys(BT_MAPS).filter(id => mapDimensions(id).cols >= 16 && mapDimensions(id).rows >= 12);
    const atlasId = resolveCatalogueId('atlas-as7-d');
    const start = randomize ? hash(`${seed}:${profile}`) % allUnitIds.length : Math.max(0,allUnitIds.indexOf(atlasId));
    const candidates = rotate(allUnitIds,start);
    const targetStart = (start + 17 + profile * 7) % allUnitIds.length;
    const targetIds = [allUnitIds[targetStart],allUnitIds[(targetStart + 31) % allUnitIds.length]];
    const mapId = randomize ? mapIds[hash(`map:${seed}:${profile}`) % mapIds.length] : 'standard-single-sheet';
    const terrainOverrides = {};
    for (let col = 3; col <= 13; col++) terrainOverrides[hexCode(col,8)] = 'clear';
    setActiveMap(mapId);
    setActiveTerrainState({ terrain_overrides:terrainOverrides });
    const positions = { '1':[{ col:11,row:8,facing:0 },{ col:5,row:8,facing:0 }], '2':[{ col:12,row:8,facing:3 }] };
    let fixture = null;
    for (const attackerId of candidates) {
      const units = buildRosterInstances({ '1':targetIds,'2':[attackerId] },{},positions);
      for (const mech of units) {
        Object.assign(mech,{
          hasMoved:true,hasReacted:true,hasFired:mech.owner === 1,hasPhysicalAttacked:false,hasManagedHeat:false,
          prone:false,destroyed:false,shutdown:false,movementMode:'stand',hexesMoved:0,
          heat:0,roundStartingHeat:0,movementHeat:0,weaponHeat:0,externalHeat:0
        });
        mech.pilot = { ...(mech.pilot || {}),gunnery:2,piloting:5,hits:0,consciousness:'conscious' };
        mech.weaponPhaseStart = { round:1,mech:copy(mech) };
      }
      const attacker = units.find(mech => mech.owner === 2);
      const targets = units.filter(mech => mech.owner === 1);
      prepareAIAmmoLoadouts([attacker]);
      attacker.weaponPhaseStart = { round:1,mech:copy(attacker) };
      mechInstances = units;
      currentGameState = {
        round:1,phase:'weapon_attack',active_player_id:ai.id,initiative_winner:ai.id,
        initiative_order:[{ player_id:ai.id,seat_number:2,is_ai:true },{ player_id:human.id,seat_number:1,is_ai:false }],
        initiative_rolls:[],initiative_round:1,initiative_pending:[],phase_activation:null,match_result:null
      };
      currentMatchConfig = { map_id:mapId,ruleset:'advanced_3060',vs_ai_mode:true,ai_difficulty:'expert',ai_seed:seed,catalogue_version:game.catalogue_version,terrain_overrides:terrainOverrides };
      const context = createAIPlanningContext('expert',currentMatchConfig,units);
      const action = generateAIAttackAction(attacker,targets,AI_SETTINGS.expert,context);
      const mounts = action?.allocations?.flatMap(allocation => allocation.weapon_mounts || []) || [];
      const ammoMounts = action?.allocations?.flatMap(allocation => Object.entries(allocation.ammo_bins || {}).filter(([key]) => !key.startsWith('__'))) || [];
      if (action?.type === 'attack' && mounts.length >= 2 && ammoMounts.length) {
        fixture = { units,attacker,targets,actionPreview:copy(action) };
        break;
      }
    }
    if (!fixture) throw new Error('Could not find a multi-weapon, ammunition-using AI fixture in the pinned catalogue.');

    mechInstances = fixture.units;
    const before = copy(fixture.attacker);
    const state = {
      map_id:mapId,ruleset:'advanced_3060',vs_ai_mode:true,ai_difficulty:'expert',ai_seed:seed,
      ai_engine_version:BT_AI_ENGINE_VERSION,ai_decisions:[],catalogue_version:game.catalogue_version,
      terrain_overrides:terrainOverrides,mech_instances:fixture.units,
      initiative_order:currentGameState.initiative_order,initiative_round:1,initiative_rolls:[],initiative_pending:[],
      phase_activation:null,active_player_player_id:ai.id,round:1
    };
    // Take the normal scheduler's re-entry guard before publishing an active
    // AI fixture. Realtime can deliver that update immediately.
    aiTurnInProgress = true;
    const { error:updateError } = await db.from('btech_games').update({ current_round:1,current_phase:'weapon_attack',active_player_id:ai.id,initiative_winner:ai.id,state }).eq('id',currentGameId);
    if (updateError) throw updateError;

    vsAiMode = true;
    AI_SETTINGS.expert.attackChance = 1;
    // A delayed realtime notification from initial match setup can otherwise
    // replace this fixture between publication and planning. Reload the exact
    // authoritative row while the scheduler guard remains held.
    await loadGameState();
    const plan = generateAIPlan('expert',ai.id,state,players);
    try { await executeAIPlan(plan); }
    finally { aiTurnInProgress = false; }
    await new Promise(resolve => setTimeout(resolve,500));

    const eventResult = await db.from('btech_combat_events').select('*').eq('game_id',currentGameId).eq('round',1).eq('phase','weapon_attack').eq('attacker_instance_id',fixture.attacker.instanceId).maybeSingle();
    const decisionResult = await db.from('btech_ai_decisions').select('*').eq('game_id',currentGameId).eq('decision_id',plan.decisionId).maybeSingle();
    const finalGameResult = await db.from('btech_games').select('*').eq('id',currentGameId).single();
    const finalState = typeof finalGameResult.data?.state === 'string' ? JSON.parse(finalGameResult.data.state) : finalGameResult.data?.state;
    const after = finalState?.mech_instances?.find(mech => mech.instanceId === fixture.attacker.instanceId) || null;
    return {
      build:BT_BUILD_ID,gameId:currentGameId,gameCode:game.game_code,catalogueVersion:game.catalogue_version,mapId,
      force:{ ai:fixture.attacker.unitId,human:fixture.targets.map(target => target.unitId) },players:{ humanId:human.id,aiId:ai.id },
      before,after,plan:copy(plan),event:eventResult.data,eventError:eventResult.error?.message || null,
      decision:decisionResult.data,decisionError:decisionResult.error?.message || null,
      finalGame:{ phase:finalGameResult.data?.current_phase,activePlayerId:finalGameResult.data?.active_player_id,status:finalGameResult.data?.status }
    };
  },{ seed:SEED,profile:PROFILE,randomize:RANDOMIZE });

  gameId = result.gameId;
  gameCode = result.gameCode;
  const action = result.plan?.actions?.find(entry => entry.instanceId === result.before?.instanceId);
  const plannedMounts = action?.allocations?.flatMap(allocation => allocation.weapon_mounts || []) || [];
  const declaredMounts = result.event?.declaration?.weapon_mounts || [];
  const resolved = result.event?.resolution?.results || [];
  const plannedAmmo = action?.allocations?.flatMap(allocation => Object.entries(allocation.ammo_bins || {}).filter(([key]) => !key.startsWith('__')).map(([mountId,binId]) => ({ mountId,binId,mode:allocation.ammo_bins?.__fire_modes?.[mountId] || 'single' }))) || [];
  const expectedAmmo = plannedAmmo.reduce((bins,item) => {
    const shots = item.mode === 'rapid' ? 2 : item.mode.startsWith('rotary-') ? Number(item.mode.slice(7)) || 1 : 1;
    bins[item.binId] = (bins[item.binId] || 0) + shots;
    return bins;
  },{});
  const beforeBins = Object.fromEntries((result.before?.ammoBins || []).map(bin => [bin.id,Number(bin.shots)]));
  const afterBins = Object.fromEntries((result.after?.ammoBins || []).map(bin => [bin.id,Number(bin.shots)]));
  const ammoExact = Object.entries(expectedAmmo).every(([binId,spent]) => beforeBins[binId] - afterBins[binId] === spent);

  check('Play vs AI pins an immutable catalogue',Boolean(result.catalogueVersion),result.catalogueVersion || 'missing');
  check('AI-2 chooses a complete multi-mount package',action?.type === 'attack' && plannedMounts.length >= 2,`${result.force.ai}: ${plannedMounts.length} mounts`);
  check('AI records an auditable planned and completed decision',/^ai-(?:[4-9]|[1-9][0-9])\./.test(result.decision?.engine_version || '') && result.decision?.status === 'completed',result.decisionError || result.decision?.status || 'missing');
  check('AI-4 records its force doctrine in the live decision',result.plan?.coordination?.doctrine === 'coordinated' && result.decision?.decision?.coordination?.focus_target_id,JSON.stringify(result.plan?.coordination || null));
  check('AI-4 declaration follows its ranked focus target',action?.focusTargetId === result.plan?.coordination?.focus_target_id && action?.allocations?.some(allocation => allocation.target_instance_id === action.focusTargetId),action?.focusTargetId || 'missing');
  check('the authoritative event belongs to the AI seat',result.event?.player_id === result.players.aiId,result.eventError || result.event?.player_id || 'missing');
  check('the server receives exactly the planned mount package',[...plannedMounts].sort().join('|') === [...declaredMounts].sort().join('|'),`${plannedMounts.length} planned / ${declaredMounts.length} declared`);
  const resolvedMounts = new Set(resolved.map(item => item?.mount_id).filter(Boolean));
  const completeResolution = plannedMounts.every(mountId => resolvedMounts.has(mountId)) &&
    resolved.every(item => plannedMounts.includes(item?.mount_id)) &&
    resolved.every(item => Number.isFinite(Number(item?.to_hit?.die_a)) && Number.isFinite(Number(item?.to_hit?.die_b)));
  check('the authoritative resolver returns dice results for every planned mount',completeResolution,`${plannedMounts.length} mounts / ${resolved.length} shot results`);
  check('server ammunition consumption matches the selected modes',plannedAmmo.length > 0 && ammoExact,JSON.stringify({ expectedAmmo,beforeBins,afterBins }));
  check('server heat accounting applies the package exactly once',Number(result.after?.weaponHeat) === Number(result.before?.weaponHeat || 0) + Number(action?.weaponHeat || 0),`${result.before?.weaponHeat || 0} + ${action?.weaponHeat || 0} = ${result.after?.weaponHeat}`);
  check('the AI activation hands play on without remaining active',result.finalGame?.activePlayerId !== result.players.aiId || result.finalGame?.phase !== 'weapon_attack',JSON.stringify(result.finalGame));

  if (!failures.length && !KEEP_PASSED) {
    const cleanup = await page.evaluate(async id => (await db.from('btech_games').delete().eq('id',id)).error?.message || null,gameId);
    check('passing disposable AI match is removed',!cleanup,cleanup || gameCode);
  }
} catch (error) {
  failures.push(`fatal acceptance error — ${error.message}`);
  console.error(`FAIL  dedicated AI-2 live acceptance — ${error.message}`);
  if (!gameId) {
    const identity = await page.evaluate(() => ({ gameId:typeof currentGameId === 'undefined' ? null : currentGameId,gameCode:typeof currentGameCode === 'undefined' ? null : currentGameCode })).catch(() => ({}));
    gameId = identity.gameId || null;
    gameCode = identity.gameCode || null;
  }
} finally {
  const report = { generatedAt:new Date().toISOString(),seed:SEED,profile:PROFILE,randomized:RANDOMIZE,passed:failures.length === 0,failures,gameId,gameCode,result,consoleErrors:consoleErrors.slice(0,50) };
  if (REPORT_PATH) await writeFile(REPORT_PATH,JSON.stringify(report,null,2));
  console.log(`\nAI-2 LIVE ACCEPTANCE ${failures.length ? 'FAILED' : 'PASSED'}${gameCode ? ` — ${gameCode}` : ''}`);
  if (failures.length) console.log(`Failed match retained${gameCode ? ` as ${gameCode}` : ''}.`);
  if (consoleErrors.length) console.log(`Console/page errors: ${consoleErrors.length} (saved in the report when configured).`);
  await browser.close();
}

if (failures.length) process.exitCode = 1;
