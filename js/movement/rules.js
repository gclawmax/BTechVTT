// ── MOVEMENT (Quick-Start Rules: Movement Phase) ─────────
// 6 hex directions for a pointy-top / odd-r offset grid (matches offsetToAxial/hexToPixel above).
// index: 0=E 1=NE 2=NW 3=W 4=SW 5=SE. `angle` is used purely for drawing the facing arrow.
const HEX_DIRS = [
  { dq: 1, dr: 0,  angle: 0 },    // 0: E
  { dq: 1, dr: -1, angle: -60 },  // 1: NE
  { dq: 0, dr: -1, angle: -120 }, // 2: NW
  { dq: -1, dr: 0, angle: 180 },  // 3: W
  { dq: -1, dr: 1, angle: 120 },  // 4: SW
  { dq: 0, dr: 1,  angle: 60 }    // 5: SE
];
// MegaMek top-down sprites are authored pointing toward the top of the image.
// Canvas direction 0 points east, so source art needs one +90° baseline turn;
// HEX_DIRS then supplies the game's exact clockwise/counter-clockwise 60° steps.
const MEGAMEK_SPRITE_FORWARD_OFFSET_DEGREES = 90;

function hexNeighbor(col, row, dir) {
  const { q, r } = offsetToAxial(col, row);
  const d = HEX_DIRS[((dir % 6) + 6) % 6];
  return axialToOffset(q + d.dq, r + d.dr);
}

// Which direction (0-5) leads from one hex to an ADJACENT hex, or -1 if not adjacent.
function directionBetween(fromCol, fromRow, toCol, toRow) {
  for (let d = 0; d < 6; d++) {
    const n = hexNeighbor(fromCol, fromRow, d);
    if (n.col === toCol && n.row === toRow) return d;
  }
  return -1;
}

// Shortest number of hexsides between two facings (used for facing-change MP cost).
function facingTurnCost(fromDir, toDir) {
  const diff = Math.abs(fromDir - toDir) % 6;
  return Math.min(diff, 6 - diff);
}

function axialDistance(aCol, aRow, bCol, bRow) {
  const a = offsetToAxial(aCol, aRow);
  const b = offsetToAxial(bCol, bRow);
  const as = -a.q - a.r, bs = -b.q - b.r;
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(as - bs));
}

function isHexOccupied(col, row, excludeInstanceId) {
  return mechInstances.some(m => m.instanceId !== excludeInstanceId && !isEnemyHiddenUnit(m) && m.col === col && m.row === row);
}

function resetMapPan() {
  mapPanX = 0;
  mapPanY = 0;
  mapZoom = 1;
  mapRotation = 0;
  renderMapZoomReadout();
  draw();
}

function rotateMapView() {
  mapRotation = (mapRotation + 90) % 360;
  renderMapZoomReadout();
  draw();
}

function renderMapZoomReadout() {
  const readout = document.getElementById('map-zoom-readout');
  if (readout) readout.textContent = `${Math.round(mapZoom * 100)}% · ${mapRotation}°`;
}

// Tracks an in-progress movement action for a single 'Mech, selected via the Movement Panel.
let moveState = {
  active: false,
  instanceId: null,
  mode: null,       // 'walk' | 'run' | 'jump'
  mpMax: 0,
  mpUsed: 0,
  hexesMoved: 0,
  path: []
};

const SQRT3 = 1.73205080757;

function hexToPixel(col, row) {
  const x = HEX_SIZE * SQRT3 * (col + 0.5 * (row & 1));
  const y = HEX_SIZE * 1.5 * row;
  return { x, y };
}

function pixelToHex(px, py) {
  const q = (Math.sqrt(3)/3 * px - py/3) / HEX_SIZE;
  const r = 2/3 * py / HEX_SIZE;
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  const col = rq + (rr - (rr & 1)) / 2;
  const row = rr;
  return { col: Math.round(col), row: Math.round(row) };
}

