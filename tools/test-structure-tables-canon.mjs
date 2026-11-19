// Structure-table canon guard. Fails if any hand-maintained internal-structure
// table drifts from MegaMek Mek.getInternalForTonnage (source of truth:
// github.com/MegaMek/megamek, src/megamek/common/units/Mek.java, verified
// 2026-11-02 against master). Covers: mech-designer CUSTOM_STRUCTURE_TABLE,
// build-megamek-content-pack BIPED_STRUCTURE, and every hardcoded stock unit
// in js/game/unit-catalogue.js (structure must match its declared tonnage row).
import { readFile } from 'node:fs/promises';

// [head, centerTorso, sideTorso, arm, leg] per Mek.java switch block.
const MEGAMEK = {
  20:[3,6,5,3,4],25:[3,8,6,4,6],30:[3,10,7,5,7],35:[3,11,8,6,8],40:[3,12,10,6,10],45:[3,14,11,7,11],
  50:[3,16,12,8,12],55:[3,18,13,9,13],60:[3,20,14,10,14],65:[3,21,15,10,15],70:[3,22,15,11,15],
  75:[3,23,16,12,16],80:[3,25,17,13,17],85:[3,27,18,14,18],90:[3,29,19,15,19],95:[3,30,20,16,20],100:[3,31,21,17,21]
};

const failures = [];
const text = await readFile(new URL('../js/game/unit-catalogue.js', import.meta.url), 'utf8');
const designer = await readFile(new URL('../js/game/mech-designer.js', import.meta.url), 'utf8');
const generator = await readFile(new URL('./build-megamek-content-pack.mjs', import.meta.url), 'utf8');

// 1) Table-shaped literals: "T:[head?,ct,st,arm,leg]" keyed by tonnage.
const checkTable = (label, src, slice) => {
  for (const [, tonnageStr, body] of src.matchAll(/(\d+):\s*\[([\d,\s]+)\]/g)) {
    const tonnage = Number(tonnageStr);
    const got = body.split(',').map(Number);
    const want = MEGAMEK[tonnage];
    const normalized = want.length === got.length ? want : want.slice(1); // catalogue tables omit head
    if (normalized.join() !== got.join()) failures.push(`${label}: ${tonnage}t = [${got}] but MegaMek = [${want}]`);
  }
};
const designerBlock = designer.match(/CUSTOM_STRUCTURE_TABLE\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/);
const generatorBlock = generator.match(/BIPED_STRUCTURE\s*=\s*\{([\s\S]*?)\};/);
if (!designerBlock || !generatorBlock) {
  failures.push('could not locate CUSTOM_STRUCTURE_TABLE or BIPED_STRUCTURE literal');
} else {
  checkTable('mech-designer', designerBlock[1]);
  checkTable('content-pack', generatorBlock[1]);
}

// 2) Stock units: structure must equal the table row for its declared tonnage.
for (const m of text.matchAll(/tonnage:\s*(\d+),[\s\S]*?structure:\s*\{([^}]+)\}/g)) {
  const tonnage = Number(m[1]);
  const row = MEGAMEK[tonnage];
  if (!row) { failures.push(`stock unit at tonnage ${tonnage}t has no MegaMek table row`); continue; }
  const parts = Object.fromEntries(m[2].split(',').map(p => p.split(':').map(s => s.trim())));
  const expect = { head: row[0], ct: row[1], lt: row[2], rt: row[2], la: row[3], ra: row[3], ll: row[4], rl: row[4] };
  for (const [slot, want] of Object.entries(expect)) {
    if (Number(parts[slot]) !== want) failures.push(`stock unit ${tonnage}t slot ${slot} = ${parts[slot]} but MegaMek ${tonnage}t row = ${want}`);
  }
}

if (failures.length) {
  console.error('FAIL structure-tables-canon:\n' + failures.map(f => '  ' + f).join('\n'));
  process.exit(1);
}
console.log('PASS structure-tables-canon: designer table, content-pack table, and all stock units match MegaMek');
