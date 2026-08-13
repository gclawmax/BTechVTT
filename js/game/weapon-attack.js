// ── WEAPON ATTACK PHASE ──────────────────────────────────
// This first pass implements player declarations and resolution for the
// standard weapons in BT_WEAPONS. Terrain, ammunition, critical hits, and
// damage transfer remain later rules milestones.

let weaponAttackState = { attackerId: null, targetId: null, weaponKeys: [] };

function weaponDirectionTo(attacker, target) {
  let bestDirection = 0;
  let bestDistance = Infinity;
  for (let direction = 0; direction < 6; direction++) {
    const neighbor = hexNeighbor(attacker.col, attacker.row, direction);
    const distance = axialDistance(neighbor.col, neighbor.row, target.col, target.row);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestDirection = direction;
    }
  }
  return bestDirection;
}

function isInForwardArc(facing, targetDirection) {
  const difference = (targetDirection - facing + 6) % 6;
  return difference === 0 || difference === 1 || difference === 5;
}

function movementToHitModifier(mech) {
  return ({ stand: 0, walk: 1, run: 2, jump: 3 })[mech.movementMode] || 0;
}

function targetMovementModifier(mech) {
  const moved = mech.hexesMoved || 0;
  let modifier = moved >= 10 ? 4 : moved >= 7 ? 3 : moved >= 5 ? 2 : moved >= 3 ? 1 : 0;
  if (mech.movementMode === 'jump') modifier += 1;
  return modifier;
}

function weaponRangeModifier(weapon, distance) {
  if (distance <= weapon.range[0]) return { label: 'Short', modifier: 0 };
  if (distance <= weapon.range[1]) return { label: 'Medium', modifier: 2 };
  if (distance <= weapon.range[2]) return { label: 'Long', modifier: 4 };
  return null;
}

function weaponArcFacing(weaponEntry, attacker) {
  return /torso|head/i.test(weaponEntry.location)
    ? (attacker.torsoFacing == null ? attacker.facing : attacker.torsoFacing)
    : attacker.facing;
}

function evaluateWeaponAttack(attacker, target, weaponEntry) {
  const weapon = BT_WEAPONS[weaponEntry.key];
  if (!weapon || attacker.destroyed || target.destroyed || attacker.owner === target.owner) {
    return { valid: false, reason: 'Choose a valid enemy target and supported weapon.' };
  }
  const distance = axialDistance(attacker.col, attacker.row, target.col, target.row);
  const range = weaponRangeModifier(weapon, distance);
  if (!range) return { valid: false, reason: `${weapon.name} is beyond long range (${distance} hexes).` };
  const facing = weaponArcFacing(weaponEntry, attacker);
  if (!isInForwardArc(facing, weaponDirectionTo(attacker, target))) {
    return { valid: false, reason: `${weapon.name} target is outside its firing arc.` };
  }
  const attackerMove = movementToHitModifier(attacker);
  const targetMove = targetMovementModifier(target);
  return {
    valid: true,
    weapon,
    distance,
    range,
    targetNumber: 4 + attackerMove + targetMove + range.modifier,
    breakdown: `Gunnery 4 + move ${attackerMove} + target ${targetMove} + ${range.label.toLowerCase()} ${range.modifier}`
  };
}

function selectWeaponAttacker(instanceId) {
  const mech = mechInstances.find(m => m.instanceId === instanceId);
  if (!mech || mech.owner !== mySeatNumber || !isMyActiveTurn() || currentGameState.phase !== 'weapon_attack' || mech.hasFired) return;
  weaponAttackState = { attackerId: instanceId, targetId: null, weaponKeys: [] };
  selectedInstanceId = instanceId;
  renderRoster();
  renderDetail();
  renderWeaponAttackPanel();
  draw();
}

function selectWeaponTarget(instanceId) {
  const target = mechInstances.find(m => m.instanceId === instanceId);
  if (!target || target.destroyed) return;
  weaponAttackState.targetId = instanceId;
  weaponAttackState.weaponKeys = [];
  renderWeaponAttackPanel();
}

function toggleWeaponForAttack(weaponKey) {
  const selected = weaponAttackState.weaponKeys;
  weaponAttackState.weaponKeys = selected.includes(weaponKey)
    ? selected.filter(key => key !== weaponKey)
    : [...selected, weaponKey];
  renderWeaponAttackPanel();
}