function buildDefaultVsAIMechInstances() {
  // Until AI force selection arrives, keep the demonstration force in one
  // canonical builder so the lobby persists exactly what the board displays.
  const catalogueId = id => typeof resolveCatalogueId === 'function' ? resolveCatalogueId(id) : id;
  const units = [
    { instanceId: 'atlas-1', unitId: catalogueId('atlas-as7-d'), col: 4, row: 5, owner: 1, facing: 0, torsoFacing: 0 },
    { instanceId: 'hunchback-ai', unitId: catalogueId('hunchback-hbk-4g'), col: 9, row: 7, owner: 2, facing: 3, torsoFacing: 3 },
    { instanceId: 'locust-ai', unitId: catalogueId('locust-lct-1v'), col: 10, row: 4, owner: 2, facing: 2, torsoFacing: 2 }
  ];
  units.forEach(mech => {
    mech.movementMode = null;
    mech.mpUsed = 0;
    mech.hexesMoved = 0;
    mech.hasMoved = false;
    mech.hasReacted = false;
    if (typeof activeCatalogueVersion !== 'undefined' && activeCatalogueVersion) mech.catalogueVersion = activeCatalogueVersion;
    ensureMechCombatState(mech);
  });
  return units;
}

function initGame() {
  canvas = document.getElementById('hexmap');
  ctx = canvas.getContext('2d');

  // Place mech instances — different setup for AI mode vs multiplayer
  // NOTE: `facing` is a hex-direction index 0-5 (0=E,1=NE,2=NW,3=W,4=SW,5=SE), see HEX_DIRS.
  if (vsAiMode) {
    mechInstances = buildDefaultVsAIMechInstances();
  } else {
    // Multiplayer demo: 3 units for 2 players
    mechInstances = [
      { instanceId: 'atlas-1', unitId: 'atlas-as7-d', col: 4, row: 5, owner: 1, facing: 0, torsoFacing: 0 },
      { instanceId: 'hunchback-1', unitId: 'hunchback-hbk-4g', col: 9, row: 7, owner: 2, facing: 3, torsoFacing: 3 },
      { instanceId: 'locust-1', unitId: 'locust-lct-1v', col: 10, row: 4, owner: 2, facing: 2, torsoFacing: 2 }
    ];
  }
  // Movement bookkeeping fields, reset each round when the Movement Phase begins.
  mechInstances.forEach(m => {
    m.movementMode = null;   // 'stand' | 'walk' | 'run' | 'jump'
    m.mpUsed = 0;
    m.hexesMoved = 0;        // hexes traversed this turn — feeds the Target Movement Modifier
    m.hasMoved = false;
    m.hasReacted = false;
    if (m.torsoFacing == null) m.torsoFacing = m.facing;
    ensureMechCombatState(m);
  });

  try {
    window.addEventListener('resize', resizeCanvas);
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => resizeCanvas()).observe(document.getElementById('map-wrap'));
    }
    resizeCanvas();
    renderRoster();
    renderDetail();
    document.getElementById('status-readout').textContent = `${mechInstances.filter(mech => !isEnemyHiddenUnit(mech)).length} UNITS ON FIELD`;

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => { resizeCanvas(); });
    }
  } catch (err) {
    console.error('BT-VTT init error:', err);
    const el = document.getElementById('status-readout');
    if (el) { el.textContent = `INIT ERROR: ${err.message}`; el.style.color = '#a3321c'; }
  }
}

function resizeCanvas() {
  const wrap = document.getElementById('map-wrap');
  if (!wrap || !canvas) return;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const gridPixelW = GRID_COLS * HEX_SIZE * SQRT3 + HEX_SIZE * SQRT3 * 0.5;
  const gridPixelH = (GRID_ROWS - 1) * HEX_SIZE * 1.5 + HEX_SIZE;
  gridOffsetX = (w - gridPixelW) / 2;
  gridOffsetY = (h - gridPixelH) / 2;
  draw();
}

