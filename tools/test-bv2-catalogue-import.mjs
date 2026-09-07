import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(tmpdir(), 'btechvtt-bv2-'));
const configPath = path.join(scratch, 'units.json');
const inputPath = path.join(scratch, 'Units.txt');
const outputPath = path.join(scratch, 'supported-bv2.json');

await writeFile(configPath, JSON.stringify({ catalogue_version:'fixture', units:[
  { id:'wolverine-wvr-6r', source:'data/mekfiles/meks/3039u/Wolverine WVR-6R.mtf' },
  { id:'timber-wolf-prime', source:'data/mekfiles/meks/3050U/Mad Cat (Timber Wolf) Prime.mtf' }
] }));
await writeFile(inputPath, [
  'MUL ID|Chassis|Model|BV|File Location',
  '3573|Wolverine|WVR-6R|1105|/tmp/mm-data/data/mekfiles/meks/3039u/Wolverine WVR-6R.mtf',
  '1234|Mad Cat|Prime|2737|data/mekfiles/meks/3050U/Mad Cat (Timber Wolf) Prime.mtf'
].join('\n'));

execFileSync(process.execPath, [path.join(ROOT, 'tools/import-megamek-bv2.mjs'), '--config', configPath, '--input', inputPath, '--output', outputPath, '--megamek-release', '0.51.01-fixture', '--source-revision', 'fixture-revision'], { stdio:'inherit' });
const fixture = JSON.parse(await readFile(outputPath, 'utf8'));
assert.equal(fixture.battle_value_system, 'BV2');
assert.deepEqual(fixture.reference_pilot, { gunnery:4, piloting:5 });
assert.equal(fixture.records['wolverine-wvr-6r'].stock_bv, 1105);
assert.equal(fixture.records['timber-wolf-prime'].stock_bv, 2737);

const builder = await readFile(path.join(ROOT, 'tools/build-megamek-content-pack.mjs'), 'utf8');
assert.ok(builder.includes("config.require_verified_bv2 ? await loadBv2Fixture"));
assert.ok(builder.includes("system: 'BV2'"));
assert.ok(!builder.includes('BV1'));

console.log('BV2 catalogue import regression passed.');
