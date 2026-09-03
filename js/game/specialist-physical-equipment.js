// Specialist physical equipment is catalogue-led.  Keep detection in one
// place so an imported unit never gains a client-only bonus after a critical.
const BT_SPECIALIST_PHYSICAL_EQUIPMENT = Object.freeze({
  talons: { labels:['talons'], description:'Talons increase kick and Death From Above damage by 50% when the mounting foot is intact.' },
  mechanical_jump_booster: { labels:['mechanicaljumpbooster','mechmechanicaljumpboosters','jumpboostermech'], description:'Uses its recorded Jumping MP instead of a lower jump-jet rating.' },
  shield_small: { labels:['shieldsmall','smallshield'], description:'Open/Experimental equipment; defensive modes require the shield resolver.' },
  shield_medium: { labels:['shieldmedium','mediumshield'], description:'Open/Experimental equipment; defensive modes require the shield resolver.' },
  shield_large: { labels:['shieldlarge','largeshield'], description:'Open/Experimental equipment; defensive modes require the shield resolver.' },
  actuator_enhancement: { labels:['actuatorenhancementsystem','aes'], description:'Open/Experimental equipment; retained as a catalogue audit marker until its published firing rules are enabled.' }
});

function specialistPhysicalSlots(mech, key, location = null) {
  const definition = BT_SPECIALIST_PHYSICAL_EQUIPMENT[key];
  if (!mech || !definition) return [];
  return Object.entries(BT_CRITICAL_LAYOUTS[mech.unitId] || {}).flatMap(([slotLocation, slots]) => {
    if (location && slotLocation !== location) return [];
    return (slots || []).map((label, index) => ({ slotLocation, index, label, equipmentKey: criticalEquipmentKey(label) }))
      .filter(slot => definition.labels.includes(slot.equipmentKey));
  });
}

function specialistPhysicalOperational(mech, key, location = null) {
  const slots = specialistPhysicalSlots(mech, key, location);
  return Boolean(mech && !mech.destroyed && !mech.shutdown && slots.length && slots.every(slot =>
    (mech.structure?.[slot.slotLocation] || 0) > 0 && !(mech.criticalSlotDamage?.[slot.slotLocation] || []).includes(slot.index)
  ));
}

function hasOperationalTalons(mech, leg) {
  return specialistPhysicalOperational(mech, 'talons', leg) &&
    (mech.structure?.[leg] || 0) > 0 &&
    !physicalComponentState(mech, leg, 'Foot Actuator').damaged;
}

function talonAdjustedDamage(mech, leg, damage) {
  return hasOperationalTalons(mech, leg) ? Math.ceil(Number(damage || 0) * 1.5) : damage;
}

function mechanicalJumpBoosterMP(mech) {
  if (!specialistPhysicalOperational(mech, 'mechanical_jump_booster')) return 0;
  const unit = BT_UNITS[mech.unitId] || {};
  const recorded = Number(mech.mechanicalJumpBoosterMP ?? unit.mechanical_jump_booster_mp ?? unit.movement?.jump_booster ?? 0);
  return Number.isFinite(recorded) ? Math.max(0, recorded) : 0;
}