function roll2d6() {
  return Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6) + 1;
}

function hitLocationForRoll(roll) {
  if (roll === 2 || roll === 12) return 'head';
  if (roll === 3 || roll === 4) return 'ra';
  if (roll === 5) return 'rl';
  if (roll === 6) return 'rt';
  if (roll === 7) return 'ct';
  if (roll === 8) return 'lt';
  if (roll === 9) return 'll';
  return 'la';
}

function hitLocationLabel(location) {
  return ({ head: 'Head', ct: 'Center Torso', lt: 'Left Torso', rt: 'Right Torso', la: 'Left Arm', ra: 'Right Arm', ll: 'Left Leg', rl: 'Right Leg' })[location] || location;
}

function applyWeaponDamage(target, damage) {
  const location = hitLocationForRoll(roll2d6());
  const armorBefore = target.armor[location] || 0;
  const absorbed = Math.min(armorBefore, damage);
  target.armor[location] = armorBefore - absorbed;
  const internalDamage = damage - absorbed;
  const structureBefore = target.structure[location] || 0;
  if (internalDamage > 0) target.structure[location] = Math.max(0, structureBefore - internalDamage);
  if ((location === 'head' || location === 'ct') && target.structure[location] <= 0 && internalDamage > 0) target.destroyed = true;
  return { location, armorBefore, internalDamage, structureBefore, destroyed: !!target.destroyed };
}

async function confirmWeaponAttack() {
  const attacker = mechInstances.find(m => m.instanceId === weaponAttackState.attackerId);
  if (!attacker || attacker.owner !== mySeatNumber || !isMyActiveTurn() || currentGameState.phase !== 'weapon_attack' || attacker.hasFired) return;
  const target = mechInstances.find(m => m.instanceId === weaponAttackState.targetId);
  const selectedWeapons = BT_UNITS[attacker.unitId].weapons.filter(w => weaponAttackState.weaponKeys.includes(w.key));
  if (selectedWeapons.length && !target) return;

  const messages = [];
  let addedHeat = 0;
  for (const weaponEntry of selectedWeapons) {
    const attack = evaluateWeaponAttack(attacker, target, weaponEntry);
    if (!attack.valid) {
      messages.push(`${mechLabel(attacker)} could not fire ${weaponEntry.key}: ${attack.reason}`);
      continue;
    }
    addedHeat += attack.weapon.heat * weaponEntry.count;
    for (let shot = 1; shot <= weaponEntry.count; shot++) {
      const roll = roll2d6();
      const hit = attack.targetNumber <= 2 || (attack.targetNumber <= 12 && roll >= attack.targetNumber);
      const shotLabel = weaponEntry.count > 1 ? ` #${shot}` : '';
      if (!hit) {
        messages.push(`${mechLabel(attacker)} fired ${attack.weapon.name}${shotLabel} at ${mechLabel(target)} — need ${attack.targetNumber} (${attack.breakdown}), rolled ${roll}: miss.`);
        continue;
      }
      const damage = applyWeaponDamage(target, attack.weapon.damage);
      messages.push(`${mechLabel(attacker)} fired ${attack.weapon.name}${shotLabel} at ${mechLabel(target)} — need ${attack.targetNumber}, rolled ${roll}: hit ${hitLocationLabel(damage.location)} for ${attack.weapon.damage} damage.${damage.destroyed ? ' Target destroyed.' : ''}`);
    }
  }

  attacker.weaponHeat = (attacker.weaponHeat || 0) + addedHeat;
  attacker.heat = (attacker.roundStartingHeat || 0) + (attacker.movementHeat || 0) + attacker.weaponHeat;
  attacker.hasFired = true;
  weaponAttackState = { attackerId: null, targetId: null, weaponKeys: [] };
  renderWeaponAttackPanel();
  renderRoster();
  renderDetail();
  draw();
  updateAdvanceButtonState();
  await syncMechInstances();
  if (messages.length) messages.forEach(message => logEvent(message, 'attack'));
  else logEvent(`${mechLabel(attacker)} declared no weapon attacks.`, 'attack');
}

