// ── REACTION PHASE ───────────────────────────────────────
function resetReactionState() {
  mechInstances.forEach(m => {
    m.hasReacted = false;
    if (m.torsoFacing == null) m.torsoFacing = m.facing;
  });
  syncMechInstances();
}

async function completeReaction(instanceId) {
  const mech = mechInstances.find(m => m.instanceId === instanceId);
  if (!mech || mech.owner !== mySeatNumber || !isMyActiveTurn() || currentGameState.phase !== 'reaction') return;
  const twisted = (mech.torsoFacing == null ? mech.facing : mech.torsoFacing) !== mech.facing;
  if (!vsAiMode) {
    const torsoFacing = mech.torsoFacing == null ? mech.facing : mech.torsoFacing;
    const { error } = await db.rpc('submit_torso_twist_reaction', {
      p_game_id: currentGameId,
      p_instance_id: mech.instanceId,
      p_torso_facing: torsoFacing
    });
    if (error) {
      flashMoveWarning(error.message);
      logEvent(`Server rejected the Reaction: ${error.message}`, 'error');
      return;
    }
    await loadGameState();
    logEvent(`${mechLabel(mech)} ${twisted ? 'confirmed torso twist and completed' : 'completed'} its Reaction.`, 'phase');
    return;
  }
  mech.hasReacted = true;
  renderReactionPanel();
  updateAdvanceButtonState();
  await syncMechInstances();
  logEvent(`${mechLabel(mech)} ${twisted ? 'confirmed torso twist and completed' : 'completed'} its Reaction.`, 'phase');
}

function torsoTwist(instanceId, direction) {
  const mech = mechInstances.find(m => m.instanceId === instanceId);
  if (!mech || mech.owner !== mySeatNumber || !isMyActiveTurn() || currentGameState.phase !== 'reaction' || mech.hasReacted) return;

  // A 'Mech may twist its torso one hexside during Reaction, then must
  // explicitly complete the Reaction before the phase can move on.
  const current = mech.torsoFacing == null ? mech.facing : mech.torsoFacing;
  if (current !== mech.facing) return;
  // Direction indices increase counter-clockwise on the rendered board.
  const delta = direction === 'left' ? 1 : -1;
  mech.torsoFacing = (current + delta + 6) % 6;

  renderReactionPanel();
  renderDetail();
  draw();
}

function undoTorsoTwist(instanceId) {
  const mech = mechInstances.find(m => m.instanceId === instanceId);
  if (!mech || mech.owner !== mySeatNumber || !isMyActiveTurn() || currentGameState.phase !== 'reaction' || mech.hasReacted) return;

  mech.torsoFacing = mech.facing;
  renderReactionPanel();
  renderDetail();
  draw();
}

function renderReactionPanel() {
  const panel = document.getElementById('movement-panel');
  if (!panel) return;

  if (currentGameState.phase !== 'reaction') return;
  panel.style.display = 'block';

  const mech = mechInstances.find(m => m.instanceId === selectedInstanceId);
  const activeSeat = getActivePlayerSeat();
  const activePlayerOwnsTurn = activeSeat === mySeatNumber && isMyActiveTurn();
  const pending = mechInstances.filter(m => m.owner === activeSeat && !m.destroyed && !m.hasReacted && !m.shutdown && (!m.pilot?.consciousness || m.pilot.consciousness === 'conscious'));

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
  const torsoFacing = mech.torsoFacing == null ? mech.facing : mech.torsoFacing;
  const torso = HEX_DIR_LABELS[torsoFacing];
  const hasTwisted = torsoFacing !== mech.facing;
  panel.innerHTML = `
    <div class="panel-eyebrow">Reaction — Torso Twist</div>
    <div style="font-size:11px;color:var(--paper);line-height:1.6;margin-bottom:8px;">
      ${mechLabel(mech)} · Legs: ${HEX_DIR_LABELS[mech.facing]} · Torso: ${torso}
    </div>
    ${mech.hasReacted
      ? `<div style="font-size:11px;color:var(--phosphor-dim);">Reaction complete.</div>`
      : isMine
        ? `${hasTwisted
            ? `<div style="font-size:11px;color:var(--amber);margin-bottom:6px;">Torso twist selected. Confirm it to keep it through the End Phase.</div>
               <div style="display:flex;gap:6px;margin-bottom:6px;">
                 <button onclick="undoTorsoTwist('${mech.instanceId}')" style="flex:1;padding:8px 6px;border:1px solid var(--panel-line);background:transparent;color:var(--phosphor);font-family:var(--display);font-size:9px;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;border-radius:2px;">Undo Twist</button>
               </div>`
            : `<div style="display:flex;gap:6px;margin-bottom:6px;">
             <button onclick="torsoTwist('${mech.instanceId}','left')" style="flex:1;padding:8px 6px;border:1px solid var(--panel-line);background:transparent;color:var(--phosphor);font-family:var(--display);font-size:9px;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;border-radius:2px;">↶ Twist Left</button>
             <button onclick="torsoTwist('${mech.instanceId}','right')" style="flex:1;padding:8px 6px;border:1px solid var(--panel-line);background:transparent;color:var(--phosphor);font-family:var(--display);font-size:9px;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;border-radius:2px;">↷ Twist Right</button>
           </div>`}
           <button onclick="completeReaction('${mech.instanceId}')" style="width:100%;${MOVE_BTN_STYLE}text-align:center;">${hasTwisted ? 'Confirm Twist / Complete Reaction' : 'No Twist / Complete Reaction'}</button>`
        : `<div style="font-size:11px;color:var(--phosphor-dim);">Waiting on the active player.</div>`}
  `;
}
