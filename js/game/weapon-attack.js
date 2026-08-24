// ── WEAPON ATTACK PHASE ──────────────────────────────────
// This first pass implements player declarations and resolution for the
// standard weapons in BT_WEAPONS.  Critical-hit slot damage and primary
// component effects are resolved from the BattleMech record sheet.

let weaponAttackState = { attackerId: null, targetId: null, weaponKeys: [], ammoBinsByMount: {}, fireModesByMount: {}, indirect: false, spotterId: null };

function weaponLineOfSight(observer, target) {
  const woods = woodsBetween(observer, target);
  const targetWoods = terrainAt(target.col, target.row) === 'heavy_woods' ? 2 : terrainAt(target.col, target.row) === 'light_woods' ? 1 : 0;
  return { valid: woods < 3 && !elevationBlocksLineOfSight(observer, target), woods: woods + targetWoods };
}

function eligibleIndirectSpotters(attacker, target) {
  return mechInstances.filter(mech => {
    const spotter = weaponPhaseStartMech(mech);
    return mech.owner === attacker.owner && mech.instanceId !== attacker.instanceId && !spotter.destroyed && !spotter.shutdown &&
      (!spotter.pilot?.consciousness || spotter.pilot.consciousness === 'conscious') &&
      !spotter.dfaDeclaration && !spotter.chargeDeclaration && weaponLineOfSight(spotter, weaponPhaseStartMech(target)).valid;
  });
}

function setIndirectFire(enabled) {
  weaponAttackState.indirect = Boolean(enabled);
  if (!weaponAttackState.indirect) weaponAttackState.spotterId = null;
  weaponAttackState.weaponKeys = [];
  renderWeaponAttackPanel();
}

function selectIndirectSpotter(instanceId) {
  weaponAttackState.spotterId = instanceId;
  weaponAttackState.weaponKeys = [];
  renderWeaponAttackPanel();
}

function weaponProfile(entry) {
  return entry?.weapon || BT_WEAPONS[entry?.key];
}

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
  return Boolean(mech && !mech.shutdown && (!mech.pilot?.consciousness || mech.pilot.consciousness === 'conscious') && !weaponPhaseStartMech(mech)?.destroyed);
}

function compatibleAmmoBins(attacker, weaponEntry, shotsRequired = 1) {
  const ammoType = weaponProfile(weaponEntry)?.ammoType;
  if (!ammoType) return [];
  const mountId = weaponMountId(weaponEntry, BT_UNITS[attacker.unitId].weapons.indexOf(weaponEntry));
  // An LB-X bin's Round 1 loadout determines its ammunition type. Selecting
  // the bin is therefore the firing-mode choice; never hide another valid
  // LB-X bin merely because the currently selected bin has a different load.
  return (weaponPhaseStartMech(attacker).ammoBins || []).filter(bin =>
    bin.type === ammoType && bin.shots >= shotsRequired && !bin.destroyed
  );
}

function weaponFireMode(mountId, weaponEntry) {
  if (weaponEntry?.key?.startsWith('uac')) return weaponAttackState.fireModesByMount[mountId] || 'single';
  if (weaponEntry?.key === 'lb10x') return weaponAttackState.fireModesByMount[mountId] || 'slug';
  return 'single';
}

function weaponShotsForMode(mountId, weaponEntry) {
  return weaponFireMode(mountId, weaponEntry) === 'rapid' ? 2 : 1;
}