function draw() {
  if (!ctx || !canvas) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  // Rendering helpers use save/restore for clipping, sprites and terrain.
  // Re-establish the canvas baseline on every frame so a stale browser
  // transform can never compound across redraws into a distorted battlefield.
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(mapRotation * Math.PI / 180);
  ctx.scale(mapZoom, mapZoom);
  ctx.translate(-w / 2, -h / 2);

  // Draw a readable, original tabletop-style battlefield. Terrain remains
  // data-driven; these are canvas decorations rather than copied map art.
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const { x, y } = hexToPixel(col, row);
      const px = x + gridOffsetX + mapPanX;
      const py = y + gridOffsetY + mapPanY;
      const terrain = terrainAt(col, row);
      const elevation = elevationAt(col, row);
      drawMapHex(px, py, col, row, terrain, elevation);
      if (typeof currentMatchConfig !== 'undefined' && currentMatchConfig.victory_mode === 'breakthrough') {
        const zoneOne = scenarioDeploymentZoneContains(1,col,row,currentMatchConfig);
        const zoneTwo = scenarioDeploymentZoneContains(2,col,row,currentMatchConfig);
        if (zoneOne || zoneTwo) {
          ctx.save();
          drawHex(px,py,HEX_SIZE-3,zoneOne?'rgba(76,158,217,.10)':'rgba(216,103,103,.10)',zoneOne?'rgba(76,158,217,.42)':'rgba(216,103,103,.42)');
          if (row === Math.floor(GRID_ROWS/2) && (zoneOne ? col === Math.min(4,GRID_COLS-1) : col === Math.max(0,GRID_COLS-5))) {
            ctx.fillStyle=zoneOne?'#27638e':'#9b3838';ctx.font='bold 7px "IBM Plex Mono", monospace';ctx.textAlign='center';ctx.fillText(zoneOne?'P2 GOAL':'P1 GOAL',px,py-15);
          }
          ctx.restore();
        }
      }
      if (typeof currentMatchConfig !== 'undefined' && currentMatchConfig.victory_mode === 'control' && (currentMatchConfig.objective_hexes || []).includes(hexCode(col, row))) {
        ctx.save(); ctx.strokeStyle = '#d4800a'; ctx.lineWidth = 2.5; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.arc(px, py, 18, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(212,128,10,.92)'; ctx.font = 'bold 8px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'; ctx.fillText('OBJ', px, py - 15); ctx.restore();
      }
      // Hex code label
      ctx.save();
      ctx.shadowColor = 'rgba(255,255,255,.65)';
      ctx.shadowBlur = 2;
      ctx.fillStyle = '#4d4c42';
      ctx.font = '700 7px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(hexCode(col, row), px, py + 17);
      if (elevation) {
        ctx.fillStyle = '#6d5135';
        ctx.font = '700 7px "IBM Plex Mono", monospace';
        ctx.fillText(`LEVEL ${elevation}`, px, py - 17);
      }
      ctx.restore();
    }
  }

  // Highlight legal movement destinations for the 'Mech currently being moved
  drawMovementHighlights();

  // Minefields remain invisible to the opposing player until an Active Probe
  // detects them or a unit triggers them. Owners always see their own fields.
  if (typeof visibleMinefields === 'function') for (const field of visibleMinefields()) {
    const { x, y } = hexToPixel(Number(field.col), Number(field.row));
    const px = x + gridOffsetX + mapPanX, py = y + gridOffsetY + mapPanY;
    ctx.save();
    ctx.strokeStyle = Number(field.owner) === Number(mySeatNumber) ? '#d4800a' : '#a32832';
    ctx.fillStyle = 'rgba(48,38,24,.72)';ctx.lineWidth = 2;
    ctx.beginPath();ctx.arc(px, py, HEX_SIZE * .24, 0, Math.PI * 2);ctx.fill();ctx.stroke();
    ctx.fillStyle = '#f0d7a0';ctx.font = '700 8px "IBM Plex Mono", monospace';ctx.textAlign = 'center';ctx.textBaseline = 'middle';ctx.fillText('M', px, py);
    ctx.restore();
  }

  // The planned path remains local until movement is confirmed.
  if (moveState.active && moveState.path?.length) {
    const points = [{col:moveState.origCol,row:moveState.origRow}, ...moveState.path.filter(step => step.action === 'step' || step.action === 'jump')];
    ctx.save(); ctx.strokeStyle = '#126a89'; ctx.lineWidth = 3; ctx.setLineDash([5,3]); ctx.beginPath();
    points.forEach((point,index) => { const pixel=hexToPixel(point.col,point.row); const x=pixel.x+gridOffsetX+mapPanX, y=pixel.y+gridOffsetY+mapPanY; if(index) ctx.lineTo(x,y); else ctx.moveTo(x,y); });
    ctx.stroke(); ctx.restore();
  }

  // Draw mechs
  for (const inst of mechInstances) {
    if (isEnemyHiddenUnit(inst)) continue;
    const { x, y } = hexToPixel(inst.col, inst.row);
    const px = x + gridOffsetX + mapPanX;
    const py = y + gridOffsetY + mapPanY;
    const unit = typeof displayUnitFor === 'function' ? displayUnitFor(inst.unitId) : BT_UNITS[inst.unitId];
    const angle = HEX_DIRS[inst.facing || 0].angle;
    const torsoAngle = HEX_DIRS[inst.torsoFacing == null ? inst.facing : inst.torsoFacing].angle;
    drawMechToken(px, py, HEX_SIZE * 0.64, unit.color, angle, torsoAngle, inst.instanceId === selectedInstanceId, inst.prone, inst.unitId);
    ctx.save();
    const label = String(unit.variant || inst.unitId);
    ctx.font = 'bold 8px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const labelWidth = Math.min(HEX_SIZE * 1.7, ctx.measureText(label).width + 6);
    ctx.fillStyle = '#f5f2e9'; ctx.fillRect(px-labelWidth/2, py+HEX_SIZE*.58-5, labelWidth, 10);
    ctx.fillStyle = '#172a25'; ctx.fillText(label, px, py+HEX_SIZE*.58, labelWidth-4);
    ctx.restore();
  }
  ctx.restore();
  renderMapZoomReadout();
}

