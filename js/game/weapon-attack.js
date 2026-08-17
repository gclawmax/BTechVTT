// ── WEAPON ATTACK PHASE ──────────────────────────────────
// This first pass implements player declarations and resolution for the
// standard weapons in BT_WEAPONS.  Critical-hit slot damage and primary
// component effects are resolved from the BattleMech record sheet.

let weaponAttackState = { attackerId: null, targetId: null, weaponKeys: [], ammoBinsByMount: {} };

// A weapon type is not a unique mount: e.g. a Marauder carries PPCs in both
// arms.  Selection must identify the specific catalogue entry, not just its
// weapon key, so the player can fire either arm independently.
function weaponMountId(entry, index) {
  return entry.mountId || `${entry.key}:${entry.location}:${index}`;
}

function weaponPhaseStartMech(mech) {
  const snapshot = mech?.weaponPhaseStart;
  return snapshot?.round === currentGameState.round && snapshot.mech ? snapshot.mech : mech;
}

function canFireFromWeaponPhaseStart(mech) {
  return Boolean(mech && !mech.shutdown && !weaponPhaseStartMech(mech)?.destroyed);
}

function compatibleAmmoBins(attacker, weaponEntry) {
  const ammoType = BT_WEAPONS[weaponEntry.key]?.ammoType;
  if (!ammoType) return [];
  return (weaponPhaseStartMech(attacker).ammoBins || []).filter(bin =>
    bin.type === ammoType && bin.shots > 0 && !bin.destroyed
  );
}

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
  let modifier = moved >= 25 ? 6 : moved >= 18 ? 5 : moved >= 10 ? 4 : moved >= 7 ? 3 : moved >= 5 ? 2 : moved >= 3 ? 1 : 0;
  if (mech.movementMode === 'jump') modifier += 1;
  return modifier;
}

function weaponComponentToHitModifier(mech, weaponEntry) {
  const location = typeof criticalLocationKey === 'function'
    ? criticalLocationKey(weaponEntry.location)
    : weaponEntry.location.toLowerCase().includes('left arm') ? 'la'
      : weaponEntry.location.toLowerCase().includes('right arm') ? 'ra' : null;
  if (!['la', 'ra'].includes(location)) return 0;
  const layout = BT_CRITICAL_LAYOUTS[mech.unitId]?.[location] || [];
  const damaged = mech.criticalSlotDamage?.[location] || [];
  const slotName = slot => typeof criticalSlotName === 'function'
    ? criticalSlotName(slot)
    : String(slot || '').replace(/\s*\([A-Z]\)$/, '');
  if (damaged.some(index => slotName(layout[index]) === 'Shoulder')) return 4;
  return damaged.filter(index => ['Upper Arm Actuator', 'Lower Arm Actuator'].includes(slotName(layout[index]))).length;
}

function weaponHeatToHitModifier(mech) {
  const heat = (mech.roundStartingHeat || 0) + (mech.movementHeat || 0);
  return heat >= 24 ? 4 : heat >= 17 ? 3 : heat >= 13 ? 2 : heat >= 8 ? 1 : 0;
}

function weaponRangeModifier(weapon, distance) {
  if (distance <= weapon.range[0]) {
    const minimum = weapon.minimumRange && distance <= weapon.minimumRange
      ? weapon.minimumRange - distance + 1
      : 0;
    return { label: minimum ? 'Minimum' : 'Short', modifier: minimum };
  }
  if (distance <= weapon.range[1]) return { label: 'Medium', modifier: 2 };
  if (distance <= weapon.range[2]) return { label: 'Long', modifier: 4 };
  return null;
}

function weaponArcFacing(weaponEntry, attacker) {
  return /torso|head/i.test(weaponEntry.location)
    ? (attacker.torsoFacing == null ? attacker.facing : attacker.torsoFacing)
    : attacker.facing;
}

function weaponLocationDestroyed(attacker, weaponEntry) {
  const location = weaponEntry.location.toLowerCase();
  const key = location.includes('right arm') ? 'ra' : location.includes('left arm') ? 'la'
    : location.includes('right torso') ? 'rt' : location.includes('left torso') ? 'lt'
      : location.includes('center torso') ? 'ct' : location.includes('head') ? 'head' : null;
  return key && (attacker.structure[key] || 0) <= 0;
}

