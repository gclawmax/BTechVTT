// ── PANEL RENDERING ──────────────────────────────────────
function renderRoster() {
  const list = document.getElementById('roster-list');
  list.innerHTML = '';
  mechInstances.forEach(inst => {
    const unit = BT_UNITS[inst.unitId];
    const row = document.createElement('div');
    row.className = 'roster-item' + (inst.instanceId === selectedInstanceId ? ' selected' : '');

    let moveBadge = '';
    if (currentGameState.phase === 'movement') {
      if (inst.hasMoved) {
        moveBadge = `<span style="font-size:9px;color:#2a7a2a;letter-spacing:.06em;margin-left:6px;">MOVED</span>`;
      } else if (inst.owner === mySeatNumber) {
        moveBadge = `<span style="font-size:9px;color:var(--amber);letter-spacing:.06em;margin-left:6px;">● MOVE</span>`;
      } else {
        moveBadge = `<span style="font-size:9px;color:var(--phosphor-dim);letter-spacing:.06em;margin-left:6px;">WAITING</span>`;
      }
    }
    if (currentGameState.phase === 'weapon_attack') {
      if (inst.hasFired) {
        moveBadge = `<span style="font-size:9px;color:#2a7a2a;letter-spacing:.06em;margin-left:6px;">FIRED</span>`;
      } else if (inst.owner === mySeatNumber) {
        moveBadge = `<span style="font-size:9px;color:var(--amber);letter-spacing:.06em;margin-left:6px;">● FIRE</span>`;
      } else {
        moveBadge = `<span style="font-size:9px;color:var(--phosphor-dim);letter-spacing:.06em;margin-left:6px;">WAITING</span>`;
      }
    }
    if (currentGameState.phase === 'physical_attack') {
      if (inst.hasPhysicalAttacked) {
        moveBadge = `<span style="font-size:9px;color:#2a7a2a;letter-spacing:.06em;margin-left:6px;">DONE</span>`;
      } else if (inst.owner === mySeatNumber) {
        moveBadge = `<span style="font-size:9px;color:var(--amber);letter-spacing:.06em;margin-left:6px;">● MELEE</span>`;
      } else {
        moveBadge = `<span style="font-size:9px;color:var(--phosphor-dim);letter-spacing:.06em;margin-left:6px;">WAITING</span>`;
      }
    }

    row.innerHTML = `
      <div class="roster-swatch" style="background:${unit.color}"></div>
      <div class="roster-name">${unit.chassis} <span style="color:var(--phosphor-dim)">${unit.variant}</span>${moveBadge}</div>
      <div class="roster-sub">P${inst.owner} · ${unit.tonnage}t · ${hexCode(inst.col, inst.row)}</div>
    `;
    row.addEventListener('click', () => selectInstance(inst.instanceId));
    list.appendChild(row);
  });
}

function armorCell(loc, label, armor, structure) {
  return `<div class="armor-cell"><span class="loc">${label}</span><span class="val">${armor ?? '—'}${structure !== undefined ? ` <span style="color:var(--phosphor-dim)">(${structure})</span>` : ''}</span></div>`;
}

function renderDetail() {
  const body = document.getElementById('detail-body');
  const inst = mechInstances.find(m => m.instanceId === selectedInstanceId);
  if (!inst) {
    body.className = 'no-selection';
    body.innerHTML = 'No unit selected. Click a token on the map, or an entry in the roster above.';
    return;
  }
  const unit = BT_UNITS[inst.unitId];
  const axial = offsetToAxial(inst.col, inst.row);
  body.className = '';
  body.innerHTML = `
    <div style="font-family:var(--display);font-size:15px;letter-spacing:.04em;color:${unit.color};margin-bottom:2px;">
      ${unit.chassis} ${unit.variant}
    </div>
    <div style="font-size:10px;color:var(--phosphor-dim);margin-bottom:12px;">
      ${unit.tonnage} TONS · PLAYER ${inst.owner}
    </div>
    <div class="stat-grid">
      <div class="k">Hex</div><div class="v">${hexCode(inst.col, inst.row)} (q${axial.q} r${axial.r})</div>
      <div class="k">Leg Facing</div><div class="v">${HEX_DIR_LABELS[inst.facing || 0]}</div>
      <div class="k">Torso Facing</div><div class="v">${HEX_DIR_LABELS[inst.torsoFacing == null ? inst.facing : inst.torsoFacing]}</div>
      <div class="k">Walk / Run / Jump</div><div class="v">${unit.movement.walk} / ${unit.movement.run} / ${unit.movement.jump}</div>
      <div class="k">Heat Sinks</div><div class="v">${unit.heat_sinks} (${unit.heat_sink_type})</div>
      <div class="k">Heat</div><div class="v">${inst.heat || 0}${inst.weaponHeat ? ` · weapons +${inst.weaponHeat}` : ''}</div>
      ${inst.hasMoved ? `<div class="k">This Turn</div><div class="v">${titleCaseMode(inst.movementMode)} · ${inst.hexesMoved} hex${inst.hexesMoved===1?'':'es'}</div>` : ''}
    </div>
    <div class="panel-eyebrow" style="margin-top:14px;">Weapons</div>
    <div class="stat-grid">
      ${unit.weapons.map(w => `<div class="k">${w.key.replace('_',' ')}</div><div class="v">×${w.count} — ${w.location.toUpperCase()}</div>`).join('')}
    </div>
    <div class="panel-eyebrow" style="margin-top:14px;">Armor / Structure</div>
    <div class="armor-diagram">
      ${armorCell('la','LA', inst.armor.la, inst.structure.la)}${armorCell('h','HD', inst.armor.head, inst.structure.head)}${armorCell('ra','RA', inst.armor.ra, inst.structure.ra)}
      ${armorCell('lt','LT', inst.armor.lt, inst.structure.lt)}${armorCell('ct','CT', inst.armor.ct, inst.structure.ct)}${armorCell('rt','RT', inst.armor.rt, inst.structure.rt)}
      ${armorCell('ll','LL', inst.armor.ll, inst.structure.ll)}${armorCell('','', null, null)}${armorCell('rl','RL', inst.armor.rl, inst.structure.rl)}
    </div>
  `;
}
