// ── HEAT MANAGEMENT PHASE ─────────────────────────────────
// Human matches resolve the complete heat ledger on Supabase. Local AI games
// retain the lightweight client path for test play.

function heatLedger(mech) {
  ensureMechCombatState(mech);
  const engineHeat = engineCriticalHeat(mech);
  const before = (mech.heat || 0) + engineHeat;
  const sinks = Math.max(0, BT_UNITS[mech.unitId].heat_sinks - destroyedHeatSinkCapacity(mech));
  const dissipated = Math.min(before, sinks);
  return {
    starting: mech.roundStartingHeat || 0,
    movement: mech.movementHeat || 0,
    weapons: mech.weaponHeat || 0,
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
      if (outcome.shutdown_target) {
        const roll = outcome.shutdown_roll;
        logEvent(`${label} ${outcome.shutdown ? 'shut down' : 'avoided shutdown'}${roll ? ` — need ${outcome.shutdown_target}, rolled ${roll.die_a} + ${roll.die_b} = ${roll.total}` : ' automatically at 30+ heat'}.`, 'roll');
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
    return;
  }
  const messages = await resolveHeatForSeat(mySeatNumber);
  renderHeatPanel();
  renderRoster();
  renderDetail();
  draw();
  updateAdvanceButtonState();
  messages.forEach(message => logEvent(message, 'phase'));
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
  const rows = units.map(mech => {
    const ledger = heatLedger(mech);
    return `<div style="padding:7px 0;border-top:1px solid var(--panel-line);font-size:10px;line-height:1.55;">
      <div style="color:var(--paper);">${mechLabel(mech)}${mech.hasManagedHeat ? ' · resolved' : ''}</div>
      <div style="color:var(--phosphor-dim);">Start ${ledger.starting} + move ${ledger.movement} + weapons ${ledger.weapons}${ledger.engineHeat ? ` + engine ${ledger.engineHeat}` : ''} = ${ledger.before} heat</div>
      <div style="color:var(--amber);">Sinks ${ledger.sinks}: ${mech.hasManagedHeat ? `dissipated ${mech.heatDissipated}, ending ${mech.heat}` : `will dissipate ${ledger.dissipated}, ending ${ledger.after}`}${mech.shutdown ? ' · SHUT DOWN' : ''}</div>
    </div>`;
  }).join('');
  panel.innerHTML = `
    <div class="panel-eyebrow">Heat Management</div>
    <div style="font-size:11px;color:var(--paper);margin-bottom:7px;">${isMine ? 'Review the round heat ledger, then apply heat sinks.' : `Waiting for Player ${activeSeat} to resolve heat.`}</div>
    ${rows || '<div style="font-size:11px;color:var(--phosphor-dim);">No active units require heat management.</div>'}
    ${isMine && pending.length ? `<button onclick="confirmHeatManagement()" style="width:100%;margin-top:9px;${MOVE_BTN_STYLE}text-align:center;">Apply Heat Sinks / Complete</button>` : ''}`;
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
