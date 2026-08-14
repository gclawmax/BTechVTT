// ── PHYSICAL ATTACK PHASE ────────────────────────────────
// Basic punches and kicks: one confirmed melee choice per eligible 'Mech.
// Charge, DFA, limb loss, criticals, and advanced physical attack rules are
// intentionally deferred until their supporting rules and unit data exist.

let physicalAttackState = { attackerId: null, targetId: null, attackType: null };

function physicalAttackDamage(attacker, type) {
  const tonnage = BT_UNITS[attacker.unitId].tonnage;
  return Math.max(1, Math.floor(tonnage / (type === 'kick' ? 5 : 10)));
}

function evaluatePhysicalAttack(attacker, target, type) {
  if (!attacker || !target || attacker.destroyed || target.destroyed || attacker.owner === target.owner) {
    return { valid: false, reason: 'Choose a valid enemy target.' };
  }
  if (axialDistance(attacker.col, attacker.row, target.col, target.row) !== 1) {
    return { valid: false, reason: 'Physical attacks require an adjacent target.' };
  }
  if (!isInForwardArc(attacker.facing, weaponDirectionTo(attacker, target))) {
    return { valid: false, reason: 'Target is outside the forward physical attack arc.' };
  }
  const attackerMove = movementToHitModifier(attacker);
  const targetMove = targetMovementModifier(target);
  return {
    valid: true,
    damage: physicalAttackDamage(attacker, type),
    targetNumber: 5 + attackerMove + targetMove,
    breakdown: `Piloting 5 + move ${attackerMove} + target ${targetMove}`
  };
}

function selectPhysicalAttacker(instanceId) {
  const mech = mechInstances.find(m => m.instanceId === instanceId);
  if (!mech || mech.owner !== mySeatNumber || !isMyActiveTurn() || currentGameState.phase !== 'physical_attack' || mech.hasPhysicalAttacked) return;
  physicalAttackState = { attackerId: instanceId, targetId: null, attackType: null };
  selectedInstanceId = instanceId;
  logEvent(`${mechLabel(mech)} selected for physical attack declaration.`, 'system');
  renderRoster();
  renderDetail();
  renderPhysicalAttackPanel();
  draw();
}

function selectPhysicalTarget(instanceId) {
  physicalAttackState.targetId = instanceId;
  physicalAttackState.attackType = null;
  renderPhysicalAttackPanel();
}

function selectPhysicalAttackType(type) {
  physicalAttackState.attackType = type;
  renderPhysicalAttackPanel();
}

async function confirmPhysicalAttack() {
  // Match the panel's selection behaviour: roster/map selection is just as
  // valid as choosing the 'Mech from the physical-attack panel.
  const attacker = mechInstances.find(m => m.instanceId === physicalAttackState.attackerId) ||
    mechInstances.find(m => m.instanceId === selectedInstanceId);
  if (!attacker || attacker.owner !== mySeatNumber || !isMyActiveTurn() || currentGameState.phase !== 'physical_attack' || attacker.hasPhysicalAttacked) return;
  const target = mechInstances.find(m => m.instanceId === physicalAttackState.targetId);
  const type = physicalAttackState.attackType;
  let message;
  if (type && target) {
    const attack = evaluatePhysicalAttack(attacker, target, type);
    if (!attack.valid) return;
    const roll = roll2d6Detailed();
    const hit = attack.targetNumber <= 2 || (attack.targetNumber <= 12 && roll.total >= attack.targetNumber);
    if (hit) {
      const damage = applyWeaponDamage(target, attack.damage, 'front');
      message = `${mechLabel(attacker)} ${type === 'kick' ? 'kicked' : 'punched'} ${mechLabel(target)} — need ${attack.targetNumber} (${attack.breakdown}), rolled ${format2d6(roll)}: hit ${hitLocationLabel(damage.location)} for ${attack.damage} damage.${damage.critical ? ' Critical-hit check triggered.' : ''}${damage.destroyedLocations.length ? ` Destroyed: ${damage.destroyedLocations.map(hitLocationLabel).join(', ')}.` : ''}${damage.destroyed ? ' Target destroyed.' : ''}`;
    } else {
      message = `${mechLabel(attacker)} ${type === 'kick' ? 'kicked' : 'punched'} ${mechLabel(target)} — need ${attack.targetNumber} (${attack.breakdown}), rolled ${format2d6(roll)}: miss.`;
    }
  } else {
    message = `${mechLabel(attacker)} made no physical attack.`;
  }

  attacker.hasPhysicalAttacked = true;
  physicalAttackState = { attackerId: null, targetId: null, attackType: null };
  renderPhysicalAttackPanel();
  renderRoster();
  renderDetail();
  draw();
  updateAdvanceButtonState();
  // Give immediate feedback before the shared-state write has completed.
  // The detailed resolution is logged after the save so it remains in order
  // for the other player as well.
  logEvent(`${mechLabel(attacker)} physical attack submitted — saving outcome.`, 'attack');
  await syncMechInstances();
  logEvent(message, 'attack');
}

