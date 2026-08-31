// ── TOTAL WARFARE 'MECH CRITICAL HITS ─────────────────────
// Uses the unit-specific critical layouts generated from the local MegaMek
// source records.  Slot selection follows Total Warfare p. 124–126:
// head/legs use one die; torso/arms use a half-table die then a slot die.

const CRITICAL_TRANSFER = Object.freeze({ la: 'lt', ra: 'rt', ll: 'lt', rl: 'rt', lt: 'ct', rt: 'ct' });
const CRITICAL_LOCATION_NAMES = Object.freeze({ head: 'Head', ct: 'Center Torso', lt: 'Left Torso', rt: 'Right Torso', la: 'Left Arm', ra: 'Right Arm', ll: 'Left Leg', rl: 'Right Leg' });

function criticalLocationKey(location) {
  const text = String(location || '').toLowerCase().replace(/[^a-z]/g, '');
  return ({ head: 'head', centertorso: 'ct', lefttorso: 'lt', righttorso: 'rt', leftarm: 'la', rightarm: 'ra', leftleg: 'll', rightleg: 'rl' })[text] || text;
}

function criticalEquipmentKey(label) {
  return criticalSlotName(label).toLowerCase().replace(/^(is|clan|cl)/, '').replace(/[^a-z0-9]/g, '');
}

function criticalDie() {
  return Math.floor(Math.random() * 6) + 1;
}

function criticalRollResult(total, location) {
  if (total <= 7) return { count: 0, special: null };
  if (total <= 9) return { count: 1, special: null };
  if (total <= 11) return { count: 2, special: null };
  if (['head', 'la', 'ra', 'll', 'rl'].includes(location)) return { count: 0, special: 'blown_off' };
  return { count: 3, special: null };
}

function criticalSlotIndex(location) {
  if (['head', 'll', 'rl'].includes(location)) return criticalDie() - 1;
  const half = criticalDie() <= 3 ? 0 : 6;
  return half + criticalDie() - 1;
}

function criticalSlotCanTakeDamage(mech, location, index) {
  const slot = BT_CRITICAL_LAYOUTS[mech.unitId]?.[location]?.[index];
  if (!slot || mech.criticalSlotDamage?.[location]?.includes(index)) return false;
  return !/^(Endo Steel|Ferro-Fibrous|CASE)$/i.test(criticalSlotName(slot));
}

function availableCriticalSlots(mech, location) {
  return (BT_CRITICAL_LAYOUTS[mech.unitId]?.[location] || [])
    .map((_, index) => index)
    .filter(index => criticalSlotCanTakeDamage(mech, location, index));
}

function markCriticalSlot(mech, location, index) {
  mech.criticalSlotDamage ||= {};
  mech.criticalSlotDamage[location] ||= [];
  mech.criticalSlotDamage[location].push(index);
}

function criticalWeaponLabel(key) {
  return ({
    ac20: 'Autocannon/20', ac10: 'Autocannon/10', ac5: 'Autocannon/5', ac2: 'Autocannon/2',
    uac20: 'Ultra AC/20', uac10: 'Ultra AC/10', uac5: 'Ultra AC/5', uac2: 'Ultra AC/2', lb10x: 'LB 10-X AC',
    gauss: 'Gauss Rifle', lrm20: 'LRM 20', lrm15: 'LRM 15', lrm10: 'LRM 10', lrm5: 'LRM 5',
    lr20: 'LRM 20', lr15: 'LRM 15', lr10: 'LRM 10', lr5: 'LRM 5',
    srm6: 'SRM 6', srm4: 'SRM 4', srm2: 'SRM 2', sr6: 'SRM 6', sr4: 'SRM 4', sr2: 'SRM 2',
    med_laser: 'Medium Laser', small_laser: 'Small Laser', large_laser: 'Large Laser',
    erl: 'ER Large Laser', ppc: 'PPC', machine_gun: 'Machine Gun', streak_sr4: 'Streak SRM 4'
    , mrm10: 'MRM 10', mrm20: 'MRM 20', mrm30: 'MRM 30', mrm40: 'MRM 40'
    , mml3: 'MML 3', mml5: 'MML 5', mml7: 'MML 7', mml9: 'MML 9', snub_ppc: 'Snub-Nose PPC'
  })[key] || key;
}