const MAP_VISUAL_PALETTES = Object.freeze({
  grassland: { light: '#afbc76', dark: '#879b57', speck: 'rgba(57,77,36,.16)' },
  woodland: { light: '#91a76d', dark: '#647c4f', speck: 'rgba(37,62,35,.20)' },
  steppe: { light: '#c5ae75', dark: '#9d8654', speck: 'rgba(92,66,36,.15)' },
  highland: { light: '#aa9d70', dark: '#7f7451', speck: 'rgba(67,59,40,.20)' },
  flatland: { light: '#c7b56c', dark: '#8e8145', speck: 'rgba(72,61,25,.16)' },
  desert: { light: '#c58f61', dark: '#925f3e', speck: 'rgba(82,47,27,.15)' },
  industrial: { light: '#aaa99f', dark: '#777872', speck: 'rgba(45,48,49,.20)' },
  tundra: { light: '#b7b9ad', dark: '#858a80', speck: 'rgba(53,61,62,.16)' }
});

function stableMapNoise(col, row, salt = 0) {
  const value = Math.sin((col + 1) * 12.9898 + (row + 1) * 78.233 + salt * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

function traceHex(cx, cy, size, renderContext = ctx) {
  renderContext.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i + 30);
    const x = cx + size * Math.cos(angle);
    const y = cy + size * Math.sin(angle);
    i === 0 ? renderContext.moveTo(x, y) : renderContext.lineTo(x, y);
  }
  renderContext.closePath();
}

function drawMapHex(cx, cy, col, row, terrain, elevation, renderContext = ctx) {
  const map = getMapDefinition(activeMapId);
  const palette = MAP_VISUAL_PALETTES[map.visual] || MAP_VISUAL_PALETTES.grassland;
  const shimmer = stableMapNoise(col, row, 1);
  const gradient = renderContext.createLinearGradient(cx - HEX_SIZE, cy - HEX_SIZE, cx + HEX_SIZE, cy + HEX_SIZE);
  gradient.addColorStop(0, palette.light);
  gradient.addColorStop(1, palette.dark);
  drawHex(cx, cy, HEX_SIZE - .5, gradient, 'rgba(31,37,25,.60)', renderContext);

  // Fine, deterministic ground texture keeps the board organic without
  // flickering when it redraws during movement or panning.
  renderContext.save();
  traceHex(cx, cy, HEX_SIZE - 2, renderContext);
  renderContext.clip();
  renderContext.fillStyle = palette.speck;
  for (let i = 0; i < 7; i++) {
    const px = cx + (stableMapNoise(col, row, i + 2) - .5) * HEX_SIZE * 1.5;
    const py = cy + (stableMapNoise(col, row, i + 14) - .5) * HEX_SIZE * 1.35;
    renderContext.fillRect(px, py, 1 + shimmer * 1.5, 1 + shimmer * 1.5);
  }
  renderContext.restore();

  if (elevation) {
    drawHex(cx, cy, HEX_SIZE - 5, 'rgba(255,255,255,0)', 'rgba(97,71,38,.72)', renderContext);
    drawHex(cx, cy, HEX_SIZE - 8, 'rgba(255,255,255,0)', 'rgba(255,245,206,.38)', renderContext);
  }
  if (terrain !== 'clear') drawTerrainFeature(cx, cy, col, row, terrain, renderContext);
}

