// ── HEAT MANAGEMENT PHASE ─────────────────────────────────
// Human matches resolve the complete heat ledger on Supabase. Local AI games
// retain the lightweight client path for test play.

let heatSinksPreviewRound = null;

function heatLedger(mech) {
  ensureMechCombatState(mech);
  const engineHeat = engineCriticalHeat(mech);
  const before = (mech.heat || 0) + engineHeat;
  const sinks = Math.max(0, (BT_UNITS[mech.unitId].heat_sink_capacity || BT_UNITS[mech.unitId].heat_sinks) - destroyedHeatSinkCapacity(mech));
  const dissipated = Math.min(before, sinks);
  return {
    starting: mech.roundStartingHeat || 0,
    movement: mech.movementHeat || 0,
    weapons: (mech.weaponHeat || 0) + (mech.externalHeat || 0),
    engineHeat,
    before,
    sinks,
    dissipated,
    after: Math.max(0, before - dissipated)
  };
}

async function resolveHeatForSeat(seat) {
  const units = mechInstances.filter(m => m.owner === seat && !m.destroyed && !m.hasManagedHeat);
  if (!units.length) return [];
  const messages = [];
  for (const mech of units) {
    const ledger = heatLedger(mech);
    mech.heatDissipated = ledger.dissipated;
    mech.heat = ledger.after;
    mech.externalHeat = 0;
    mech.hasManagedHeat = true;
    messages.push(`${mechLabel(mech)} heat: start ${ledger.starting} + move ${ledger.movement} + weapons ${ledger.weapons}${ledger.engineHeat ? ` + engine ${ledger.engineHeat}` : ''} = ${ledger.before}; dissipated ${ledger.dissipated}/${ledger.sinks}, ending ${ledger.after}.`);
  }
  await syncMechInstances();
  return messages;
}

async function confirmHeatManagement() {
  if (currentGameState.phase !== 'heat' || !isMyActiveTurn()) return;
  if (!vsAiMode) {
    const { data, error } = await db.rpc('resolve_heat_management', { p_game_id: currentGameId });
    if (error) { logEvent(`Server rejected Heat Management: ${error.message}`, 'error'); flashMoveWarning(error.message); return; }
    for (const outcome of data?.results || []) {
      const mech = mechInstances.find(candidate => candidate.instanceId === outcome.instance_id);
      const label = mechLabel(mech);
      logEvent(`${label} heat: ${outcome.before}; dissipated ${Math.min(outcome.before, outcome.sinks)}/${outcome.sinks}, ending ${outcome.after}.`, 'phase');
      if (outcome.automatic_restart) {
        logEvent(`${label} restarted automatically after cooling below Heat Level 14.`, 'phase');
      } else if (outcome.shutdown_target) {
        const roll = outcome.shutdown_roll;
        const detail = outcome.shutdown_target === 99
          ? ' automatically at Heat Level 30 or higher'
          : roll ? ` — override need ${outcome.shutdown_target}, rolled ${roll.die_a} + ${roll.die_b} = ${roll.total}`
            : ' — no conscious-pilot override was declared';
        logEvent(`${label} ${outcome.shutdown ? 'shut down' : 'avoided shutdown'}${detail}.`, 'roll');
      }
      if (outcome.ammo_target && outcome.ammo_roll) {
        const roll = outcome.ammo_roll;
        const explosion = outcome.ammo_explosion;
        logEvent(`${label} ${explosion ? `${explosion.type} ammunition exploded in ${hitLocationLabel(explosion.location)} for ${explosion.damage} internal damage` : 'avoided an ammunition explosion'} — safety need ${outcome.ammo_target}, rolled ${roll.die_a} + ${roll.die_b} = ${roll.total}.`, 'roll');
      }
      for (const check of outcome.pilot_checks || []) logEvent(`${label}${formatAuthoritativePilotCheck(check)}`, 'roll');
      if (outcome.pilot_recovery) {
        const recovery = outcome.pilot_recovery;
        logEvent(`${label} ${recovery.recovered ? 'regained consciousness' : 'remained unconscious'} — need ${recovery.target}, rolled ${recovery.die_a} + ${recovery.die_b} = ${recovery.total}.`, 'roll');
      }
    }
    await loadGameState();
    heatSinksPreviewRound = null;
    return;
  }
  const messages = await resolveHeatForSeat(mySeatNumber);
  renderHeatPanel();
  renderRoster();
  renderDetail();
  draw();
  updateAdvanceButtonState();
  messages.forEach(message => logEvent(message, 'phase'));
  heatSinksPreviewRound = null;
}

function previewHeatSinkDissipation() {
  if (currentGameState.phase !== 'heat' || !isMyActiveTurn()) return;
  heatSinksPreviewRound = currentGameState.round;
  renderHeatPanel();
  logEvent('Heat sinks applied: review each remaining Heat Level before resolving shutdown, ammunition, and pilot checks.', 'phase');
}

async function declareShutdownOverride(instanceId) {
  const mech = mechInstances.find(candidate => candidate.instanceId === instanceId);
  if (!mech || mech.owner !== mySeatNumber || currentGameState.phase !== 'heat' || !isMyActiveTurn()) return;
  const { data, error } = await db.rpc('declare_shutdown_override', { p_game_id: currentGameId, p_instance_id: instanceId });
  if (error) { flashMoveWarning(error.message); logEvent(`Server rejected the shutdown override: ${error.message}`, 'error'); return; }
  logEvent(`${mechLabel(mech)} declared a shutdown override. Heat sinks will apply first; the post-sink roll needs ${data?.target}.`, 'phase');
  await loadGameState();
}

