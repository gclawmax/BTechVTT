// ── HEAT MANAGEMENT PHASE ─────────────────────────────────
// Each player confirms heat dissipation for all their 'Mechs. Threshold
// effects, shutdowns, ammunition explosions, and pilot checks remain a later
// rules milestone; this phase makes the per-round heat ledger durable first.

function heatLedger(mech) {
  ensureMechCombatState(mech);
  const before = mech.heat || 0;
  const sinks = BT_UNITS[mech.unitId].heat_sinks;
  const dissipated = Math.min(before, sinks);
  return {
    starting: mech.roundStartingHeat || 0,
    movement: mech.movementHeat || 0,
    weapons: mech.weaponHeat || 0,
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
    messages.push(`${mechLabel(mech)} heat: start ${ledger.starting} + move ${ledger.movement} + weapons ${ledger.weapons} = ${ledger.before}; dissipated ${ledger.dissipated}/${ledger.sinks}, ending ${ledger.after}.`);
  }
  await syncMechInstances();
  return messages;
}

async function confirmHeatManagement() {
  if (currentGameState.phase !== 'heat' || !isMyActiveTurn()) return;
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
      <div style="color:var(--phosphor-dim);">Start ${ledger.starting} + move ${ledger.movement} + weapons ${ledger.weapons} = ${ledger.before} heat</div>
      <div style="color:var(--amber);">Sinks ${ledger.sinks}: ${mech.hasManagedHeat ? `dissipated ${mech.heatDissipated}, ending ${mech.heat}` : `will dissipate ${ledger.dissipated}, ending ${ledger.after}`}</div>
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
  const units = mechInstances.filter(m => !m.destroyed);
  panel.innerHTML = `
    <div class="panel-eyebrow">End Phase</div>
    <div style="font-size:11px;color:var(--paper);line-height:1.6;">Heat is resolved for both players. Advancing will return every torso to its leg facing, retain any remaining heat, and begin the next round's Initiative Roll.</div>
    <div style="font-size:10px;color:var(--phosphor-dim);margin-top:8px;">${units.length} active 'Mech${units.length === 1 ? '' : 's'} · Round ${currentGameState.round} complete</div>`;
}
