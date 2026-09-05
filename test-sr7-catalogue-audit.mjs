import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const BATCH = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/sr7-catalogue-import-batch.json'), 'utf8'));
const PARTS = path.join(ROOT, 'SQL/122_sr7_catalogue_completion.sql.parts');
const expectedBatch = [
  'bushwacker-bsw-x1', 'bushwacker-bsw-x2', 'axman-axm-1n', 'king-crab-kgc-000',
  'wraith-tr1', 'nightsky-ngs-5s', 'axman-axm-2n', 'nova-cat-prime',
  'nova-cat-a', 'nova-cat-b'
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
}

assert(BATCH.extends === 'supported-megamek-units.json', 'SR-7 extends the previous immutable 75-unit roster');
assert(BATCH.catalogue_version === 'megamek-2026-09-sr7-01', 'SR-7 has a new immutable catalogue version');
assert(JSON.stringify(BATCH.units.map(unit => unit.id)) === JSON.stringify(expectedBatch), 'SR-7 uses the reviewed ten-BattleMech import batch');

const sql = ['001_of_004.sql', '002_of_004.sql', '003_of_004.sql', '004_of_004.sql']
  .map(file => fs.readFileSync(path.join(PARTS, file), 'utf8')).join('\n');
const unitRows = new Map();
for (const line of sql.split('\n')) {
  if (!line.startsWith('INSERT INTO public.btech_catalogue_units(')) continue;
  const match = line.match(/VALUES \('megamek-2026-09-sr7-01','([^']+)',(?:'[^']+'|NULL),'(\{.*\})'::jsonb\)/);
  if (!match) throw new Error(`Could not parse SR-7 unit row: ${line.slice(0, 140)}`);
  unitRows.set(match[1], JSON.parse(match[2].replaceAll("''", "'")));
}
assert(unitRows.size === 85, 'SR-7 generated SQL contains all 85 reviewed BattleMechs');
assert(expectedBatch.every(id => unitRows.get(id)?.supported_by_vtt === true), 'every new SR-7 BattleMech is explicitly playable');
assert(expectedBatch.slice(0, 7).every(id => unitRows.get(id)?.tech_base === 'Inner Sphere'), 'SR-7 adds seven Inner Sphere BattleMechs');
assert(expectedBatch.slice(7).every(id => unitRows.get(id)?.tech_base === 'Clan'), 'SR-7 adds three Clan BattleMechs');

const mountsFor = id => sql.split('\n').filter(line => line.includes("btech_catalogue_mounts") && line.includes(`'${id}'`)).join('\n');
assert(mountsFor('bushwacker-bsw-x1').includes("'ac10'") && mountsFor('bushwacker-bsw-x1').includes("'lrm5'") && mountsFor('bushwacker-bsw-x1').includes("'er_large_laser'"), 'Bushwacker exercises ballistic, missile and ER direct fire');
assert(mountsFor('axman-axm-2n').includes("'lrm15'") && mountsFor('axman-axm-2n').includes("'large_pulse_laser'"), 'Axman adds LRM and pulse-laser coverage alongside the existing hatchet family');
assert(mountsFor('nova-cat-b').includes("'lrm15'") && mountsFor('nova-cat-b').includes("'er_med_laser'"), 'Nova Cat B exercises Clan LRM and ER laser families');

const verify = fs.readFileSync(path.join(PARTS, '005_verify.sql'), 'utf8');
assert(verify.includes('unit_count<>85') && verify.includes('mount_count<>423') && verify.includes('slot_count<>4534') && verify.includes('ammo_count<>189'), 'SR-7 verification checks every imported catalogue table');

console.log('SR-7 catalogue audit regression passed.');
