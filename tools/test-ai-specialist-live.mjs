// AI-5 live acceptance. Exercises an authoritative AI torso twist followed by
// an authoritative physical attack in a disposable Play-vs-AI match.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/mattperkins/.hermes/hermes-agent/node_modules/playwright');

const BASE = process.env.SHOT_URL || 'https://gclawmax.github.io/BTechVTT/';
const USER = process.env.BT_AI5_USER || 'ai5-live-acceptance';
const PASS = process.env.BT_AI5_PASS || 'AI5!Live01';
const KEEP = process.env.BT_AI5_KEEP === '1';
const failures = [];
const consoleErrors = [];
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
  await page.goto(BASE, { waitUntil:'networkidle', timeout:30000 });
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
  await page.evaluate(async () => { await handleCreateVsAI(); });
  if (!await waitForScreen('lobby-screen')) throw new Error('Play vs AI did not open its lobby.');
  await page.evaluate(async () => { await handleStartGame(); });
  if (!await waitForScreen('game-screen',25000)) throw new Error('Play vs AI did not reach the battlefield.');

  const result = await page.evaluate(async () => {
    const copy = value => JSON.parse(JSON.stringify(value));
    const { data:game, error:gameError } = await db.from('btech_games').select('*').eq('id',currentGameId).single();
    if (gameError) throw new Error(`Game lookup failed: ${gameError.message}`);
    const { data:players, error:playerError } = await db.from('btech_players').select('*').eq('game_id',currentGameId).eq('role','player').order('seat_number');
    if (playerError) throw new Error(`Player lookup failed: ${playerError.message}`);
    const humanPlayer = players.find(player => player.seat_number === 1 && !player.is_ai);
    const aiPlayer = players.find(player => player.seat_number === 2 && player.is_ai);
    if (!humanPlayer || !aiPlayer) throw new Error('The disposable match is missing its human or AI seat.');
    await loadUnitCatalogue(game.catalogue_version);
    const unitIds = [...databaseSupportedUnitIds].filter(unitId => {
      const unit = getSupportedUnit(unitId);
      return unit?.armor && unit?.structure && Number(unit?.movement?.walk || 0) > 0;
    }).sort();
    if (unitIds.length < 2) throw new Error('The pinned catalogue has no physical-attack fixture.');
    const mapId = 'standard-single-sheet';
    setActiveMap(mapId);
    const positions = { '1':[{ col:9,row:7,facing:3 }], '2':[{ col:8,row:8,facing:0 }] };
    const units = buildRosterInstances({ '1':[unitIds[0]], '2':[unitIds[1]] }, {}, positions);
    const human = units.find(mech => mech.owner === 1);
    const ai = units.find(mech => mech.owner === 2);
    for (const mech of units) {
      Object.assign(mech, { destroyed:false, shutdown:false, prone:false, hasMoved:true, hasReacted:mech.owner === 1, hasFired:false, hasPhysicalAttacked:false, hasManagedHeat:false, movementMode:'stand', hexesMoved:0, heat:0, roundStartingHeat:0, movementHeat:0, weaponHeat:0, externalHeat:0 });
      mech.pilot = { ...(mech.pilot || {}), gunnery:4, piloting:5, hits:0, consciousness:'conscious' };
    }
    const initiative = [{ player_id:aiPlayer.id, seat_number:2, is_ai:true }, { player_id:humanPlayer.id, seat_number:1, is_ai:false }];
    const baseState = {
      map_id:mapId, ruleset:'advanced_3060', vs_ai_mode:true, ai_difficulty:'expert', ai_seed:'ai5-live',
      ai_engine_version:BT_AI_ENGINE_VERSION, ai_decisions:[], catalogue_version:game.catalogue_version,
      terrain_overrides:{}, mech_instances:units, initiative_order:initiative, initiative_round:1,
      initiative_rolls:[], initiative_pending:[], phase_activation:null, active_player_player_id:aiPlayer.id, round:1
    };
    currentMatchConfig = copy(baseState);
    aiTurnInProgress = true;
    let update = await db.from('btech_games').update({ current_round:1, current_phase:'reaction', active_player_id:aiPlayer.id, initiative_winner:aiPlayer.id, state:baseState }).eq('id',currentGameId);
    if (update.error) throw new Error(`Reaction fixture update failed: ${update.error.message}`);
    await loadGameState();
    const reactionPlan = generateAIPlan('expert',aiPlayer.id,baseState,players);
    await executeAIPlan(reactionPlan);
    const reactionGame = await db.from('btech_games').select('*').eq('id',currentGameId).single();
    const reactionState = typeof reactionGame.data.state === 'string' ? JSON.parse(reactionGame.data.state) : reactionGame.data.state;
    const reactedAI = reactionState.mech_instances.find(mech => mech.instanceId === ai.instanceId);

    const physicalUnits = copy(reactionState.mech_instances);
    const physicalAI = physicalUnits.find(mech => mech.instanceId === ai.instanceId);
    const physicalHuman = physicalUnits.find(mech => mech.instanceId === human.instanceId);
    Object.assign(physicalAI, { col:8,row:8,facing:0,torsoFacing:0,hasPhysicalAttacked:false,prone:false,shutdown:false,destroyed:false });
    Object.assign(physicalHuman, { col:9,row:8,facing:3,torsoFacing:3,hasPhysicalAttacked:false,prone:false,shutdown:false,destroyed:false });
    const physicalState = { ...copy(baseState), mech_instances:physicalUnits, active_player_player_id:aiPlayer.id, ai_decisions:reactionState.ai_decisions || [] };
    update = await db.from('btech_games').update({ current_round:1, current_phase:'physical_attack', active_player_id:aiPlayer.id, state:physicalState }).eq('id',currentGameId);
    if (update.error) throw new Error(`Physical fixture update failed: ${update.error.message}`);
    await loadGameState();
    const physicalPlan = generateAIPlan('expert',aiPlayer.id,physicalState,players);
    await executeAIPlan(physicalPlan);
    const physicalAction = physicalPlan.actions.find(action => action.instanceId === ai.instanceId);
    const pass = await db.rpc('submit_simultaneous_physical_declaration', { p_game_id:currentGameId, p_attacker_instance_id:human.instanceId, p_target_instance_id:null, p_attack_type:'pass', p_limbs:[] });
    if (pass.error) throw new Error(`Human resolution pass failed: ${pass.error.message}`);
    const event = await db.from('btech_combat_events').select('*').eq('game_id',currentGameId).eq('round',1).eq('phase','physical_attack').eq('attacker_instance_id',ai.instanceId).maybeSingle();
    const decisions = await db.from('btech_ai_decisions').select('phase,status,decision').eq('game_id',currentGameId).order('created_at');
    aiTurnInProgress = false;
    return {
      build:BT_BUILD_ID, gameId:currentGameId, gameCode:game.game_code, catalogueVersion:game.catalogue_version,
      reactionAction:reactionPlan.actions[0] || null, reacted:reactedAI?.hasReacted === true,
      physicalAction, event:event.data, eventError:event.error?.message || null,
      decisions:decisions.data || [], decisionError:decisions.error?.message || null
    };
  });

  gameId = result.gameId;
  gameCode = result.gameCode;
  check('the deployed browser is AI-5',result.build === '20260906-ai5-specialist-tactics-71',result.build);
  check('SQL 126 accepts the active AI Reaction action',result.reacted && ['torso_twist','complete_reaction'].includes(result.reactionAction?.type),JSON.stringify(result.reactionAction));
  check('AI-5 selects a legal physical attack rather than a fixed kick',result.physicalAction?.type === 'physical_attack' && result.physicalAction?.attackType && result.physicalAction?.limbs?.length,JSON.stringify(result.physicalAction));
  check('the authoritative server resolves the AI physical declaration',result.event?.status === 'resolved' && result.event?.resolution?.results?.length > 0,result.eventError || result.event?.status || 'missing');
  check('Reaction and Physical decisions are durably completed',!result.decisionError && ['reaction','physical_attack'].every(phase => result.decisions.some(decision => decision.phase === phase && decision.status === 'completed')),JSON.stringify(result.decisions.map(decision => ({ phase:decision.phase,status:decision.status }))));
  if (!failures.length && !KEEP) {
    const cleanup = await page.evaluate(async id => (await db.from('btech_games').delete().eq('id',id)).error?.message || null,gameId);
    check('the passing disposable AI-5 match is removed',!cleanup,cleanup || gameCode);
  }
} catch (error) {
  failures.push(`fatal acceptance error — ${error.message}`);
  console.error(`FAIL  AI-5 live acceptance — ${error.message}`);
  if (!gameId) {
    const identity = await page.evaluate(() => ({ gameId:typeof currentGameId === 'undefined' ? null : currentGameId, gameCode:typeof currentGameCode === 'undefined' ? null : currentGameCode })).catch(() => ({}));
    gameId = identity.gameId || null;
    gameCode = identity.gameCode || null;
  }
} finally {
  console.log(`\nAI-5 LIVE ACCEPTANCE ${failures.length ? 'FAILED' : 'PASSED'}${gameCode ? ` — ${gameCode}` : ''}`);
  if (failures.length) console.log(`Failed disposable match retained${gameCode ? ` as ${gameCode}` : ''}.`);
  if (consoleErrors.length) console.log(`Console/page errors: ${consoleErrors.length}.\n${consoleErrors.slice(0,20).join('\n')}`);
  await browser.close();
}

if (failures.length) process.exitCode = 1;
