// ── FULL BATTLEMECH RECORD SHEET ──────────────────────────
const RECORD_LOCATIONS = [
  ['head', 'Head'], ['la', 'Left Arm'], ['ra', 'Right Arm'], ['lt', 'Left Torso'],
  ['ct', 'Center Torso'], ['rt', 'Right Torso'], ['ll', 'Left Leg'], ['rl', 'Right Leg']
];

function recordSheetSlotState(mech, location, index) {
  if ((mech.structure?.[location] || 0) <= 0) return 'destroyed';
  return mech.criticalSlotDamage?.[location]?.includes(index) ? 'damaged' : 'intact';
}

function recordAmmoForSlot(mech, slotName) {
  const name = slotName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const bin = (mech.ammoBins || []).find(candidate =>
    name.includes(candidate.type.replace(/[^a-z0-9]/g, '')) ||
    (candidate.type === 'machine_gun' && name.includes('ammomg'))
  );
  return bin ? ` — ${bin.shots}/${bin.maxShots} shots` : '';
}

function showRecordSheet(instanceId) {
  const mech = mechInstances.find(item => item.instanceId === instanceId);
  if (!mech || !ensureMechCombatState(mech)) return;
  const unit = BT_UNITS[mech.unitId];
  const layout = BT_CRITICAL_LAYOUTS[mech.unitId] || {};
  document.getElementById('record-sheet-modal')?.remove();
  const locations = RECORD_LOCATIONS.map(([key, label]) => {
    const armour = mech.armor?.[key] ?? 0;
    const armourMax = unit.armor?.[key] ?? 0;
    const structure = mech.structure?.[key] ?? 0;
    const structureMax = unit.structure?.[key] ?? 0;
    const slots = (layout[key] || Array(12).fill(null)).map((slot, index) => {
      const state = slot ? recordSheetSlotState(mech, key, index) : 'empty';
      return `<li class="record-slot ${state}"><span>${String(index + 1).padStart(2, '0')}</span>${slot ? `${slot}${recordAmmoForSlot(mech, slot)}` : '—'}</li>`;
    }).join('');
    return `<section class="record-location"><h4>${label}</h4><div class="record-condition"><span>A ${armour} / ${armourMax}</span><span>I ${structure} / ${structureMax}</span></div><ol>${slots}</ol></section>`;
  }).join('');
  const criticalCount = Object.values(mech.criticalSlotDamage || {}).reduce((total, slots) => total + slots.length, 0);
  const modal = document.createElement('div');
  modal.id = 'record-sheet-modal';
  modal.className = 'record-sheet-modal';
  modal.innerHTML = `<div class="record-sheet" role="dialog" aria-modal="true" aria-label="${unit.chassis} ${unit.variant} record sheet">
    <header><div><div class="panel-eyebrow">BattleMech Record Sheet</div><h2>${unit.chassis} ${unit.variant}</h2><p>Player ${mech.owner} · ${unit.tonnage} tons · Heat ${mech.heat || 0}</p></div><button onclick="closeRecordSheet()">Close</button></header>
    <div class="record-note">Critical slots are shown from the unit record. ${criticalCount ? `${criticalCount} critical slot${criticalCount === 1 ? '' : 's'} damaged.` : 'No critical slots damaged.'}</div>
    <div class="record-grid">${locations}</div>
  </div>`;
  document.body.appendChild(modal);
}

function closeRecordSheet() {
  document.getElementById('record-sheet-modal')?.remove();
}
