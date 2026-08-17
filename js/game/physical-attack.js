// ── PHYSICAL ATTACK PHASE ────────────────────────────────
// Standard biped punches and kicks. Human matches submit only declarations;
// Supabase validates, rolls and applies the simultaneous results.

let physicalAttackState = { attackerId: null, targetId: null, attackType: null, limbs: [] };

function physicalAttackDamage(attacker, type) {
  const tonnage = BT_UNITS[attacker.unitId].tonnage;
  return Math.max(1, Math.ceil(tonnage / (['kick', 'hatchet'].includes(type) ? 5 : 10)));
}

function physicalLimbLabel(limb) {
  return ({ la: 'Left Arm', ra: 'Right Arm', ll: 'Left Leg', rl: 'Right Leg' })[limb] || limb;
}

function physicalLimbCandidates(type) {
  if (type === 'punch') return ['la', 'ra'];
  if (type === 'hatchet') return ['ra'];
  return ['ll', 'rl'];
}

function physicalComponentState(mech, location, label) {
  const layout = BT_CRITICAL_LAYOUTS[mech.unitId]?.[location] || [];
  const indexes = layout.map((slot, index) => criticalSlotName(slot) === label ? index : -1).filter(index => index >= 0);
  return { exists: indexes.length > 0, damaged: indexes.some(index => (mech.criticalSlotDamage?.[location] || []).includes(index)) };
}

function evaluatePhysicalAttack(attacker, target, type, limb = physicalLimbCandidates(type)[0]) {
  if (!attacker || !target || attacker.destroyed || target.destroyed || attacker.shutdown || target.shutdown || (attacker.pilot?.consciousness && attacker.pilot.consciousness !== 'conscious') || attacker.owner === target.owner) {
    return { valid: false, reason: 'Choose a valid enemy target.' };
  }
  if (axialDistance(attacker.col, attacker.row, target.col, target.row) !== 1) {
    return { valid: false, reason: 'Physical attacks require an adjacent target.' };
  }
  const directionDifference = (weaponDirectionTo(attacker, target) - attacker.facing + 6) % 6;
  if (type === 'kick' && ![0, 1, 5].includes(directionDifference)) return { valid: false, reason: 'Kick target is outside the three forward hexes.' };
  if (['punch', 'hatchet'].includes(type) && directionDifference === 3) return { valid: false, reason: `${type === 'hatchet' ? 'Hatchet' : 'Punch'} target is in the rear arc.` };
  if (['punch', 'hatchet'].includes(type) && [1, 2].includes(directionDifference) && limb !== 'la') return { valid: false, reason: 'Only the left arm can reach this side.' };
  if (['punch', 'hatchet'].includes(type) && [4, 5].includes(directionDifference) && limb !== 'ra') return { valid: false, reason: 'Only the right arm can reach this side.' };
  if ((attacker.structure?.[limb] || 0) <= 0) return { valid: false, reason: `${physicalLimbLabel(limb)} is destroyed.` };
  let componentModifier = 0;
  let reductions = 0;
  if (['punch', 'hatchet'].includes(type)) {
    if (physicalComponentState(attacker, limb, 'Shoulder').damaged) return { valid: false, reason: 'Damaged shoulder prevents this punch.' };
    if (type === 'hatchet') {
      const hatchet = physicalComponentState(attacker, limb, 'Hatchet');
      if (!hatchet.exists) return { valid: false, reason: 'No functioning hatchet is mounted in this arm.' };
      if (hatchet.damaged) return { valid: false, reason: 'The hatchet is destroyed.' };
    }
    if (physicalComponentState(attacker, limb, 'Upper Arm Actuator').damaged) { componentModifier += 2; reductions++; }
    const lower = physicalComponentState(attacker, limb, 'Lower Arm Actuator');
    if (!lower.exists || lower.damaged) { componentModifier += 2; reductions++; }
    const hand = physicalComponentState(attacker, limb, 'Hand Actuator');
    if (!hand.exists || hand.damaged) componentModifier += 1;
  } else {
    if (['ll', 'rl'].some(side => physicalComponentState(attacker, side, 'Hip').damaged)) return { valid: false, reason: 'A damaged hip prevents kicking.' };
    for (const label of ['Upper Leg Actuator', 'Lower Leg Actuator']) {
      if (physicalComponentState(attacker, limb, label).damaged) { componentModifier += 2; reductions++; }
    }
    if (physicalComponentState(attacker, limb, 'Foot Actuator').damaged) componentModifier += 1;
  }
  const attackerMove = movementToHitModifier(attacker);
  const targetMove = targetMovementModifier(target);
  const targetTerrain = terrainAt(target.col, target.row) === 'heavy_woods' ? 2 : terrainAt(target.col, target.row) === 'light_woods' ? 1 : 0;
  let damage = physicalAttackDamage(attacker, type);
  while (reductions-- > 0) damage = Math.floor(damage / 2);
  return {
    valid: true,
    damage: Math.max(1, damage),
    targetNumber: 5 + attackerMove + targetMove + targetTerrain + componentModifier + (type === 'kick' ? -2 : 0),
    breakdown: `Piloting 5 + move ${attackerMove} + target ${targetMove} + terrain ${targetTerrain}${componentModifier ? ` + actuator ${componentModifier}` : ''}${type === 'kick' ? ' - kick 2' : ''}`
  };
}