function criticalAmmoType(slot) {
  const label = criticalSlotName(slot).toLowerCase();
  if (!label.includes('ammo')) return null;
  if (label.includes('ac/20')) return 'ac20';
  if (label.includes('ac/10')) return 'ac10';
  if (label.includes('ac/5')) return 'ac5';
  if (label.includes('ac/2')) return 'ac2';
  if (label.includes('lrm-20')) return 'lrm20';
  if (label.includes('lrm-10')) return 'lrm10';
  if (label.includes('srm-6')) return 'srm6';
  for (const family of ['mrm', 'mml']) for (const rack of [3, 5, 7, 9, 10, 20, 30, 40]) {
    if (label.includes(`${family}-${rack}`) || label.includes(`${family} ${rack}`)) return `${family}${rack}`;
  }
  if (label.includes('ammo mg')) return 'machine_gun';
  return null;
}

function criticalAmmoExplosion(mech, location, slot) {
  const type = criticalAmmoType(slot);
  if (!type) return null;
  const bin = (mech.ammoBins || []).find(item =>
    !item.destroyed && item.type === type && criticalLocationKey(item.location) === location
  );
  if (!bin) return `${criticalSlotName(slot)} destroyed (no matching ammunition bin).`;
  const shots = bin.shots || 0;
  bin.destroyed = true;
  bin.shots = 0;
  if (!shots) return `${criticalSlotName(slot)} destroyed empty.`;
  const rackDamage = /^(?:mrm|mml)\d+$/.test(type) ? Number(type.match(/\d+/)?.[0] || 0) : 0;
  const perShot = type.startsWith('mml') && bin.loadType === 'srm' ? rackDamage * 2 : rackDamage || (BT_WEAPONS[type]?.damage || 0);
  const damage = perShot * shots;
  const result = applyCriticalInternalDamage(mech, location, damage);
  return `${criticalSlotName(slot)} explodes for ${damage} internal damage${result.destroyed ? '; target destroyed' : ''}.`;
}

function applyCriticalInternalDamage(mech, location, damage) {
  let current = location;
  let remaining = damage;
  while (remaining > 0 && current && !mech.destroyed) {
    const structure = mech.structure?.[current] || 0;
    const applied = Math.min(structure, remaining);
    mech.structure[current] = structure - applied;
    remaining -= applied;
    if (mech.structure[current] > 0) break;
    if (current === 'head' || current === 'ct') {
      mech.destroyed = true;
      break;
    }
    if (current === 'lt') mech.structure.la = 0;
    if (current === 'rt') mech.structure.ra = 0;
    current = CRITICAL_TRANSFER[current];
  }
  return { destroyed: !!mech.destroyed };
}

function finalizeBlownOffLocation(mech, location) {
  mech.structure[location] = 0;
  const slots = BT_CRITICAL_LAYOUTS[mech.unitId]?.[location] || [];
  mech.criticalSlotDamage ||= {};
  mech.criticalSlotDamage[location] = slots.map((_, index) => index);
  for (const bin of mech.ammoBins || []) {
    if (criticalLocationKey(bin.location) !== location && !String(bin.id || '').startsWith(`${location}:`)) continue;
    bin.shots = 0;
    bin.destroyed = true;
  }
  if (location === 'head') {
    mech.destroyed = true;
    mech.pilot ||= {};
    mech.pilot.hits = 6;
    mech.pilot.consciousness = 'dead';
  }
}

function criticalEffectMessage(mech, location, slot) {
  const label = criticalSlotName(slot);
  const normalized = label.toLowerCase();
  if (normalized === 'cockpit') {
    mech.destroyed = true;
    mech.pilot ||= {};
    mech.pilot.hits = 6;
    mech.pilot.consciousness = 'dead';
    return 'Cockpit destroyed — pilot killed; BattleMech destroyed.';
  }
  if (normalized === 'fusion engine') {
    const hits = criticalDamagedSlots(mech, 'Fusion Engine').length;
    if (hits >= 3) {
      mech.destroyed = true;
      return 'Third engine hit — engine shut down; BattleMech destroyed.';
    }
    return `Engine shielding hit (${hits}/3) — +5 heat each turn.`;
  }
  if (normalized === 'gyro') {
    const hits = criticalDamagedSlots(mech, 'Gyro').length;
    if (hits >= 2) return 'Second gyro hit — gyro destroyed; BattleMech cannot move.';
    return 'Gyro hit — a Piloting Skill Roll is required (+3).';
  }
  if (normalized === 'sensors') {
    const hits = criticalDamagedSlots(mech, 'Sensors').length;
    return hits >= 2 ? 'Second sensor hit — sensors destroyed; weapons cannot fire.' : 'Sensor hit — +2 weapon to-hit modifier.';
  }
  if (normalized === 'heat sink') return 'Heat sink destroyed — heat dissipation reduced by 1.';
  if (normalized === 'double heat sink') return 'Double heat sink destroyed — heat dissipation reduced by 2.';
  if (normalized === 'life support') return 'Life support destroyed — pilot consciousness checks apply.';
  if (/actuator|shoulder|hip/.test(normalized)) return `${label} destroyed — movement or arm-use penalties now apply.`;
  const ammo = criticalAmmoExplosion(mech, location, label);
  if (ammo) return ammo;
  if (Object.values(BT_WEAPONS).some(weapon => weapon.name === label)) return `${label} destroyed — weapon disabled.`;
  return `${label} destroyed.`;
}

