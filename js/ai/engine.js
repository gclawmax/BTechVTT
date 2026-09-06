// ── AI DECISION ENGINE & AUDIT FOUNDATION ─────────────────
// Pure, deterministic planning helpers. The phase-specific opponent code may
// improve over time without changing this replay/audit contract.

var BT_AI_ENGINE_VERSION = 'ai-2.0';
var pendingAIDecisionEnvelope = null;
var aiDecisionHistory = [];

function stableAIValue(value) {
  if (Array.isArray(value)) return value.map(stableAIValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableAIValue(value[key])]));
  }
  return value;
}

function stableAIStringify(value) {
  return JSON.stringify(stableAIValue(value));
}

function hashAIValue(value) {
  const source = typeof value === 'string' ? value : stableAIStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function createSeededAIRandom(seed) {
  let state = Number.parseInt(hashAIValue(String(seed)), 16) >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function aiUnitSnapshot(mech) {
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  return {
    instanceId: mech.instanceId,
    unitId: mech.unitId,
    owner: Number(mech.owner),
    col: Number(mech.col),
    row: Number(mech.row),
    facing: Number(mech.facing),
    torsoFacing: Number(mech.torsoFacing ?? mech.facing),
    movementMode: mech.movementMode || null,
    hexesMoved: Number(mech.hexesMoved || 0),
    heat: Number(mech.heat || 0),
    roundStartingHeat: Number(mech.roundStartingHeat || 0),
    movementHeat: Number(mech.movementHeat || 0),
    weaponHeat: Number(mech.weaponHeat || 0),
    externalHeat: Number(mech.externalHeat || 0),
    prone: Boolean(mech.prone),
    shutdown: Boolean(mech.shutdown),
    destroyed: Boolean(mech.destroyed),
    hasMoved: Boolean(mech.hasMoved),
    hasReacted: Boolean(mech.hasReacted),
    hasFired: Boolean(mech.hasFired),
    hasPhysicalAttacked: Boolean(mech.hasPhysicalAttacked),
    hasManagedHeat: Boolean(mech.hasManagedHeat),
    armor: copy(mech.armor || {}),
    structure: copy(mech.structure || {}),
    ammoBins: copy(mech.ammoBins || []),
    weaponJams: copy(mech.weaponJams || []),
    destroyedMounts: copy(mech.destroyedMounts || []),
    criticalSlotDamage: copy(mech.criticalSlotDamage || {}),
    pilot: copy(mech.pilot || {}),
    weaponPhaseStart: copy(mech.weaponPhaseStart || null),
    proneSupportArm: mech.proneSupportArm || null,
    taggedRound: Number(mech.taggedRound || 0),
    narcPod: copy(mech.narcPod || null),
    signatureModes: copy(mech.signatureModes || {}),
    c3Network: copy(mech.c3Network || null)
  };
}

function buildAIBattlefieldSnapshot(gameState = {}, units = null) {
  const liveUnits = units || (typeof mechInstances !== 'undefined' ? mechInstances : []);
  const matchState = gameState && typeof gameState === 'object' ? gameState : {};
  const phaseState = typeof currentGameState !== 'undefined' ? currentGameState : {};
  const matchConfig = typeof currentMatchConfig !== 'undefined' ? currentMatchConfig : {};
  return stableAIValue({
    round: Number(phaseState.round ?? matchState.round ?? 1),
    phase: phaseState.phase || matchState.phase || 'initiative',
    activePlayerId: phaseState.active_player_id || matchState.active_player_player_id || null,
    mapId: matchState.map_id || matchConfig.map_id || null,
    ruleset: matchState.ruleset || matchConfig.ruleset || 'advanced_3060',
    catalogueVersion: matchState.catalogue_version || (typeof activeCatalogueVersion !== 'undefined' ? activeCatalogueVersion : null),
    victoryMode: matchState.victory_mode || matchConfig.victory_mode || 'annihilation',
    objectiveHexes: matchState.objective_hexes || matchConfig.objective_hexes || [],
    minefields: matchState.minefields || matchConfig.minefields || [],
    terrainOverrides: matchState.terrain_overrides || matchConfig.terrain_overrides || {},
    elevationOverrides: matchState.elevation_overrides || matchConfig.elevation_overrides || {},
    units: liveUnits.map(aiUnitSnapshot).sort((a, b) => String(a.instanceId).localeCompare(String(b.instanceId)))
  });
}

function createAIPlanningContext(difficulty, gameState = {}, units = null) {
  const snapshot = buildAIBattlefieldSnapshot(gameState, units);
  const snapshotHash = hashAIValue(snapshot);
  const matchId = typeof currentGameId !== 'undefined' && currentGameId ? currentGameId : 'local-match';
  const rootSeed = gameState.ai_seed || `${matchId}:${snapshot.round}`;
  const seed = `${rootSeed}:${snapshot.round}:${snapshot.phase}:${snapshotHash}`;
  return {
    engineVersion: BT_AI_ENGINE_VERSION,
    difficulty: difficulty || 'beginner',
    snapshot,
    snapshotHash,
    seed,
    decisionId: `${snapshot.round}-${snapshot.phase}-${snapshotHash}`,
    random: createSeededAIRandom(seed)
  };
}

const AI_ACTIONS_BY_PHASE = Object.freeze({
  movement: new Set(['move', 'complete_movement']),
  reaction: new Set(['torso_twist', 'complete_reaction']),
  weapon_attack: new Set(['attack', 'no_fire']),
  physical_attack: new Set(['physical_attack', 'no_physical_attack']),
  heat: new Set(['manage_heat'])
});

function validateAIActionContract(action, phase) {
  if (!action || typeof action !== 'object') return { valid: false, reason: 'AI action must be an object.' };
  if (!AI_ACTIONS_BY_PHASE[phase]?.has(action.type)) return { valid: false, reason: `${action.type || 'unknown'} is not legal during ${phase}.` };
  if (action.type !== 'manage_heat' && !action.instanceId) return { valid: false, reason: `${action.type} requires an acting BattleMech.` };
  if (['attack', 'physical_attack'].includes(action.type) && !action.targetInstanceId) return { valid: false, reason: `${action.type} requires a target.` };
  if (action.type === 'attack' && (!Array.isArray(action.allocations) || !action.allocations.length)) return { valid: false, reason: 'Weapon attack requires a complete allocation.' };
  if (action.type === 'attack' && action.allocations.some(allocation => !allocation?.target_instance_id || !Array.isArray(allocation.weapon_mounts) || !allocation.weapon_mounts.length)) {
    return { valid: false, reason: 'Every weapon allocation requires a target and at least one mount.' };
  }
  return { valid: true, reason: '' };
}

function publicAIAction(action) {
  return Object.fromEntries([
    'type', 'instanceId', 'targetInstanceId', 'weaponKey', 'weaponLocation',
    'weaponCount', 'allocations', 'weaponHeat', 'expectedDamage', 'attackType',
    'facing', 'useMASC', 'reason', '_debug'
  ].filter(key => action[key] !== undefined).map(key => [key, action[key]]));
}

function registerAIPlan(context, actions) {
  const envelope = {
    decision_id: context.decisionId,
    engine_version: context.engineVersion,
    difficulty: context.difficulty,
    round: context.snapshot.round,
    phase: context.snapshot.phase,
    seed: context.seed,
    snapshot_hash: context.snapshotHash,
    status: 'planned',
    actions: actions.map(publicAIAction),
    outcomes: []
  };
  pendingAIDecisionEnvelope = envelope;
  aiDecisionHistory = [...aiDecisionHistory.filter(item => item.decision_id !== envelope.decision_id), envelope].slice(-50);
  console.info('[BT-AI]', stableAIStringify(envelope));
  return envelope;
}

function recordAIActionOutcome(action, status, detail = '') {
  if (!pendingAIDecisionEnvelope) return;
  pendingAIDecisionEnvelope.outcomes.push({ type: action.type, instanceId: action.instanceId || null, status, detail: String(detail || '') });
}

function completeAIDecision(status = 'completed') {
  if (!pendingAIDecisionEnvelope) return;
  pendingAIDecisionEnvelope.status = status;
}

function getAIDecisionForPersistence() {
  if (!pendingAIDecisionEnvelope) return null;
  if (typeof currentGameState !== 'undefined' &&
      (Number(pendingAIDecisionEnvelope.round) !== Number(currentGameState.round) || pendingAIDecisionEnvelope.phase !== currentGameState.phase)) return null;
  if (typeof getActivePlayerRecord === 'function' && !getActivePlayerRecord()?.is_ai) return null;
  return JSON.parse(JSON.stringify(pendingAIDecisionEnvelope));
}

function restoreAIDecisionHistory(saved) {
  if (!Array.isArray(saved)) return;
  aiDecisionHistory = saved.filter(item => item && typeof item === 'object').slice(-50);
}
