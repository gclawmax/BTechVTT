// Extracted from index_3_1.html — game_init

// ── GAME INIT (existing hex grid code) ───────────────────
// These are the original BTechVTT game functions, preserved from the Phase 1 prototype.

const HEX_SIZE = 32;
const GRID_COLS = 16;
const GRID_ROWS = 12;

const BT_UNITS = {
  atlas: {
    chassis: 'Atlas', variant: 'AS7-D', tonnage: 100, color: '#c4302b',
    movement: { walk: 3, run: 5, jump: 0 },
    heat_sinks: 20, heat_sink_type: 'double',
    weapons: [
      { key: 'ac20', count: 1, location: 'Right Arm' },
      { key: 'lr20', count: 1, location: 'Right Torso' },
      { key: 'sr6', count: 1, location: 'Left Torso' },
      { key: 'med_laser', count: 4, location: 'Center Torso' }
    ],
    armor: { head:9, ct:47, ct_rear:14, lt:32, lt_rear:10, rt:32, rt_rear:10, la:34, ra:34, ll:41, rl:41 },
    structure: { head:3, ct:31, lt:21, rt:21, la:17, ra:17, ll:21, rl:21 }
  },
  hunchback: {
    chassis: 'Hunchback', variant: 'HBK-4G', tonnage: 50, color: '#d4800a',
    movement: { walk: 3, run: 5, jump: 0 },
    heat_sinks: 10, heat_sink_type: 'single',
    weapons: [
      { key: 'erl', count: 1, location: 'Center Torso' },
      { key: 'lr6', count: 1, location: 'Right Torso' },
      { key: 'ac2', count: 1, location: 'Right Arm' }
    ],
    armor: { head:9, ct:19, ct_rear:5, lt:14, lt_rear:4, rt:14, rt_rear:4, la:9, ra:9, ll:14, rl:14 },
    structure: { head:3, ct:16, lt:11, rt:11, la:8, ra:8, ll:11, rl:11 }
  },
  locust: {
    chassis: 'Locust', variant: 'LCT-1V', tonnage: 20, color: '#2a8a2a',
    movement: { walk: 3, run: 5, jump: 6 },
    heat_sinks: 4, heat_sink_type: 'single',
    weapons: [
      { key: 'erl', count: 1, location: 'Center Torso' },
      { key: 'streak_sr4', count: 1, location: 'Left Torso' }
    ],
    armor: { head:8, ct:10, ct_rear:4, lt:6, lt_rear:3, rt:6, rt_rear:3, la:4, ra:4, ll:6, rl:6 },
    structure: { head:3, ct:6, lt:5, rt:5, la:3, ra:3, ll:4, rl:4 }
  }
};

const MECH_COLORS = ['#c4302b', '#d4800a', '#2a8a2a', '#3060c4'];

let mechInstances = [];
let selectedInstanceId = null;
let canvas, ctx;
let gridOffsetX, gridOffsetY;

// Short human-readable label for a mech instance, e.g. "Atlas AS7-D (P1)".
function mechLabel(mech) {
  if (!mech) return 'Unknown \'Mech';
  const unit = BT_UNITS[mech.unitId];
  const chassisLabel = unit ? `${unit.chassis} ${unit.variant}` : mech.unitId;
  const owner = mech.owner === mySeatNumber ? `P${mech.owner}` : (mech.instanceId && mech.instanceId.includes('ai') ? 'AI' : `P${mech.owner}`);
  return `${chassisLabel} (${owner})`;
}

function hexCode(col, row) {
  return `${String(col).padStart(2,'0')}${String(row).padStart(2,'0')}`;
}

function offsetToAxial(col, row) {
  const q = col - (row - (row & 1)) / 2;
  const r = row;
  return { q, r };
}

function axialToOffset(q, r) {
  const col = q + (r - (r & 1)) / 2;
  const row = r;
  return { col, row };
}

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