function criticalDamagedSlots(mech, wantedName) {
  const layout = BT_CRITICAL_LAYOUTS[mech.unitId] || {};
  return Object.entries(mech.criticalSlotDamage || {}).flatMap(([location, indices]) =>
    (indices || []).filter(index => criticalSlotName(layout[location]?.[index]) === wantedName)
      .map(index => ({ location, index }))
  );
}

function criticalMobilityState(mech) {
  const damagedIn = (location, names) => {
    const wanted = new Set(names);
    const layout = BT_CRITICAL_LAYOUTS[mech.unitId]?.[location] || [];
    return (mech.criticalSlotDamage?.[location] || []).filter(index => wanted.has(criticalSlotName(layout[index]))).length;
  };
  const allDamaged = Object.entries(mech.criticalSlotDamage || {}).flatMap(([location, indices]) => {
    const layout = BT_CRITICAL_LAYOUTS[mech.unitId]?.[location] || [];
    return (indices || []).map(index => criticalSlotName(layout[index]));
  });
  const gyroHits = allDamaged.filter(label => /gyro/i.test(label)).length;
  const leftHipHits = damagedIn('ll', ['Hip']);
  const rightHipHits = damagedIn('rl', ['Hip']);
  const actuatorNames = ['Upper Leg Actuator', 'Lower Leg Actuator', 'Foot Actuator'];
  const leftActuatorHits = damagedIn('ll', actuatorNames);
  const rightActuatorHits = damagedIn('rl', actuatorNames);
  const leftLegDestroyed = (mech.structure?.ll || 0) <= 0;
  const rightLegDestroyed = (mech.structure?.rl || 0) <= 0;
  const leftModifier = leftLegDestroyed ? 5 : leftHipHits ? 2 : leftActuatorHits;
  const rightModifier = rightLegDestroyed ? 5 : rightHipHits ? 2 : rightActuatorHits;
  const gyroModifier = gyroHits >= 2 ? 6 : gyroHits === 1 ? 3 : 0;
  return {
    gyroHits, gyroDestroyed: gyroHits >= 2, gyroModifier,
    leftHipHits, rightHipHits, hipHits: leftHipHits + rightHipHits,
    leftActuatorHits, rightActuatorHits, legActuatorHits: leftActuatorHits + rightActuatorHits,
    leftLegDestroyed, rightLegDestroyed,
    destroyedLegs: Number(leftLegDestroyed) + Number(rightLegDestroyed),
    legModifier: leftModifier + rightModifier,
    pilotingModifier: gyroModifier + leftModifier + rightModifier
  };
}

function criticalMovementProfile(mech) {
  const unit = BT_UNITS[mech.unitId];
  const damage = criticalMobilityState(mech);
  const baseWalk = unit?.movement?.walk || 0;
  const baseJump = unit?.movement?.jump || 0;
  let walk;
  if (damage.destroyedLegs >= 2 || damage.hipHits >= 2) walk = 0;
  else if (damage.destroyedLegs === 1) walk = 1;
  else {
    const leftDeduction = damage.leftHipHits ? 0 : damage.leftActuatorHits;
    const rightDeduction = damage.rightHipHits ? 0 : damage.rightActuatorHits;
    walk = Math.max(0, (damage.hipHits === 1 ? Math.ceil(baseWalk / 2) : baseWalk) - leftDeduction - rightDeduction);
  }
  const run = damage.destroyedLegs ? 0 : Math.ceil(walk * 1.5);
  const layout = BT_CRITICAL_LAYOUTS[mech.unitId] || {};
  let unavailableJumpJets = 0;
  for (const [location, slots] of Object.entries(layout)) {
    slots.forEach((slot, index) => {
      if (!/jump jet/i.test(criticalSlotName(slot))) return;
      if ((mech.structure?.[location] || 0) <= 0 || (mech.criticalSlotDamage?.[location] || []).includes(index)) unavailableJumpJets++;
    });
  }
  const jump = damage.destroyedLegs >= 2 ? 0 : Math.max(0, baseJump - unavailableJumpJets);
  return { ...damage, baseWalk, baseJump, walk, run, jump, unavailableJumpJets };
}