function selectPhysicalAttacker(instanceId) {
  const mech = mechInstances.find(m => m.instanceId === instanceId);
  if (!mech || mech.owner !== mySeatNumber || !isMyActiveTurn() || currentGameState.phase !== 'physical_attack' || mech.hasPhysicalAttacked || mech.shutdown || (mech.pilot?.consciousness && mech.pilot.consciousness !== 'conscious')) return;
  physicalAttackState = { attackerId: instanceId, targetId: null, attackType: null, limbs: [] };
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
  physicalAttackState.limbs = [];
  renderPhysicalAttackPanel();
}

function selectPhysicalAttackType(type) {
  physicalAttackState.attackType = type;
  const attacker = mechInstances.find(m => m.instanceId === physicalAttackState.attackerId);
  const target = mechInstances.find(m => m.instanceId === physicalAttackState.targetId);
  physicalAttackState.limbs = physicalLimbCandidates(type).filter(limb => evaluatePhysicalAttack(attacker, target, type, limb).valid);
  if (['kick', 'hatchet'].includes(type)) physicalAttackState.limbs = physicalAttackState.limbs.slice(0, 1);
  renderPhysicalAttackPanel();
}

function togglePhysicalLimb(limb) {
  const selected = physicalAttackState.limbs || [];
  if (['kick', 'hatchet'].includes(physicalAttackState.attackType)) physicalAttackState.limbs = selected.includes(limb) ? [] : [limb];
  else physicalAttackState.limbs = selected.includes(limb) ? selected.filter(value => value !== limb) : [...selected, limb];
  renderPhysicalAttackPanel();
}

async function confirmAuthoritativePhysicalAttack(attacker, target, type) {
  const attackType = type || 'pass';
  const limbs = attackType === 'pass' ? [] : physicalAttackState.limbs;
  if (attackType !== 'pass' && !limbs.length) { flashMoveWarning(`Choose ${attackType === 'kick' ? 'a leg' : 'an arm'}.`); return; }
  logEvent(`${mechLabel(attacker)} Physical Attack declaration submitted to the server.`, 'attack');
  const { data, error } = await db.rpc('submit_simultaneous_physical_declaration', {
    p_game_id: currentGameId, p_attacker_instance_id: attacker.instanceId,
    p_target_instance_id: attackType === 'pass' ? null : target?.instanceId || null,
    p_attack_type: attackType, p_limbs: limbs
  });
  if (error) { logEvent(`Server rejected the Physical Attack declaration: ${error.message}`, 'error'); flashMoveWarning(error.message); return; }
  physicalAttackState = { attackerId: null, targetId: null, attackType: null, limbs: [] };
  selectedInstanceId = null;
  await loadGameState();
  renderPhysicalAttackPanel(); renderRoster(); renderDetail(); draw(); updateAdvanceButtonState();
  if (data?.status === 'resolved') await checkForMatchEnd();
}

