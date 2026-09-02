// ── WEAPON ATTACK PHASE ──────────────────────────────────
// This first pass implements player declarations and resolution for the
// standard weapons in BT_WEAPONS.  Critical-hit slot damage and primary
// component effects are resolved from the BattleMech record sheet.

function emptyWeaponAttackState() {
  return { attackerId: null, targetId: null, primaryTargetId: null, targetAssignments: {}, weaponKeys: [], ammoBinsByMount: {}, fireModesByMount: {}, aimLocationsByMount: {}, indirect: false, indirectTargetId: null, spotterId: null, armsFlipped: false };
}
let weaponAttackState = emptyWeaponAttackState();

function weaponLineOfSight(observer, target) {
  const sight = analyseWeaponLineOfSight(observer, target);
  return { valid: sight.valid, woods: sight.terrainModifier, reason: sight.reason, partialCover: sight.partialCover };
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
  weaponAttackState.indirectTargetId = weaponAttackState.indirect ? weaponAttackState.targetId : null;
  if (!weaponAttackState.indirect) weaponAttackState.spotterId = null;
  renderWeaponAttackPanel();
}

function selectIndirectSpotter(instanceId) {
  weaponAttackState.spotterId = instanceId;
  weaponAttackState.weaponKeys = [];
  weaponAttackState.aimLocationsByMount = {};
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

// Shutdown and unconscious BattleMechs cannot fire, but they remain legal
// targets. Destruction is checked against the phase-start snapshot so that
// simultaneous weapon declarations remain valid until resolution.
function canBeWeaponTarget(mech) {
  return Boolean(mech && !isEnemyHiddenUnit(mech) && !weaponPhaseStartMech(mech)?.destroyed);
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
  const key = weaponProfile(weaponEntry)?.key || weaponEntry?.key;
  if (key?.startsWith('uac')) return weaponAttackState.fireModesByMount[mountId] || 'single';
  if (key?.startsWith('rac')) return weaponAttackState.fireModesByMount[mountId] || '1';
  if (key === 'lb10x') return weaponAttackState.fireModesByMount[mountId] || 'slug';
  return 'single';
}

function weaponShotsForMode(mountId, weaponEntry) {
  const key = weaponProfile(weaponEntry)?.key || weaponEntry?.key;
  if (key?.startsWith('rac')) return Math.max(1, Math.min(6, Number(weaponFireMode(mountId, weaponEntry)) || 1));
  return weaponFireMode(mountId, weaponEntry) === 'rapid' ? 2 : 1;
}

function ammoBinLabel(bin) {
  const loadoutLabels = { semi_guided:'Semi-guided',armor_piercing:'Armor-piercing',fragmentation:'Fragmentation',flechette:'Flechette',er:'ATM ER',he:'ATM HE',standard:'Standard' };
  const loadout = bin.loadType ? ` · ${loadoutLabels[bin.loadType] || `${bin.loadType[0].toUpperCase()}${bin.loadType.slice(1)}`}` : '';
  const guidance = bin.artemisCapable ? ' · Artemis IV' : bin.narcCapable ? ' · Narc-capable' : '';
  return `${bin.location}${loadout}${guidance} · ${bin.shots}/${bin.maxShots} shots`;
}

function selectedAmmoLoadType(attacker, weaponEntry) {
  const mountId = weaponMountId(weaponEntry, BT_UNITS[attacker.unitId].weapons.indexOf(weaponEntry));
  const selectedId = weaponAttackState.ammoBinsByMount[mountId];
  const bins = compatibleAmmoBins(attacker, weaponEntry);
  return (bins.find(bin => bin.id === selectedId) || bins[0])?.loadType || 'standard';
}

function selectedAmmoBin(attacker, weaponEntry) {
  const mountId = weaponMountId(weaponEntry, BT_UNITS[attacker.unitId].weapons.indexOf(weaponEntry));
  const bins = compatibleAmmoBins(attacker, weaponEntry);
  return bins.find(bin => bin.id === weaponAttackState.ammoBinsByMount[mountId]) || bins[0] || null;
}

function mmlAmmoMode(attacker, weaponEntry) {
  const bin = selectedAmmoBin(attacker, weaponEntry);
  return bin?.loadType === 'srm' || /\bSRM\b/i.test(bin?.rawName || '') ? 'srm' : 'lrm';
}

function effectiveWeaponProfile(attacker, weaponEntry) {
  const weapon = weaponProfile(weaponEntry);
  if (weapon?.atm) {
    const loadType = selectedAmmoLoadType(attacker, weaponEntry);
    const payload = loadType === 'er' ? { damage: 1, range: [9, 18, 27], minimumRange: 0 }
      : loadType === 'he' ? { damage: 3, range: [3, 6, 9], minimumRange: 0 }
        : { damage: 2, range: [5, 10, 15], minimumRange: 4 };
    return { ...weapon, damage: Number(weapon.clusterSize || 0) * payload.damage, damagePerMissile: payload.damage, range: payload.range, minimumRange: payload.minimumRange, atmMode: loadType };
  }
  if (!weapon?.mml) return weapon;
  const rack = Number(weapon.clusterSize || String(weaponEntry.key || '').match(/\d+/)?.[0] || 0);
  return mmlAmmoMode(attacker, weaponEntry) === 'srm'
    ? { ...weapon, damage: rack * 2, damagePerMissile: 2, range: [3, 6, 9], minimumRange: 0, mmlMode: 'srm' }
    : { ...weapon, damage: rack, damagePerMissile: 1, range: [7, 14, 21], minimumRange: 6, mmlMode: 'lrm' };
}

function effectiveWeaponDamage(weapon, distance) {
  if (!Array.isArray(weapon?.damageByRange)) return Number(weapon?.damage || 0);
  return Number(weapon.damageByRange[distance <= weapon.range[0] ? 0 : distance <= weapon.range[1] ? 1 : 2] || 0);
}

function isIndirectCapableWeapon(attacker, weaponEntry) {
  const weapon = weaponProfile(weaponEntry);
  return weaponEntry?.key?.startsWith('lrm') || weapon?.thunderbolt || (weapon?.mml && mmlAmmoMode(attacker, weaponEntry) === 'lrm');
}

function terrainLosPoints(terrain, intervening = true) {
  if (terrain === 'heavy_woods' || terrain === 'heavy_smoke') return 2;
  if (terrain === 'light_woods' || terrain === 'light_smoke' || terrain === 'fire') return 1;
  if (intervening && terrain === 'building') return 3;
  return 0;
}

function battleMechLosHeight(mech) {
  return elevationAt(mech.col, mech.row) + (mech.prone ? 1 : 2);
}

function losFeatureHeight(terrain, col, row) {
  const level = elevationAt(col, row);
  if (['light_woods', 'heavy_woods', 'light_smoke', 'heavy_smoke'].includes(terrain)) return level + 2;
  // The current map format has no separate building-height field, so a
  // building hex represents a Level 1 building.
  if (terrain === 'building') return level + 1;
  if (terrain === 'fire') return level + 1;
  return level;
}

function interveningHexes(attacker, target) {
  const hexes = [];
  let current = { col: attacker.col, row: attacker.row };
  let remaining = axialDistance(current.col, current.row, target.col, target.row);
  while (remaining > 1 && hexes.length < 40) {
    current = hexNeighbor(current.col, current.row, weaponDirectionTo(current, target));
    hexes.push(current);
    remaining = axialDistance(current.col, current.row, target.col, target.row);
  }
  return hexes;
}

// Total Warfare LOS for the currently supported ground BattleMechs. Terrain
// only intervenes when its top reaches the sight line. A target-adjacent
// Level-1 rise gives a standing target partial cover unless the attacker is
// looking down from above; depth-one water always gives that cover.
function analyseWeaponLineOfSight(observer, target) {
  const observerTerrain = terrainAt(observer.col, observer.row);
  const targetTerrain = terrainAt(target.col, target.row);
  if (observerTerrain === 'deep_water' || targetTerrain === 'deep_water') {
    return { valid: false, reason: 'Line of sight is blocked by water depth.', terrainModifier: 0, partialCover: false };
  }
  const observerHeight = battleMechLosHeight(observer);
  const targetHeight = battleMechLosHeight(target);
  let obscuration = 0;
  let blockedByTerrain = false;
  let terrainCover = false;
  const hexes = interveningHexes(observer, target);
  hexes.forEach((hex, index) => {
    const terrain = terrainAt(hex.col, hex.row);
    const level = elevationAt(hex.col, hex.row);
    const featureHeight = losFeatureHeight(terrain, hex.col, hex.row);
    const adjacentObserver = index === 0;
    const adjacentTarget = index === hexes.length - 1;
    const levelIntervenes = level >= Math.max(observerHeight, targetHeight)
      || (adjacentObserver && level >= observerHeight)
      || (adjacentTarget && level >= targetHeight);
    const featureIntervenes = featureHeight >= Math.max(observerHeight, targetHeight)
      || (adjacentObserver && featureHeight >= observerHeight)
      || (adjacentTarget && featureHeight >= targetHeight);
    if (levelIntervenes || (terrain === 'building' && featureIntervenes)) blockedByTerrain = true;
    if (featureIntervenes) obscuration += terrainLosPoints(terrain, false);
    const coverHeight = terrain === 'building' ? featureHeight : level;
    if (adjacentTarget && !target.prone && observerHeight <= targetHeight && !['light_woods', 'heavy_woods'].includes(terrain) && coverHeight === elevationAt(target.col, target.row) + 1) terrainCover = true;
  });
  const targetModifier = terrainLosPoints(targetTerrain, false);
  const partialCover = !target.prone && (targetTerrain === 'shallow_water' || terrainCover);
  const blocked = blockedByTerrain || obscuration >= 3;
  return {
    valid: !blocked,
    reason: blockedByTerrain ? 'Line of sight is blocked by intervening terrain.' : obscuration >= 3 ? 'Line of sight is blocked by intervening woods or smoke.' : '',
    terrainModifier: obscuration + targetModifier,
    interveningModifier: obscuration,
    partialCover
  };
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

function electronicEquipmentKey(label) {
  return String(label || '').toLowerCase().replace(/(?:\s*\([^)]*\))+$/, '').replace(/^(is|clan|cl)/, '').replace(/[^a-z0-9]/g, '');
}

function hasOperationalElectronicEquipment(mech, keys) {
  if (!mech || mech.destroyed || mech.shutdown) return false;
  const layout = BT_CRITICAL_LAYOUTS[mech.unitId] || {};
  const matched = [];
  for (const [location, slots] of Object.entries(layout)) {
    (slots || []).forEach((label, index) => {
      if (keys.includes(electronicEquipmentKey(label))) matched.push([location, index]);
    });
  }
  return matched.length > 0 && matched.every(([location, index]) => !(mech.criticalSlotDamage?.[location] || []).includes(index));
}

function hasOperationalEcm(mech) {
  return hasOperationalElectronicEquipment(mech, ['guardianecmsuite', 'ecmsuite', 'angelecmsuite', 'watchdogcews', 'watchdogecm']);
}

function hasOperationalActiveProbe(mech) {
  return hasOperationalElectronicEquipment(mech, ['beagleactiveprobe', 'activeprobe', 'lightactiveprobe', 'watchdogcews', 'watchdogecm']);
}

const SIGNATURE_EQUIPMENT = Object.freeze({
  null: { keys:['nullsignaturesystem'], name:'Null Signature', heat:10 },
  void: { keys:['voidsignaturesystem'], name:'Void Signature', heat:10 },
  chameleon: { keys:['chameleonlightpolarizationshield', 'chameleonlightpolarizationfield'], name:'Chameleon LPS', heat:6 }
});

function signatureModes(mech) {
  const modes = mech?.signatureModes;
  return modes && typeof modes === 'object' && !Array.isArray(modes) ? modes : {};
}

function signatureSystemActive(mech, key) {
  const system = SIGNATURE_EQUIPMENT[key];
  return Boolean(system && signatureModes(mech)[key] && hasOperationalElectronicEquipment(mech, system.keys));
}

function signatureHeat(mech) {
  return Object.entries(SIGNATURE_EQUIPMENT).reduce((total, [key, system]) => total + (signatureSystemActive(mech, key) ? system.heat : 0), 0);
}

function signatureTargetModifier(target, range) {
  if (signatureSystemActive(target, 'void')) {
    const moved = Number(target.hexesMoved || 0);
    return moved > 5 ? 0 : moved > 2 ? 1 : moved > 0 ? 2 : 3;
  }
  const byRange = range?.label === 'Medium' ? 1 : ['Long', 'Extreme', 'LOS'].includes(range?.label) ? 2 : 0;
  return byRange * ((signatureSystemActive(target, 'null') ? 1 : 0) + (signatureSystemActive(target, 'chameleon') ? 1 : 0));
}

function voidSignatureAttackerModifier(attacker) {
  return signatureSystemActive(attacker, 'void') ? 1 : 0;
}

function hasOperationalTargetingComputer(mech) {
  return hasOperationalElectronicEquipment(mech, ['targetingcomputer']);
}

function c3EquipmentRole(mech) {
  if (hasOperationalElectronicEquipment(mech, ['c3icomputer', 'improvedc3computer'])) return 'c3i';
  if (hasOperationalElectronicEquipment(mech, ['c3mastercomputer', 'c3master'])) return 'master';
  if (hasOperationalElectronicEquipment(mech, ['c3slavecomputer', 'c3slave'])) return 'slave';
  return null;
}

function enemyEcmEmitters(owner) {
  return mechInstances.filter(mech => mech.owner !== owner && hasOperationalEcm(mech));
}

function ecmInterferesLine(owner, from, to = from) {
  const emitters = enemyEcmEmitters(owner);
  const distance = axialDistance(from.col, from.row, to.col, to.row);
  const a = offsetToAxial(from.col, from.row), b = offsetToAxial(to.col, to.row);
  for (let step = 0; step <= distance; step++) {
    const fraction = distance ? step / distance : 0;
    const axial = axialRound(a.q + (b.q - a.q) * fraction, a.r + (b.r - a.r) * fraction);
    const hex = axialToOffset(axial.q, axial.r);
    if (emitters.some(emitter => axialDistance(emitter.col, emitter.row, hex.col, hex.row) <= 6)) return true;
  }
  return false;
}

function targetGuidanceEcm(attacker, target) {
  return ecmInterferesLine(attacker.owner, attacker, target);
}

function c3NetworkSupport(attacker, target) {
  const physicalDistance = axialDistance(attacker.col, attacker.row, target.col, target.row);
  const role = c3EquipmentRole(attacker);
  const network = attacker.c3Network;
  if (!role || !network?.id || network.role !== role || ecmInterferesLine(attacker.owner, attacker)) return { distance: physicalDistance, source: null, jammed: Boolean(role && network?.id) };
  const family = network.type;
  const eligible = mechInstances.filter(candidate => {
    if (candidate.owner !== attacker.owner || candidate.destroyed || candidate.c3Network?.id !== network.id || candidate.c3Network?.type !== family) return false;
    const candidateRole = c3EquipmentRole(candidate);
    if (!candidateRole || (family === 'c3i') !== (candidateRole === 'c3i')) return false;
    return !ecmInterferesLine(attacker.owner, candidate) && weaponLineOfSight(candidate, target).valid;
  });
  if (family === 'standard') {
    const pathToRoot = member => {
      const path = [], seen = new Set();
      let current = member;
      while (current && !seen.has(current.instanceId) && path.length <= 12) {
        seen.add(current.instanceId);path.push(current);
        const parentId = current.c3Network?.parentInstanceId;
        if (!parentId) return c3EquipmentRole(current) === 'master' ? path : null;
        const parent = mechInstances.find(mech => mech.instanceId === parentId && mech.c3Network?.id === network.id);
        if (!parent || c3EquipmentRole(parent) !== 'master' || ecmInterferesLine(attacker.owner,current,parent)) return null;
        current=parent;
      }
      return null;
    };
    const attackerPath = pathToRoot(attacker);
    if (!attackerPath) return { distance: physicalDistance, source: null, jammed: false };
    const rootId = attackerPath.at(-1).instanceId;
    const linked = eligible.filter(candidate => pathToRoot(candidate)?.at(-1)?.instanceId === rootId).slice(0,12);
    const source = linked.reduce((best, candidate) => !best || axialDistance(candidate.col, candidate.row, target.col, target.row) < axialDistance(best.col, best.row, target.col, target.row) ? candidate : best, null);
    return { distance: source ? Math.min(physicalDistance, axialDistance(source.col, source.row, target.col, target.row)) : physicalDistance, source, jammed: false };
  }
  const linked = eligible.filter(candidate => !ecmInterferesLine(attacker.owner, attacker, candidate)).slice(0, 6);
  const source = linked.reduce((best, candidate) => !best || axialDistance(candidate.col, candidate.row, target.col, target.row) < axialDistance(best.col, best.row, target.col, target.row) ? candidate : best, null);
  return { distance: source ? Math.min(physicalDistance, axialDistance(source.col, source.row, target.col, target.row)) : physicalDistance, source, jammed: false };
}

function targetingComputerEligibleWeapon(attacker, weaponEntry) {
  const weapon = weaponProfile(weaponEntry);
  if (!hasOperationalTargetingComputer(attacker) || !weapon || weapon.supportOnly || weapon.missileWeapon) return false;
  return !['tag', 'c3_master_tag', 'narc', 'ams'].includes(weaponEntry.key);
}

function targetingComputerCanAim(attacker, weaponEntry, mountId) {
  if (!targetingComputerEligibleWeapon(attacker, weaponEntry)) return false;
  if (/pulse/i.test(weaponProfile(weaponEntry)?.name || '') || weaponEntry.key === 'lb10x' && weaponFireMode(mountId, weaponEntry) === 'cluster') return false;
  return weaponFireMode(mountId, weaponEntry) !== 'rapid' && weaponShotsForMode(mountId, weaponEntry) === 1;
}

function electronicWarfareReadout(attacker, target) {
  const notices = [];
  if (hasOperationalEcm(attacker)) notices.push('ECM active (6 hexes)');
  if (hasOperationalActiveProbe(attacker)) notices.push(ecmInterferesLine(attacker.owner, attacker) ? 'Active Probe is inside hostile ECM' : 'Active Probe operational: hidden units and minefields are checked after Movement');
  if (hasOperationalTargetingComputer(attacker)) notices.push('Targeting Computer operational: eligible direct fire receives −1 or may make an aimed shot');
  const c3 = target ? c3NetworkSupport(attacker, target) : null;
  if (c3?.jammed) notices.push('C3 link is cut by hostile ECM');
  else if (c3?.source && c3.source.instanceId !== attacker.instanceId && c3.distance < axialDistance(attacker.col, attacker.row, target.col, target.row)) notices.push(`C3 range supplied by ${mechLabel(c3.source)}: ${c3.distance} hexes`);
  if (target && targetGuidanceEcm(attacker, target)) notices.push(`${mechLabel(target)} is ECM-protected: Artemis and Narc guidance are suppressed`);
  if (target && Number(target.taggedRound) === Number(currentGameState.round)) notices.push(`${mechLabel(target)} is TAG-designated this round`);
  if (target?.narcPod && Number(target.narcPod.round) === Number(currentGameState.round)) notices.push(`${mechLabel(target)} carries a Narc beacon`);
  for (const [key, system] of Object.entries(SIGNATURE_EQUIPMENT)) if (signatureSystemActive(attacker, key)) notices.push(`${system.name} active (+${system.heat} heat)`);
  if (target && signatureSystemActive(target, 'void')) notices.push(`${mechLabel(target)} has Void Signature protection based on movement`);
  return notices;
}

function weaponRangeModifier(weapon, distance, physicalDistance = distance) {
  if (distance <= weapon.range[0]) {
    // C3 may improve the range band, but minimum range always uses the
    // firing BattleMech's real distance to the target.
    const minimum = weapon.minimumRange && physicalDistance <= weapon.minimumRange
      ? weapon.minimumRange - physicalDistance + 1
      : 0;
    return { label: minimum ? 'Minimum' : 'Short', modifier: minimum };
  }
  if (distance <= weapon.range[1]) return { label: 'Medium', modifier: 2 };
  if (distance <= weapon.range[2]) return { label: 'Long', modifier: 4 };
  return null;
}

function weaponArcFacing(weaponEntry, attacker) {
  return /torso|head|arm/i.test(weaponEntry.location)
    ? (attacker.torsoFacing == null ? attacker.facing : attacker.torsoFacing)
    : attacker.facing;
}

function weaponArcLocation(weaponEntry) {
  const location = String(weaponEntry?.location || '').toLowerCase();
  if (location.includes('left arm')) return 'la';
  if (location.includes('right arm')) return 'ra';
  return null;
}

// Total Warfare BattleMech arcs: torso, head, and leg weapons use the
// torso's three-hex forward arc. An arm weapon uses that forward arc plus
// only its own side arc (left arm: left; right arm: right), never the rear.
function isWeaponTargetInArc(weaponEntry, attacker, targetDirection, armsFlipped = weaponAttackState.attackerId === attacker?.instanceId && weaponAttackState.armsFlipped) {
  const difference = (targetDirection - weaponArcFacing(weaponEntry, attacker) + 6) % 6;
  const location = weaponArcLocation(weaponEntry);
  if (weaponProfile(weaponEntry)?.rearMounted) return [2, 3, 4].includes(difference);
  if (armsFlipped && ['la', 'ra'].includes(location)) return [2, 3, 4].includes(difference);
  if (location === 'la') return [0, 1, 2, 5].includes(difference);
  if (location === 'ra') return [0, 1, 4, 5].includes(difference);
  return [0, 1, 5].includes(difference);
}

function weaponArcLabel(weaponEntry, attacker = null) {
  const location = weaponArcLocation(weaponEntry);
  if (weaponProfile(weaponEntry)?.rearMounted) return 'rear arc';
  if (attacker && weaponAttackState.attackerId === attacker.instanceId && weaponAttackState.armsFlipped && ['la', 'ra'].includes(location)) return 'flipped rear arc';
  if (location === 'la') return 'forward + left side arc';
  if (location === 'ra') return 'forward + right side arc';
  return 'torso forward arc';
}

function armActuatorExists(mech, label) {
  return ['la', 'ra'].some(location => (BT_CRITICAL_LAYOUTS[mech.unitId]?.[location] || []).some(slot => criticalSlotName(slot) === label));
}

function canFlipBattleMechArms(mech) {
  if (!mech || mech.prone) return false;
  const torsoFacing = mech.torsoFacing == null ? mech.facing : mech.torsoFacing;
  return torsoFacing === mech.facing && !armActuatorExists(mech, 'Lower Arm Actuator') && !armActuatorExists(mech, 'Hand Actuator');
}

function toggleWeaponArmFlip() {
  // The roster and map may select a BattleMech without going through the
  // declaration-panel picker. Bind that selection before changing attack
  // state so this control behaves identically from every selection path.
  const attacker = mechInstances.find(mech => mech.instanceId === weaponAttackState.attackerId) ||
    mechInstances.find(mech => mech.instanceId === selectedInstanceId);
  if (!canFlipBattleMechArms(attacker)) return;
  weaponAttackState.attackerId = attacker.instanceId;
  weaponAttackState.armsFlipped = !weaponAttackState.armsFlipped;
  for (const [mountId, targetId] of Object.entries(weaponAttackState.targetAssignments)) {
    const entry = BT_UNITS[attacker.unitId].weapons.find((weapon, index) => weaponMountId(weapon, index) === mountId);
    const target = mechInstances.find(mech => mech.instanceId === targetId);
    if (entry && target && !isWeaponTargetInArc(entry, attacker, weaponDirectionTo(attacker, target))) {
      delete weaponAttackState.targetAssignments[mountId];
      weaponAttackState.weaponKeys = weaponAttackState.weaponKeys.filter(id => id !== mountId);
    }
  }
  renderWeaponAttackPanel();
}

function improvisedClubTerrain(mech) {
  const terrain = mech ? terrainAt(mech.col, mech.row) : 'clear';
  if (['light_woods', 'heavy_woods'].includes(terrain)) return 'tree';
  if (terrain === 'rubble') return 'girder';
  return null;
}

function canSearchForImprovisedClub(mech) {
  if (!mech || mech.improvisedClub || !improvisedClubTerrain(mech)) return false;
  return ['la', 'ra'].every(location => (mech.structure?.[location] || 0) > 0 &&
    !physicalComponentState(mech, location, 'Shoulder').damaged &&
    physicalComponentState(mech, location, 'Hand Actuator').exists &&
    !physicalComponentState(mech, location, 'Hand Actuator').damaged);
}

async function findImprovisedClub(instanceId) {
  const attacker = mechInstances.find(mech => mech.instanceId === instanceId);
  if (!canSearchForImprovisedClub(attacker) || !isMyActiveTurn() || currentGameState.phase !== 'weapon_attack') return;
  const { data, error } = await db.rpc('find_improvised_club', { p_game_id: currentGameId, p_instance_id: instanceId });
  if (error) { flashMoveWarning(error.message); showGameToast(`Club search was rejected: ${error.message}`, 'error'); return; }
  const found = data?.found === true;
  logEvent(found ? `${mechLabel(attacker)} found a ${data.club_type === 'tree' ? 'tree' : 'girder'} club and completed its Weapon Attack action.` : `${mechLabel(attacker)} searched the rubble for a club but found nothing.`, 'phase');
  weaponAttackState = emptyWeaponAttackState();
  selectedInstanceId = null;
  await loadGameState();
  renderWeaponAttackPanel(); renderRoster(); renderDetail(); draw(); updateAdvanceButtonState();
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
  // Total Warfare hit-location arcs use all three forward hexes. The two
  // forward diagonals are not side shots; only the lateral hexes are sides.
  if ([0, 1, 5].includes(diff)) return 'front';
  if (diff === 2) return 'side-left';
  if (diff === 4) return 'side-right';
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
  return analyseWeaponLineOfSight(attacker, target).interveningModifier || 0;
}

// Compatibility wrapper retained for C3 and older callers.
function elevationBlocksLineOfSight(attacker, target) {
  const sight = analyseWeaponLineOfSight(attacker, target);
  return !sight.valid && /terrain|water depth/i.test(sight.reason);
}

function evaluateWeaponAttack(attacker, target, weaponEntry, options = {}) {
  const eligibleAttacker = weaponPhaseStartMech(attacker);
  const eligibleTarget = weaponPhaseStartMech(target);
  const weapon = effectiveWeaponProfile(attacker, weaponEntry);
  if (!weapon || eligibleAttacker.destroyed || eligibleTarget.destroyed || attacker.owner === target.owner) {
    return { valid: false, reason: 'Choose a valid enemy target and supported weapon.' };
  }
  if (terrainAt(attacker.col, attacker.row) === 'deep_water' || terrainAt(target.col, target.row) === 'deep_water') {
    return { valid: false, reason: 'The current catalogue has no underwater-capable weapon profile for a fully submerged target or attacker.' };
  }
  const mountId = weaponMountId(weaponEntry, BT_UNITS[attacker.unitId].weapons.indexOf(weaponEntry));
  if ((eligibleAttacker.weaponJams || []).includes(mountId)) return { valid: false, reason: `${weapon.name} is jammed.` };
  const supportArm = attacker.proneSupportArm;
  const weaponLocation = typeof criticalLocationKey === 'function'
    ? criticalLocationKey(weaponEntry.location)
    : weaponEntry.location.toLowerCase().includes('left arm') ? 'la'
      : weaponEntry.location.toLowerCase().includes('right arm') ? 'ra' : null;
  if (attacker.prone && Number(eligibleAttacker.structure?.[supportArm] || 0) <= 0) return { valid: false, reason: 'Choose an intact supporting arm before firing while prone.' };
  if (attacker.prone && !['la', 'ra'].includes(supportArm)) return { valid: false, reason: 'Choose a supporting arm before firing while prone.' };
  if (attacker.prone && weaponLocation === supportArm) return { valid: false, reason: 'Supporting-arm weapons cannot fire while prone.' };
  if (attacker.prone && ['ll', 'rl'].includes(weaponLocation)) return { valid: false, reason: 'Leg-mounted weapons cannot fire while prone.' };
  if (weaponLocationDestroyed(eligibleAttacker, weaponEntry)) return { valid: false, reason: `${weapon.name} was mounted in a location destroyed before this phase.` };
  if (typeof weaponsDisabledByCritical === 'function' && weaponsDisabledByCritical(eligibleAttacker)) return { valid: false, reason: 'Sensors were destroyed before this phase.' };
  if (typeof isWeaponCriticallyDestroyed === 'function' && isWeaponCriticallyDestroyed(eligibleAttacker, weaponEntry)) return { valid: false, reason: `${weapon.name} was destroyed before this phase.` };
  const distance = axialDistance(attacker.col, attacker.row, target.col, target.row);
  const indirect = Boolean(options.indirect);
  const c3 = indirect ? { distance, source: null, jammed: false } : c3NetworkSupport(attacker, target);
  // C3 can improve the range bracket, but never extends a weapon's maximum
  // range and never changes minimum-range penalties.
  if (distance > weapon.range[2]) return { valid: false, reason: `${weapon.name} is beyond long range (${distance} hexes).` };
  const range = weaponRangeModifier(weapon, c3.distance, distance);
  if (!range) return { valid: false, reason: `${weapon.name} is beyond long range (${distance} hexes).` };
  const spotter = options.spotter;
  if (indirect && !isIndirectCapableWeapon(attacker, weaponEntry)) return { valid: false, reason: 'Only LRM ammunition may fire indirectly.' };
  if (indirect && weaponLineOfSight(attacker, target).valid) return { valid: false, reason: 'Indirect fire is unavailable while the attacker has direct line of sight.' };
  if (indirect && (!spotter || !eligibleIndirectSpotters(attacker, target).some(candidate => candidate.instanceId === spotter.instanceId))) return { valid: false, reason: 'Choose a friendly spotter with line of sight.' };
  if (!indirect && !isWeaponTargetInArc(weaponEntry, attacker, weaponDirectionTo(attacker, target))) {
    return { valid: false, reason: `${weapon.name} target is outside its firing arc.` };
  }
  const attackerMove = movementToHitModifier(attacker);
  const targetMove = targetMovementModifier(target);
  const observer = indirect ? spotter : attacker;
  const sight = analyseWeaponLineOfSight(observer, eligibleTarget);
  if (!indirect && !sight.valid) return { valid: false, reason: sight.reason };
  const woods = sight.terrainModifier;
  const sensorCritical = typeof criticalToHitModifier === 'function' ? criticalToHitModifier(eligibleAttacker) : 0;
  const critical = sensorCritical + weaponComponentToHitModifier(eligibleAttacker, weaponEntry);
  const heat = weaponHeatToHitModifier(eligibleAttacker);
  const gunnery = eligibleAttacker.pilot?.gunnery ?? 4;
  const clusterModifier = weaponEntry.key === 'lb10x' && weaponFireMode(mountId, weaponEntry) === 'cluster' ? -1 : 0;
  const ammoLoadType = selectedAmmoLoadType(attacker, weaponEntry);
  const tagGuided = ammoLoadType === 'semi_guided' && Number(eligibleTarget.taggedRound) === Number(currentGameState.round);
  const guidanceEcm = targetGuidanceEcm(eligibleAttacker, eligibleTarget);
  const indirectModifier = indirect ? 1 : 0;
  const spotterMovement = indirect ? movementToHitModifier(spotter) : 0;
  const precisionModifier = ammoLoadType === 'precision' ? -Math.min(2, targetMove) : 0;
  const armorPiercingModifier = ammoLoadType === 'armor_piercing' ? 1 : 0;
  const semiGuidedModifier = tagGuided ? -(targetMove + (indirect ? indirectModifier + spotterMovement + woods : 0)) : 0;
  const accuracyModifier = Number(weapon.toHitModifier || 0);
  const aimedLocation = weaponAttackState.aimLocationsByMount?.[mountId] || null;
  const targetingComputerModifier = targetingComputerEligibleWeapon(eligibleAttacker, weaponEntry)
    ? (aimedLocation ? 3 : weaponEntry.key === 'lb10x' && weaponFireMode(mountId, weaponEntry) === 'cluster' || weaponShotsForMode(mountId, weaponEntry) > 1 ? 0 : -1)
    : 0;
  if (aimedLocation && !targetingComputerCanAim(eligibleAttacker, weaponEntry, mountId)) return { valid: false, reason: `${weapon.name} cannot make a Targeting Computer aimed shot in this firing mode.` };
  if (aimedLocation && (!['ct', 'lt', 'rt', 'la', 'ra', 'll', 'rl'].includes(aimedLocation) || Number(eligibleTarget.structure?.[aimedLocation] || 0) <= 0)) return { valid: false, reason: 'Choose an intact non-head location for the aimed shot.' };
  const partialCover = sight.partialCover ? 1 : 0;
  const signature = signatureTargetModifier(eligibleTarget, range);
  const voidSignature = voidSignatureAttackerModifier(eligibleAttacker);
  const secondaryTarget = Boolean(options.secondaryTarget);
  const targetDirection = weaponDirectionTo(attacker, target);
  const torsoFacing = attacker.torsoFacing == null ? attacker.facing : attacker.torsoFacing;
  const multipleTargets = secondaryTarget ? (isInForwardArc(torsoFacing, targetDirection) ? 1 : 2) : 0;
  return {
    valid: true,
    weapon,
    damage: effectiveWeaponDamage(weapon, distance),
    distance,
    range,
    targetNumber: gunnery + attackerMove + targetMove + range.modifier + woods + critical + heat + (attacker.prone ? 2 : 0) + (target.prone ? (distance === 1 ? -2 : 1) : 0) + clusterModifier + precisionModifier + armorPiercingModifier + semiGuidedModifier + accuracyModifier + targetingComputerModifier + indirectModifier + spotterMovement + partialCover + multipleTargets + signature + voidSignature,
    attackAngle: attackDirection(attacker, target),
    multipleTargets,
    aimedLocation,
    c3,
    breakdown: `Gunnery ${gunnery} + move ${attackerMove} + target ${targetMove} + ${range.label.toLowerCase()} ${range.modifier}${c3.source && c3.source.instanceId !== attacker.instanceId && c3.distance < distance ? ` (C3 ${c3.distance} hexes via ${mechLabel(c3.source)})` : ''} + terrain ${woods}${indirect ? ` + indirect 1 + spotter move ${spotterMovement}` : ''}${critical ? ` + damage ${critical}` : ''}${heat ? ` + heat ${heat}` : ''}${attacker.prone ? ' + prone 2' : ''}${target.prone ? `${distance === 1 ? ' - prone target 2' : ' + prone target 1'}` : ''}${partialCover ? ' + partial cover 1' : ''}${multipleTargets ? ` + secondary target ${multipleTargets}` : ''}${signature ? ` + target signature ${signature}` : ''}${voidSignature ? ' + attacker Void Signature 1' : ''}${clusterModifier ? ' - LB-X cluster 1' : ''}${precisionModifier ? ` - precision ${-precisionModifier}` : ''}${armorPiercingModifier ? ' + armor-piercing 1' : ''}${semiGuidedModifier ? ` - semi-guided TAG ${-semiGuidedModifier}` : ''}${targetingComputerModifier === -1 ? ' - Targeting Computer 1' : targetingComputerModifier === 3 ? ` + Targeting Computer aimed ${aimedLocation} 3` : ''}${guidanceEcm ? ' · ECM suppresses Artemis/Narc' : ''}${accuracyModifier ? ' - pulse laser 2' : ''}`
  };
}

async function setProneWeaponSupportArm(instanceId, arm) {
  const { error } = await db.rpc('set_prone_weapon_support_arm', { p_game_id: currentGameId, p_instance_id: instanceId, p_arm: arm });
  if (error) { flashMoveWarning(error.message); return; }
  await loadGameState();
  weaponAttackState.weaponKeys = [];
  weaponAttackState.ammoBinsByMount = {};
  weaponAttackState.fireModesByMount = {};
  weaponAttackState.aimLocationsByMount = {};
  renderWeaponAttackPanel();
}

function selectWeaponAttacker(instanceId) {
  const mech = mechInstances.find(m => m.instanceId === instanceId);
  if (!canFireFromWeaponPhaseStart(mech) || mech.catalogueUnavailable || mech.owner !== mySeatNumber || !isMyActiveTurn() || currentGameState.phase !== 'weapon_attack' || mech.hasFired) return;
  weaponAttackState = { ...emptyWeaponAttackState(), attackerId: instanceId };
  selectedInstanceId = instanceId;
  logEvent(`${mechLabel(mech)} selected for weapon attack declaration.`, 'system');
  renderRoster();
  renderDetail();
  renderWeaponAttackPanel();
  draw();
}

function selectWeaponTarget(instanceId) {
  const target = mechInstances.find(m => m.instanceId === instanceId);
  if (!canBeWeaponTarget(target)) return;
  weaponAttackState.targetId = instanceId;
  weaponAttackState.indirect = weaponAttackState.indirectTargetId === instanceId;
  renderWeaponAttackPanel();
}

function selectPrimaryWeaponTarget(instanceId) {
  if (!Object.values(weaponAttackState.targetAssignments).includes(instanceId)) return;
  weaponAttackState.primaryTargetId = instanceId;
  renderWeaponAttackPanel();
}

function toggleWeaponForAttack(mountId) {
  weaponAttackState.aimLocationsByMount ||= {};
  const attacker = mechInstances.find(m => m.instanceId === weaponAttackState.attackerId);
  const entry = attacker && BT_UNITS[attacker.unitId].weapons.find((weapon, index) => weaponMountId(weapon, index) === mountId);
  const selected = weaponAttackState.weaponKeys;
  if (selected.includes(mountId)) {
    weaponAttackState.weaponKeys = selected.filter(id => id !== mountId);
    delete weaponAttackState.targetAssignments[mountId];
    delete weaponAttackState.ammoBinsByMount[mountId];
    delete weaponAttackState.fireModesByMount[mountId];
    delete weaponAttackState.aimLocationsByMount[mountId];
    if (!Object.values(weaponAttackState.targetAssignments).includes(weaponAttackState.primaryTargetId)) {
      weaponAttackState.primaryTargetId = Object.values(weaponAttackState.targetAssignments)[0] || null;
    }
  } else {
    if (!weaponAttackState.targetId) return;
    weaponAttackState.weaponKeys = [...selected, mountId];
    weaponAttackState.targetAssignments[mountId] = weaponAttackState.targetId;
    if (!weaponAttackState.primaryTargetId) weaponAttackState.primaryTargetId = weaponAttackState.targetId;
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
  weaponAttackState.aimLocationsByMount ||= {};
  const attacker = mechInstances.find(m => m.instanceId === weaponAttackState.attackerId);
  const entry = attacker && BT_UNITS[attacker.unitId].weapons.find((weapon, index) => weaponMountId(weapon, index) === mountId);
  const key = weaponProfile(entry)?.key || entry?.key;
  const rotary = key?.startsWith('rac');
  const validModes = key?.startsWith('uac') ? ['single', 'rapid'] : rotary ? ['1', '2', '3', '4', '5', '6'] : [];
  if (!entry || !validModes.includes(mode)) return;
  const bins = (weaponPhaseStartMech(attacker).ammoBins || []).filter(bin =>
    bin.type === weaponProfile(entry)?.ammoType && bin.shots >= (rotary ? Number(mode) : mode === 'rapid' ? 2 : 1) && !bin.destroyed &&
    (entry.key !== 'lb10x' || !bin.loadType || bin.loadType === mode)
  );
  if (!bins.length) {
    flashMoveWarning(rotary ? `Rotary fire rate ${mode} requires ${mode} rounds in one selected Rotary AC ammunition bin.` : mode === 'rapid' ? 'Rapid fire requires two rounds in one selected Ultra AC ammunition bin.' : 'Choose an LB-X ammunition bin loaded for that ammunition type.');
    return;
  }
  weaponAttackState.fireModesByMount[mountId] = mode;
  if (mode === 'rapid' || rotary && Number(mode) > 1) delete weaponAttackState.aimLocationsByMount[mountId];
  if (!bins.some(bin => bin.id === weaponAttackState.ammoBinsByMount[mountId])) weaponAttackState.ammoBinsByMount[mountId] = bins[0].id;
  renderWeaponAttackPanel();
}

function selectTargetingComputerAim(mountId, location) {
  weaponAttackState.aimLocationsByMount ||= {};
  const attacker = mechInstances.find(mech => mech.instanceId === weaponAttackState.attackerId) ||
    mechInstances.find(mech => mech.instanceId === selectedInstanceId);
  const entry = attacker && BT_UNITS[attacker.unitId].weapons.find((weapon, index) => weaponMountId(weapon, index) === mountId);
  if (!entry) return;
  if (!location) delete weaponAttackState.aimLocationsByMount[mountId];
  else if (['ct', 'lt', 'rt', 'la', 'ra', 'll', 'rl'].includes(location) && targetingComputerCanAim(attacker, entry, mountId)) weaponAttackState.aimLocationsByMount[mountId] = location;
  renderWeaponAttackPanel();
}

function selectAmmoBinForMount(mountId, binId) {
  weaponAttackState.aimLocationsByMount ||= {};
  const attacker = mechInstances.find(m => m.instanceId === weaponAttackState.attackerId);
  const entry = attacker && BT_UNITS[attacker.unitId].weapons.find((weapon, index) => weaponMountId(weapon, index) === mountId);
  if (!entry || !compatibleAmmoBins(attacker, entry, weaponShotsForMode(mountId, entry)).some(bin => bin.id === binId)) return;
  weaponAttackState.ammoBinsByMount[mountId] = binId;
  if ((weaponProfile(entry)?.key || entry.key) === 'lb10x') {
    const bin = (weaponPhaseStartMech(attacker).ammoBins || []).find(candidate => candidate.id === binId);
    weaponAttackState.fireModesByMount[mountId] = bin?.loadType || 'slug';
    if (weaponAttackState.fireModesByMount[mountId] === 'cluster') delete weaponAttackState.aimLocationsByMount[mountId];
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
  const fireModes = Object.fromEntries(selectedWeapons.filter(entry => { const key = weaponProfile(entry)?.key || entry.key; return key?.startsWith('uac') || key?.startsWith('rac') || key === 'lb10x'; }).map(entry => {
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
  const tables = {
    2:[1,1,1,1,1,1,1,1,2,2,2], 3:[1,1,1,2,2,2,2,2,3,3,3],
    4:[1,2,2,2,2,3,3,3,3,4,4], 5:[1,2,2,3,3,3,3,4,4,5,5],
    6:[2,2,3,3,4,4,4,5,5,6,6], 7:[2,2,3,4,4,4,4,6,6,7,7],
    8:[3,3,3,5,5,5,5,6,6,8,8], 9:[3,3,4,5,5,5,5,7,7,9,9],
    10:[3,3,4,6,6,6,6,8,8,10,10], 12:[4,4,5,8,8,8,8,10,10,12,12],
    15:[5,5,6,9,9,9,9,12,12,15,15], 20:[6,6,9,12,12,12,12,16,16,20,20],
    30:[10,10,12,18,18,18,18,24,24,30,30], 40:[12,12,18,24,24,24,24,32,32,40,40]
  };
  return tables[size]?.[total - 2] || 0;
}

function hitLocationForRoll(roll, angle = 'front') {
  if (angle === 'rear') return ({ 2:'ct',3:'ra',4:'ra',5:'rl',6:'rt',7:'ct',8:'lt',9:'ll',10:'la',11:'la',12:'head' })[roll];
  // Total Warfare side tables. A natural 2 names the side torso where the
  // authoritative resolver also applies the separate through-armour critical.
  if (angle === 'side-right') return ({ 2:'rt',3:'rl',4:'ra',5:'ra',6:'rl',7:'rt',8:'ct',9:'lt',10:'la',11:'ll',12:'head' })[roll];
  if (angle === 'side-left') return ({ 2:'lt',3:'ll',4:'la',5:'la',6:'ll',7:'lt',8:'ct',9:'rt',10:'ra',11:'rl',12:'head' })[roll];
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
    ` ${check.through_armor ? 'Through-armour critical check' : 'Critical check'} ${check.die_a} + ${check.die_b} = ${check.total}: ${check.hits} hit${check.hits === 1 ? '' : 's'}.${(check.events || []).map(event =>
      event.special === 'blown_off' ? ` ${hitLocationLabel(event.location)} blown off.` :
        event.ammo_explosion ? ` ${event.ammo_explosion} ammunition exploded for ${event.damage} damage.${event.case_protected ? ` CASE vented ${event.vented_damage || 0} excess damage.` : ''}${(event.pilot_checks || []).map(formatAuthoritativePilotCheck).join('')}` :
          event.label ? ` ${hitLocationLabel(event.location)} slot ${event.slot_index + 1}: ${event.label} destroyed.` : ''
    ).join('')}`
  ).join('');
}

function formatAuthoritativeLocationRoll(locationRoll, angle) {
  if (!locationRoll || !Number.isFinite(Number(locationRoll.total))) return '';
  const angleLabel = ({ front: 'front', rear: 'rear', 'side-left': 'left-side', 'side-right': 'right-side' })[angle] || angle || 'normal';
  const tac = locationRoll.through_armor_critical ? ' — through-armour critical' : '';
  return `${angleLabel} location ${locationRoll.die_a} + ${locationRoll.die_b} = ${locationRoll.total} → ${hitLocationLabel(locationRoll.location)}${tac}`;
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
  const modeSuffix = result.fire_mode === 'rapid' ? ' (rapid fire)' : result.rotary_shots > 1 ? ` (${result.rotary_shots}-shot rotary fire)` : result.fire_mode === 'cluster' ? ' (cluster ammunition)'
    : result.ammo_load_type === 'inferno' ? ' (Inferno ammunition)' : result.ammo_load_type === 'precision' ? ' (Precision ammunition)'
      : result.ammo_load_type === 'semi_guided' ? ' (semi-guided ammunition)' : result.ammo_load_type === 'armor_piercing' ? ' (armour-piercing ammunition)'
        : result.ammo_load_type === 'flechette' ? ' (flechette ammunition)' : result.ammo_load_type === 'fragmentation' ? ' (fragmentation ammunition)' : '';
  const aimed = result.aimed_location
    ? result.aimed_roll
      ? ` Targeting Computer aimed at ${hitLocationLabel(result.aimed_location)}; location roll ${result.aimed_roll.die_a} + ${result.aimed_roll.die_b} = ${result.aimed_roll.total}${result.aimed_success ? ': designated location acquired.' : ': normal hit location used.'}`
      : ` Targeting Computer aimed at ${hitLocationLabel(result.aimed_location)}.`
    : '';
  if (result.rotary_clear_attempt) return `${mechLabel(attacker)} attempted to clear Rotary AC ${result.mount_id} — need Gunnery + 3 (${roll.target}), rolled ${rolled}: ${result.hit ? 'jam cleared.' : 'jam remains.'}`;
  if (result.intercepted) return `${mechLabel(attacker)} fired ${result.weapon}${modeSuffix} at ${mechLabel(target)} — need ${roll.target}${targetNumberExplanation}, rolled ${rolled}: on target, but ${mechLabel(target)}'s AMS destroyed the missile (interception roll ${result.ams?.single_missile_roll}).`;
  if (!result.hit) return `${mechLabel(attacker)} fired ${result.weapon}${modeSuffix} at ${mechLabel(target)} — need ${roll.target}${targetNumberExplanation}, rolled ${rolled}: miss.${aimed}${result.streak_no_lock ? ' Streak did not lock; no ammunition or heat expended.' : ''}${result.jammed ? result.rotary_shots ? ' Rotary AC jammed.' : ' Ultra AC jammed.' : ''}`;
  if (result.tagged) return `${mechLabel(attacker)} designated ${mechLabel(target)} with TAG — need ${roll.target}${targetNumberExplanation}, rolled ${rolled}: lock confirmed.`;
  if (result.narc_attached) return `${mechLabel(attacker)} attached a Narc beacon to ${mechLabel(target)} — need ${roll.target}${targetNumberExplanation}, rolled ${rolled}: beacon attached.`;
  if (result.cluster_roll || result.streak_lock) {
    const cluster = result.cluster_roll;
    const groups = (result.groups || []).map(group => {
      const gauss = group.gauss_explosion ? `; Gauss rifle exploded for ${group.gauss_explosion.damage} internal damage in ${hitLocationLabel(group.gauss_explosion.location)}` : '';
      const location = formatAuthoritativeLocationRoll(group.location_roll, result.angle) || hitLocationLabel(group.location);
      return group.partial_cover ? `${location} — absorbed by partial cover` : `${location}: ${group.damage} damage${formatAuthoritativeCriticals(group.critical_checks)}${gauss}${formatAuthoritativePilotCheck(group.pilot_check)}`;
    }).join('; ');
    const pellets = result.cluster_kind === 'lb_x' ? 'pellet' : result.rotary_shots ? 'shell' : 'missile';
    const clusterText = result.streak_lock ? 'Streak lock confirmed' : `Cluster roll ${cluster.die_a} + ${cluster.die_b} = ${cluster.total}${cluster.modified_total && cluster.modified_total !== cluster.total ? `, modified to ${cluster.modified_total}` : ''}`;
    const defence = `${result.ams ? ' AMS engaged.' : ''}${result.narc_guided ? ' Narc guidance applied.' : ''}${result.artemis_guided ? ' Artemis IV guidance applied.' : ''}${result.tag_guided ? ' TAG guidance applied.' : ''}${result.ecm_guidance ? ' ECM suppressed Narc/Artemis guidance.' : ''}`;
    if (result.ammo_load_type === 'inferno') return `${mechLabel(attacker)} fired ${result.weapon}${modeSuffix} at ${mechLabel(target)} — need ${roll.target}${targetNumberExplanation}, rolled ${rolled}: hit. ${clusterText}: ${result.missiles_hit} missile${result.missiles_hit === 1 ? '' : 's'} struck; ${mechLabel(target)} gains ${result.heat_inflicted || 0} heat.${defence}`;
    return `${mechLabel(attacker)} fired ${result.weapon}${modeSuffix} at ${mechLabel(target)} — need ${roll.target}${targetNumberExplanation}, rolled ${rolled}: hit. ${clusterText}: ${result.missiles_hit} ${pellets}${result.missiles_hit === 1 ? '' : 's'} hit in ${result.groups?.length || 0} group${result.groups?.length === 1 ? '' : 's'} — ${groups}.${defence}${result.jammed ? ' Rotary AC jammed.' : ''}`;
  }
  const criticals = formatAuthoritativeCriticals(result.critical_checks);
  const armourPiercing = result.armor_piercing_critical
    ? ` Armour-piercing critical check ${result.armor_piercing_critical.roll >= 8 ? 'succeeded' : 'failed'} on ${result.armor_piercing_critical.roll}; ${(result.armor_piercing_critical.events || []).length} critical effect${(result.armor_piercing_critical.events || []).length === 1 ? '' : 's'} resolved.`
    : '';
  const gaussExplosion = result.gauss_explosion ? ` Gauss rifle exploded for ${result.gauss_explosion.damage} internal damage in ${hitLocationLabel(result.gauss_explosion.location)}.` : '';
  const flamerHeat = result.heat_inflicted ? ` ${mechLabel(target)} gains ${result.heat_inflicted} heat.` : '';
  if (result.partial_cover) return `${mechLabel(attacker)} fired ${result.weapon}${modeSuffix} at ${mechLabel(target)} — need ${roll.target}${targetNumberExplanation}, rolled ${rolled}: ${hitLocationLabel(result.location)} hit absorbed by partial cover.${aimed}`;
  const location = formatAuthoritativeLocationRoll(result.location_roll, result.angle) || `${result.angle} hit ${hitLocationLabel(result.location)}`;
  return `${mechLabel(attacker)} fired ${result.weapon}${modeSuffix} at ${mechLabel(target)} — need ${roll.target}${targetNumberExplanation}, rolled ${rolled}: ${location} for ${result.damage} damage.${aimed}${flamerHeat}${criticals}${armourPiercing}${gaussExplosion}${formatAuthoritativePilotCheck(result.pilot_check)}`;
}

function formatAuthoritativeTargetNumber(roll) {
  const b = roll?.breakdown;
  if (!b || typeof b.gunnery !== 'number') return '';
  const labels = [['attacker_movement', 'attacker movement'], ['spotter_movement', 'spotter movement'], ['target_movement', 'target movement'], ['range', 'range'], ['woods', 'terrain'], ['partial_cover', 'partial cover'], ['multiple_targets', 'secondary target'], ['indirect_fire', 'indirect fire'], ['spotter_firing', 'spotter firing'], ['sensors', 'sensors'], ['heat', 'heat'], ['component_damage', 'damage'], ['prone', 'prone'], ['target_prone', 'prone target'], ['lb_x_cluster', 'LB-X cluster'], ['special_ammunition', 'special ammunition'], ['weapon_accuracy', 'weapon accuracy'], ['targeting_computer', 'Targeting Computer']];
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
  const immediateEntries = [];
  const animatedGroups = [];
  for (const event of data || []) {
    const attacker = mechInstances.find(mech => mech.instanceId === event.attacker_instance_id);
    const target = mechInstances.find(mech => mech.instanceId === event.target_instance_id);
    if (!attacker) continue;
    const declaredAt = Date.parse(event.declared_at || '') || Date.now();
    const mounts = event.declaration?.weapon_mounts || [];
    const allocations = event.declaration?.target_allocations || [];
    const allocationSummary = allocations.map(allocation => {
      const allocationTarget = mechInstances.find(mech => mech.instanceId === allocation.target_instance_id);
      return `${weaponDeclarationSummary(attacker, allocation.weapon_mounts, allocation.ammo_bins?.__fire_modes)} at ${mechLabel(allocationTarget)}${allocation.primary ? ' (primary)' : ''}`;
    }).join('; ');
    immediateEntries.push({
      id: `combat-declaration-${event.id}`, ts: declaredAt + event.sequence,
      time: new Date(declaredAt).toTimeString().slice(0, 8), round: event.round,
      phase: event.phase, cat: 'attack', team: attacker.owner,
      msg: mounts.length
        ? `${mechLabel(attacker)} declared ${allocationSummary || `${weaponDeclarationSummary(attacker, mounts, event.declaration?.ammo_bins?.__fire_modes)}${event.declaration?.ammo_bins?.__indirect ? ` indirectly using ${mechLabel(mechInstances.find(mech => mech.instanceId === event.declaration.ammo_bins.__spotter))} as spotter` : ''} at ${mechLabel(target)}`}.`
        : `${mechLabel(attacker)} declared no weapon fire.`
    });
    if (event.status !== 'resolved' || !['simultaneous-declarations-01', 'alternating-activations-01', 'multi-target-01'].includes(event.resolution?.state_version)) continue;
    const resolvedAt = Date.parse(event.resolved_at || '') || Date.now();
    const results = event.resolution?.results || [];
    if (!results.length) continue;
    const resultEntries = results.map((result, index) => ({
      id: `combat-${event.id}-${index}`, ts: resolvedAt + event.sequence * 100 + index,
      time: new Date(resolvedAt).toTimeString().slice(0, 8), round: event.round, phase: event.phase,
      cat: 'attack', team: attacker.owner, soundFamily: weaponSoundFamily(result),
      msg: authoritativeWeaponResultMessage(attacker, mechInstances.find(mech => mech.instanceId === result.target_instance_id) || target, result)
    }));
    const pilotingEntries = (event.resolution?.piloting_checks || []).map((check, index) => ({
      id: `weapon-psr-${event.id}-${index}`, ts: resolvedAt + event.sequence * 100 + results.length + index + 1,
      time: new Date(resolvedAt).toTimeString().slice(0, 8), round: event.round,
      phase: event.phase, cat: 'roll', msg: authoritativePilotingResultMessage(check)
    }));
    const group = {
      header: {
        id: `combat-${event.id}-header`, ts: resolvedAt + event.sequence * 100 - 1,
        time: new Date(resolvedAt).toTimeString().slice(0, 8), round: event.round,
        phase: event.phase, cat: 'attack', team: attacker.owner, kind: 'weapon-header',
        msg: `${mechLabel(attacker)} — WEAPON FIRE`
      },
      entries: [...resultEntries, ...pilotingEntries]
    };
    const presentation = registerResolvedWeaponEvent(event.id);
    if (presentation === 'hydrate') immediateEntries.push(group.header, ...group.entries);
    else if (presentation === 'animate') animatedGroups.push(group);
  }
  mergeRemoteLog(immediateEntries);
  markWeaponCombatPresentationHydrated();
  animatedGroups.forEach(queueAuthoritativeWeaponPresentation);
}

async function confirmAuthoritativeWeaponAttack(attacker, target, selectedWeapons) {
  weaponAttackState.aimLocationsByMount ||= {};
  const ammoDeclaration = resolveDeclaredAmmoBins(attacker, selectedWeapons);
  if (ammoDeclaration.error) {
    flashMoveWarning(ammoDeclaration.error);
    return;
  }
  // A select element visibly defaults to its first option even if no change
  // event has fired. Persist the derived choice so UI state and RPC payload
  // always describe the same ammunition bin.
  weaponAttackState.ammoBinsByMount = ammoDeclaration.choices;
  const allocationMap = new Map();
  for (const entry of selectedWeapons) {
    const mountId = weaponMountId(entry, BT_UNITS[attacker.unitId].weapons.indexOf(entry));
    const targetId = weaponAttackState.targetAssignments[mountId];
    if (!targetId) { flashMoveWarning(`Choose a target for ${weaponProfile(entry)?.name || mountId}.`); return; }
    if (!allocationMap.has(targetId)) allocationMap.set(targetId, []);
    allocationMap.get(targetId).push(mountId);
  }
  const allocations = [...allocationMap].map(([targetId, mountIds]) => ({
    target_instance_id: targetId,
    primary: targetId === weaponAttackState.primaryTargetId,
    weapon_mounts: mountIds,
    ammo_bins: {
      ...Object.fromEntries(mountIds.filter(id => ammoDeclaration.choices[id]).map(id => [id, ammoDeclaration.choices[id]])),
      __fire_modes: Object.fromEntries(mountIds.filter(id => ammoDeclaration.fireModes[id]).map(id => [id, ammoDeclaration.fireModes[id]])),
      __aim_locations: Object.fromEntries(mountIds.filter(id => weaponAttackState.aimLocationsByMount[id]).map(id => [id, weaponAttackState.aimLocationsByMount[id]])),
      ...(weaponAttackState.armsFlipped ? { __arms_flipped: true } : {}),
      __indirect: weaponAttackState.indirectTargetId === targetId,
      __spotter: weaponAttackState.indirectTargetId === targetId ? weaponAttackState.spotterId : null
    }
  }));
  if (allocations.length && !allocations.some(allocation => allocation.primary)) {
    allocations[0].primary = true;
    weaponAttackState.primaryTargetId = allocations[0].target_instance_id;
  }
  const submitButton = document.getElementById('weapon-submit');
  if (submitButton) { submitButton.disabled = true; submitButton.textContent = 'Submitting Declaration…'; }
  showGameToast(`${mechLabel(attacker)} weapon declaration submitted. Waiting for the server.`, 'success');
  const { data, error } = await db.rpc('submit_multi_target_weapon_declaration', {
    p_game_id: currentGameId,
    p_attacker_instance_id: attacker.instanceId,
    p_target_allocations: allocations
  });
  if (error) {
    if (submitButton) { submitButton.disabled = false; submitButton.textContent = 'Confirm Weapon Attacks'; }
    logEvent(`Server rejected the weapon declaration: ${error.message}`, 'error');
    flashMoveWarning(error.message);
    showGameToast(`Weapon declaration was rejected: ${error.message}`, 'error');
    return;
  }
  weaponAttackState = emptyWeaponAttackState();
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
  if (selectedWeapons.length && (!target || selectedWeapons.some((entry, index) => !weaponAttackState.targetAssignments[weaponMountId(entry, BT_UNITS[attacker.unitId].weapons.indexOf(entry) >= 0 ? BT_UNITS[attacker.unitId].weapons.indexOf(entry) : index)]))) {
    flashMoveWarning('Choose a target for every selected weapon before confirming attacks.');
    return;
  }
  if (!vsAiMode) {
    await confirmAuthoritativeWeaponAttack(attacker, target, selectedWeapons);
    return;
  }

  const messages = [];
  const recordWeaponMessage = (msg, weapon = null) => messages.push({ msg, soundFamily: weapon ? weaponSoundFamily({ weapon }) : null });
  let addedHeat = 0;
  for (const weaponEntry of selectedWeapons) {
    const attack = evaluateWeaponAttack(attacker, target, weaponEntry);
    if (!attack.valid) {
      recordWeaponMessage(`${mechLabel(attacker)} could not fire ${weaponEntry.key}: ${attack.reason}`);
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
        recordWeaponMessage(`${mechLabel(attacker)} fired ${attack.weapon.name}${rapid ? ' (rapid fire)' : ''}${shotLabel} at ${mechLabel(target)} — need ${attack.targetNumber} (${attack.breakdown}), rolled ${format2d6(roll)}: miss.${jammed ? ' Ultra AC jammed.' : ''}`, attack.weapon.name);
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
        recordWeaponMessage(`${mechLabel(attacker)} fired ${attack.weapon.name} (cluster ammunition)${shotLabel} at ${mechLabel(target)} — need ${attack.targetNumber}, rolled ${format2d6(roll)}: hit. Cluster roll ${format2d6(clusterRoll)}: ${pellets} pellet${pellets === 1 ? '' : 's'} hit${groups.length ? ` (${groups.join(', ')}).` : '.'}`, attack.weapon.name);
        continue;
      }
      if (attack.weapon.clusterSize) {
        const clusterRoll = roll2d6Detailed();
        const missiles = attack.weapon.streak ? attack.weapon.clusterSize : clusterHitsForRoll(attack.weapon.clusterSize, clusterRoll.total);
        const grouped = weaponEntry.key.startsWith('lrm') || weaponEntry.key.startsWith('mrm') || (weaponEntry.key.startsWith('mml') && attack.weapon.mmlMode === 'lrm');
        const groups = [];
        let remaining = missiles;
        while (remaining > 0) {
          const missileCount = grouped ? Math.min(5, remaining) : 1;
          const groupDamage = missileCount * Number(attack.weapon.damagePerMissile || 1);
          const damage = applyWeaponDamage(target, groupDamage, attack.attackAngle);
          groups.push(`${hitLocationLabel(damage.location)} ${groupDamage}`);
          remaining -= missileCount;
        }
        recordWeaponMessage(`${mechLabel(attacker)} fired ${attack.weapon.name}${shotLabel} at ${mechLabel(target)} — need ${attack.targetNumber}, rolled ${format2d6(roll)}: hit. Cluster roll ${format2d6(clusterRoll)}: ${missiles} missile${missiles === 1 ? '' : 's'} hit${groups.length ? ` (${groups.join(', ')}).` : '.'}`, attack.weapon.name);
        continue;
      }
      const shotDamage = attack.damage ?? attack.weapon.damage;
      const damage = applyWeaponDamage(target, shotDamage, attack.attackAngle);
      const flamerHeat = weaponEntry.key === 'flamer' ? 2 : 0;
      if (flamerHeat) {
        target.externalHeat = (target.externalHeat || 0) + flamerHeat;
        target.heat = (target.heat || 0) + flamerHeat;
      }
      recordWeaponMessage(`${mechLabel(attacker)} fired ${attack.weapon.name}${rapid ? ' (rapid fire)' : ''}${shotLabel} at ${mechLabel(target)} — need ${attack.targetNumber}, rolled ${format2d6(roll)}: ${attack.attackAngle} hit ${hitLocationLabel(damage.location)} for ${shotDamage} damage.${flamerHeat ? ` ${mechLabel(target)} gains ${flamerHeat} heat.` : ''}${damage.criticalEvents.length ? ` ${damage.criticalEvents.join(' ')}` : ''}${damage.destroyedLocations.length ? ` Destroyed: ${damage.destroyedLocations.map(hitLocationLabel).join(', ')}.` : ''}${damage.destroyed ? ' Target destroyed.' : ''}`, attack.weapon.name);
    }
  }

  attacker.weaponHeat = (attacker.weaponHeat || 0) + addedHeat;
  attacker.heat = (attacker.roundStartingHeat || 0) + (attacker.movementHeat || 0) + attacker.weaponHeat + (attacker.externalHeat || 0);
  attacker.hasFired = true;
  weaponAttackState = emptyWeaponAttackState();
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
  if (messages.length) queueLocalWeaponPresentation(attacker, messages);
  else logEvent(`${mechLabel(attacker)} declared no weapon attacks.`, 'attack', attacker.owner);
}

function renderWeaponAttackPanel() {
  weaponAttackState.aimLocationsByMount ||= {};
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

  const enemies = mechInstances.filter(m => m.owner !== attacker.owner && canBeWeaponTarget(m));
  const armFlipControls = canFlipBattleMechArms(attacker) ? `<div style="border:1px solid var(--panel-line);padding:7px;margin:7px 0;font:9px/1.45 var(--mono);color:var(--paper);"><button onclick="toggleWeaponArmFlip()" style="width:100%;padding:6px;border:1px solid ${weaponAttackState.armsFlipped ? 'var(--amber)' : 'var(--panel-line)'};background:${weaponAttackState.armsFlipped ? 'rgba(212,128,10,.18)' : 'transparent'};color:var(--paper);font:9px var(--mono);cursor:pointer;">${weaponAttackState.armsFlipped ? '✓ ' : ''}FLIP BOTH ARMS TO REAR</button><div style="margin-top:4px;color:var(--phosphor-dim);">Arm-mounted weapons use the rear arc. This cannot be combined with a torso twist.</div></div>` : '';
  const clubSearch = canSearchForImprovisedClub(attacker) ? `<div style="border:1px solid var(--panel-line);padding:7px;margin:7px 0;font:9px/1.45 var(--mono);color:var(--paper);"><button onclick="findImprovisedClub('${attacker.instanceId}')" style="width:100%;padding:6px;border:1px solid var(--amber);background:transparent;color:var(--paper);font:9px var(--mono);cursor:pointer;">FIND ${improvisedClubTerrain(attacker) === 'tree' ? 'TREE' : 'GIRDER'} CLUB</button><div style="margin-top:4px;color:var(--phosphor-dim);">Uses this BattleMech's Weapon Attack action. A found club is available in Physical Attacks.</div></div>` : '';
  const intactSupportingArms = ['la', 'ra'].filter(arm => Number(attacker.structure?.[arm] || 0) > 0);
  const supportPicker = attacker.prone ? intactSupportingArms.length
    ? `<div style="font-size:10px;color:var(--amber);margin-bottom:7px;">PRONE SUPPORT ARM — choose an intact arm holding the BattleMech up.</div><div style="display:flex;gap:6px;margin-bottom:8px;">${intactSupportingArms.map(arm => `<button onclick="setProneWeaponSupportArm('${attacker.instanceId}','${arm}')" style="flex:1;padding:7px;border:1px solid ${attacker.proneSupportArm === arm ? 'var(--amber)' : 'var(--panel-line)'};background:${attacker.proneSupportArm === arm ? 'rgba(212,128,10,.18)' : 'transparent'};color:var(--paper);font:9px var(--mono);cursor:pointer;">${attacker.proneSupportArm === arm ? '✓ ' : ''}${arm === 'la' ? 'Left Arm' : 'Right Arm'}</button>`).join('')}</div>`
    : `<div style="font-size:10px;color:var(--red);margin-bottom:8px;">PRONE FIRE UNAVAILABLE — both arms are destroyed.</div>`
    : '';
  const spotters = target ? eligibleIndirectSpotters(attacker, target) : [];
  const attackerHasLrm = BT_UNITS[attacker.unitId].weapons.some(entry => isIndirectCapableWeapon(attacker, entry));
  const indirectControls = target && attackerHasLrm ? `<div style="border:1px solid var(--panel-line);padding:7px;margin:7px 0;font:9px var(--mono);color:var(--paper);"><label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" onchange="setIndirectFire(this.checked)" ${weaponAttackState.indirect ? 'checked' : ''}> LRM INDIRECT FIRE</label>${weaponAttackState.indirect ? `<div style="margin-top:6px;color:var(--phosphor-dim);">Attacker must lack direct LOS. Choose a friendly spotter:</div><div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;">${spotters.map(candidate => `<button onclick="selectIndirectSpotter('${candidate.instanceId}')" style="padding:5px;border:1px solid ${spotter?.instanceId === candidate.instanceId ? 'var(--amber)' : 'var(--panel-line)'};background:transparent;color:var(--paper);font:9px var(--mono);">${mechLabel(candidate)}</button>`).join('') || 'No eligible spotter has line of sight.'}</div>` : ''}</div>` : '';
  const electronicReadout = electronicWarfareReadout(attacker, target);
  const electronicControls = electronicReadout.length ? `<div style="border:1px solid var(--panel-line);padding:7px;margin:7px 0;font:9px/1.45 var(--mono);color:var(--phosphor-dim);"><strong style="color:var(--amber);">ELECTRONIC WARFARE</strong><br>${electronicReadout.map(escapeHtml).join('<br>')}</div>` : '';
  const weaponRows = BT_UNITS[attacker.unitId].weapons.map((entry, index) => {
    const mountId = weaponMountId(entry, index);
    const checked = weaponAttackState.weaponKeys.includes(mountId);
    const assignedTargetId = weaponAttackState.targetAssignments[mountId];
    const assignedTarget = mechInstances.find(mech => mech.instanceId === assignedTargetId);
    const evaluation = target ? evaluateWeaponAttack(attacker, target, entry, { indirect: weaponAttackState.indirectTargetId === target.instanceId, spotter, secondaryTarget: Boolean(weaponAttackState.primaryTargetId && weaponAttackState.primaryTargetId !== target.instanceId) }) : null;
    const weapon = effectiveWeaponProfile(attacker, entry);
    if (weapon?.supportOnly) return '';
    const shotsRequired = weaponShotsForMode(mountId, entry);
    const bins = compatibleAmmoBins(attacker, entry, shotsRequired);
    const outOfAmmo = Boolean(weapon?.ammoType) && bins.length === 0;
    const disabled = !checked && (outOfAmmo || (target && !evaluation.valid));
    const countLabel = entry.count > 1 ? ` ×${entry.count}` : '';
    const heat = weapon ? weapon.heat * entry.count : '?';
    const binPicker = checked && weapon?.ammoType ? `<label style="display:flex;gap:6px;align-items:center;margin:4px 0 7px;font:9px var(--mono);color:var(--phosphor-dim);">AMMO BIN<select onchange="selectAmmoBinForMount('${mountId}',this.value)" style="flex:1;font:10px var(--mono);padding:4px;">${bins.map(bin => `<option value="${bin.id}" ${weaponAttackState.ammoBinsByMount[mountId] === bin.id ? 'selected' : ''}>${ammoBinLabel(bin)}</option>`).join('')}</select></label>` : '';
    const ultra = weapon?.key?.startsWith('uac');
    const rotary = weapon?.key?.startsWith('rac');
    const modePicker = checked && ultra ? `<div style="display:flex;gap:5px;margin:0 0 7px;"><button onclick="selectWeaponFireMode('${mountId}','single')" style="flex:1;padding:5px;border:1px solid ${weaponFireMode(mountId, entry) === 'single' ? 'var(--amber)' : 'var(--panel-line)'};background:${weaponFireMode(mountId, entry) === 'single' ? 'rgba(212,128,10,.18)' : 'transparent'};color:var(--paper);font:9px var(--mono);cursor:pointer;">SINGLE · 1 AMMO / ${weapon.heat} HEAT</button><button onclick="selectWeaponFireMode('${mountId}','rapid')" style="flex:1;padding:5px;border:1px solid ${weaponFireMode(mountId, entry) === 'rapid' ? 'var(--amber)' : 'var(--panel-line)'};background:${weaponFireMode(mountId, entry) === 'rapid' ? 'rgba(212,128,10,.18)' : 'transparent'};color:var(--paper);font:9px var(--mono);cursor:pointer;">RAPID · 2 AMMO / ${weapon.heat * 2} HEAT</button></div>` : rotary ? `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin:0 0 7px;">${[1,2,3,4,5,6].map(shots => `<button onclick="selectWeaponFireMode('${mountId}','${shots}')" style="padding:5px;border:1px solid ${weaponFireMode(mountId, entry) === String(shots) ? 'var(--amber)' : 'var(--panel-line)'};background:${weaponFireMode(mountId, entry) === String(shots) ? 'rgba(212,128,10,.18)' : 'transparent'};color:var(--paper);font:9px var(--mono);cursor:pointer;">${shots} SHOT · ${shots} AMMO / ${weapon.heat * shots} HEAT</button>`).join('')}</div>` : '';
    const canAim = checked && targetingComputerCanAim(attacker, entry, mountId);
    const aimLocations = [['ct','Centre Torso'],['lt','Left Torso'],['rt','Right Torso'],['la','Left Arm'],['ra','Right Arm'],['ll','Left Leg'],['rl','Right Leg']].filter(([value]) => Number(weaponPhaseStartMech(assignedTarget)?.structure?.[value] || 0) > 0);
    const aimPicker = canAim ? `<label style="display:flex;gap:6px;align-items:center;margin:4px 0 7px;font:9px var(--mono);color:var(--phosphor-dim);">TARGETING COMPUTER<select onchange="selectTargetingComputerAim('${mountId}',this.value)" style="flex:1;font:10px var(--mono);padding:4px;"><option value="">Standard tracking (−1 to hit)</option>${aimLocations.map(([value,label]) => `<option value="${value}" ${weaponAttackState.aimLocationsByMount[mountId] === value ? 'selected' : ''}>Aim: ${label} (+3 to hit; location on 6–8)</option>`).join('')}</select></label>` : '';
    const displayedDamage = evaluation?.valid ? evaluation.damage : weapon?.damage;
    const modeLabel = weapon?.mmlMode ? ` · ${weapon.mmlMode.toUpperCase()} ammo` : '';
    const firingHeat = ultra && weaponFireMode(mountId, entry) === 'rapid' ? heat * 2 : rotary ? heat * weaponShotsForMode(mountId, entry) : heat;
    return `<div><button onclick="toggleWeaponForAttack('${mountId}')" ${disabled ? 'disabled' : ''} style="width:100%;margin-top:5px;padding:7px 8px;border:1px solid ${checked ? 'var(--amber)' : 'var(--panel-line)'};background:${checked ? 'rgba(212,128,10,.18)' : 'transparent'};color:${disabled ? 'var(--phosphor-dim)' : 'var(--paper)'};font-family:var(--mono);font-size:10px;text-align:left;cursor:${disabled ? 'not-allowed' : 'pointer'};">${checked ? '✓ ' : ''}${weapon?.name || entry.key}${countLabel} · ${displayedDamage || '?'} max dmg / ${firingHeat} heat${modeLabel} · ${entry.location} · ${weaponArcLabel(entry, attacker)}${assignedTarget ? ` · → ${mechLabel(assignedTarget)}${assignedTargetId === weaponAttackState.primaryTargetId ? ' (primary)' : ''}` : ''}${outOfAmmo ? ' · no compatible ammunition' : evaluation ? ` · ${evaluation.valid ? `${evaluation.range.label}, TN ${evaluation.targetNumber}` : evaluation.reason}` : ''}</button>${binPicker}${modePicker}${aimPicker}</div>`;
  }).join('');

  panel.innerHTML = `
    <div class="panel-eyebrow">Weapon Attack — Declaration</div>
    <div style="font-size:11px;color:var(--paper);margin-bottom:8px;">${mechLabel(attacker)} · heat ${attacker.heat || 0}${attacker.prone ? ' · PRONE (+2 to hit)' : ''}</div>
    ${supportPicker}
    ${armFlipControls}
    ${clubSearch}
    <div style="font-size:10px;color:var(--phosphor-dim);margin-bottom:4px;">TARGET — choose a target, then assign weapons; repeat to split fire</div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;">${enemies.map(enemy => { const assigned = Object.values(weaponAttackState.targetAssignments).filter(id => id === enemy.instanceId).length; return `<button onclick="selectWeaponTarget('${enemy.instanceId}')" style="padding:6px;border:1px solid ${target?.instanceId === enemy.instanceId ? 'var(--amber)' : 'var(--panel-line)'};background:transparent;color:var(--paper);font:9px var(--mono);cursor:pointer;">${enemy.instanceId === weaponAttackState.primaryTargetId ? '★ ' : ''}${mechLabel(enemy)}${assigned ? ` · ${assigned}` : ''}</button>`; }).join('')}</div>
    ${target ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:10px;color:var(--amber);margin-bottom:4px;"><span>TARGET: ${mechLabel(target)}</span>${Object.values(weaponAttackState.targetAssignments).includes(target.instanceId) ? `<button onclick="selectPrimaryWeaponTarget('${target.instanceId}')" style="padding:4px;border:1px solid var(--panel-line);background:transparent;color:var(--paper);font:8px var(--mono);">${target.instanceId === weaponAttackState.primaryTargetId ? '★ PRIMARY' : 'MAKE PRIMARY'}</button>` : ''}</div>${electronicControls}${indirectControls}${weaponRows}` : '<div style="font-size:11px;color:var(--phosphor-dim);">Select a target to see eligible weapons and target numbers.</div>'}
    <button id="weapon-submit" onclick="confirmWeaponAttack()" style="width:100%;margin-top:9px;${MOVE_BTN_STYLE}text-align:center;">${weaponAttackState.weaponKeys.length ? 'Confirm Weapon Attacks' : 'No Fire / Complete Attacks'}</button>`;
}
