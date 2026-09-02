// ── PANEL RENDERING ──────────────────────────────────────
function renderRoster() {
  const list = document.getElementById('roster-list');
  list.innerHTML = '';
  mechInstances.forEach(inst => {
    if (isEnemyHiddenUnit(inst)) return;
    const unit = displayUnitFor(inst.unitId);
    const row = document.createElement('div');
    const isActiveUnit = getActivePlayerSeat() === inst.owner && !inst.destroyed;
    row.className = 'roster-item' + (inst.instanceId === selectedInstanceId ? ' selected' : '') +
      (inst.destroyed ? ' destroyed' : '') + (isActiveUnit ? ' is-active-unit' : '') + (isActiveUnit && inst.owner === mySeatNumber ? ' mine' : '');

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
    if (inst.prone && !inst.destroyed) {
      moveBadge += `<span style="font-size:9px;color:#a32832;letter-spacing:.06em;margin-left:6px;">PRONE</span>`;
    }
    if (inst.shutdown && !inst.destroyed) {
      moveBadge += `<span style="font-size:9px;color:#a32832;letter-spacing:.06em;margin-left:6px;">SHUT DOWN</span>`;
    }
    if (inst.pilot?.consciousness && inst.pilot.consciousness !== 'conscious') {
      moveBadge += `<span style="font-size:9px;color:#a32832;letter-spacing:.06em;margin-left:6px;">PILOT ${inst.pilot.consciousness.toUpperCase()}</span>`;
    }
    const damaged = Object.keys(unit.armor || {}).some(location => Number(inst.armor?.[location]) < Number(unit.armor?.[location])) ||
      Object.keys(unit.structure || {}).some(location => Number(inst.structure?.[location]) < Number(unit.structure?.[location]));
    const conditionBadges = [
      inst.catalogueUnavailable ? '<span class="roster-badge damage">CATALOGUE UNAVAILABLE</span>' : '',
      inst.destroyed ? '<span class="roster-badge damage">DESTROYED</span>' : '',
      inst.hidden && inst.owner === mySeatNumber ? '<span class="roster-badge">HIDDEN</span>' : '',
      !inst.destroyed && damaged ? '<span class="roster-badge damage">DAMAGED</span>' : '',
      !inst.destroyed && Number(inst.heat || 0) >= 14 ? `<span class="roster-badge ${Number(inst.heat) >= 20 ? 'heat-hot' : 'heat-warm'}">HEAT ${inst.heat}</span>` : ''
    ].join('');

    row.innerHTML = `
      <div class="roster-swatch" style="background:${unit.color}"></div>
      <div class="roster-name">${unit.chassis} <span style="color:var(--phosphor-dim)">${unit.variant}</span>${moveBadge}<div class="roster-badges">${conditionBadges}</div></div>
      <div class="roster-sub">P${inst.owner} · ${escapeHtml(inst.pilot?.name || 'MechWarrior')} · G${inst.pilot?.gunnery ?? 4}/P${inst.pilot?.piloting ?? inst.pilotingSkill ?? 5} · ${unit.tonnage}t · ${hexCode(inst.col, inst.row)}</div>
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
  const hue = Math.round(Math.max(0, Math.min(1, ratio)) * 120);
  const background = `hsl(${hue} 58% 87%)`;
  const border = `hsl(${hue} 52% 42%)`;
  return `<div class="armor-cell" style="background:${background};border-color:${border}" title="Armour ${armor ?? '—'} / ${armorMax ?? '—'} · Internal structure ${structure ?? '—'} / ${structureMax ?? '—'}"><span class="loc">${label}</span><span class="val"><span style="color:${armorColour}">A <strong>${armor ?? '—'}</strong> / ${armorMax ?? '—'}</span><span style="color:${structureColour}">I <strong>${structure ?? '—'}</strong> / ${structureMax ?? '—'}</span></span></div>`;
}

function roundOneAmmoControl(inst, bin) {
  const isInitiative = currentGameState.round === 1 && currentGameState.phase === 'initiative';
  const choices = typeof specialAmmoLoadTypes === 'function' ? specialAmmoLoadTypes(bin) : [];
  const isUnloadedSpecialBin = typeof ammoSetupRequiredForBin === 'function' && ammoSetupRequiredForBin(bin);
  if (!isInitiative || !isUnloadedSpecialBin) return '';
  if (inst.owner !== mySeatNumber) {
    return `<div style="grid-column:1 / -1;color:var(--phosphor-dim);font-size:9px;margin:2px 0 6px;">Player ${inst.owner} must choose this ammunition before Initiative.</div>`;
  }
  const key = `${inst.instanceId}:${bin.id}`;
  const selected = roundOneAmmoChoices[key] || choices[0];
  const labels = { slug: 'Slug', cluster: 'Cluster', standard: 'Standard', inferno: 'Inferno', precision: 'Precision', semi_guided: 'Semi-guided', armor_piercing: 'Armor-piercing', flechette: 'Flechette', fragmentation: 'Fragmentation' };
  return `<div style="grid-column:1 / -1;margin:3px 0 8px;padding:8px;border:1px solid var(--amber);background:rgba(181,107,0,.08);">
    <div style="color:var(--amber);font-size:10px;margin-bottom:6px;">ROUND 1 AMMUNITION — required before Initiative</div>
    <label style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10px;">Load type
      <select onchange="setRoundOneAmmoChoice('${key}',this.value)" style="font:10px var(--mono);padding:3px;">${choices.map(choice => `<option value="${choice}" ${selected === choice ? 'selected' : ''}>${labels[choice] || titleCase(choice)}</option>`).join('')}</select>
    </label>
    <button onclick="submitRoundOneAmmoLoadout('${key}')" style="width:100%;margin-top:7px;padding:6px 8px;border:1px solid var(--amber);background:transparent;color:var(--amber);font:10px var(--display);letter-spacing:.05em;text-transform:uppercase;cursor:pointer;">Confirm this ammunition bin</button>
  </div>`;
}

async function setSignatureSystemMode(instanceId, key, active) {
  const mech = mechInstances.find(candidate => candidate.instanceId === instanceId);
  if (!mech || mech.owner !== mySeatNumber || currentGameState.phase !== 'initiative') return;
  if (vsAiMode) {
    mech.signatureModes = { ...(mech.signatureModes || {}), [key]: active };
    if (key === 'void' && active) {
      mech.signatureModes.null = false;
      mech.signatureModes.chameleon = false;
    }
    if (active && (key === 'null' || key === 'chameleon')) mech.signatureModes.void = false;
    await syncMechInstances();
  } else {
    const { error } = await db.rpc('set_battlemech_signature_mode', { p_game_id: currentGameId, p_instance_id: instanceId, p_system: key, p_active: active });
    if (error) { flashMoveWarning(error.message); logEvent(`Server rejected signature-system setting: ${error.message}`, 'error'); return; }
    await loadGameState();
  }
  renderDetail();
  renderRoster();
}

function signatureSystemControls(inst) {
  if (typeof SIGNATURE_EQUIPMENT !== 'object') return '';
  const installed = Object.entries(SIGNATURE_EQUIPMENT).filter(([key, system]) => hasOperationalElectronicEquipment(inst, system.keys));
  if (!installed.length) return '';
  const editable = inst.owner === mySeatNumber && currentGameState.phase === 'initiative' && !inst.hasMoved;
  return `<div class="panel-eyebrow" style="margin-top:14px;">Signature Systems</div><div style="font-size:10px;color:var(--phosphor-dim);margin:-8px 0 6px;line-height:1.45;">Select systems during Initiative; the setting applies for this round and adds its listed heat during Heat Management.</div>${installed.map(([key, system]) => {
    const active = signatureSystemActive(inst, key);
    return `<div class="stat-grid" style="margin:4px 0;"><div class="k">${system.name}</div><div class="v">${active ? 'ACTIVE' : 'OFF'} · +${system.heat} heat${editable ? ` <button onclick="setSignatureSystemMode('${inst.instanceId}','${key}',${!active})" style="margin-left:5px;padding:3px 5px;border:1px solid var(--panel-line);background:transparent;color:var(--phosphor);font:8px var(--display);cursor:pointer;">${active ? 'Turn Off' : 'Turn On'}</button>` : ''}</div></div>`;
  }).join('')}`;
}

function renderDetail() {
  const body = document.getElementById('detail-body');
  const inst = mechInstances.find(m => m.instanceId === selectedInstanceId);
  if (!inst) {
    body.className = 'no-selection';
    body.innerHTML = 'No unit selected. Click a token on the map, or an entry in the roster above.';
    return;
  }
  if (inst.catalogueUnavailable) {
    body.className = 'no-selection';
    body.textContent = 'This BattleMech is unavailable in the match’s pinned catalogue. It is shown for reference but cannot be controlled.';
    return;
  }
  // Realtime game snapshots can contain the compact unit representation.
  // Keep this panel safe even if a snapshot arrives between render passes.
  if (!ensureMechCombatState(inst)) {
    body.className = 'no-selection';
    body.textContent = 'This unit is not supported by the current catalogue.';
    return;
  }
  const unit = displayUnitFor(inst.unitId);
  const clanWeaponSuffix = /^clan$/i.test(unit.techBase || '') ? ' (C)' : '';
  const axial = offsetToAxial(inst.col, inst.row);
  const pilot = inst.pilot || { hits: 0, consciousness: 'conscious' };
  const pilotState = String(pilot.consciousness || 'conscious').toUpperCase();
  const pilotColour = pilotState === 'CONSCIOUS' ? '#2a7a2a' : pilotState === 'DEAD' ? '#a32832' : '#b56b00';
  body.className = '';
  body.innerHTML = `
    <div style="font-family:var(--display);font-size:15px;letter-spacing:.04em;color:${unit.color};margin-bottom:2px;">
      ${unit.chassis} ${unit.variant}
    </div>
    <button onclick="showRecordSheet('${inst.instanceId}')" style="margin:2px 0 10px;padding:6px 8px;border:1px solid var(--panel-line);background:transparent;color:var(--phosphor);font:9px var(--display);letter-spacing:.06em;text-transform:uppercase;cursor:pointer;">Open Full Record Sheet</button>
    <div style="font-size:10px;color:var(--phosphor-dim);margin-bottom:12px;">
      ${unit.tonnage} TONS · PLAYER ${inst.owner}
    </div>
    <div class="stat-grid mech-summary-grid">
      <div class="k">Walk / Run / Jump</div><div class="v">${unit.movement.walk} / ${unit.movement.run} / ${unit.movement.jump}</div>
      <div class="k">Heat Sinks</div><div class="v">${unit.heat_sinks} (${unit.heat_sink_type})</div>
      <div class="k">Heat Level</div><div class="v">${inst.heat || 0}</div>
      <div class="k">Pilot</div><div class="v" style="color:${pilotColour};">${escapeHtml(pilot.name || 'MechWarrior')} · Gunnery ${pilot.gunnery ?? 4} · Piloting ${pilot.piloting ?? inst.pilotingSkill ?? 5} · ${pilotState} · ${pilot.hits || 0} hit${pilot.hits === 1 ? '' : 's'}</div>
      <div class="k">Damage State</div><div class="v">${inst.destroyed ? 'DESTROYED' : `${inst.prone ? 'PRONE · ' : ''}${inst.shutdown ? 'SHUT DOWN · ' : ''}${Object.values(inst.criticalSlotDamage || {}).reduce((total, slots) => total + slots.length, 0)} critical slot${Object.values(inst.criticalSlotDamage || {}).reduce((total, slots) => total + slots.length, 0) === 1 ? '' : 's'} damaged`}</div>
      ${inst.improvisedClub ? `<div class="k">Carried</div><div class="v">${inst.improvisedClub.type === 'tree' ? 'Tree Club' : 'Girder Club'} · uses both arms</div>` : ''}
      ${inst.hasMoved ? `<div class="k">This Turn</div><div class="v">${titleCaseMode(inst.movementMode)} · ${inst.hexesMoved} hex${inst.hexesMoved===1?'':'es'}</div>` : ''}
    </div>
    <div class="panel-eyebrow" style="margin-top:14px;">Weapons</div>
    <div class="stat-grid">
      ${unit.weapons.map(w => `<div class="k">${w.weapon?.name || w.key.replaceAll('_',' ')}${clanWeaponSuffix}</div><div class="v">×${w.count} — ${w.location.toUpperCase()}</div>`).join('')}
    </div>
    ${(inst.ammoBins || []).length ? `<div class="panel-eyebrow" style="margin-top:14px;">Ammunition</div><div class="stat-grid">${inst.ammoBins.map(bin => `<div class="k">${bin.type.replace('_',' ')}${bin.loadType ? ` · ${bin.loadType}` : ''} · ${bin.location}</div><div class="v">${bin.shots} / ${bin.maxShots} shots</div>${roundOneAmmoControl(inst, bin)}`).join('')}</div>` : ''}
    ${signatureSystemControls(inst)}
    <div class="panel-eyebrow" style="margin-top:14px;">Armour / Internal Structure</div>
    <div style="font-size:9px;color:var(--phosphor-dim);margin:-8px 0 6px;">A = current / maximum armour · I = current / maximum internal structure</div>
    <div class="armor-diagram">
      ${armorCell('la','LA', inst.armor.la, unit.armor.la, inst.structure.la, unit.structure.la)}${armorCell('h','HD', inst.armor.head, unit.armor.head, inst.structure.head, unit.structure.head)}${armorCell('ra','RA', inst.armor.ra, unit.armor.ra, inst.structure.ra, unit.structure.ra)}
      ${armorCell('lt','LT', inst.armor.lt, unit.armor.lt, inst.structure.lt, unit.structure.lt)}${armorCell('ct','CT', inst.armor.ct, unit.armor.ct, inst.structure.ct, unit.structure.ct)}${armorCell('rt','RT', inst.armor.rt, unit.armor.rt, inst.structure.rt, unit.structure.rt)}
      ${armorCell('ll','LL', inst.armor.ll, unit.armor.ll, inst.structure.ll, unit.structure.ll)}${armorCell('','', null, null, null, null)}${armorCell('rl','RL', inst.armor.rl, unit.armor.rl, inst.structure.rl, unit.structure.rl)}
    </div>
    <details class="mech-technical-details">
      <summary>Position &amp; facing</summary>
      <div class="stat-grid">
        <div class="k">Hex coordinates</div><div class="v">${hexCode(inst.col, inst.row)} (q${axial.q} r${axial.r})</div>
        <div class="k">Leg facing</div><div class="v">${HEX_DIR_LABELS[inst.facing || 0]}</div>
        <div class="k">Torso facing</div><div class="v">${HEX_DIR_LABELS[inst.torsoFacing == null ? inst.facing : inst.torsoFacing]}</div>
      </div>
    </details>
  `;
}