function drawTerrainFeature(cx, cy, col, row, terrain, renderContext = ctx) {
  renderContext.save();
  if (terrain === 'light_woods' || terrain === 'heavy_woods') {
    const count = terrain === 'heavy_woods' ? 5 : 3;
    for (let i = 0; i < count; i++) {
      const px = cx + (stableMapNoise(col, row, i + 30) - .5) * 26;
      const py = cy + (stableMapNoise(col, row, i + 40) - .5) * 20;
      const radius = terrain === 'heavy_woods' ? 6 : 5;
      renderContext.beginPath(); renderContext.arc(px, py, radius, 0, Math.PI * 2);
      renderContext.fillStyle = terrain === 'heavy_woods' ? '#315d36' : '#4d7d42'; renderContext.fill();
      renderContext.beginPath(); renderContext.arc(px - 1.5, py - 2, radius * .56, 0, Math.PI * 2);
      renderContext.fillStyle = terrain === 'heavy_woods' ? '#56884a' : '#74a75d'; renderContext.fill();
      renderContext.fillStyle = '#493b25'; renderContext.fillRect(px - .8, py + radius * .35, 1.6, radius * .75);
    }
  } else if (terrain === 'shallow_water' || terrain === 'deep_water') {
    renderContext.fillStyle = terrain === 'deep_water' ? 'rgba(32,91,132,.45)' : 'rgba(72,139,166,.28)';
    traceHex(cx, cy, HEX_SIZE - 3, renderContext); renderContext.fill();
    renderContext.strokeStyle = 'rgba(211,241,244,.82)'; renderContext.lineWidth = 1.15;
    for (let i = -1; i <= 1; i++) {
      const y = cy + i * 7;
      renderContext.beginPath(); renderContext.arc(cx - 9, y, 6, 0.15 * Math.PI, .85 * Math.PI); renderContext.arc(cx + 3, y, 6, 1.15 * Math.PI, 1.85 * Math.PI); renderContext.stroke();
    }
  } else if (terrain === 'rough' || terrain === 'rubble' || terrain === 'impassable') {
    const count = terrain === 'impassable' ? 5 : terrain === 'rubble' ? 6 : 3;
    renderContext.fillStyle = terrain === 'impassable' ? '#55463b' : terrain === 'rubble' ? '#675f56' : '#78634b';
    for (let i = 0; i < count; i++) {
      const px = cx + (stableMapNoise(col, row, i + 55) - .5) * 26;
      const py = cy + (stableMapNoise(col, row, i + 65) - .5) * 20;
      renderContext.beginPath(); renderContext.moveTo(px - 5, py + 4); renderContext.lineTo(px - 1, py - 5); renderContext.lineTo(px + 5, py - 2); renderContext.lineTo(px + 4, py + 5); renderContext.closePath(); renderContext.fill();
    }
  } else if (terrain === 'pavement') {
    renderContext.strokeStyle = 'rgba(71,74,72,.58)'; renderContext.lineWidth = 5;
    renderContext.beginPath(); renderContext.moveTo(cx - 30, cy + 8); renderContext.lineTo(cx + 30, cy - 8); renderContext.stroke();
    renderContext.strokeStyle = 'rgba(212,204,176,.58)'; renderContext.lineWidth = 1;
    renderContext.beginPath(); renderContext.moveTo(cx - 30, cy + 8); renderContext.lineTo(cx + 30, cy - 8); renderContext.stroke();
  } else if (terrain === 'building') {
    renderContext.fillStyle = '#5b6062'; renderContext.fillRect(cx - 14, cy - 12, 28, 23);
    renderContext.strokeStyle = '#292d2f'; renderContext.lineWidth = 2; renderContext.strokeRect(cx - 14, cy - 12, 28, 23);
    renderContext.fillStyle = '#d8b66b';
    for (const x of [-8, 0, 8]) for (const y of [-6, 2]) renderContext.fillRect(cx + x - 2, cy + y - 2, 4, 4);
    const cf = terrainStatusAt(col, row).buildingCF;
    if (cf != null) {
      renderContext.fillStyle = 'rgba(19,22,23,.86)'; renderContext.fillRect(cx - 11, cy + 12, 22, 9);
      renderContext.fillStyle = '#f0d58e'; renderContext.font = 'bold 7px var(--mono)'; renderContext.textAlign = 'center';
      renderContext.fillText(`CF ${cf}`, cx, cy + 19);
    }
  } else if (terrain === 'fire') {
    renderContext.fillStyle = 'rgba(190,47,20,.30)'; traceHex(cx, cy, HEX_SIZE - 3, renderContext); renderContext.fill();
    renderContext.fillStyle = '#ef7d22';
    for (const x of [-9, 0, 9]) { renderContext.beginPath(); renderContext.moveTo(cx + x - 5, cy + 8); renderContext.quadraticCurveTo(cx + x, cy - 13, cx + x + 5, cy + 8); renderContext.fill(); }
  } else if (terrain === 'light_smoke' || terrain === 'heavy_smoke') {
    renderContext.fillStyle = terrain === 'heavy_smoke' ? 'rgba(57,61,63,.62)' : 'rgba(102,108,110,.42)';
    for (const offset of [-9, 0, 9]) { renderContext.beginPath(); renderContext.arc(cx + offset, cy, 9, 0, Math.PI * 2); renderContext.fill(); }
  } else if (['ice','deep_snow','mud','sand','swamp','magma_crust','magma_liquid','bridge'].includes(terrain)) {
    const fills = { ice:'rgba(183,226,235,.72)', deep_snow:'rgba(239,244,240,.78)', mud:'rgba(91,67,43,.70)', sand:'rgba(211,174,102,.72)', swamp:'rgba(64,91,57,.72)', magma_crust:'rgba(70,57,52,.88)', magma_liquid:'rgba(222,70,20,.88)', bridge:'rgba(104,91,72,.88)' };
    renderContext.fillStyle=fills[terrain];traceHex(cx,cy,HEX_SIZE-3, renderContext);renderContext.fill();
    renderContext.strokeStyle=terrain==='magma_liquid'?'#ffbd42':terrain==='ice'?'#e9ffff':'rgba(42,40,34,.55)';renderContext.lineWidth=1.4;
    renderContext.beginPath();renderContext.moveTo(cx-18,cy+7);renderContext.lineTo(cx-7,cy-5);renderContext.lineTo(cx+3,cy+4);renderContext.lineTo(cx+17,cy-8);renderContext.stroke();
    if(terrain==='bridge'){renderContext.strokeStyle='#3d3429';renderContext.lineWidth=5;renderContext.beginPath();renderContext.moveTo(cx-29,cy);renderContext.lineTo(cx+29,cy);renderContext.stroke();}
  }
  renderContext.restore();
}

