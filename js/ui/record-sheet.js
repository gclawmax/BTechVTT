// ── FULL BATTLEMECH RECORD SHEET ──────────────────────────
const RECORD_LOCATIONS = [
  ['head', 'Head'], ['la', 'Left Arm'], ['ra', 'Right Arm'], ['lt', 'Left Torso'],
  ['ct', 'Center Torso'], ['rt', 'Right Torso'], ['ll', 'Left Leg'], ['rl', 'Right Leg']
];

function recordSheetSlotState(mech, location, index) {
  if ((mech.structure?.[location] || 0) <= 0) return 'destroyed';
  return mech.criticalSlotDamage?.[location]?.includes(index) ? 'damaged' : 'intact';
}

function recordAmmoForSlot(mech, location, index, slotName) {
  // Weapon criticals and ammunition criticals may contain the same weapon
  // name. Only the exact ammunition-bin slot owns a shot count.
  if (!/ammo/i.test(slotName)) return '';
  const bin = (mech.ammoBins || []).find(candidate => candidate.id === `${location}:${index}`);
  return bin ? ` — ${bin.shots}/${bin.maxShots} shots${bin.loadType ? ` · ${bin.loadType === 'semi_guided' ? 'semi-guided' : bin.loadType}` : ''}` : '';
}

function renderRecordSystemDamage(mech) {
  const systems = [
    ['Engine Hits', 'Fusion Engine', 3],
    ['Gyro Hits', 'Gyro', 2],
    ['Sensor Hits', 'Sensors', 2],
    ['Life Support', 'Life Support', 1]
  ];
  const available = Boolean(BT_CRITICAL_LAYOUTS[mech.unitId]);
  return `<section class="record-system-damage" aria-label="Critical system damage"><h3>Critical Damage</h3><div class="record-system-grid">${systems.map(([label, name, maximum]) => {
    const hits = available ? Math.min(maximum, criticalDamagedSlots(mech, name).length) : 0;
    const status = !available ? 'Not recorded' : name === 'Life Support' ? (hits ? 'Damaged' : 'Intact') : `${hits} / ${maximum} hits`;
    return `<div class="record-system-row${hits ? ' has-damage' : ''}"><strong>${label}</strong><span class="record-system-pips" role="img" aria-label="${label}: ${status}">${available ? Array.from({length: maximum}, (_, index) => `<i class="record-system-pip${index < hits ? ' hit' : ''}" aria-hidden="true">${index < hits ? '×' : ''}</i>`).join('') : '—'}</span><span>${status}</span></div>`;
  }).join('')}</div></section>`;
}

function recordArmourCondition(mech, unit, key) {
  const armour = mech.armor?.[key] ?? 0;
  const armourMax = unit.armor?.[key] ?? 0;
  const structure = mech.structure?.[key] ?? 0;
  const structureMax = unit.structure?.[key] ?? 0;
  const rearKey = `${key}_rear`;
  const hasRearArmour = ['ct', 'lt', 'rt'].includes(key);
  const rear = mech.armor?.[rearKey] ?? 0;
  const rearMax = unit.armor?.[rearKey] ?? 0;
  return `<div class="record-condition"><span style="color:${damageColour(armour,armourMax)};background:${recordDamageBackground(armour,armourMax)}">A Front ${armour} / ${armourMax}</span>${hasRearArmour ? `<span class="record-armour-rear" style="color:${damageColour(rear,rearMax)};background:${recordDamageBackground(rear,rearMax)}">A Rear ${rear} / ${rearMax}</span>` : ''}<span style="color:${damageColour(structure,structureMax)};background:${recordDamageBackground(structure,structureMax)}">I ${structure} / ${structureMax}</span></div>`;
}

function showRecordSheet(instanceId) {
  const mech = mechInstances.find(item => item.instanceId === instanceId);
  if (!mech || !ensureMechCombatState(mech)) return;
  const unit = displayUnitFor(mech.unitId);
  const layout = BT_CRITICAL_LAYOUTS[mech.unitId] || {};
  document.getElementById('record-sheet-modal')?.remove();
  const locations = RECORD_LOCATIONS.map(([key, label]) => {
    const slotCount = ['head', 'll', 'rl'].includes(key) ? 6 : 12;
    const slots = Array.from({ length: slotCount }, (_, index) => layout[key]?.[index] || null).map((slot, index) => {
      const state = slot ? recordSheetSlotState(mech, key, index) : 'empty';
      return `<li class="record-slot ${state}"><span>${String(index + 1).padStart(2, '0')}</span>${slot ? `${slot}${recordAmmoForSlot(mech, key, index, slot)}` : '—'}</li>`;
    }).join('');
    return `<section class="record-location record-${key}"><h4>${label}</h4>${recordArmourCondition(mech, unit, key)}<ol>${slots}</ol></section>`;
  }).join('');
  const criticalCount = Object.values(mech.criticalSlotDamage || {}).reduce((total, slots) => total + slots.length, 0);
  const pilot = mech.pilot || { hits: 0, consciousness: 'conscious' };
  const pilotState = String(pilot.consciousness || 'conscious').toUpperCase();
  const modal = document.createElement('div');
  modal.id = 'record-sheet-modal';
  modal.className = 'record-sheet-modal';
  modal.innerHTML = `<div class="record-sheet" role="dialog" aria-modal="true" aria-label="${unit.chassis} ${unit.variant} record sheet">
    <header><div><div class="panel-eyebrow">BattleMech Record Sheet</div><h2>${unit.chassis} ${unit.variant}</h2><p>Player ${mech.owner} · ${unit.tonnage} tons · Heat ${mech.heat || 0} · ${escapeHtml(pilot.name || 'MechWarrior')} · Gunnery ${pilot.gunnery ?? 4} · Piloting ${pilot.piloting ?? mech.pilotingSkill ?? 5}</p></div><button onclick="closeRecordSheet()">Close</button></header>
    <div class="record-note">Pilot: ${escapeHtml(pilot.name || 'MechWarrior')} · ${pilotState} · ${pilot.hits || 0} hit${pilot.hits === 1 ? '' : 's'}. Critical slots are shown from the unit record. ${criticalCount ? `${criticalCount} critical slot${criticalCount === 1 ? '' : 's'} damaged.` : 'No critical slots damaged.'}</div>
    <section class="record-weapon-inventory"><h3>Weapons Inventory</h3>${renderWeaponInventory(unit, 'record-weapon-table', mech)}</section>
    <div class="record-grid">${locations}${renderRecordSystemDamage(mech)}</div>
  </div>`;
  document.body.appendChild(modal);
}

function closeRecordSheet() {
  document.getElementById('record-sheet-modal')?.remove();
}

function recordDamageBackground(current, maximum) {
 const ratio = maximum > 0 ? Math.max(0,Math.min(1,current/maximum)) : 0;
 return `hsl(${Math.round(ratio*120)} 58% 87%)`;
}
