import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(ROOT, 'config', 'supported-megamek-units.json');
const PARTS_DIR = path.join(ROOT, 'SQL', '94_expanded_72_unit_catalogue.sql.parts');

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
}

const innerSphereBatch = [
  'assassin-asn-21', 'cicada-cda-2a', 'clint-clnt-2-3t', 'hermes-ii-her-2s',
  'vindicator-vnd-1r', 'trebuchet-tbt-5n', 'whitworth-wth-1', 'kintaro-kto-18',
  'jagermech-jm6-s', 'ostsol-otl-4d', 'quickdraw-qkd-4g', 'grasshopper-ghr-5h',
  'orion-on1-k', 'zeus-zeu-6s', 'highlander-hgn-733'
];
const clanBatch = [
  'fire-moth-prime', 'mist-lynx-c', 'kit-fox-a', 'viper-prime', 'nova-prime',
  'mad-dog-prime', 'hellbringer-a', 'gargoyle-b', 'warhawk-prime',
  'executioner-prime', 'battle-cobra-prime', 'shadow-cat-prime',
  'crossbow-prime', 'stone-rhino', 'black-lanner-prime'
];
const dragonFamily = [
  'dragon-drg-1c', 'dragon-drg-1n', 'grand-dragon-drg-1g', 'dragon-drg-5n',
  'grand-dragon-drg-5k-dc', 'grand-dragon-drg-5k', 'grand-dragon-drg-c'
];

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
assert(config.catalogue_version === 'megamek-2026-08-curated-04', 'catalogue version is curated-04');
assert(config.units.length === 72, 'allowlist contains exactly 72 BattleMechs');
const configuredIds = new Set(config.units.map(unit => unit.id));
assert(configuredIds.size === config.units.length, 'allowlist IDs are unique');
assert([...dragonFamily, ...innerSphereBatch, ...clanBatch].every(id => configuredIds.has(id)), 'Dragon family and both expansion batches are allowlisted');
const drg5kSource = config.units.find(unit => unit.id === 'grand-dragon-drg-5k')?.source;
assert(drg5kSource === 'data/mekfiles/meks/3050U/Grand Dragon DRG-5K.mtf', 'Grand Dragon DRG-5K uses the exact MegaMek record');

const numberedParts = ['001_of_003.sql', '002_of_003.sql', '003_of_003.sql'];
const sql = numberedParts.map(file => fs.readFileSync(path.join(PARTS_DIR, file), 'utf8')).join('\n');
const releaseHashes = [...sql.matchAll(/content_sha256<>'([a-f0-9]{64})'/g)].map(match => match[1]);
assert(releaseHashes.length === 3 && new Set(releaseHashes).size === 1, 'all SQL parts protect the same immutable release hash');

const unitRows = new Map();
for (const line of sql.split('\n')) {
  if (!line.startsWith('INSERT INTO public.btech_catalogue_units(')) continue;
  const match = line.match(/VALUES \('megamek-2026-08-curated-04','([^']+)','[^']+','(\{.*\})'::jsonb\)/);
  if (!match) throw new Error(`Could not parse catalogue unit row: ${line.slice(0, 120)}`);
  unitRows.set(match[1], JSON.parse(match[2].replaceAll("''", "'")));
}
assert(unitRows.size === 72, 'generated SQL contains exactly 72 unit definitions');
assert([...unitRows.values()].every(unit => unit.supported_by_vtt === true), 'every imported unit is marked playable');
assert(innerSphereBatch.every(id => unitRows.get(id)?.tech_base === 'Inner Sphere'), 'new Inner Sphere batch contains 15 Inner Sphere units');
assert(clanBatch.every(id => unitRows.get(id)?.tech_base === 'Clan'), 'new Clan batch contains 15 Clan units');

const drg5k = unitRows.get('grand-dragon-drg-5k');
assert(drg5k?.chassis === 'Grand Dragon' && drg5k.variant === 'DRG-5K' && drg5k.mass === 60, 'Grand Dragon DRG-5K identity and tonnage are correct');
assert(drg5k?.movement?.walk === 6 && drg5k.movement.run === 9 && drg5k.movement.jump === 0, 'Grand Dragon DRG-5K movement is 6/9/0');
const drg5kMountLines = sql.split('\n').filter(line => line.includes("'grand-dragon-drg-5k'") && line.includes('btech_catalogue_mounts'));
assert(drg5kMountLines.some(line => line.includes("'er_ppc'")) && drg5kMountLines.some(line => line.includes("'lrm10'")) && drg5kMountLines.filter(line => line.includes("'med_laser'")).length === 3, 'Grand Dragon DRG-5K weapon mounts are complete');

const verifySql = fs.readFileSync(path.join(PARTS_DIR, '004_verify.sql'), 'utf8');
assert(verifySql.includes('unit_count<>72') && verifySql.includes('mount_count<>356') && verifySql.includes('slot_count<>3624') && verifySql.includes('ammo_count<>159'), 'verification script checks every generated catalogue table');

console.log('Expanded catalogue regression passed.');