function drawMovementHighlights() {
  if (!moveState.active) return;
  const mech = mechInstances.find(m => m.instanceId === moveState.instanceId);
  if (!mech) return;
  const mpLeft = moveState.mpMax - moveState.mpUsed;
  if (mpLeft <= 0) return;

  const highlightHex = (col, row, fill) => {
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return;
    const { x, y } = hexToPixel(col, row);
    drawHex(x + gridOffsetX + mapPanX, y + gridOffsetY + mapPanY, HEX_SIZE - 1.5, fill, 'transparent');
  };

  if (moveState.mode === 'jump') {
    // A jump is one direct landing. Keep all candidates measured from the
    // starting hex even after the player previews a different landing spot.
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        if (col === moveState.origCol && row === moveState.origRow) continue;
        if (!terrainMovementBlocked(col, row) && axialDistance(moveState.origCol, moveState.origRow, col, row) <= moveState.mpMax && !isHexOccupied(col, row, mech.instanceId)) {
          highlightHex(col, row, 'rgba(90,140,220,0.35)');
        }
      }
    }
  } else {
    // Walk/Run: only the 6 adjacent hexes are directly clickable (forward, rear, or a facing-change + step).
    for (let d = 0; d < 6; d++) {
      const n = hexNeighbor(mech.col, mech.row, d);
      if (n.col < 0 || n.col >= GRID_COLS || n.row < 0 || n.row >= GRID_ROWS) continue;
      if (isHexOccupied(n.col, n.row, mech.instanceId)) continue;
      if (terrainMovementBlocked(n.col, n.row) || movementElevationCost(mech.col, mech.row, n.col, n.row) > 2) continue;
      const isRear = d === ((mech.facing + 3) % 6);
      if (isRear && moveState.mode !== 'walk') continue; // running 'Mechs can't move backward
      const levelCost = movementElevationCost(mech.col, mech.row, n.col, n.row);
      if (isRear && levelCost) continue;
      if (moveState.mode === 'run' && ['shallow_water', 'deep_water'].includes(terrainAt(n.col, n.row))) continue;
      const cost = (d === mech.facing ? 1 : (isRear ? 1 : facingTurnCost(mech.facing, d) + 1)) + movementTerrainCost(n.col, n.row) + levelCost;
      if (cost <= mpLeft) highlightHex(n.col, n.row, 'rgba(90,190,110,0.35)');
    }
  }
}

