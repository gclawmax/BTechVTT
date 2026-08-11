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
      <div class="k">Facing</div><div class="v">${HEX_DIR_LABELS[inst.facing || 0]}</div>
      <div class="k">Walk / Run / Jump</div><div class="v">${unit.movement.walk} / ${unit.movement.run} / ${unit.movement.jump}</div>
      <div class="k">Heat Sinks</div><div class="v">${unit.heat_sinks} (${unit.heat_sink_type})</div>
      ${inst.hasMoved ? `<div class="k">This Turn</div><div class="v">${titleCaseMode(inst.movementMode)} · ${inst.hexesMoved} hex${inst.hexesMoved===1?'':'es'}</div>` : ''}
    </div>
    <div class="panel-eyebrow" style="margin-top:14px;">Weapons</div>
    <div class="stat-grid">
      ${unit.weapons.map(w => `<div class="k">${w.key.replace('_',' ')}</div><div class="v">×${w.count} — ${w.location.toUpperCase()}</div>`).join('')}
    </div>
    <div class="panel-eyebrow" style="margin-top:14px;">Armor / Structure</div>
    <div class="armor-diagram">
      ${armorCell('la','LA', unit.armor.la, unit.structure.la)}${armorCell('h','HD', unit.armor.head, unit.structure.head)}${armorCell('ra','RA', unit.armor.ra, unit.structure.ra)}
      ${armorCell('lt','LT', unit.armor.lt, unit.structure.lt)}${armorCell('ct','CT', unit.armor.ct, unit.structure.ct)}${armorCell('rt','RT', unit.armor.rt, unit.structure.rt)}
      ${armorCell('ll','LL', unit.armor.ll, unit.structure.ll)}${armorCell('','', null, null)}${armorCell('rl','RL', unit.armor.rl, unit.structure.rl)}
    </div>
  `;
}