function attackDirection(attacker, target) {
  const diff = (weaponDirectionTo(target, attacker) - target.facing + 6) % 6;
  return diff === 0 ? 'front' : (diff === 1 || diff === 5) ? 'side' : 'rear';
}

function axialRound(q, r) {
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

function woodsBetween(attacker, target) {
  const a = offsetToAxial(attacker.col, attacker.row), b = offsetToAxial(target.col, target.row);
  const distance = axialDistance(attacker.col, attacker.row, target.col, target.row);
  let points = 0;
  for (let step = 1; step < distance; step++) {
    const axial = axialRound(a.q + (b.q - a.q) * step / distance, a.r + (b.r - a.r) * step / distance);
    const hex = axialToOffset(axial.q, axial.r);
    points += terrainAt(hex.col, hex.row) === 'heavy_woods' ? 2 : terrainAt(hex.col, hex.row) === 'light_woods' ? 1 : 0;
  }
  return points;
}

function evaluateWeaponAttack(attacker, target, weaponEntry) {
  const eligibleAttacker = weaponPhaseStartMech(attacker);
  const eligibleTarget = weaponPhaseStartMech(target);
  const weapon = BT_WEAPONS[weaponEntry.key];
  if (!weapon || eligibleAttacker.destroyed || eligibleTarget.destroyed || attacker.owner === target.owner) {
    return { valid: false, reason: 'Choose a valid enemy target and supported weapon.' };
  }
  if (weaponLocationDestroyed(eligibleAttacker, weaponEntry)) return { valid: false, reason: `${weapon.name} was mounted in a location destroyed before this phase.` };
  if (typeof weaponsDisabledByCritical === 'function' && weaponsDisabledByCritical(eligibleAttacker)) return { valid: false, reason: 'Sensors were destroyed before this phase.' };
  if (typeof isWeaponCriticallyDestroyed === 'function' && isWeaponCriticallyDestroyed(eligibleAttacker, weaponEntry)) return { valid: false, reason: `${weapon.name} was destroyed before this phase.` };
  const distance = axialDistance(attacker.col, attacker.row, target.col, target.row);
  const range = weaponRangeModifier(weapon, distance);
  if (!range) return { valid: false, reason: `${weapon.name} is beyond long range (${distance} hexes).` };
  const facing = weaponArcFacing(weaponEntry, attacker);
  if (!isInForwardArc(facing, weaponDirectionTo(attacker, target))) {
    return { valid: false, reason: `${weapon.name} target is outside its firing arc.` };
  }
  const attackerMove = movementToHitModifier(attacker);
  const targetMove = targetMovementModifier(target);
  const woods = woodsBetween(attacker, target);
  if (woods >= 3) return { valid: false, reason: 'Line of sight is blocked by intervening woods.' };
  const targetWoods = terrainAt(target.col, target.row) === 'heavy_woods' ? 2 : terrainAt(target.col, target.row) === 'light_woods' ? 1 : 0;
  const sensorCritical = typeof criticalToHitModifier === 'function' ? criticalToHitModifier(eligibleAttacker) : 0;
  const critical = sensorCritical + weaponComponentToHitModifier(eligibleAttacker, weaponEntry);
  const heat = weaponHeatToHitModifier(eligibleAttacker);
  return {
    valid: true,
    weapon,
    distance,
    range,
    targetNumber: 4 + attackerMove + targetMove + range.modifier + woods + targetWoods + critical + heat,
    attackAngle: attackDirection(attacker, target),
    breakdown: `Gunnery 4 + move ${attackerMove} + target ${targetMove} + ${range.label.toLowerCase()} ${range.modifier} + woods ${woods + targetWoods}${critical ? ` + damage ${critical}` : ''}${heat ? ` + heat ${heat}` : ''}`
  };
}

function selectWeaponAttacker(instanceId) {
  const mech = mechInstances.find(m => m.instanceId === instanceId);
  if (!canFireFromWeaponPhaseStart(mech) || mech.owner !== mySeatNumber || !isMyActiveTurn() || currentGameState.phase !== 'weapon_attack' || mech.hasFired) return;
  weaponAttackState = { attackerId: instanceId, targetId: null, weaponKeys: [], ammoBinsByMount: {} };
  selectedInstanceId = instanceId;
  logEvent(`${mechLabel(mech)} selected for weapon attack declaration.`, 'system');
  renderRoster();
  renderDetail();
  renderWeaponAttackPanel();
  draw();
}

function selectWeaponTarget(instanceId) {
  const target = mechInstances.find(m => m.instanceId === instanceId);
  if (!canFireFromWeaponPhaseStart(target)) return;
  weaponAttackState.targetId = instanceId;
  weaponAttackState.weaponKeys = [];
  weaponAttackState.ammoBinsByMount = {};
  renderWeaponAttackPanel();
}

function toggleWeaponForAttack(mountId) {
  const attacker = mechInstances.find(m => m.instanceId === weaponAttackState.attackerId);
  const entry = attacker && BT_UNITS[attacker.unitId].weapons.find((weapon, index) => weaponMountId(weapon, index) === mountId);
  const selected = weaponAttackState.weaponKeys;
  if (selected.includes(mountId)) {
    weaponAttackState.weaponKeys = selected.filter(id => id !== mountId);
    delete weaponAttackState.ammoBinsByMount[mountId];
  } else {
    weaponAttackState.weaponKeys = [...selected, mountId];
    const bins = entry ? compatibleAmmoBins(attacker, entry) : [];
    if (bins.length) weaponAttackState.ammoBinsByMount[mountId] = bins[0].id;
  }
  renderWeaponAttackPanel();
}

function selectAmmoBinForMount(mountId, binId) {
  const attacker = mechInstances.find(m => m.instanceId === weaponAttackState.attackerId);
  const entry = attacker && BT_UNITS[attacker.unitId].weapons.find((weapon, index) => weaponMountId(weapon, index) === mountId);
  if (!entry || !compatibleAmmoBins(attacker, entry).some(bin => bin.id === binId)) return;
  weaponAttackState.ammoBinsByMount[mountId] = binId;
}

function resolveDeclaredAmmoBins(attacker, selectedWeapons) {
  const choices = {};
  for (const entry of selectedWeapons) {
    const weapon = BT_WEAPONS[entry.key];
    if (!weapon?.ammoType) continue;
    const mountId = weaponMountId(entry, BT_UNITS[attacker.unitId].weapons.indexOf(entry));
    const bins = compatibleAmmoBins(attacker, entry);
    const selectedId = weaponAttackState.ammoBinsByMount[mountId];
    const selected = bins.find(bin => bin.id === selectedId) || bins[0];
    if (!selected) return { error: `Choose an ammunition bin for ${weapon.name}.` };
    choices[mountId] = selected.id;
  }
  return { choices };
}

function roll2d6() {
  return roll2d6Detailed().total;
}

function roll2d6Detailed() {
  const dieA = Math.floor(Math.random() * 6) + 1;
  const dieB = Math.floor(Math.random() * 6) + 1;
  return { dieA, dieB, total: dieA + dieB };
}

function format2d6(roll) {
  if (roll && typeof roll === 'object') return `${roll.dieA} + ${roll.dieB} = ${roll.total}`;
  return String(roll);
}

function hitLocationForRoll(roll, angle = 'front') {
  if (angle === 'rear') return ({ 2:'ct',3:'ra',4:'ra',5:'rl',6:'rt',7:'ct',8:'lt',9:'ll',10:'la',11:'la',12:'head' })[roll];
  if (angle === 'side') return ({ 2:'ct',3:'ra',4:'ra',5:'rl',6:'rt',7:'rt',8:'ct',9:'lt',10:'ll',11:'la',12:'head' })[roll];
  if (roll === 2) return 'ct';
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

function applyWeaponDamage(target, damage, angle = 'front') {
  const location = hitLocationForRoll(roll2d6(), angle);
  const armorLocation = angle === 'rear' && ['ct', 'lt', 'rt'].includes(location) ? `${location}_rear` : location;
  const transfer = { la:'lt', ra:'rt', ll:'lt', rl:'rt', lt:'ct', rt:'ct', head:'ct' };
  let remaining = damage, current = location, first = true, critical = false, destroyedLocations = [], criticalEvents = [];
  while (remaining > 0 && current && !target.destroyed) {
    const currentArmor = first ? armorLocation : current;
    const armor = target.armor[currentArmor] || 0;
    const absorbed = Math.min(armor, remaining);
    target.armor[currentArmor] = armor - absorbed;
    remaining -= absorbed;
    if (remaining <= 0) break;
    const structure = target.structure[current] || 0;
    const internal = Math.min(structure, remaining);
    target.structure[current] = structure - internal;
    remaining -= internal;
    if (internal > 0) {
      const criticalResult = resolveCriticalHits(target, current);
      critical = critical || criticalResult.triggered;
      target.criticalChecks = (target.criticalChecks || 0) + 1;
      criticalEvents.push(`Critical roll ${format2d6(criticalResult.roll)}: ${criticalResult.events.length ? criticalResult.events.join(' ') : 'no critical hit.'}`);
    }
    if (target.structure[current] <= 0) {
      destroyedLocations.push(current);
      if (current === 'head' || current === 'ct') { target.destroyed = true; break; }
      if (current === 'lt') { target.structure.la = 0; destroyedLocations.push('la'); }
      if (current === 'rt') { target.structure.ra = 0; destroyedLocations.push('ra'); }
      current = transfer[current];
      first = false;
    } else break;
  }
  return { location, armorLocation, critical, criticalEvents, destroyedLocations, destroyed: !!target.destroyed };
}

function formatAuthoritativeCriticals(checks) {
  return (checks || []).map(check =>
    ` Critical check ${check.die_a} + ${check.die_b} = ${check.total}: ${check.hits} hit${check.hits === 1 ? '' : 's'}.${(check.events || []).map(event =>
      event.special === 'blown_off' ? ` ${hitLocationLabel(event.location)} blown off.` :
        event.ammo_explosion ? ` ${event.ammo_explosion} ammunition exploded for ${event.damage} damage.` :
          event.label ? ` ${hitLocationLabel(event.location)} slot ${event.slot_index + 1}: ${event.label} destroyed.` : ''
    ).join('')}`
  ).join('');
}

function authoritativeWeaponResultMessage(attacker, target, result) {
  const roll = result.to_hit || {};
  const rolled = `${roll.die_a} + ${roll.die_b} = ${roll.total}`;
  if (!result.hit) return `${mechLabel(attacker)} fired ${result.weapon} at ${mechLabel(target)} — need ${roll.target}, rolled ${rolled}: miss.`;
  if (result.cluster_roll) {
    const cluster = result.cluster_roll;
    const groups = (result.groups || []).map(group =>
      `${hitLocationLabel(group.location)} ${group.damage}${formatAuthoritativeCriticals(group.critical_checks)}`
    ).join('; ');
    return `${mechLabel(attacker)} fired ${result.weapon} at ${mechLabel(target)} — need ${roll.target}, rolled ${rolled}: hit. Cluster roll ${cluster.die_a} + ${cluster.die_b} = ${cluster.total}: ${result.missiles_hit} missile${result.missiles_hit === 1 ? '' : 's'} hit in ${result.groups?.length || 0} group${result.groups?.length === 1 ? '' : 's'} — ${groups}.`;
  }
  const criticals = formatAuthoritativeCriticals(result.critical_checks);
  return `${mechLabel(attacker)} fired ${result.weapon} at ${mechLabel(target)} — need ${roll.target}, rolled ${rolled}: ${result.angle} hit ${hitLocationLabel(result.location)} for ${result.damage} damage.${criticals}`;
}

function weaponDeclarationSummary(attacker, mountIds) {
  const weapons = BT_UNITS[attacker?.unitId]?.weapons || [];
  const counts = new Map();
  for (const mountId of mountIds || []) {
    const entry = weapons.find((weapon, index) => weaponMountId(weapon, index) === mountId);
    const name = BT_WEAPONS[entry?.key]?.name || entry?.key || mountId;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const labels = [...counts].map(([name, count]) => count === 1 ? name : `${count} ${name}${name.endsWith('s') ? '' : 's'}`);
  if (labels.length < 2) return labels[0] || 'no weapon fire';
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

async function loadWeaponCombatEvents() {
  if (!currentGameId || vsAiMode) return;
  const { data, error } = await db.from('btech_combat_events')
    .select('id,round,phase,sequence,attacker_instance_id,target_instance_id,declaration,resolution,status,declared_at,resolved_at')
    .eq('game_id', currentGameId).eq('phase', 'weapon_attack')
    .order('round', { ascending: true }).order('sequence', { ascending: true }).limit(GAME_LOG_MAX);
  if (error) { console.warn('[BT-LOG] failed to load weapon combat events:', error); return; }
  const entries = [];
  for (const event of data || []) {
    const attacker = mechInstances.find(mech => mech.instanceId === event.attacker_instance_id);
    const target = mechInstances.find(mech => mech.instanceId === event.target_instance_id);
    if (!attacker) continue;
    const declaredAt = Date.parse(event.declared_at || '') || Date.now();
    const mounts = event.declaration?.weapon_mounts || [];
    entries.push({
      id: `combat-declaration-${event.id}`, ts: declaredAt + event.sequence,
      time: new Date(declaredAt).toTimeString().slice(0, 8), round: event.round,
      phase: event.phase, cat: 'attack',
      msg: mounts.length
        ? `${mechLabel(attacker)} declared ${weaponDeclarationSummary(attacker, mounts)} at ${mechLabel(target)}.`
        : `${mechLabel(attacker)} declared no weapon fire.`
    });
    if (event.status !== 'resolved' || !['simultaneous-declarations-01', 'alternating-activations-01'].includes(event.resolution?.state_version)) continue;
    const resolvedAt = Date.parse(event.resolved_at || '') || Date.now();
    const results = event.resolution?.results || [];
    if (!results.length) continue;
    results.forEach((result, index) => entries.push({
      id: `combat-${event.id}-${index}`, ts: resolvedAt + event.sequence * 100 + index,
      time: new Date(resolvedAt).toTimeString().slice(0, 8), round: event.round,
      phase: event.phase, cat: 'attack', msg: authoritativeWeaponResultMessage(attacker, target, result)
    }));
  }
  mergeRemoteLog(entries);
}

async function confirmAuthoritativeWeaponAttack(attacker, target, selectedWeapons) {
  const ammoDeclaration = resolveDeclaredAmmoBins(attacker, selectedWeapons);
  if (ammoDeclaration.error) {
    flashMoveWarning(ammoDeclaration.error);
    return;
  }
  // A select element visibly defaults to its first option even if no change
  // event has fired. Persist the derived choice so UI state and RPC payload
  // always describe the same ammunition bin.
  weaponAttackState.ammoBinsByMount = ammoDeclaration.choices;
  const { data, error } = await db.rpc('submit_simultaneous_weapon_declaration', {
    p_game_id: currentGameId,
    p_attacker_instance_id: attacker.instanceId,
    p_target_instance_id: target?.instanceId || null,
    p_weapon_mounts: selectedWeapons.map((entry, index) => {
      const catalogueIndex = BT_UNITS[attacker.unitId].weapons.indexOf(entry);
      return weaponMountId(entry, catalogueIndex >= 0 ? catalogueIndex : index);
    }),
    p_ammo_bins: ammoDeclaration.choices
  });
  if (error) {
    logEvent(`Server rejected the weapon declaration: ${error.message}`, 'error');
    flashMoveWarning(error.message);
    return;
  }
  weaponAttackState = { attackerId: null, targetId: null, weaponKeys: [], ammoBinsByMount: {} };
  await loadGameState();
  renderWeaponAttackPanel(); renderRoster(); renderDetail(); draw(); updateAdvanceButtonState();
  if (data?.status === 'resolved') await checkForMatchEnd();
}

async function confirmWeaponAttack() {
  // A player may select their 'Mech from the roster/map or from this panel.
  // Both paths render the declaration controls, so both must be valid here.
  const attacker = mechInstances.find(m => m.instanceId === weaponAttackState.attackerId) ||
    mechInstances.find(m => m.instanceId === selectedInstanceId);
  if (!attacker || attacker.owner !== mySeatNumber || !isMyActiveTurn() || currentGameState.phase !== 'weapon_attack' || attacker.hasFired) return;
  const target = mechInstances.find(m => m.instanceId === weaponAttackState.targetId);
  const selectedWeapons = BT_UNITS[attacker.unitId].weapons.filter((entry, index) =>
    weaponAttackState.weaponKeys.includes(weaponMountId(entry, index))
  );
  if (selectedWeapons.length && !target) {
    flashMoveWarning('Choose a target before confirming weapon attacks.');
    return;
  }
  if (!vsAiMode) {
    await confirmAuthoritativeWeaponAttack(attacker, target, selectedWeapons);
    return;
  }

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
      const roll = roll2d6Detailed();
      const hit = attack.targetNumber <= 2 || (attack.targetNumber <= 12 && roll.total >= attack.targetNumber);
      const shotLabel = weaponEntry.count > 1 ? ` #${shot}` : '';
      if (!hit) {
        messages.push(`${mechLabel(attacker)} fired ${attack.weapon.name}${shotLabel} at ${mechLabel(target)} — need ${attack.targetNumber} (${attack.breakdown}), rolled ${format2d6(roll)}: miss.`);
        continue;
      }
      const damage = applyWeaponDamage(target, attack.weapon.damage, attack.attackAngle);
      messages.push(`${mechLabel(attacker)} fired ${attack.weapon.name}${shotLabel} at ${mechLabel(target)} — need ${attack.targetNumber}, rolled ${format2d6(roll)}: ${attack.attackAngle} hit ${hitLocationLabel(damage.location)} for ${attack.weapon.damage} damage.${damage.criticalEvents.length ? ` ${damage.criticalEvents.join(' ')}` : ''}${damage.destroyedLocations.length ? ` Destroyed: ${damage.destroyedLocations.map(hitLocationLabel).join(', ')}.` : ''}${damage.destroyed ? ' Target destroyed.' : ''}`);
    }
  }

  attacker.weaponHeat = (attacker.weaponHeat || 0) + addedHeat;
  attacker.heat = (attacker.roundStartingHeat || 0) + (attacker.movementHeat || 0) + attacker.weaponHeat;
  attacker.hasFired = true;
  weaponAttackState = { attackerId: null, targetId: null, weaponKeys: [], ammoBinsByMount: {} };
  renderWeaponAttackPanel();
  renderRoster();
  renderDetail();
  draw();
  updateAdvanceButtonState();
  // Give immediate feedback before the shared-state write has completed.
  // The detailed resolution is logged after the save so it remains in order
  // for the other player as well.
  logEvent(`${mechLabel(attacker)} weapon attack submitted — saving outcome.`, 'attack');
  await syncMechInstances();
  await checkForMatchEnd();
  if (messages.length) messages.forEach(message => logEvent(message, 'attack'));
  else logEvent(`${mechLabel(attacker)} declared no weapon attacks.`, 'attack');
}

function renderWeaponAttackPanel() {
  const panel = document.getElementById('movement-panel');
  if (!panel || currentGameState.phase !== 'weapon_attack') return;
  panel.style.display = 'block';

  const activeSeat = getActivePlayerSeat();
  const isMine = activeSeat === mySeatNumber && isMyActiveTurn();
  const pending = mechInstances.filter(m => m.owner === activeSeat && canFireFromWeaponPhaseStart(m) && !m.hasFired);
  const attacker = mechInstances.find(m => m.instanceId === weaponAttackState.attackerId) || mechInstances.find(m => m.instanceId === selectedInstanceId);
  const target = mechInstances.find(m => m.instanceId === weaponAttackState.targetId);

  if (!isMine) {
    panel.innerHTML = `<div class="panel-eyebrow">Weapon Attack</div><div style="font-size:11px;color:var(--phosphor-dim);">Waiting for Player ${activeSeat} to complete weapon attacks.</div>`;
    return;
  }
  if (!attacker || attacker.owner !== activeSeat || attacker.hasFired) {
    const allowance = Math.min(currentActivationAllowance('weapon_attack'), pending.length);
    panel.innerHTML = pending.length
      ? `<div class="panel-eyebrow">Weapon Attack</div><div style="font-size:11px;color:var(--paper);margin-bottom:8px;">Declare for ${allowance} 'Mech${allowance === 1 ? '' : 's'} in this activation. ${pending.length} total remain.</div><div style="display:flex;flex-direction:column;gap:6px;">${pending.map(m => `<button onclick="selectWeaponAttacker('${m.instanceId}')" style="${MOVE_BTN_STYLE}text-align:center;">${mechLabel(m)}</button>`).join('')}</div>`
      : `<div class="panel-eyebrow">Weapon Attack</div><div style="font-size:11px;color:var(--phosphor-dim);">All declarations saved. Waiting for simultaneous resolution.</div>`;
    return;
  }

  const enemies = mechInstances.filter(m => m.owner !== attacker.owner && canFireFromWeaponPhaseStart(m));
  const weaponRows = BT_UNITS[attacker.unitId].weapons.map((entry, index) => {
    const mountId = weaponMountId(entry, index);
    const checked = weaponAttackState.weaponKeys.includes(mountId);
    const evaluation = target ? evaluateWeaponAttack(attacker, target, entry) : null;
    const weapon = BT_WEAPONS[entry.key];
    const bins = compatibleAmmoBins(attacker, entry);
    const outOfAmmo = Boolean(weapon?.ammoType) && bins.length === 0;
    const disabled = outOfAmmo || (target && !evaluation.valid);
    const countLabel = entry.count > 1 ? ` ×${entry.count}` : '';
    const heat = weapon ? weapon.heat * entry.count : '?';
    const binPicker = checked && weapon?.ammoType ? `<label style="display:flex;gap:6px;align-items:center;margin:4px 0 7px;font:9px var(--mono);color:var(--phosphor-dim);">AMMO BIN<select onchange="selectAmmoBinForMount('${mountId}',this.value)" style="flex:1;font:10px var(--mono);padding:4px;">${bins.map(bin => `<option value="${bin.id}" ${weaponAttackState.ammoBinsByMount[mountId] === bin.id ? 'selected' : ''}>${bin.location} · ${bin.shots}/${bin.maxShots} shots</option>`).join('')}</select></label>` : '';
    return `<div><button onclick="toggleWeaponForAttack('${mountId}')" ${disabled ? 'disabled' : ''} style="width:100%;margin-top:5px;padding:7px 8px;border:1px solid ${checked ? 'var(--amber)' : 'var(--panel-line)'};background:${checked ? 'rgba(212,128,10,.18)' : 'transparent'};color:${disabled ? 'var(--phosphor-dim)' : 'var(--paper)'};font-family:var(--mono);font-size:10px;text-align:left;cursor:${disabled ? 'not-allowed' : 'pointer'};">${checked ? '✓ ' : ''}${weapon?.name || entry.key}${countLabel} · ${weapon?.damage || '?'} max dmg / ${heat} heat · ${entry.location}${outOfAmmo ? ' · no ammunition' : evaluation ? ` · ${evaluation.valid ? `${evaluation.range.label}, TN ${evaluation.targetNumber}` : evaluation.reason}` : ''}</button>${binPicker}</div>`;
  }).join('');

  panel.innerHTML = `
    <div class="panel-eyebrow">Weapon Attack — Declaration</div>
    <div style="font-size:11px;color:var(--paper);margin-bottom:8px;">${mechLabel(attacker)} · heat ${attacker.heat || 0}</div>
    <div style="font-size:10px;color:var(--phosphor-dim);margin-bottom:4px;">TARGET</div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;">${enemies.map(enemy => `<button onclick="selectWeaponTarget('${enemy.instanceId}')" style="padding:6px;border:1px solid ${target?.instanceId === enemy.instanceId ? 'var(--amber)' : 'var(--panel-line)'};background:transparent;color:var(--paper);font:9px var(--mono);cursor:pointer;">${mechLabel(enemy)}</button>`).join('')}</div>
    ${target ? `<div style="font-size:10px;color:var(--amber);margin-bottom:4px;">TARGET: ${mechLabel(target)}</div>${weaponRows}` : '<div style="font-size:11px;color:var(--phosphor-dim);">Select a target to see eligible weapons and target numbers.</div>'}
    <button onclick="confirmWeaponAttack()" style="width:100%;margin-top:9px;${MOVE_BTN_STYLE}text-align:center;">${weaponAttackState.weaponKeys.length ? 'Confirm Weapon Attacks' : 'No Fire / Complete Attacks'}</button>`;
}