function drawHex(cx, cy, size, fill, stroke, renderContext = ctx) {
  traceHex(cx, cy, size, renderContext);
  renderContext.fillStyle = fill;
  renderContext.fill();
  renderContext.strokeStyle = stroke;
  renderContext.lineWidth = 0.5;
  renderContext.stroke();
}

function drawMechToken(x, y, r, color, facing, torsoFacing, selected, prone = false, unitId = null) {
  // Hex token
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i - 30);
    const px = x + r * Math.cos(angle);
    const py = y + r * Math.sin(angle);
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  const artwork = typeof mechArtworkImage === 'function' ? mechArtworkImage(unitId) : null;
  if (artwork?.dataset.ready === 'true') {
    ctx.save();
    ctx.clip();
    ctx.translate(x, y);
    ctx.rotate((facing + MEGAMEK_SPRITE_FORWARD_OFFSET_DEGREES) * Math.PI / 180);
    ctx.drawImage(artwork, -r, -r, r * 2, r * 2);
    ctx.restore();
  }
  ctx.strokeStyle = selected ? '#fff' : '#1a1a1a';
  ctx.lineWidth = selected ? 2.5 : 1.5;
  ctx.stroke();

  // Facing indicator
  const rad = facing * Math.PI / 180;
  const fx = x + r * 0.6 * Math.cos(rad);
  const fy = y + r * 0.6 * Math.sin(rad);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(fx, fy);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();

  // A gold triangle records a torso twist without changing the white leg-facing
  // indicator. It appears only when the torso and legs point to different hexsides.
  if (torsoFacing !== facing) {
    const torsoRad = torsoFacing * Math.PI / 180;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(torsoRad);
    ctx.beginPath();
    ctx.moveTo(r * 0.78, 0);
    ctx.lineTo(r * 0.28, -r * 0.22);
    ctx.lineTo(r * 0.28, r * 0.22);
    ctx.closePath();
    ctx.fillStyle = '#f6cf63';
    ctx.fill();
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  // A fallen 'Mech remains on the same hex but is unmistakable at a glance.
  if (prone) {
    ctx.beginPath();
    ctx.moveTo(x - r * .45, y - r * .45);
    ctx.lineTo(x + r * .45, y + r * .45);
    ctx.moveTo(x + r * .45, y - r * .45);
    ctx.lineTo(x - r * .45, y + r * .45);
    ctx.strokeStyle = '#ffddd8';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
}

canvas = document.getElementById('hexmap');

// Pan the view without affecting unit selection or shared state. Right-click
// drag is the primary control; middle-click drag helps mouse users too.
let mapPanDrag = null;
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 2 && event.button !== 1) return;
  mapPanDrag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, panX: mapPanX, panY: mapPanY };
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add('panning');
  event.preventDefault();
});

