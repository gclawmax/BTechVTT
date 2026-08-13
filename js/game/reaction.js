// ── REACTION PHASE ───────────────────────────────────────
function resetReactionState() {
  mechInstances.forEach(m => {
    m.hasReacted = false;
    if (m.torsoFacing == null) m.torsoFacing = m.facing;
  });
  syncMechInstances();
}

function completeReaction(instanceId) {
  const mech = mechInstances.find(m => m.instanceId === instanceId);
  if (!mech || mech.owner !== mySeatNumber || !isMyActiveTurn() || currentGameState.phase !== 'reaction') return;
  mech.hasReacted = true;
  syncMechInstances();
  renderReactionPanel();
  updateAdvanceButtonState();
  logEvent(`${mechLabel(mech)} completed its Reaction.`, 'phase');
}

function torsoTwist(instanceId, direction) {
  const mech = mechInstances.find(m => m.instanceId === instanceId);
  if (!mech || mech.owner !== mySeatNumber || !isMyActiveTurn() || currentGameState.phase !== 'reaction' || mech.hasReacted) return;

  // First implementation: a single hexside left/right torso twist.
  // Exact limits beyond this are intentionally kept out of this phase until the
  // applicable rules are added to the VTT rules set.
  const current = mech.torsoFacing == null ? mech.facing : mech.torsoFacing;
  // Direction indices increase counter-clockwise on the rendered board.
  const delta = direction === 'left' ? 1 : -1;
  mech.torsoFacing = (current + delta + 6) % 6;
  mech.hasReacted = true;

  syncMechInstances();
  renderReactionPanel();
  renderDetail();
  draw();
  updateAdvanceButtonState();
  logEvent(`${mechLabel(mech)} twisted torso ${direction}.`, 'phase');
}

function renderReactionPanel() {
  const panel = document.getElementById('movement-panel');
  if (!panel) return;

  if (currentGameState.phase !== 'reaction') return;
  panel.style.display = 'block';

  const mech = mechInstances.find(m => m.instanceId === selectedInstanceId);
  const activeSeat = getActivePlayerSeat();
  const activePlayerOwnsTurn = activeSeat === mySeatNumber && isMyActiveTurn();
  const pending = mechInstances.filter(m => m.owner === activeSeat && !m.destroyed && !m.hasReacted);

  if (!mech || mech.owner !== activeSeat) {
    panel.innerHTML = `
      <div class="panel-eyebrow">Reaction Phase</div>
      <div style="font-size:11px;color:var(--paper);line-height:1.6;">
        ${pending.length
          ? activePlayerOwnsTurn
            ? `Choose a 'Mech to set its torso facing. ${pending.length} remain.`
            : `Waiting for Player ${activeSeat} to complete ${pending.length} reaction${pending.length === 1 ? '' : 's'}.`
          : 'All reactions complete.'}
      </div>
      ${activePlayerOwnsTurn && pending.length
        ? `<div style="display:flex;flex-direction:column;gap:6px;margin-top:10px;">
            ${pending.map(unit => `<button onclick="selectInstance('${unit.instanceId}')" style="${MOVE_BTN_STYLE}text-align:center;">${mechLabel(unit)}</button>`).join('')}
           </div>`
        : ''}`;
    return;
  }

  const isMine = mech.owner === mySeatNumber && isMyActiveTurn();
  const torso = HEX_DIR_LABELS[mech.torsoFacing == null ? mech.facing : mech.torsoFacing];
  panel.innerHTML = `
    <div class="panel-eyebrow">Reaction — Torso Twist</div>
    <div style="font-size:11px;color:var(--paper);line-height:1.6;margin-bottom:8px;">
      ${mechLabel(mech)} · Legs: ${HEX_DIR_LABELS[mech.facing]} · Torso: ${torso}
    </div>
    ${mech.hasReacted
      ? `<div style="font-size:11px;color:var(--phosphor-dim);">Reaction complete.</div>`
      : isMine
        ? `<div style="display:flex;gap:6px;margin-bottom:6px;">
             <button onclick="torsoTwist('${mech.instanceId}','left')" style="flex:1;padding:8px 6px;border:1px solid var(--panel-line);background:transparent;color:var(--phosphor);font-family:var(--display);font-size:9px;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;border-radius:2px;">↶ Twist Left</button>
             <button onclick="torsoTwist('${mech.instanceId}','right')" style="flex:1;padding:8px 6px;border:1px solid var(--panel-line);background:transparent;color:var(--phosphor);font-family:var(--display);font-size:9px;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;border-radius:2px;">↷ Twist Right</button>
           </div>
           <button onclick="completeReaction('${mech.instanceId}')" style="width:100%;${MOVE_BTN_STYLE}text-align:center;">No Twist / Complete Reaction</button>`
        : `<div style="font-size:11px;color:var(--phosphor-dim);">Waiting on the active player.</div>`}
  `;
}