// Tracks an in-progress movement action for a single 'Mech, selected via the Movement Panel.
let moveState = {
  active: false,
  instanceId: null,
  mode: null,       // 'walk' | 'run' | 'jump'
  mpMax: 0,
  mpUsed: 0,
  hexesMoved: 0
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
      { instanceId: 'atlas-1', unitId: 'atlas', col: 4, row: 5, owner: 1, facing: 0 },
      { instanceId: 'hunchback-ai', unitId: 'hunchback', col: 9, row: 7, owner: 2, facing: 3 },
      { instanceId: 'locust-ai', unitId: 'locust', col: 10, row: 4, owner: 2, facing: 2 }
    ];
  } else {
    // Multiplayer demo: 3 units for 2 players
    mechInstances = [
      { instanceId: 'atlas-1', unitId: 'atlas', col: 4, row: 5, owner: 1, facing: 0 },
      { instanceId: 'hunchback-1', unitId: 'hunchback', col: 9, row: 7, owner: 2, facing: 3 },
      { instanceId: 'locust-1', unitId: 'locust', col: 10, row: 4, owner: 2, facing: 2 }
    ];
  }
  // Movement bookkeeping fields, reset each round when the Movement Phase begins.
  mechInstances.forEach(m => {
    m.movementMode = null;   // 'stand' | 'walk' | 'run' | 'jump'
    m.mpUsed = 0;
    m.hexesMoved = 0;        // hexes traversed this turn — feeds the Target Movement Modifier
    m.hasMoved = false;
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

  // Draw grid
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const { x, y } = hexToPixel(col, row);
      drawHex(x + gridOffsetX, y + gridOffsetY, HEX_SIZE - 0.5, '#e8e8e2', '#c9c9c2');
      // Hex code label
      ctx.fillStyle = '#b0b0a8';
      ctx.font = '7px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(hexCode(col, row), x + gridOffsetX, y + gridOffsetY);
    }
  }

  // Highlight legal movement destinations for the 'Mech currently being moved
  drawMovementHighlights();

  // Draw mechs
  for (const inst of mechInstances) {
    const { x, y } = hexToPixel(inst.col, inst.row);
    const px = x + gridOffsetX;
    const py = y + gridOffsetY;
    const unit = BT_UNITS[inst.unitId];
    const angle = HEX_DIRS[inst.facing || 0].angle;
    drawMechToken(px, py, HEX_SIZE * 0.45, unit.color, angle, inst.instanceId === selectedInstanceId);
  }
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
    drawHex(x + gridOffsetX, y + gridOffsetY, HEX_SIZE - 1.5, fill, 'transparent');
  };

  if (moveState.mode === 'jump') {
    // Jumping ignores terrain/facing: any hex within remaining Jump MP is reachable, if unoccupied.
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        if (col === mech.col && row === mech.row) continue;
        if (axialDistance(mech.col, mech.row, col, row) <= mpLeft && !isHexOccupied(col, row, mech.instanceId)) {
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
      const isRear = d === ((mech.facing + 3) % 6);
      if (isRear && moveState.mode !== 'walk') continue; // running 'Mechs can't move backward
      const cost = (d === mech.facing) ? 1 : (isRear ? 1 : facingTurnCost(mech.facing, d) + 1);
      if (cost <= mpLeft) highlightHex(n.col, n.row, 'rgba(90,190,110,0.35)');
    }
  }
}

function drawHex(cx, cy, size, fill, stroke) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i + 30);
    const x = cx + size * Math.cos(angle);
    const y = cy + size * Math.sin(angle);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 0.5;
  ctx.stroke();
}

function drawMechToken(x, y, r, color, facing, selected) {
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
}

// Mouse hover
canvas = document.getElementById('hexmap');
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const px = e.clientX - rect.left - gridOffsetX, py = e.clientY - rect.top - gridOffsetY;
  const hex = pixelToHex(px, py);
  if (hex.col >= 0 && hex.col < GRID_COLS && hex.row >= 0 && hex.row < GRID_ROWS) {
    const axial = offsetToAxial(hex.col, hex.row);
    document.getElementById('coord-readout').textContent =
      `HEX ${String(hex.col).padStart(2,'0')}${String(hex.row).padStart(2,'0')}  (q${axial.q} r${axial.r})`;
  }
});

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const px = e.clientX - rect.left - gridOffsetX, py = e.clientY - rect.top - gridOffsetY;
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
  draw();
}

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