async function confirmPhysicalAttack() {
  // Match the panel's selection behaviour: roster/map selection is just as
  // valid as choosing the 'Mech from the physical-attack panel.
  const attacker = mechInstances.find(m => m.instanceId === physicalAttackState.attackerId) ||
    mechInstances.find(m => m.instanceId === selectedInstanceId);
  if (!attacker || attacker.owner !== mySeatNumber || !isMyActiveTurn() || currentGameState.phase !== 'physical_attack' || attacker.hasPhysicalAttacked) return;
  const target = mechInstances.find(m => m.instanceId === physicalAttackState.targetId);
  const type = physicalAttackState.attackType;
  if (!vsAiMode) return confirmAuthoritativePhysicalAttack(attacker, target, type);
  let message;
  if (type && target) {
    const limb = physicalAttackState.limbs[0] || physicalLimbCandidates(type)[0];
    const attack = evaluatePhysicalAttack(attacker, target, type, limb);
    if (!attack.valid) return;
    const roll = roll2d6Detailed();
    const hit = attack.targetNumber <= 2 || (attack.targetNumber <= 12 && roll.total >= attack.targetNumber);
    if (hit) {
      const damage = applyWeaponDamage(target, attack.damage, 'front');
      message = `${mechLabel(attacker)} ${type === 'kick' ? 'kicked' : type === 'hatchet' ? 'struck with its hatchet' : 'punched'} ${mechLabel(target)} — need ${attack.targetNumber} (${attack.breakdown}), rolled ${format2d6(roll)}: hit ${hitLocationLabel(damage.location)} for ${attack.damage} damage.${damage.critical ? ' Critical-hit check triggered.' : ''}${damage.destroyedLocations.length ? ` Destroyed: ${damage.destroyedLocations.map(hitLocationLabel).join(', ')}.` : ''}${damage.destroyed ? ' Target destroyed.' : ''}`;
    } else {
      message = `${mechLabel(attacker)} ${type === 'kick' ? 'kicked' : type === 'hatchet' ? 'swung its hatchet at' : 'punched'} ${mechLabel(target)} — need ${attack.targetNumber} (${attack.breakdown}), rolled ${format2d6(roll)}: miss.`;
    }
  } else {
    message = `${mechLabel(attacker)} made no physical attack.`;
  }

  attacker.hasPhysicalAttacked = true;
  physicalAttackState = { attackerId: null, targetId: null, attackType: null, limbs: [] };
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
  await checkForMatchEnd();
  logEvent(message, 'attack');
}

