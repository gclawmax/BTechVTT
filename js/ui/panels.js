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

function damageColour(current, maximum) {
  if (!Number.isFinite(current) || !Number.isFinite(maximum) || maximum <= 0) return '#8d8d8d';
  const ratio = Math.max(0, Math.min(1, current / maximum));
  // 0% is red, 50% amber, and 100% green.
  return `hsl(${Math.round(ratio * 120)} 62% 35%)`;
}

function armorCell(loc, label, armor, armorMax, structure, structureMax) {
  if (!label) return '<div></div>';
  const armorColour = damageColour(armor, armorMax);
  const structureColour = damageColour(structure, structureMax);
  const ratio = Math.min(
    Number.isFinite(armor) && Number.isFinite(armorMax) && armorMax > 0 ? armor / armorMax : 1,
    Number.isFinite(structure) && Number.isFinite(structureMax) && structureMax > 0 ? structure / structureMax : 1
  );
  const background = `hsla(${Math.round(Math.max(0, Math.min(1, ratio)) * 120)} 62% 45% / .10)`;
  return `<div class="armor-cell" style="background:${background}" title="Armour ${armor ?? '—'} / ${armorMax ?? '—'} · Internal structure ${structure ?? '—'} / ${structureMax ?? '—'}"><span class="loc">${label}</span><span class="val"><span style="color:${armorColour}">A ${armor ?? '—'} / ${armorMax ?? '—'}</span><br><span style="color:${structureColour}">I ${structure ?? '—'} / ${structureMax ?? '—'}</span></span></div>`;
}

function renderDetail() {
  const body = document.getElementById('detail-body');
  const inst = mechInstances.find(m => m.instanceId === selectedInstanceId);
  if (!inst) {
    body.className = 'no-selection';
    body.innerHTML = 'No unit selected. Click a token on the map, or an entry in the roster above.';
    return;
  }
  // Realtime game snapshots can contain the compact unit representation.
  // Keep this panel safe even if a snapshot arrives between render passes.
  if (!ensureMechCombatState(inst)) {
    body.className = 'no-selection';
    body.textContent = 'This unit is not supported by the current catalogue.';
    return;
  }
  const unit = BT_UNITS[inst.unitId];
  const axial = offsetToAxial(inst.col, inst.row);
  body.className = '';
  body.innerHTML = `
    <div style="font-family:var(--display);font-size:15px;letter-spacing:.04em;color:${unit.color};margin-bottom:2px;">
      ${unit.chassis} ${unit.variant}
    </div>
    <button onclick="showRecordSheet('${inst.instanceId}')" style="margin:2px 0 10px;padding:6px 8px;border:1px solid var(--panel-line);background:transparent;color:var(--phosphor);font:9px var(--display);letter-spacing:.06em;text-transform:uppercase;cursor:pointer;">Open Full Record Sheet</button>
    <div style="font-size:10px;color:var(--phosphor-dim);margin-bottom:12px;">
      ${unit.tonnage} TONS · PLAYER ${inst.owner}
    </div>
    <div class="stat-grid">
      <div class="k">Hex</div><div class="v">${hexCode(inst.col, inst.row)} (q${axial.q} r${axial.r})</div>
      <div class="k">Leg Facing</div><div class="v">${HEX_DIR_LABELS[inst.facing || 0]}</div>
      <div class="k">Torso Facing</div><div class="v">${HEX_DIR_LABELS[inst.torsoFacing == null ? inst.facing : inst.torsoFacing]}</div>
      <div class="k">Walk / Run / Jump</div><div class="v">${unit.movement.walk} / ${unit.movement.run} / ${unit.movement.jump}</div>
      <div class="k">Heat Sinks</div><div class="v">${unit.heat_sinks} (${unit.heat_sink_type})</div>
      <div class="k">Heat</div><div class="v">${inst.heat || 0}${inst.movementHeat || inst.weaponHeat ? ` · move +${inst.movementHeat || 0}, weapons +${inst.weaponHeat || 0}` : ''}</div>
      <div class="k">Damage State</div><div class="v">${inst.destroyed ? 'DESTROYED' : `${inst.criticalHits || 0} critical check${inst.criticalHits === 1 ? '' : 's'}`}</div>
      ${inst.hasMoved ? `<div class="k">This Turn</div><div class="v">${titleCaseMode(inst.movementMode)} · ${inst.hexesMoved} hex${inst.hexesMoved===1?'':'es'}</div>` : ''}
    </div>
    <div class="panel-eyebrow" style="margin-top:14px;">Weapons</div>
    <div class="stat-grid">
      ${unit.weapons.map(w => `<div class="k">${w.key.replace('_',' ')}</div><div class="v">×${w.count} — ${w.location.toUpperCase()}</div>`).join('')}
    </div>
    ${(inst.ammoBins || []).length ? `<div class="panel-eyebrow" style="margin-top:14px;">Ammunition</div><div class="stat-grid">${inst.ammoBins.map(bin => `<div class="k">${bin.type.replace('_',' ')} · ${bin.location}</div><div class="v">${bin.shots} / ${bin.maxShots} shots</div>`).join('')}</div>` : ''}
    <div class="panel-eyebrow" style="margin-top:14px;">Armour / Internal Structure</div>
    <div style="font-size:9px;color:var(--phosphor-dim);margin:-8px 0 6px;">A = current / maximum armour · I = current / maximum internal structure</div>
    <div class="armor-diagram">
      ${armorCell('la','LA', inst.armor.la, unit.armor.la, inst.structure.la, unit.structure.la)}${armorCell('h','HD', inst.armor.head, unit.armor.head, inst.structure.head, unit.structure.head)}${armorCell('ra','RA', inst.armor.ra, unit.armor.ra, inst.structure.ra, unit.structure.ra)}
      ${armorCell('lt','LT', inst.armor.lt, unit.armor.lt, inst.structure.lt, unit.structure.lt)}${armorCell('ct','CT', inst.armor.ct, unit.armor.ct, inst.structure.ct, unit.structure.ct)}${armorCell('rt','RT', inst.armor.rt, unit.armor.rt, inst.structure.rt, unit.structure.rt)}
      ${armorCell('ll','LL', inst.armor.ll, unit.armor.ll, inst.structure.ll, unit.structure.ll)}${armorCell('','', null, null, null, null)}${armorCell('rl','RL', inst.armor.rl, unit.armor.rl, inst.structure.rl, unit.structure.rl)}
    </div>
  `;
}
