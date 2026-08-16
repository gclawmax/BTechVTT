// Generates the shipped layouts for the currently supported MegaMek records.
// Source files remain local-only; the resulting data is the compact runtime
// representation required by the record-sheet viewer.
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
const output = process.argv[3];
const units = {
  'atlas-as7-d': 'Atlas AS7-D.mtf',
  'hunchback-hbk-4g': 'Hunchback HBK-4G.mtf',
  'locust-lct-1v': 'Locust LCT-1V.mtf',
  'marauder-mad-3r': 'Marauder MAD-3R.mtf',
  'enforcer-enf-4r': 'Enforcer ENF-4R.mtf',
  'centurion-cn9-a': 'Centurion CN9-A.mtf'
};
const headings = new Map([
  ['Left Arm:', 'la'], ['Right Arm:', 'ra'], ['Left Torso:', 'lt'], ['Right Torso:', 'rt'],
  ['Center Torso:', 'ct'], ['Head:', 'head'], ['Left Leg:', 'll'], ['Right Leg:', 'rl']
]);
const layouts = {};
for (const [unitId, file] of Object.entries(units)) {
  const lines = fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r', '').split('\n');
  const layout = {};
  for (let index = 0; index < lines.length; index++) {
    const key = headings.get(lines[index]);
    if (!key) continue;
    layout[key] = lines.slice(index + 1, index + 13).map(slot => slot === '-Empty-' ? null : slot || null);
  }
  layouts[unitId] = layout;
}
fs.writeFileSync(output, `// Generated from local MegaMek MTF records; see tools/export-supported-critical-layouts.mjs.\nconst BT_CRITICAL_LAYOUTS = Object.freeze(${JSON.stringify(layouts, null, 2)});\n`);