function ammoBinLabel(bin) {
  const loadout = bin.loadType ? ` · ${bin.loadType[0].toUpperCase()}${bin.loadType.slice(1)}` : '';
  const guidance = bin.artemisCapable ? ' · Artemis IV' : bin.narcCapable ? ' · Narc-capable' : '';
  return `${bin.location}${loadout}${guidance} · ${bin.shots}/${bin.maxShots} shots`;
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
  if (diff === 0) return 'front';
  if (diff === 1) return 'side-right';
  if (diff === 5) return 'side-left';
  return 'rear';
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

// Keep this deliberately aligned with the database resolver: walk the same
// deterministic shortest path (the first direction that reduces range) and
// test only intervening hexes. A ridge blocks this introductory elevation-LOS
// layer when it rises above both BattleMechs.
function elevationBlocksLineOfSight(attacker, target) {
  const attackerElevation = elevationAt(attacker.col, attacker.row);
  const targetElevation = elevationAt(target.col, target.row);
  let current = { col: attacker.col, row: attacker.row };
  let remaining = axialDistance(current.col, current.row, target.col, target.row);
  while (remaining > 1) {
    current = hexNeighbor(current.col, current.row, weaponDirectionTo(current, target));
    if (elevationAt(current.col, current.row) > Math.max(attackerElevation, targetElevation)) return true;
    remaining = axialDistance(current.col, current.row, target.col, target.row);
  }
  return false;
}

function evaluateWeaponAttack(attacker, target, weaponEntry, options = {}) {
  const eligibleAttacker = weaponPhaseStartMech(attacker);
  const eligibleTarget = weaponPhaseStartMech(target);
  const weapon = weaponProfile(weaponEntry);
  if (!weapon || eligibleAttacker.destroyed || eligibleTarget.destroyed || attacker.owner === target.owner) {
    return { valid: false, reason: 'Choose a valid enemy target and supported weapon.' };
  }
  const mountId = weaponMountId(weaponEntry, BT_UNITS[attacker.unitId].weapons.indexOf(weaponEntry));
  if ((eligibleAttacker.weaponJams || []).includes(mountId)) return { valid: false, reason: `${weapon.name} is jammed.` };
  const supportArm = attacker.proneSupportArm;
  const weaponLocation = typeof criticalLocationKey === 'function'
    ? criticalLocationKey(weaponEntry.location)
    : weaponEntry.location.toLowerCase().includes('left arm') ? 'la'
      : weaponEntry.location.toLowerCase().includes('right arm') ? 'ra' : null;
  if (attacker.prone && (Number(eligibleAttacker.structure?.la || 0) <= 0 || Number(eligibleAttacker.structure?.ra || 0) <= 0)) return { valid: false, reason: 'A prone BattleMech cannot fire after either arm is destroyed.' };
  if (attacker.prone && !['la', 'ra'].includes(supportArm)) return { valid: false, reason: 'Choose a supporting arm before firing while prone.' };
  if (attacker.prone && weaponLocation === supportArm) return { valid: false, reason: 'Supporting-arm weapons cannot fire while prone.' };
  if (attacker.prone && ['ll', 'rl'].includes(weaponLocation)) return { valid: false, reason: 'Leg-mounted weapons cannot fire while prone.' };
  if (weaponLocationDestroyed(eligibleAttacker, weaponEntry)) return { valid: false, reason: `${weapon.name} was mounted in a location destroyed before this phase.` };
  if (typeof weaponsDisabledByCritical === 'function' && weaponsDisabledByCritical(eligibleAttacker)) return { valid: false, reason: 'Sensors were destroyed before this phase.' };
  if (typeof isWeaponCriticallyDestroyed === 'function' && isWeaponCriticallyDestroyed(eligibleAttacker, weaponEntry)) return { valid: false, reason: `${weapon.name} was destroyed before this phase.` };
  const distance = axialDistance(attacker.col, attacker.row, target.col, target.row);
  const range = weaponRangeModifier(weapon, distance);
  if (!range) return { valid: false, reason: `${weapon.name} is beyond long range (${distance} hexes).` };
  const indirect = Boolean(options.indirect);
  const spotter = options.spotter;
  if (indirect && !weaponEntry.key?.startsWith('lrm')) return { valid: false, reason: 'Only LRM weapons may fire indirectly.' };
  if (indirect && weaponLineOfSight(attacker, target).valid) return { valid: false, reason: 'Indirect fire is unavailable while the attacker has direct line of sight.' };
  if (indirect && (!spotter || !eligibleIndirectSpotters(attacker, target).some(candidate => candidate.instanceId === spotter.instanceId))) return { valid: false, reason: 'Choose a friendly spotter with line of sight.' };
  const facing = weaponArcFacing(weaponEntry, attacker);
  if (!indirect && !isInForwardArc(facing, weaponDirectionTo(attacker, target))) {
    return { valid: false, reason: `${weapon.name} target is outside its firing arc.` };
  }
  const attackerMove = movementToHitModifier(attacker);
  const targetMove = targetMovementModifier(target);
  const observer = indirect ? spotter : attacker;
  const woods = woodsBetween(observer, target);
  if (!indirect && woods >= 3) return { valid: false, reason: 'Line of sight is blocked by intervening woods.' };
  if (!indirect && elevationBlocksLineOfSight(attacker, target)) return { valid: false, reason: 'Line of sight is blocked by an intervening ridge.' };
  const targetWoods = terrainAt(target.col, target.row) === 'heavy_woods' ? 2 : terrainAt(target.col, target.row) === 'light_woods' ? 1 : 0;
  const sensorCritical = typeof criticalToHitModifier === 'function' ? criticalToHitModifier(eligibleAttacker) : 0;
  const critical = sensorCritical + weaponComponentToHitModifier(eligibleAttacker, weaponEntry);
  const heat = weaponHeatToHitModifier(eligibleAttacker);
  const gunnery = eligibleAttacker.pilot?.gunnery ?? 4;
  const clusterModifier = weaponEntry.key === 'lb10x' && weaponFireMode(mountId, weaponEntry) === 'cluster' ? -1 : 0;
  const accuracyModifier = Number(weapon.toHitModifier || 0);
  const indirectModifier = indirect ? 1 : 0;
  const spotterMovement = indirect ? movementToHitModifier(spotter) : 0;
  const partialCover = terrainAt(target.col, target.row) === 'shallow_water' && !eligibleTarget.prone ? 1 : 0;
  return {
    valid: true,
    weapon,
    distance,
    range,
    targetNumber: gunnery + attackerMove + targetMove + range.modifier + woods + targetWoods + critical + heat + (attacker.prone ? 2 : 0) + (target.prone ? (distance === 1 ? -2 : 1) : 0) + clusterModifier + accuracyModifier + indirectModifier + spotterMovement + partialCover,
    attackAngle: attackDirection(attacker, target),
    breakdown: `Gunnery ${gunnery} + move ${attackerMove} + target ${targetMove} + ${range.label.toLowerCase()} ${range.modifier} + woods ${woods + targetWoods}${indirect ? ` + indirect 1 + spotter move ${spotterMovement}` : ''}${critical ? ` + damage ${critical}` : ''}${heat ? ` + heat ${heat}` : ''}${attacker.prone ? ' + prone 2' : ''}${target.prone ? `${distance === 1 ? ' - prone target 2' : ' + prone target 1'}` : ''}${partialCover ? ' + partial cover 1' : ''}${clusterModifier ? ' - LB-X cluster 1' : ''}${accuracyModifier ? ' - pulse laser 2' : ''}`
  };
}

async function setProneWeaponSupportArm(instanceId, arm) {
  const { error } = await db.rpc('set_prone_weapon_support_arm', { p_game_id: currentGameId, p_instance_id: instanceId, p_arm: arm });
  if (error) { flashMoveWarning(error.message); return; }
  await loadGameState();
  weaponAttackState.weaponKeys = [];
  weaponAttackState.ammoBinsByMount = {};
  weaponAttackState.fireModesByMount = {};
  renderWeaponAttackPanel();
}

function selectWeaponAttacker(instanceId) {
  const mech = mechInstances.find(m => m.instanceId === instanceId);
  if (!canFireFromWeaponPhaseStart(mech) || mech.owner !== mySeatNumber || !isMyActiveTurn() || currentGameState.phase !== 'weapon_attack' || mech.hasFired) return;
  weaponAttackState = { attackerId: instanceId, targetId: null, weaponKeys: [], ammoBinsByMount: {}, fireModesByMount: {} };
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
  weaponAttackState.fireModesByMount = {};
  weaponAttackState.indirect = false;
  weaponAttackState.spotterId = null;
  renderWeaponAttackPanel();
}

function toggleWeaponForAttack(mountId) {
  const attacker = mechInstances.find(m => m.instanceId === weaponAttackState.attackerId);
  const entry = attacker && BT_UNITS[attacker.unitId].weapons.find((weapon, index) => weaponMountId(weapon, index) === mountId);
  const selected = weaponAttackState.weaponKeys;
  if (selected.includes(mountId)) {
    weaponAttackState.weaponKeys = selected.filter(id => id !== mountId);
    delete weaponAttackState.ammoBinsByMount[mountId];
    delete weaponAttackState.fireModesByMount[mountId];
  } else {
    weaponAttackState.weaponKeys = [...selected, mountId];
    const bins = entry ? compatibleAmmoBins(attacker, entry) : [];
    if (bins.length) {
      weaponAttackState.ammoBinsByMount[mountId] = bins[0].id;
      // Start on the ammunition type chosen during Round 1. This avoids a
      // Cluster-only bin being rejected by the old implicit Slug default.
      if (entry?.key === 'lb10x') weaponAttackState.fireModesByMount[mountId] = bins[0].loadType || 'slug';
    }
  }
  renderWeaponAttackPanel();
}

function selectWeaponFireMode(mountId, mode) {
  const attacker = mechInstances.find(m => m.instanceId === weaponAttackState.attackerId);
  const entry = attacker && BT_UNITS[attacker.unitId].weapons.find((weapon, index) => weaponMountId(weapon, index) === mountId);
  const validModes = entry?.key?.startsWith('uac') ? ['single', 'rapid'] : [];
  if (!entry || !validModes.includes(mode)) return;
  const bins = (weaponPhaseStartMech(attacker).ammoBins || []).filter(bin =>
    bin.type === weaponProfile(entry)?.ammoType && bin.shots >= (mode === 'rapid' ? 2 : 1) && !bin.destroyed &&
    (entry.key !== 'lb10x' || !bin.loadType || bin.loadType === mode)
  );
  if (!bins.length) {
    flashMoveWarning(mode === 'rapid' ? 'Rapid fire requires two rounds in one selected Ultra AC ammunition bin.' : 'Choose an LB-X ammunition bin loaded for that ammunition type.');
    return;
  }
  weaponAttackState.fireModesByMount[mountId] = mode;
  if (!bins.some(bin => bin.id === weaponAttackState.ammoBinsByMount[mountId])) weaponAttackState.ammoBinsByMount[mountId] = bins[0].id;
  renderWeaponAttackPanel();
}

function selectAmmoBinForMount(mountId, binId) {
  const attacker = mechInstances.find(m => m.instanceId === weaponAttackState.attackerId);
  const entry = attacker && BT_UNITS[attacker.unitId].weapons.find((weapon, index) => weaponMountId(weapon, index) === mountId);
  if (!entry || !compatibleAmmoBins(attacker, entry, weaponShotsForMode(mountId, entry)).some(bin => bin.id === binId)) return;
  weaponAttackState.ammoBinsByMount[mountId] = binId;
  if (entry.key === 'lb10x') {
    const bin = (weaponPhaseStartMech(attacker).ammoBins || []).find(candidate => candidate.id === binId);
    weaponAttackState.fireModesByMount[mountId] = bin?.loadType || 'slug';
  }
  renderWeaponAttackPanel();
}

function resolveDeclaredAmmoBins(attacker, selectedWeapons) {
  const choices = {};
  for (const entry of selectedWeapons) {
    const weapon = weaponProfile(entry);
    if (!weapon?.ammoType) continue;
    const mountId = weaponMountId(entry, BT_UNITS[attacker.unitId].weapons.indexOf(entry));
    const shotsRequired = weaponShotsForMode(mountId, entry);
    const bins = compatibleAmmoBins(attacker, entry, shotsRequired);
    const selectedId = weaponAttackState.ammoBinsByMount[mountId];
    const selected = bins.find(bin => bin.id === selectedId) || bins[0];
    if (!selected) return { error: `Choose an ammunition bin for ${weapon.name}.` };
    choices[mountId] = selected.id;
  }
  const fireModes = Object.fromEntries(selectedWeapons.filter(entry => entry.key?.startsWith('uac') || entry.key === 'lb10x').map(entry => {
    const mountId = weaponMountId(entry, BT_UNITS[attacker.unitId].weapons.indexOf(entry));
    return [mountId, weaponFireMode(mountId, entry)];
  }));
  return { choices, fireModes };
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

function clusterHitsForRoll(size, total) {
  const tables = { 10: [3, 3, 4, 6, 6, 6, 6, 8, 8, 10, 10] };
  return tables[size]?.[total - 2] || 0;
}

function hitLocationForRoll(roll, angle = 'front') {
  if (angle === 'rear') return ({ 2:'ct',3:'ra',4:'ra',5:'rl',6:'rt',7:'ct',8:'lt',9:'ll',10:'la',11:'la',12:'head' })[roll];
  // Mirrored side tables: attacking the target's right flank favors RA/RT,
  // attacking the left flank favors LA/LT (Total Warfare side hit-location tables).
  if (angle === 'side-right') return ({ 2:'ct',3:'ra',4:'ra',5:'rl',6:'rt',7:'rt',8:'ct',9:'lt',10:'ll',11:'la',12:'head' })[roll];
  if (angle === 'side-left') return ({ 2:'ct',3:'la',4:'la',5:'ll',6:'lt',7:'lt',8:'ct',9:'rt',10:'rl',11:'ra',12:'head' })[roll];
  if (roll === 2) return 'ct';
  if (roll === 3 || roll === 4) return 'ra';
  if (roll === 5) return 'rl';
  if (roll === 6) return 'rt';
  if (roll === 7) return 'ct';
  if (roll === 8) return 'lt';
  if (roll === 9) return 'll';
  if (roll === 12) return 'head';
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
        event.ammo_explosion ? ` ${event.ammo_explosion} ammunition exploded for ${event.damage} damage.${event.case_protected ? ` CASE vented ${event.vented_damage || 0} excess damage.` : ''}${(event.pilot_checks || []).map(formatAuthoritativePilotCheck).join('')}` :
          event.label ? ` ${hitLocationLabel(event.location)} slot ${event.slot_index + 1}: ${event.label} destroyed.` : ''
    ).join('')}`
  ).join('');
}

function formatAuthoritativePilotCheck(check) {
  if (!check) return '';
  if (check.consciousness === 'dead') return ` Pilot suffered hit ${check.hits}/6 and was killed.`;
  return ` Pilot hit ${check.hits}/6 (${check.reason}) — consciousness need ${check.target}, rolled ${check.die_a} + ${check.die_b} = ${check.total}: ${check.consciousness}.`;
}

function authoritativeWeaponResultMessage(attacker, target, result) {
  const roll = result.to_hit || {};
  const rolled = `${roll.die_a} + ${roll.die_b} = ${roll.total}`;
  const targetNumberExplanation = formatAuthoritativeTargetNumber(roll);
  const modeSuffix = result.fire_mode === 'rapid' ? ' (rapid fire)' : result.fire_mode === 'cluster' ? ' (cluster ammunition)' : '';
  if (!result.hit) return `${mechLabel(attacker)} fired ${result.weapon}${modeSuffix} at ${mechLabel(target)} — need ${roll.target}${targetNumberExplanation}, rolled ${rolled}: miss.${result.streak_no_lock ? ' Streak did not lock; no ammunition or heat expended.' : ''}${result.jammed ? ' Ultra AC jammed.' : ''}`;
  if (result.tagged) return `${mechLabel(attacker)} designated ${mechLabel(target)} with TAG — need ${roll.target}${targetNumberExplanation}, rolled ${rolled}: lock confirmed.`;
  if (result.narc_attached) return `${mechLabel(attacker)} attached a Narc beacon to ${mechLabel(target)} — need ${roll.target}${targetNumberExplanation}, rolled ${rolled}: beacon attached.`;
  if (result.cluster_roll || result.streak_lock) {
    const cluster = result.cluster_roll;
    const groups = (result.groups || []).map(group => {
      const gauss = group.gauss_explosion ? `; Gauss rifle exploded for ${group.gauss_explosion.damage} internal damage in ${hitLocationLabel(group.gauss_explosion.location)}` : '';
      return group.partial_cover ? `${hitLocationLabel(group.location)} — absorbed by partial cover` : `${hitLocationLabel(group.location)} ${group.damage}${formatAuthoritativeCriticals(group.critical_checks)}${gauss}${formatAuthoritativePilotCheck(group.pilot_check)}`;
    }).join('; ');
    const pellets = result.cluster_kind === 'lb_x' ? 'pellet' : 'missile';
    const clusterText = result.streak_lock ? 'Streak lock confirmed' : `Cluster roll ${cluster.die_a} + ${cluster.die_b} = ${cluster.total}${cluster.modified_total && cluster.modified_total !== cluster.total ? `, modified to ${cluster.modified_total}` : ''}`;
    const defence = result.ams ? ' AMS engaged.' : result.narc_guided ? ' Narc guidance applied.' : result.artemis_guided ? ' Artemis IV guidance applied.' : '';
    return `${mechLabel(attacker)} fired ${result.weapon}${modeSuffix} at ${mechLabel(target)} — need ${roll.target}${targetNumberExplanation}, rolled ${rolled}: hit. ${clusterText}: ${result.missiles_hit} ${pellets}${result.missiles_hit === 1 ? '' : 's'} hit in ${result.groups?.length || 0} group${result.groups?.length === 1 ? '' : 's'} — ${groups}.${defence}`;
  }
  const criticals = formatAuthoritativeCriticals(result.critical_checks);
  const gaussExplosion = result.gauss_explosion ? ` Gauss rifle exploded for ${result.gauss_explosion.damage} internal damage in ${hitLocationLabel(result.gauss_explosion.location)}.` : '';
  const flamerHeat = result.heat_inflicted ? ` ${mechLabel(target)} gains ${result.heat_inflicted} heat.` : '';
  if (result.partial_cover) return `${mechLabel(attacker)} fired ${result.weapon}${modeSuffix} at ${mechLabel(target)} — need ${roll.target}${targetNumberExplanation}, rolled ${rolled}: ${hitLocationLabel(result.location)} hit absorbed by partial cover.`;
  return `${mechLabel(attacker)} fired ${result.weapon}${modeSuffix} at ${mechLabel(target)} — need ${roll.target}${targetNumberExplanation}, rolled ${rolled}: ${result.angle} hit ${hitLocationLabel(result.location)} for ${result.damage} damage.${flamerHeat}${criticals}${gaussExplosion}${formatAuthoritativePilotCheck(result.pilot_check)}`;
}

function formatAuthoritativeTargetNumber(roll) {
  const b = roll?.breakdown;
  if (!b || typeof b.gunnery !== 'number') return '';
  const labels = [['attacker_movement', 'attacker movement'], ['spotter_movement', 'spotter movement'], ['target_movement', 'target movement'], ['range', 'range'], ['woods', 'woods'], ['partial_cover', 'partial cover'], ['indirect_fire', 'indirect fire'], ['spotter_firing', 'spotter firing'], ['sensors', 'sensors'], ['heat', 'heat'], ['component_damage', 'damage'], ['prone', 'prone'], ['target_prone', 'prone target'], ['lb_x_cluster', 'LB-X cluster'], ['weapon_accuracy', 'weapon accuracy']];
  const terms = [`Gunnery ${b.gunnery}`];
  for (const [key, label] of labels) {
    const value = Number(b[key] || 0);
    if (value) terms.push(`${value < 0 ? '−' : '+'} ${label} ${Math.abs(value)}`);
  }
  return ` (${terms.join(' ')})`;
}

function weaponDeclarationSummary(attacker, mountIds, fireModes = {}) {
  const weapons = BT_UNITS[attacker?.unitId]?.weapons || [];
  const counts = new Map();
  for (const mountId of mountIds || []) {
    const entry = weapons.find((weapon, index) => weaponMountId(weapon, index) === mountId);
    const modeSuffix = fireModes[mountId] === 'rapid' ? ' (rapid fire)' : fireModes[mountId] === 'cluster' ? ' (cluster ammunition)' : '';
    const name = `${weaponProfile(entry)?.name || entry?.key || mountId}${modeSuffix}`;
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
      phase: event.phase, cat: 'attack', team: attacker.owner,
      msg: mounts.length
        ? `${mechLabel(attacker)} declared ${weaponDeclarationSummary(attacker, mounts, event.declaration?.ammo_bins?.__fire_modes)}${event.declaration?.ammo_bins?.__indirect ? ` indirectly using ${mechLabel(mechInstances.find(mech => mech.instanceId === event.declaration.ammo_bins.__spotter))} as spotter` : ''} at ${mechLabel(target)}.`
        : `${mechLabel(attacker)} declared no weapon fire.`
    });
    if (event.status !== 'resolved' || !['simultaneous-declarations-01', 'alternating-activations-01'].includes(event.resolution?.state_version)) continue;
    const resolvedAt = Date.parse(event.resolved_at || '') || Date.now();
    const results = event.resolution?.results || [];
    if (!results.length) continue;
    results.forEach((result, index) => entries.push({
      id: `combat-${event.id}-${index}`, ts: resolvedAt + event.sequence * 100 + index,
      time: new Date(resolvedAt).toTimeString().slice(0, 8), round: event.round,
      phase: event.phase, cat: 'attack', team: attacker.owner, msg: authoritativeWeaponResultMessage(attacker, target, result)
    }));
    (event.resolution?.piloting_checks || []).forEach((check, index) => entries.push({
      id: `weapon-psr-${event.id}-${index}`, ts: resolvedAt + event.sequence * 100 + results.length + index + 1,
      time: new Date(resolvedAt).toTimeString().slice(0, 8), round: event.round,
      phase: event.phase, cat: 'roll', msg: authoritativePilotingResultMessage(check)
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
  const submitButton = document.getElementById('weapon-submit');
  if (submitButton) { submitButton.disabled = true; submitButton.textContent = 'Submitting Declaration…'; }
  showGameToast(`${mechLabel(attacker)} weapon declaration submitted. Waiting for the server.`, 'success');
  const { data, error } = await db.rpc('submit_simultaneous_weapon_declaration', {
    p_game_id: currentGameId,
    p_attacker_instance_id: attacker.instanceId,
    p_target_instance_id: target?.instanceId || null,
    p_weapon_mounts: selectedWeapons.map((entry, index) => {
      const catalogueIndex = BT_UNITS[attacker.unitId].weapons.indexOf(entry);
      return weaponMountId(entry, catalogueIndex >= 0 ? catalogueIndex : index);
    }),
    p_ammo_bins: { ...ammoDeclaration.choices, __fire_modes: ammoDeclaration.fireModes, __indirect: Boolean(weaponAttackState.indirect), __spotter: weaponAttackState.spotterId }
  });
  if (error) {
    if (submitButton) { submitButton.disabled = false; submitButton.textContent = 'Confirm Weapon Attacks'; }
    logEvent(`Server rejected the weapon declaration: ${error.message}`, 'error');
    flashMoveWarning(error.message);
    showGameToast(`Weapon declaration was rejected: ${error.message}`, 'error');
    return;
  }
  weaponAttackState = { attackerId: null, targetId: null, weaponKeys: [], ammoBinsByMount: {}, fireModesByMount: {} };
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
  const spotter = mechInstances.find(m => m.instanceId === weaponAttackState.spotterId);
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
    const mountId = weaponMountId(weaponEntry, BT_UNITS[attacker.unitId].weapons.indexOf(weaponEntry));
    const shots = weaponEntry.count * weaponShotsForMode(mountId, weaponEntry);
    const rapid = weaponFireMode(mountId, weaponEntry) === 'rapid';
    addedHeat += attack.weapon.heat * shots;
    for (let shot = 1; shot <= shots; shot++) {
      const roll = roll2d6Detailed();
      const jammed = rapid && roll.total === 2;
      const hit = !jammed && (attack.targetNumber <= 2 || (attack.targetNumber <= 12 && roll.total >= attack.targetNumber));
      const shotLabel = shots > 1 ? ` #${shot}` : '';
      if (!hit) {
        messages.push(`${mechLabel(attacker)} fired ${attack.weapon.name}${rapid ? ' (rapid fire)' : ''}${shotLabel} at ${mechLabel(target)} — need ${attack.targetNumber} (${attack.breakdown}), rolled ${format2d6(roll)}: miss.${jammed ? ' Ultra AC jammed.' : ''}`);
        if (jammed) {
          attacker.weaponJams = [...new Set([...(attacker.weaponJams || []), mountId])];
          break;
        }
        continue;
      }
      if (weaponEntry.key === 'lb10x' && weaponFireMode(mountId, weaponEntry) === 'cluster') {
        const clusterRoll = roll2d6Detailed();
        const pellets = clusterHitsForRoll(10, clusterRoll.total);
        const groups = [];
        for (let pellet = 0; pellet < pellets; pellet++) {
          const damage = applyWeaponDamage(target, 1, attack.attackAngle);
          groups.push(hitLocationLabel(damage.location));
        }
        messages.push(`${mechLabel(attacker)} fired ${attack.weapon.name} (cluster ammunition)${shotLabel} at ${mechLabel(target)} — need ${attack.targetNumber}, rolled ${format2d6(roll)}: hit. Cluster roll ${format2d6(clusterRoll)}: ${pellets} pellet${pellets === 1 ? '' : 's'} hit${groups.length ? ` (${groups.join(', ')}).` : '.'}`);
        continue;
      }
      const damage = applyWeaponDamage(target, attack.weapon.damage, attack.attackAngle);
      const flamerHeat = weaponEntry.key === 'flamer' ? 2 : 0;
      if (flamerHeat) {
        target.externalHeat = (target.externalHeat || 0) + flamerHeat;
        target.heat = (target.heat || 0) + flamerHeat;
      }
      messages.push(`${mechLabel(attacker)} fired ${attack.weapon.name}${rapid ? ' (rapid fire)' : ''}${shotLabel} at ${mechLabel(target)} — need ${attack.targetNumber}, rolled ${format2d6(roll)}: ${attack.attackAngle} hit ${hitLocationLabel(damage.location)} for ${attack.weapon.damage} damage.${flamerHeat ? ` ${mechLabel(target)} gains ${flamerHeat} heat.` : ''}${damage.criticalEvents.length ? ` ${damage.criticalEvents.join(' ')}` : ''}${damage.destroyedLocations.length ? ` Destroyed: ${damage.destroyedLocations.map(hitLocationLabel).join(', ')}.` : ''}${damage.destroyed ? ' Target destroyed.' : ''}`);
    }
  }

  attacker.weaponHeat = (attacker.weaponHeat || 0) + addedHeat;
  attacker.heat = (attacker.roundStartingHeat || 0) + (attacker.movementHeat || 0) + attacker.weaponHeat + (attacker.externalHeat || 0);
  attacker.hasFired = true;
  weaponAttackState = { attackerId: null, targetId: null, weaponKeys: [], ammoBinsByMount: {}, fireModesByMount: {} };
  renderWeaponAttackPanel();
  renderRoster();
  renderDetail();
  draw();
  updateAdvanceButtonState();
  // Give immediate feedback before the shared-state write has completed.
  // The detailed resolution is logged after the save so it remains in order
  // for the other player as well.
  logEvent(`${mechLabel(attacker)} weapon attack submitted — saving outcome.`, 'attack', attacker.owner);
  await syncMechInstances();
  await checkForMatchEnd();
  if (messages.length) messages.forEach(message => logEvent(message, 'attack', attacker.owner));
  else logEvent(`${mechLabel(attacker)} declared no weapon attacks.`, 'attack', attacker.owner);
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
  const spotter = mechInstances.find(m => m.instanceId === weaponAttackState.spotterId);

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

  const displacementAttack = weaponPhaseStartMech(attacker)?.dfaDeclaration ? 'Death From Above' : weaponPhaseStartMech(attacker)?.chargeDeclaration ? 'a Charge' : null;
  if (displacementAttack) {
    panel.innerHTML = `<div class="panel-eyebrow">Weapon Attack — Death From Above</div>
      <div style="font-size:11px;color:var(--amber);line-height:1.55;margin-bottom:8px;">${mechLabel(attacker)} is committed to ${displacementAttack}. It cannot fire weapons this turn.</div>
      <button id="weapon-submit" onclick="confirmWeaponAttack()" style="width:100%;${MOVE_BTN_STYLE}text-align:center;">Confirm No Fire</button>`;
    return;
  }

  const enemies = mechInstances.filter(m => m.owner !== attacker.owner && canFireFromWeaponPhaseStart(m));
  const supportPicker = attacker.prone ? `<div style="font-size:10px;color:var(--amber);margin-bottom:7px;">PRONE SUPPORT ARM — choose the arm holding the BattleMech up.</div><div style="display:flex;gap:6px;margin-bottom:8px;">${['la','ra'].map(arm => `<button onclick="setProneWeaponSupportArm('${attacker.instanceId}','${arm}')" style="flex:1;padding:7px;border:1px solid ${attacker.proneSupportArm === arm ? 'var(--amber)' : 'var(--panel-line)'};background:${attacker.proneSupportArm === arm ? 'rgba(212,128,10,.18)' : 'transparent'};color:var(--paper);font:9px var(--mono);cursor:pointer;">${attacker.proneSupportArm === arm ? '✓ ' : ''}${arm === 'la' ? 'Left Arm' : 'Right Arm'}</button>`).join('')}</div>` : '';
  const spotters = target ? eligibleIndirectSpotters(attacker, target) : [];
  const attackerHasLrm = BT_UNITS[attacker.unitId].weapons.some(entry => entry.key?.startsWith('lrm'));
  const indirectControls = target && attackerHasLrm ? `<div style="border:1px solid var(--panel-line);padding:7px;margin:7px 0;font:9px var(--mono);color:var(--paper);"><label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" onchange="setIndirectFire(this.checked)" ${weaponAttackState.indirect ? 'checked' : ''}> LRM INDIRECT FIRE</label>${weaponAttackState.indirect ? `<div style="margin-top:6px;color:var(--phosphor-dim);">Attacker must lack direct LOS. Choose a friendly spotter:</div><div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;">${spotters.map(candidate => `<button onclick="selectIndirectSpotter('${candidate.instanceId}')" style="padding:5px;border:1px solid ${spotter?.instanceId === candidate.instanceId ? 'var(--amber)' : 'var(--panel-line)'};background:transparent;color:var(--paper);font:9px var(--mono);">${mechLabel(candidate)}</button>`).join('') || 'No eligible spotter has line of sight.'}</div>` : ''}</div>` : '';
  const weaponRows = BT_UNITS[attacker.unitId].weapons.map((entry, index) => {
    const mountId = weaponMountId(entry, index);
    const checked = weaponAttackState.weaponKeys.includes(mountId);
    const evaluation = target ? evaluateWeaponAttack(attacker, target, entry, { indirect: weaponAttackState.indirect, spotter }) : null;
    const weapon = weaponProfile(entry);
    if (weapon?.supportOnly) return '';
    const shotsRequired = weaponShotsForMode(mountId, entry);
    const bins = compatibleAmmoBins(attacker, entry, shotsRequired);
    const outOfAmmo = Boolean(weapon?.ammoType) && bins.length === 0;
    const disabled = outOfAmmo || (target && !evaluation.valid);
    const countLabel = entry.count > 1 ? ` ×${entry.count}` : '';
    const heat = weapon ? weapon.heat * entry.count : '?';
    const binPicker = checked && weapon?.ammoType ? `<label style="display:flex;gap:6px;align-items:center;margin:4px 0 7px;font:9px var(--mono);color:var(--phosphor-dim);">AMMO BIN<select onchange="selectAmmoBinForMount('${mountId}',this.value)" style="flex:1;font:10px var(--mono);padding:4px;">${bins.map(bin => `<option value="${bin.id}" ${weaponAttackState.ammoBinsByMount[mountId] === bin.id ? 'selected' : ''}>${ammoBinLabel(bin)}</option>`).join('')}</select></label>` : '';
    const ultra = weapon?.key?.startsWith('uac');
    const modePicker = checked && ultra ? `<div style="display:flex;gap:5px;margin:0 0 7px;"><button onclick="selectWeaponFireMode('${mountId}','single')" style="flex:1;padding:5px;border:1px solid ${weaponFireMode(mountId, entry) === 'single' ? 'var(--amber)' : 'var(--panel-line)'};background:${weaponFireMode(mountId, entry) === 'single' ? 'rgba(212,128,10,.18)' : 'transparent'};color:var(--paper);font:9px var(--mono);cursor:pointer;">SINGLE · 1 AMMO / ${weapon.heat} HEAT</button><button onclick="selectWeaponFireMode('${mountId}','rapid')" style="flex:1;padding:5px;border:1px solid ${weaponFireMode(mountId, entry) === 'rapid' ? 'var(--amber)' : 'var(--panel-line)'};background:${weaponFireMode(mountId, entry) === 'rapid' ? 'rgba(212,128,10,.18)' : 'transparent'};color:var(--paper);font:9px var(--mono);cursor:pointer;">RAPID · 2 AMMO / ${weapon.heat * 2} HEAT</button></div>` : '';
    return `<div><button onclick="toggleWeaponForAttack('${mountId}')" ${disabled ? 'disabled' : ''} style="width:100%;margin-top:5px;padding:7px 8px;border:1px solid ${checked ? 'var(--amber)' : 'var(--panel-line)'};background:${checked ? 'rgba(212,128,10,.18)' : 'transparent'};color:${disabled ? 'var(--phosphor-dim)' : 'var(--paper)'};font-family:var(--mono);font-size:10px;text-align:left;cursor:${disabled ? 'not-allowed' : 'pointer'};">${checked ? '✓ ' : ''}${weapon?.name || entry.key}${countLabel} · ${weapon?.damage || '?'} max dmg / ${ultra && weaponFireMode(mountId, entry) === 'rapid' ? heat * 2 : heat} heat · ${entry.location}${outOfAmmo ? ' · no compatible ammunition' : evaluation ? ` · ${evaluation.valid ? `${evaluation.range.label}, TN ${evaluation.targetNumber}` : evaluation.reason}` : ''}</button>${binPicker}${modePicker}</div>`;
  }).join('');

  panel.innerHTML = `
    <div class="panel-eyebrow">Weapon Attack — Declaration</div>
    <div style="font-size:11px;color:var(--paper);margin-bottom:8px;">${mechLabel(attacker)} · heat ${attacker.heat || 0}${attacker.prone ? ' · PRONE (+2 to hit)' : ''}</div>
    ${supportPicker}
    <div style="font-size:10px;color:var(--phosphor-dim);margin-bottom:4px;">TARGET</div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;">${enemies.map(enemy => `<button onclick="selectWeaponTarget('${enemy.instanceId}')" style="padding:6px;border:1px solid ${target?.instanceId === enemy.instanceId ? 'var(--amber)' : 'var(--panel-line)'};background:transparent;color:var(--paper);font:9px var(--mono);cursor:pointer;">${mechLabel(enemy)}</button>`).join('')}</div>
    ${target ? `<div style="font-size:10px;color:var(--amber);margin-bottom:4px;">TARGET: ${mechLabel(target)}</div>${indirectControls}${weaponRows}` : '<div style="font-size:11px;color:var(--phosphor-dim);">Select a target to see eligible weapons and target numbers.</div>'}
    <button id="weapon-submit" onclick="confirmWeaponAttack()" style="width:100%;margin-top:9px;${MOVE_BTN_STYLE}text-align:center;">${weaponAttackState.weaponKeys.length ? 'Confirm Weapon Attacks' : 'No Fire / Complete Attacks'}</button>`;
}