function isWeaponCriticallyDestroyed(mech, weaponEntry) {
  const location = criticalLocationKey(weaponEntry.location);
  const layout = BT_CRITICAL_LAYOUTS[mech.unitId]?.[location] || [];
  const catalogueLabel = criticalWeaponLabel(weaponEntry.key);
  const wanted = criticalEquipmentKey(catalogueLabel === weaponEntry.key ? (weaponEntry.weapon?.name || catalogueLabel) : catalogueLabel);
  const mountId = weaponEntry.mountId;
  if (mountId && (mech.destroyedMounts || []).includes(mountId)) return true;
  const unitWeapons = (BT_UNITS[mech.unitId]?.weapons || []).filter(entry => {
    const label = criticalWeaponLabel(entry.key);
    return criticalLocationKey(entry.location) === location && criticalEquipmentKey(label === entry.key ? (entry.weapon?.name || label) : label) === wanted;
  });
  const matchingSlots = layout.map((slot, index) => criticalEquipmentKey(slot) === wanted ? index : -1).filter(index => index >= 0);
  const mountIndex = unitWeapons.indexOf(weaponEntry);
  if (mountIndex < 0 || !matchingSlots.length) return false;
  const assigned = matchingSlots.filter((_, slotOrdinal) => Math.floor(slotOrdinal * unitWeapons.length / matchingSlots.length) === mountIndex);
  return assigned.some(index => (mech.criticalSlotDamage?.[location] || []).includes(index));
}

function criticalToHitModifier(mech) {
  const sensorHits = criticalDamagedSlots(mech, 'Sensors').length;
  return sensorHits === 1 ? 2 : 0;
}

function weaponsDisabledByCritical(mech) {
  return criticalDamagedSlots(mech, 'Sensors').length >= 2;
}

function gyroDestroyedByCritical(mech) {
  return criticalDamagedSlots(mech, 'Gyro').length >= 2;
}

function destroyedHeatSinkCapacity(mech) {
  const layout = BT_CRITICAL_LAYOUTS[mech.unitId] || {};
  return Object.entries(mech.criticalSlotDamage || {}).reduce((total, [location, indices]) => total + (indices || []).reduce((locationTotal, index) => {
    const slot = criticalSlotName(layout[location]?.[index]);
    return locationTotal + (/Double Heat Sink$/i.test(slot) ? 2 : slot === 'Heat Sink' ? 1 : 0);
  }, 0), 0);
}

function engineCriticalHeat(mech) {
  return Math.min(3, criticalDamagedSlots(mech, 'Fusion Engine').length) * 5;
}

function resolveCriticalHits(mech, initialLocation) {
  const roll = { dieA: criticalDie(), dieB: criticalDie() };
  roll.total = roll.dieA + roll.dieB;
  const initial = criticalRollResult(roll.total, initialLocation);
  const events = [];
  if (initial.special === 'blown_off') {
    finalizeBlownOffLocation(mech, initialLocation);
    events.push(`${CRITICAL_LOCATION_NAMES[initialLocation]} blown off on a 12${initialLocation === 'head' ? ' — target destroyed' : ''}.`);
    return { triggered: true, roll, events, count: 0 };
  }
  let current = initialLocation;
  let remaining = initial.count;
  while (remaining > 0 && current && !mech.destroyed) {
    let found = null;
    for (let attempts = 0; attempts < 60; attempts++) {
      const index = criticalSlotIndex(current);
      if (criticalSlotCanTakeDamage(mech, current, index)) { found = index; break; }
    }
    // A normal random roll will always settle naturally.  This guard only
    // protects the UI against a pathological random source: it still selects
    // a legal remaining slot in this location, never transfers a valid crit.
    if (found == null) {
      const available = availableCriticalSlots(mech, current);
      if (available.length) found = available[criticalDie() % available.length];
    }
    if (found == null) {
      current = CRITICAL_TRANSFER[current];
      continue;
    }
    const slot = BT_CRITICAL_LAYOUTS[mech.unitId][current][found];
    markCriticalSlot(mech, current, found);
    events.push(`${CRITICAL_LOCATION_NAMES[current]} slot ${found + 1}: ${criticalEffectMessage(mech, current, slot)}`);
    remaining -= 1;
  }
  return { triggered: initial.count > 0, roll, events, count: initial.count };
}