canvas.addEventListener('pointermove', event => {
  if (!mapPanDrag || event.pointerId !== mapPanDrag.pointerId) return;
  const dx = (event.clientX - mapPanDrag.startX) / mapZoom;
  const dy = (event.clientY - mapPanDrag.startY) / mapZoom;
  const radians = -mapRotation * Math.PI / 180;
  mapPanX = mapPanDrag.panX + dx * Math.cos(radians) - dy * Math.sin(radians);
  mapPanY = mapPanDrag.panY + dx * Math.sin(radians) + dy * Math.cos(radians);
  draw();
});

const finishMapPan = event => {
  if (!mapPanDrag || event.pointerId !== mapPanDrag.pointerId) return;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  mapPanDrag = null;
  canvas.classList.remove('panning');
};
canvas.addEventListener('pointerup', finishMapPan);
canvas.addEventListener('pointercancel', finishMapPan);
canvas.addEventListener('contextmenu', event => event.preventDefault());

// Zoom stays centred under the pointer, so players can inspect a particular
// hex without losing their place. It is visual-only and never touches match state.
canvas.addEventListener('wheel', event => {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const pointerX = event.clientX - rect.left;
  const pointerY = event.clientY - rect.top;
  const oldZoom = mapZoom;
  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
  mapZoom = Math.max(.65, Math.min(2.5, mapZoom * factor));
  if (mapZoom === oldZoom) return;
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  const zoomDelta = 1 / mapZoom - 1 / oldZoom;
  const dx = (pointerX - centerX) * zoomDelta;
  const dy = (pointerY - centerY) * zoomDelta;
  const radians = -mapRotation * Math.PI / 180;
  mapPanX += dx * Math.cos(radians) - dy * Math.sin(radians);
  mapPanY += dx * Math.sin(radians) + dy * Math.cos(radians);
  draw();
}, { passive: false });

function canvasPointToMap(event) {
  const rect = canvas.getBoundingClientRect();
  const screenX = event.clientX - rect.left;
  const screenY = event.clientY - rect.top;
  let x = screenX - rect.width / 2;
  let y = screenY - rect.height / 2;
  const radians = -mapRotation * Math.PI / 180;
  const rotatedX = x * Math.cos(radians) - y * Math.sin(radians);
  const rotatedY = x * Math.sin(radians) + y * Math.cos(radians);
  const boardX = rotatedX / mapZoom + rect.width / 2;
  const boardY = rotatedY / mapZoom + rect.height / 2;
  return { x: boardX - gridOffsetX - mapPanX, y: boardY - gridOffsetY - mapPanY };
}

// Mouse hover
canvas.addEventListener('mousemove', (e) => {
  const { x: px, y: py } = canvasPointToMap(e);
  const hex = pixelToHex(px, py);
  if (hex.col >= 0 && hex.col < GRID_COLS && hex.row >= 0 && hex.row < GRID_ROWS) {
    const axial = offsetToAxial(hex.col, hex.row);
    document.getElementById('coord-readout').textContent =
      `HEX ${String(hex.col).padStart(2,'0')}${String(hex.row).padStart(2,'0')}  (q${axial.q} r${axial.r})`;
  }
});

canvas.addEventListener('click', (e) => {
  const { x: px, y: py } = canvasPointToMap(e);
  let hit = null;
  for (const inst of mechInstances) {
    const { x, y } = hexToPixel(inst.col, inst.row);
    if (Math.hypot(px - x, py - y) < HEX_SIZE * 0.55) hit = inst;
  }

  // Mid-move: clicks on the map are movement clicks, not selection clicks.
  if (moveState.active) {
    if (hit && hit.instanceId !== moveState.instanceId) return; // ignore clicks on other 'Mechs
    const hex = pixelToHex(px, py);
    if (hex.col < 0 || hex.col >= GRID_COLS || hex.row < 0 || hex.row >= GRID_ROWS) return;
    attemptMoveStep(hex.col, hex.row);
    return;
  }

  selectInstance(hit ? hit.instanceId : null);
});

function selectInstance(instanceId) {
  const candidate = mechInstances.find(mech => mech.instanceId === instanceId);
  if (candidate && isEnemyHiddenUnit(candidate)) return;
  selectedInstanceId = instanceId;
  renderRoster();
  renderDetail();
  renderMovementPanel();
  renderReactionPanel();
  renderWeaponAttackPanel();
  renderPhysicalAttackPanel();
  renderHeatPanel();
  renderEndPanel();
  draw();
}