function renderPhysicalAttackPanel() {
  const panel = document.getElementById('movement-panel');
  if (!panel || currentGameState.phase !== 'physical_attack') return;
  panel.style.display = 'block';
  const activeSeat = getActivePlayerSeat();
  const isMine = activeSeat === mySeatNumber && isMyActiveTurn();
  const pending = mechInstances.filter(m => m.owner === activeSeat && !m.destroyed && !m.hasPhysicalAttacked);
  const attacker = mechInstances.find(m => m.instanceId === physicalAttackState.attackerId) || mechInstances.find(m => m.instanceId === selectedInstanceId);
  const target = mechInstances.find(m => m.instanceId === physicalAttackState.targetId);

  if (!isMine) {
    panel.innerHTML = `<div class="panel-eyebrow">Physical Attack</div><div style="font-size:11px;color:var(--phosphor-dim);">Waiting for Player ${activeSeat} to complete physical attacks.</div>`;
    return;
  }
  if (!attacker || attacker.owner !== activeSeat || attacker.hasPhysicalAttacked) {
    panel.innerHTML = pending.length
      ? `<div class="panel-eyebrow">Physical Attack</div><div style="font-size:11px;color:var(--paper);margin-bottom:8px;">Choose a 'Mech. ${pending.length} remain.</div><div style="display:flex;flex-direction:column;gap:6px;">${pending.map(m => `<button onclick="selectPhysicalAttacker('${m.instanceId}')" style="${MOVE_BTN_STYLE}text-align:center;">${mechLabel(m)}</button>`).join('')}</div>`
      : `<div class="panel-eyebrow">Physical Attack</div><div style="font-size:11px;color:var(--phosphor-dim);">All physical attacks complete. Advance to Heat Management.</div>`;
    return;
  }

  const enemies = mechInstances.filter(m => m.owner !== attacker.owner && !m.destroyed);
  const options = ['punch', 'kick'].map(type => {
    const evaluation = target ? evaluatePhysicalAttack(attacker, target, type) : null;
    const selected = physicalAttackState.attackType === type;
    const disabled = target && !evaluation.valid;
    return `<button onclick="selectPhysicalAttackType('${type}')" ${disabled ? 'disabled' : ''} style="flex:1;padding:8px 6px;border:1px solid ${selected ? 'var(--amber)' : 'var(--panel-line)'};background:${selected ? 'rgba(212,128,10,.18)' : 'transparent'};color:${disabled ? 'var(--phosphor-dim)' : 'var(--paper)'};font-family:var(--display);font-size:9px;text-transform:uppercase;cursor:${disabled ? 'not-allowed' : 'pointer'};">${type} · ${physicalAttackDamage(attacker, type)} dmg${evaluation?.valid ? ` · TN ${evaluation.targetNumber}` : ''}</button>`;
  }).join('');
  panel.innerHTML = `
    <div class="panel-eyebrow">Physical Attack — Declaration</div>
    <div style="font-size:11px;color:var(--paper);margin-bottom:8px;">${mechLabel(attacker)} · target must be adjacent and in the forward arc.</div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;">${enemies.map(enemy => `<button onclick="selectPhysicalTarget('${enemy.instanceId}')" style="padding:6px;border:1px solid ${target?.instanceId === enemy.instanceId ? 'var(--amber)' : 'var(--panel-line)'};background:transparent;color:var(--paper);font:9px var(--mono);cursor:pointer;">${mechLabel(enemy)}</button>`).join('')}</div>
    ${target ? `<div style="display:flex;gap:6px;">${options}</div>` : '<div style="font-size:11px;color:var(--phosphor-dim);">Select an enemy to see available attacks.</div>'}
    <button onclick="confirmPhysicalAttack()" style="width:100%;margin-top:9px;${MOVE_BTN_STYLE}text-align:center;">${physicalAttackState.attackType ? 'Confirm Physical Attack' : 'No Physical Attack / Complete'}</button>`;
}
