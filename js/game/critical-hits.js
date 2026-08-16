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

function criticalSlotName(slot) {
  return String(slot || '').replace(/\s*\([A-Z]\)$/, '').trim();
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
    lr20: 'LRM 20', lrm20: 'LRM 20', lrm10: 'LRM 10', lr6: 'LRM 6', sr6: 'SRM 6', srm6: 'SRM 6',
    med_laser: 'Medium Laser', small_laser: 'Small Laser', large_laser: 'Large Laser',
    erl: 'ER Large Laser', ppc: 'PPC', machine_gun: 'Machine Gun', streak_sr4: 'Streak SRM 4'
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
  const damage = (BT_WEAPONS[type]?.damage || 0) * shots;
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

function criticalEffectMessage(mech, location, slot) {
  const label = criticalSlotName(slot);
  const normalized = label.toLowerCase();
  if (normalized === 'cockpit') {
    mech.destroyed = true;
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

function isWeaponCriticallyDestroyed(mech, weaponEntry) {
  const location = criticalLocationKey(weaponEntry.location);
  const layout = BT_CRITICAL_LAYOUTS[mech.unitId]?.[location] || [];
  const wanted = criticalWeaponLabel(weaponEntry.key);
  return (mech.criticalSlotDamage?.[location] || []).some(index => criticalSlotName(layout[index]) === wanted);
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
    return locationTotal + (slot === 'Double Heat Sink' ? 2 : slot === 'Heat Sink' ? 1 : 0);
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
    mech.structure[initialLocation] = 0;
    if (initialLocation === 'head') mech.destroyed = true;
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