function renderPhysicalAttackPanel() {
  const panel = document.getElementById('movement-panel');
  if (!panel || currentGameState.phase !== 'physical_attack') return;
  panel.style.display = 'block';
  const activeSeat = getActivePlayerSeat();
  const isMine = activeSeat === mySeatNumber && isMyActiveTurn();
  const pending = mechInstances.filter(m => m.owner === activeSeat && !m.destroyed && !m.shutdown && !m.hasPhysicalAttacked);
  const attacker = mechInstances.find(m => m.instanceId === physicalAttackState.attackerId) || mechInstances.find(m => m.instanceId === selectedInstanceId);
  const target = mechInstances.find(m => m.instanceId === physicalAttackState.targetId);

  if (!isMine) {
    panel.innerHTML = `<div class="panel-eyebrow">Physical Attack</div><div style="font-size:11px;color:var(--phosphor-dim);">Waiting for Player ${activeSeat} to complete physical attacks.</div>`;
    return;
  }
  if (!attacker || attacker.owner !== activeSeat || attacker.hasPhysicalAttacked) {
    const allowance = Math.min(currentActivationAllowance('physical_attack'), pending.length);
    panel.innerHTML = pending.length
      ? `<div class="panel-eyebrow">Physical Attack</div><div style="font-size:11px;color:var(--paper);margin-bottom:8px;">Act with ${allowance} 'Mech${allowance === 1 ? '' : 's'} in this activation. ${pending.length} total remain.</div><div style="display:flex;flex-direction:column;gap:6px;">${pending.map(m => `<button onclick="selectPhysicalAttacker('${m.instanceId}')" style="${MOVE_BTN_STYLE}text-align:center;">${mechLabel(m)}</button>`).join('')}</div>`
      : `<div class="panel-eyebrow">Physical Attack</div><div style="font-size:11px;color:var(--phosphor-dim);">All physical attacks complete. Advance to Heat Management.</div>`;
    return;
  }

  const enemies = mechInstances.filter(m => m.owner !== attacker.owner && !m.destroyed);
  const attackTypes = ['punch', 'kick'];
  if (physicalComponentState(attacker, 'ra', 'Hatchet').exists) attackTypes.push('hatchet');
  const options = attackTypes.map(type => {
    const evaluation = target ? physicalLimbCandidates(type).map(limb => evaluatePhysicalAttack(attacker, target, type, limb)).find(value => value.valid) : null;
    const selected = physicalAttackState.attackType === type;
    const disabled = target && !evaluation?.valid;
    return `<button onclick="selectPhysicalAttackType('${type}')" ${disabled ? 'disabled' : ''} style="flex:1;padding:8px 6px;border:1px solid ${selected ? 'var(--amber)' : 'var(--panel-line)'};background:${selected ? 'rgba(212,128,10,.18)' : 'transparent'};color:${disabled ? 'var(--phosphor-dim)' : 'var(--paper)'};font-family:var(--display);font-size:9px;text-transform:uppercase;cursor:${disabled ? 'not-allowed' : 'pointer'};">${type === 'hatchet' ? 'Hatchet' : type}${evaluation?.valid ? ` · TN ${evaluation.targetNumber}` : ''}</button>`;
  }).join('');
  const limbOptions = physicalAttackState.attackType ? physicalLimbCandidates(physicalAttackState.attackType).map(limb => {
    const evaluation = evaluatePhysicalAttack(attacker, target, physicalAttackState.attackType, limb);
    const selected = physicalAttackState.limbs.includes(limb);
    return `<button onclick="togglePhysicalLimb('${limb}')" ${evaluation.valid ? '' : 'disabled'} style="flex:1;padding:7px;border:1px solid ${selected ? 'var(--amber)' : 'var(--panel-line)'};background:${selected ? 'rgba(212,128,10,.18)' : 'transparent'};font:9px var(--mono);">${selected ? '✓ ' : ''}${physicalLimbLabel(limb)}${evaluation.valid ? ` · ${evaluation.damage} dmg · TN ${evaluation.targetNumber}` : ` · ${evaluation.reason}`}</button>`;
  }).join('') : '';
  panel.innerHTML = `
    <div class="panel-eyebrow">Physical Attack — Declaration</div>
    <div style="font-size:11px;color:var(--paper);margin-bottom:8px;">${mechLabel(attacker)} · punches and hatchets use the matching side arc; kicks use the three forward hexes.</div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;">${enemies.map(enemy => `<button onclick="selectPhysicalTarget('${enemy.instanceId}')" style="padding:6px;border:1px solid ${target?.instanceId === enemy.instanceId ? 'var(--amber)' : 'var(--panel-line)'};background:transparent;color:var(--paper);font:9px var(--mono);cursor:pointer;">${mechLabel(enemy)}</button>`).join('')}</div>
    ${target ? `<div style="display:flex;gap:6px;">${options}</div>${limbOptions ? `<div style="display:flex;gap:6px;margin-top:6px;">${limbOptions}</div>` : ''}` : '<div style="font-size:11px;color:var(--phosphor-dim);">Select an enemy to see available attacks.</div>'}
    <button onclick="confirmPhysicalAttack()" style="width:100%;margin-top:9px;${MOVE_BTN_STYLE}text-align:center;">${physicalAttackState.attackType ? 'Confirm Physical Attack Declaration' : 'No Physical Attack / Complete'}</button>`;
}