async function resolveAIHeatManagement() {
  const messages = await resolveHeatForSeat(2);
  renderHeatPanel();
  renderRoster();
  renderDetail();
  draw();
  updateAdvanceButtonState();
  messages.forEach(message => logEvent(message.replace(' (AI)', ' (AI)'), 'phase'));
}

function renderHeatPanel() {
  const panel = document.getElementById('movement-panel');
  if (!panel || currentGameState.phase !== 'heat') return;
  panel.style.display = 'block';
  const activeSeat = getActivePlayerSeat();
  const isMine = activeSeat === mySeatNumber && isMyActiveTurn();
  const units = mechInstances.filter(m => m.owner === activeSeat && !m.destroyed);
  const pending = units.filter(m => !m.hasManagedHeat);
  const sinksPreviewed = heatSinksPreviewRound === currentGameState.round;
  const rows = units.map(mech => {
    const ledger = heatLedger(mech);
    const remainingHeat = sinksPreviewed ? ledger.after : ledger.before;
    const predictedShutdownTarget = remainingHeat >= 30 ? 99 : remainingHeat >= 26 ? 10 : remainingHeat >= 22 ? 8 : remainingHeat >= 18 ? 6 : remainingHeat >= 14 ? 4 : 0;
    const canOverride = sinksPreviewed && isMine && !mech.hasManagedHeat && !mech.shutdown && predictedShutdownTarget > 0 && predictedShutdownTarget < 99 && (!mech.pilot?.consciousness || mech.pilot.consciousness === 'conscious');
    const overrideStatus = predictedShutdownTarget === 99
      ? ' · automatic shutdown at 30+'
      : predictedShutdownTarget > 0
        ? mech.shutdownOverrideRequested ? ` · override declared for post-sink Heat Level (need ${predictedShutdownTarget})` : ` · post-sink shutdown target: ${predictedShutdownTarget}`
        : mech.shutdown ? ' · will restart automatically below Heat Level 14' : '';
    return `<div style="padding:7px 0;border-top:1px solid var(--panel-line);font-size:10px;line-height:1.55;">
      <div style="color:var(--paper);">${mechLabel(mech)}${mech.hasManagedHeat ? ' · resolved' : ''}</div>
      <div style="color:var(--phosphor-dim);">Start ${ledger.starting} + move ${ledger.movement} + weapons ${ledger.weapons}${ledger.engineHeat ? ` + engine ${ledger.engineHeat}` : ''} = ${ledger.before} heat</div>
      <div style="color:var(--amber);">Sinks ${ledger.sinks}: ${mech.hasManagedHeat ? `dissipated ${mech.heatDissipated}, ending ${mech.heat}` : sinksPreviewed ? `dissipates ${ledger.dissipated}, remaining Heat Level ${ledger.after}` : `will dissipate ${ledger.dissipated}`}${mech.shutdown && !mech.hasManagedHeat ? ' · SHUT DOWN' : ''}${sinksPreviewed ? overrideStatus : ''}</div>
      ${canOverride && !mech.shutdownOverrideRequested ? `<button onclick="declareShutdownOverride('${mech.instanceId}')" style="margin-top:5px;${MOVE_BTN_STYLE}">Declare Post-Sink Shutdown Override (need ${predictedShutdownTarget})</button>` : ''}
    </div>`;
  }).join('');
  panel.innerHTML = `
    <div class="panel-eyebrow">Heat Management</div>
    <div style="font-size:11px;color:var(--paper);margin-bottom:7px;">${isMine ? sinksPreviewed ? 'Heat sinks have been applied. Declare any shutdown overrides, then resolve checks from the remaining Heat Level.' : 'First apply heat sinks. No shutdown, ammunition, or pilot check is considered until the resulting Heat Level is shown.' : `Waiting for Player ${activeSeat} to resolve heat.`}</div>
    ${rows || '<div style="font-size:11px;color:var(--phosphor-dim);">No active units require heat management.</div>'}
    ${isMine && pending.length ? sinksPreviewed ? `<button onclick="confirmHeatManagement()" style="width:100%;margin-top:9px;${MOVE_BTN_STYLE}text-align:center;">Resolve Remaining Heat Checks</button>` : `<button onclick="previewHeatSinkDissipation()" style="width:100%;margin-top:9px;${MOVE_BTN_STYLE}text-align:center;">Apply Heat Sinks</button>` : ''}`;
}

function renderEndPanel() {
  const panel = document.getElementById('movement-panel');
  if (!panel || currentGameState.phase !== 'end') return;
  panel.style.display = 'block';
  if (currentGameState.match_result) {
    const result = currentGameState.match_result;
    panel.innerHTML = `
      <div class="panel-eyebrow">Match Complete</div>
      <div style="font:16px var(--display);letter-spacing:.06em;color:var(--amber);margin-bottom:7px;">${result.winner_seat == null ? 'DRAW' : `PLAYER ${result.winner_seat} VICTORY`}</div>
      <div style="font-size:11px;color:var(--paper);line-height:1.6;">All opposing 'Mechs have been destroyed. Return to the Dropship to review or leave the game.</div>`;
    return;
  }
  const units = mechInstances.filter(m => !m.destroyed);
  panel.innerHTML = `
    <div class="panel-eyebrow">End Phase</div>
    <div style="font-size:11px;color:var(--paper);line-height:1.6;">Heat is resolved for both players. Advancing will return every torso to its leg facing, retain any remaining heat, and begin the next round's Initiative Roll.</div>
    <div style="font-size:10px;color:var(--phosphor-dim);margin-top:8px;">${units.length} active 'Mech${units.length === 1 ? '' : 's'} · Round ${currentGameState.round} complete</div>`;
}