function renderWeaponAttackPanel() {
  const panel = document.getElementById('movement-panel');
  if (!panel || currentGameState.phase !== 'weapon_attack') return;
  panel.style.display = 'block';

  const activeSeat = getActivePlayerSeat();
  const isMine = activeSeat === mySeatNumber && isMyActiveTurn();
  const pending = mechInstances.filter(m => m.owner === activeSeat && !m.destroyed && !m.hasFired);
  const attacker = mechInstances.find(m => m.instanceId === weaponAttackState.attackerId) || mechInstances.find(m => m.instanceId === selectedInstanceId);
  const target = mechInstances.find(m => m.instanceId === weaponAttackState.targetId);

  if (!isMine) {
    panel.innerHTML = `<div class="panel-eyebrow">Weapon Attack</div><div style="font-size:11px;color:var(--phosphor-dim);">Waiting for Player ${activeSeat} to complete weapon attacks.</div>`;
    return;
  }
  if (!attacker || attacker.owner !== activeSeat || attacker.hasFired) {
    panel.innerHTML = pending.length
      ? `<div class="panel-eyebrow">Weapon Attack</div><div style="font-size:11px;color:var(--paper);margin-bottom:8px;">Choose a 'Mech to declare attacks. ${pending.length} remain.</div><div style="display:flex;flex-direction:column;gap:6px;">${pending.map(m => `<button onclick="selectWeaponAttacker('${m.instanceId}')" style="${MOVE_BTN_STYLE}text-align:center;">${mechLabel(m)}</button>`).join('')}</div>`
      : `<div class="panel-eyebrow">Weapon Attack</div><div style="font-size:11px;color:var(--phosphor-dim);">All weapon attacks complete. Pass to the next player.</div>`;
    return;
  }

  const enemies = mechInstances.filter(m => m.owner !== attacker.owner && !m.destroyed);
  const weaponRows = BT_UNITS[attacker.unitId].weapons.map(entry => {
    const checked = weaponAttackState.weaponKeys.includes(entry.key);
    const evaluation = target ? evaluateWeaponAttack(attacker, target, entry) : null;
    const disabled = target && !evaluation.valid;
    const weapon = BT_WEAPONS[entry.key];
    const countLabel = entry.count > 1 ? ` ×${entry.count}` : '';
    const heat = weapon ? weapon.heat * entry.count : '?';
    return `<button onclick="toggleWeaponForAttack('${entry.key}')" ${disabled ? 'disabled' : ''} style="width:100%;margin-top:5px;padding:7px 8px;border:1px solid ${checked ? 'var(--amber)' : 'var(--panel-line)'};background:${checked ? 'rgba(212,128,10,.18)' : 'transparent'};color:${disabled ? 'var(--phosphor-dim)' : 'var(--paper)'};font-family:var(--mono);font-size:10px;text-align:left;cursor:${disabled ? 'not-allowed' : 'pointer'};">${checked ? '✓ ' : ''}${weapon?.name || entry.key}${countLabel} · ${weapon?.damage || '?'} dmg / ${heat} heat · ${entry.location}${evaluation ? ` · ${evaluation.valid ? `${evaluation.range.label}, TN ${evaluation.targetNumber}` : evaluation.reason}` : ''}</button>`;
  }).join('');

  panel.innerHTML = `
    <div class="panel-eyebrow">Weapon Attack — Declaration</div>
    <div style="font-size:11px;color:var(--paper);margin-bottom:8px;">${mechLabel(attacker)} · heat ${attacker.heat || 0}</div>
    <div style="font-size:10px;color:var(--phosphor-dim);margin-bottom:4px;">TARGET</div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;">${enemies.map(enemy => `<button onclick="selectWeaponTarget('${enemy.instanceId}')" style="padding:6px;border:1px solid ${target?.instanceId === enemy.instanceId ? 'var(--amber)' : 'var(--panel-line)'};background:transparent;color:var(--paper);font:9px var(--mono);cursor:pointer;">${mechLabel(enemy)}</button>`).join('')}</div>
    ${target ? `<div style="font-size:10px;color:var(--amber);margin-bottom:4px;">TARGET: ${mechLabel(target)}</div>${weaponRows}` : '<div style="font-size:11px;color:var(--phosphor-dim);">Select a target to see eligible weapons and target numbers.</div>'}
    <button onclick="confirmWeaponAttack()" style="width:100%;margin-top:9px;${MOVE_BTN_STYLE}text-align:center;">${weaponAttackState.weaponKeys.length ? 'Confirm Weapon Attacks' : 'No Fire / Complete Attacks'}</button>`;
}