function authoritativePhysicalResultMessage(attacker, target, result) {
  const roll = result.to_hit || {};
  const rolled = `${roll.die_a} + ${roll.die_b} = ${roll.total}`;
  const action = result.attack_type === 'kick' ? 'kicked' : result.attack_type === 'hatchet' ? 'struck with its hatchet' : `punched with ${physicalLimbLabel(result.limb)}`;
  if (!result.hit) return `${mechLabel(attacker)} ${action} at ${mechLabel(target)} — need ${roll.target}, rolled ${rolled}: miss.`;
  return `${mechLabel(attacker)} ${action} ${mechLabel(target)} — need ${roll.target}, rolled ${rolled}: hit ${hitLocationLabel(result.location)} for ${result.damage} damage.${formatAuthoritativeCriticals(result.critical_checks)}${formatAuthoritativePilotCheck(result.pilot_check)}`;
}

function authoritativePilotingResultMessage(check) {
  const mech = mechInstances.find(candidate => candidate.instanceId === check.instance_id);
  const label = mechLabel(mech);
  const roll = check.to_hit || {};
  const reasons = (check.reasons || []).join(' and ');
  const gyro = roll.gyro_modifier ? ` (including +${roll.gyro_modifier} gyro damage)` : '';
  if (check.passed) return `${label} passed its Piloting Skill Roll for ${reasons} — need ${roll.target}${gyro}, rolled ${roll.die_a} + ${roll.die_b} = ${roll.total}.`;
  const groups = (check.fall_groups || []).map(group => `${hitLocationLabel(group.location)} ${group.damage}`).join(', ');
  return `${label} failed its Piloting Skill Roll for ${reasons} — need ${roll.target}${gyro}, rolled ${roll.die_a} + ${roll.die_b} = ${roll.total}; fell ${check.fall_angle} for ${check.fall_damage} damage${groups ? ` (${groups})` : ''}.`;
}

async function loadResolvedPhysicalEvents() {
  if (!currentGameId || vsAiMode) return;
  const { data, error } = await db.from('btech_combat_events').select('id,round,phase,sequence,attacker_instance_id,target_instance_id,resolution,resolved_at')
    .eq('game_id', currentGameId).eq('phase', 'physical_attack').eq('status', 'resolved').order('round').order('sequence').limit(GAME_LOG_MAX);
  if (error) { console.warn('[BT-LOG] failed to load resolved physical events:', error); return; }
  const entries = [];
  for (const event of data || []) {
    if (event.resolution?.state_version !== 'authoritative-physical-01') continue;
    const attacker = mechInstances.find(mech => mech.instanceId === event.attacker_instance_id);
    const target = mechInstances.find(mech => mech.instanceId === event.target_instance_id);
    const resolvedAt = Date.parse(event.resolved_at || '') || Date.now();
    const results = event.resolution?.results || [];
    if (!results.length) entries.push({ id:`physical-${event.id}-pass`,ts:resolvedAt+event.sequence,time:new Date(resolvedAt).toTimeString().slice(0,8),round:event.round,phase:event.phase,cat:'attack',msg:`${mechLabel(attacker)} declared no physical attack.` });
    results.forEach((result,index) => entries.push({ id:`physical-${event.id}-${index}`,ts:resolvedAt+event.sequence*100+index,time:new Date(resolvedAt).toTimeString().slice(0,8),round:event.round,phase:event.phase,cat:'attack',msg:authoritativePhysicalResultMessage(attacker,target,result) }));
    (event.resolution?.piloting_checks || []).forEach((check,index) => entries.push({ id:`physical-psr-${event.id}-${index}`,ts:resolvedAt+event.sequence*100+results.length+index+1,time:new Date(resolvedAt).toTimeString().slice(0,8),round:event.round,phase:event.phase,cat:'roll',msg:authoritativePilotingResultMessage(check) }));
  }
  mergeRemoteLog(entries);
}
