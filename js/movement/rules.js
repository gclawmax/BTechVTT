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
  return mechInstances.some(m => m.instanceId !== excludeInstanceId && m.col === col && m.row === row);
}

function resetMapPan() {
  mapPanX = 0;
  mapPanY = 0;
  mapZoom = 1;
  renderMapZoomReadout();
  draw();
}

function renderMapZoomReadout() {
  const readout = document.getElementById('map-zoom-readout');
  if (readout) readout.textContent = `${Math.round(mapZoom * 100)}%`;
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

function initGame() {
  canvas = document.getElementById('hexmap');
  ctx = canvas.getContext('2d');

  // Place mech instances — different setup for AI mode vs multiplayer
  // NOTE: `facing` is a hex-direction index 0-5 (0=E,1=NE,2=NW,3=W,4=SW,5=SE), see HEX_DIRS.
  if (vsAiMode) {
    // AI mode: Player 1 gets Atlas, AI (owner 2) gets Hunchback + Locust
    mechInstances = [
      { instanceId: 'atlas-1', unitId: 'atlas-as7-d', col: 4, row: 5, owner: 1, facing: 0, torsoFacing: 0 },
      { instanceId: 'hunchback-ai', unitId: 'hunchback-hbk-4g', col: 9, row: 7, owner: 2, facing: 3, torsoFacing: 3 },
      { instanceId: 'locust-ai', unitId: 'locust-lct-1v', col: 10, row: 4, owner: 2, facing: 2, torsoFacing: 2 }
    ];
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
    document.getElementById('status-readout').textContent = `${mechInstances.length} UNITS ON FIELD`;

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
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
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

  // Draw mechs
  for (const inst of mechInstances) {
    const { x, y } = hexToPixel(inst.col, inst.row);
    const px = x + gridOffsetX + mapPanX;
    const py = y + gridOffsetY + mapPanY;
    const unit = BT_UNITS[inst.unitId];
    const angle = HEX_DIRS[inst.facing || 0].angle;
    const torsoAngle = HEX_DIRS[inst.torsoFacing == null ? inst.facing : inst.torsoFacing].angle;
    drawMechToken(px, py, HEX_SIZE * 0.45, unit.color, angle, torsoAngle, inst.instanceId === selectedInstanceId, inst.prone);
  }
  ctx.restore();
  renderMapZoomReadout();
}

const MAP_VISUAL_PALETTES = Object.freeze({
  grassland: { light: '#afbc76', dark: '#879b57', speck: 'rgba(57,77,36,.16)' },
  woodland: { light: '#91a76d', dark: '#647c4f', speck: 'rgba(37,62,35,.20)' },
  steppe: { light: '#c5ae75', dark: '#9d8654', speck: 'rgba(92,66,36,.15)' },
  highland: { light: '#aa9d70', dark: '#7f7451', speck: 'rgba(67,59,40,.20)' }
});

function stableMapNoise(col, row, salt = 0) {
  const value = Math.sin((col + 1) * 12.9898 + (row + 1) * 78.233 + salt * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

function traceHex(cx, cy, size) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i + 30);
    const x = cx + size * Math.cos(angle);
    const y = cy + size * Math.sin(angle);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawMapHex(cx, cy, col, row, terrain, elevation) {
  const map = getMapDefinition(activeMapId);
  const palette = MAP_VISUAL_PALETTES[map.visual] || MAP_VISUAL_PALETTES.grassland;
  const shimmer = stableMapNoise(col, row, 1);
  const gradient = ctx.createLinearGradient(cx - HEX_SIZE, cy - HEX_SIZE, cx + HEX_SIZE, cy + HEX_SIZE);
  gradient.addColorStop(0, palette.light);
  gradient.addColorStop(1, palette.dark);
  drawHex(cx, cy, HEX_SIZE - .5, gradient, 'rgba(31,37,25,.60)');

  // Fine, deterministic ground texture keeps the board organic without
  // flickering when it redraws during movement or panning.
  ctx.save();
  traceHex(cx, cy, HEX_SIZE - 2);
  ctx.clip();
  ctx.fillStyle = palette.speck;
  for (let i = 0; i < 7; i++) {
    const px = cx + (stableMapNoise(col, row, i + 2) - .5) * HEX_SIZE * 1.5;
    const py = cy + (stableMapNoise(col, row, i + 14) - .5) * HEX_SIZE * 1.35;
    ctx.fillRect(px, py, 1 + shimmer * 1.5, 1 + shimmer * 1.5);
  }
  ctx.restore();

  if (elevation) {
    drawHex(cx, cy, HEX_SIZE - 5, 'rgba(255,255,255,0)', 'rgba(97,71,38,.72)');
    drawHex(cx, cy, HEX_SIZE - 8, 'rgba(255,255,255,0)', 'rgba(255,245,206,.38)');
  }
  if (terrain !== 'clear') drawTerrainFeature(cx, cy, col, row, terrain);
}

function drawTerrainFeature(cx, cy, col, row, terrain) {
  ctx.save();
  if (terrain === 'light_woods' || terrain === 'heavy_woods') {
    const count = terrain === 'heavy_woods' ? 5 : 3;
    for (let i = 0; i < count; i++) {
      const px = cx + (stableMapNoise(col, row, i + 30) - .5) * 26;
      const py = cy + (stableMapNoise(col, row, i + 40) - .5) * 20;
      const radius = terrain === 'heavy_woods' ? 6 : 5;
      ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fillStyle = terrain === 'heavy_woods' ? '#315d36' : '#4d7d42'; ctx.fill();
      ctx.beginPath(); ctx.arc(px - 1.5, py - 2, radius * .56, 0, Math.PI * 2);
      ctx.fillStyle = terrain === 'heavy_woods' ? '#56884a' : '#74a75d'; ctx.fill();
      ctx.fillStyle = '#493b25'; ctx.fillRect(px - .8, py + radius * .35, 1.6, radius * .75);
    }
  } else if (terrain === 'shallow_water') {
    ctx.strokeStyle = 'rgba(211,241,244,.82)'; ctx.lineWidth = 1.15;
    for (let i = -1; i <= 1; i++) {
      const y = cy + i * 7;
      ctx.beginPath(); ctx.arc(cx - 9, y, 6, 0.15 * Math.PI, .85 * Math.PI); ctx.arc(cx + 3, y, 6, 1.15 * Math.PI, 1.85 * Math.PI); ctx.stroke();
    }
  } else if (terrain === 'rough' || terrain === 'impassable') {
    const count = terrain === 'impassable' ? 5 : 3;
    ctx.fillStyle = terrain === 'impassable' ? '#55463b' : '#78634b';
    for (let i = 0; i < count; i++) {
      const px = cx + (stableMapNoise(col, row, i + 55) - .5) * 26;
      const py = cy + (stableMapNoise(col, row, i + 65) - .5) * 20;
      ctx.beginPath(); ctx.moveTo(px - 5, py + 4); ctx.lineTo(px - 1, py - 5); ctx.lineTo(px + 5, py - 2); ctx.lineTo(px + 4, py + 5); ctx.closePath(); ctx.fill();
    }
  } else if (terrain === 'pavement') {
    ctx.strokeStyle = 'rgba(71,74,72,.58)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(cx - 30, cy + 8); ctx.lineTo(cx + 30, cy - 8); ctx.stroke();
    ctx.strokeStyle = 'rgba(212,204,176,.58)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - 30, cy + 8); ctx.lineTo(cx + 30, cy - 8); ctx.stroke();
  }
  ctx.restore();
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
      if (terrainMovementBlocked(n.col, n.row) || Math.abs(elevationAt(mech.col, mech.row) - elevationAt(n.col, n.row)) > 1) continue;
      const isRear = d === ((mech.facing + 3) % 6);
      if (isRear && moveState.mode !== 'walk') continue; // running 'Mechs can't move backward
      const cost = (d === mech.facing) ? 1 + movementTerrainCost(n.col, n.row) : (isRear ? 1 : facingTurnCost(mech.facing, d) + 1) + movementTerrainCost(n.col, n.row);
      if (cost <= mpLeft) highlightHex(n.col, n.row, 'rgba(90,190,110,0.35)');
    }
  }
}

function drawHex(cx, cy, size, fill, stroke) {
  traceHex(cx, cy, size);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 0.5;
  ctx.stroke();
}

function drawMechToken(x, y, r, color, facing, torsoFacing, selected, prone = false) {
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
  mapPanX = mapPanDrag.panX + (event.clientX - mapPanDrag.startX) / mapZoom;
  mapPanY = mapPanDrag.panY + (event.clientY - mapPanDrag.startY) / mapZoom;
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
  mapPanX += (pointerX - centerX) * (1 / mapZoom - 1 / oldZoom);
  mapPanY += (pointerY - centerY) * (1 / mapZoom - 1 / oldZoom);
  draw();
}, { passive: false });

function canvasPointToMap(event) {
  const rect = canvas.getBoundingClientRect();
  const screenX = event.clientX - rect.left;
  const screenY = event.clientY - rect.top;
  const boardX = (screenX - rect.width / 2) / mapZoom + rect.width / 2;
  const boardY = (screenY - rect.height / 2) / mapZoom + rect.height / 2;
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
