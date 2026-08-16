#!/usr/bin/env node
// Generate a versioned, developer-local BT-VTT registry and an idempotent SQL
// content pack from explicitly supported MegaMek MTF records.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DEFAULT_SOURCE = 'local-data/megamek-mm-data';
const DEFAULT_CONFIG = 'config/supported-megamek-units.json';
const DEFAULT_REGISTRY = 'local-data/btech-supported-registry.json';
const DEFAULT_SQL = 'local-data/btech-supported-content-pack.sql';
const ATTRIBUTION = 'MegaMek Data © 2025-2026 by The MegaMek Team — CC BY-NC-SA 4.0';
const SOURCE_REPOSITORY = 'https://github.com/MegaMek/mm-data';

const LOCATION_HEADINGS = new Map([
  ['Left Arm:', 'la'], ['Right Arm:', 'ra'], ['Left Torso:', 'lt'], ['Right Torso:', 'rt'],
  ['Center Torso:', 'ct'], ['Head:', 'head'], ['Left Leg:', 'll'], ['Right Leg:', 'rl']
]);
const LOCATION_NAMES = {
  'Left Arm': 'la', 'Right Arm': 'ra', 'Left Torso': 'lt', 'Right Torso': 'rt',
  'Center Torso': 'ct', Head: 'head', 'Left Leg': 'll', 'Right Leg': 'rl'
};
const WEAPONS = {
  'Medium Laser': { key: 'med_laser', damage: 5, heat: 3, range: [3, 6, 9] },
  'Small Laser': { key: 'small_laser', damage: 3, heat: 1, range: [1, 2, 3] },
  'Large Laser': { key: 'large_laser', damage: 8, heat: 8, range: [5, 10, 15] },
  PPC: { key: 'ppc', damage: 10, heat: 10, range: [3, 6, 12], minimumRange: 3 },
  'AC/20': { key: 'ac20', damage: 20, heat: 7, range: [3, 6, 9], ammoType: 'ac20' },
  'AC/10': { key: 'ac10', damage: 10, heat: 3, range: [5, 10, 15], ammoType: 'ac10' },
  'AC/5': { key: 'ac5', damage: 5, heat: 1, range: [6, 12, 18], ammoType: 'ac5' },
  'Machine Gun': { key: 'machine_gun', damage: 2, heat: 0, range: [1, 2, 3], ammoType: 'machine_gun' },
  'LRM 20': { key: 'lrm20', damage: 20, heat: 6, range: [7, 14, 21], minimumRange: 6, ammoType: 'lrm20', clusterSize: 20, damagePerMissile: 1 },
  'LRM 10': { key: 'lrm10', damage: 10, heat: 4, range: [7, 14, 21], minimumRange: 6, ammoType: 'lrm10', clusterSize: 10, damagePerMissile: 1 },
  'SRM 6': { key: 'srm6', damage: 12, heat: 4, range: [3, 6, 9], ammoType: 'srm6', clusterSize: 6, damagePerMissile: 2 }
};
const AMMO = [
  [/Ammo AC\/20/i, 'ac20', 5], [/Ammo AC\/10/i, 'ac10', 10], [/Ammo AC\/5/i, 'ac5', 20],
  [/Ammo LRM-20/i, 'lrm20', 6], [/Ammo LRM-10/i, 'lrm10', 12], [/Ammo SRM-6/i, 'srm6', 15],
  [/Ammo MG/i, 'machine_gun', 200]
];
const BIPED_STRUCTURE = {
  20:[6,5,3,4],25:[8,6,4,6],30:[10,7,5,7],35:[11,8,6,8],40:[12,10,6,10],45:[14,11,7,11],
  50:[16,12,8,12],55:[18,13,9,13],60:[20,14,10,14],65:[21,15,10,15],70:[22,15,11,15],
  75:[23,16,12,16],80:[25,17,13,17],85:[27,18,14,18],90:[29,19,15,19],95:[30,20,16,20],100:[31,21,17,21]
};

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
function integer(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
function jsonSql(value) {
  return `${sql(JSON.stringify(value))}::jsonb`;
}
function headersFrom(lines) {
  const headers = new Map();
  for (const line of lines) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match && !headers.has(match[1].trim().toLowerCase())) headers.set(match[1].trim().toLowerCase(), match[2].trim());
  }
  return headers;
}
function armorFrom(lines) {
  const keys = { LA:'la',RA:'ra',LT:'lt',RT:'rt',CT:'ct',HD:'head',LL:'ll',RL:'rl',RTL:'lt_rear',RTR:'rt_rear',RTC:'ct_rear' };
  const armor = {};
  for (const line of lines) {
    const match = line.match(/^([A-Z]+) armor:\s*(\d+)$/i);
    if (match && keys[match[1].toUpperCase()]) armor[keys[match[1].toUpperCase()]] = integer(match[2]);
  }
  return armor;
}
function criticalsFrom(lines) {
  const criticals = {};
  for (let index = 0; index < lines.length; index++) {
    const location = LOCATION_HEADINGS.get(lines[index]);
    if (location) criticals[location] = lines.slice(index + 1, index + 13).map(label => label === '-Empty-' || !label ? null : label);
  }
  return criticals;
}
function weaponsFrom(lines) {
  const start = lines.findIndex(line => /^Weapons:\d+$/i.test(line));
  if (start < 0) return [];
  const count = integer(lines[start].split(':')[1]) || 0;
  return lines.slice(start + 1, start + count + 1).map((line, index) => {
    const comma = line.lastIndexOf(',');
    const rawName = line.slice(0, comma).trim();
    const locationName = line.slice(comma + 1).trim();
    const weapon = WEAPONS[rawName] || null;
    return {
      mount_id: `${weapon?.key || rawName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}:${LOCATION_NAMES[locationName] || locationName}:${index}`,
      weapon_key: weapon?.key || null,
      raw_name: rawName,
      location: LOCATION_NAMES[locationName] || locationName,
      definition: weapon
    };
  });
}
function ammoFrom(criticals) {
  const bins = [];
  for (const [location, slots] of Object.entries(criticals)) slots.forEach((label, slotIndex) => {
    const definition = AMMO.find(([pattern]) => pattern.test(label || ''));
    if (definition) bins.push({ bin_id:`${location}:${slotIndex}`, ammo_type:definition[1], raw_name:label, location, shots:definition[2] });
  });
  return bins;
}
function structureFor(mass, config) {
  if (!/^Biped$/i.test(config || '') || !BIPED_STRUCTURE[mass]) return null;
  const [ct,side,arm,leg] = BIPED_STRUCTURE[mass];
  return { head:3,ct,lt:side,rt:side,la:arm,ra:arm,ll:leg,rl:leg };
}
function parseMtf(text, entry) {
  const lines = text.replaceAll('\r','').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  const headers = headersFrom(lines);
  const mass = integer(headers.get('mass'));
  const walk = integer(headers.get('walk mp'));
  const heatMatch = headers.get('heat sinks')?.match(/^(\d+)\s+(.+)$/);
  const criticals = criticalsFrom(lines);
  const mounts = weaponsFrom(lines);
  const definition = {
    id: entry.id,
    chassis: headers.get('chassis'), variant: headers.get('model'), mass,
    config: headers.get('config'), tech_base: headers.get('techbase'), era: integer(headers.get('era')),
    movement: { walk, run: walk == null ? null : Math.ceil(walk * 1.5), jump: integer(headers.get('jump mp')) || 0 },
    heat_sinks: heatMatch ? integer(heatMatch[1]) : null,
    heat_sink_type: heatMatch?.[2] || null,
    armor: armorFrom(lines), structure: structureFor(mass, headers.get('config')),
    supported_by_vtt: mounts.every(mount => mount.weapon_key && mount.definition) && Boolean(structureFor(mass, headers.get('config')))
  };
  return { id:entry.id, source_uuid:headers.get('uuid') || null, source_file:entry.source, definition, mounts, criticals, ammo_bins:ammoFrom(criticals) };
}

function contentPack(registry) {
  const lines = [
    '-- Generated by tools/build-megamek-content-pack.mjs. Do not hand-edit.',
    '-- MegaMek-derived data: CC BY-NC-SA 4.0. See docs/MEGAMEK_ATTRIBUTION.md.',
    'BEGIN;',
    `DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.btech_catalogue_releases WHERE version=${sql(registry.catalogue_version)} AND content_sha256<>${sql(registry.content_sha256)}) THEN RAISE EXCEPTION 'Catalogue version already exists with different content; increment catalogue_version'; END IF; END $$;`,
    `INSERT INTO public.btech_catalogue_releases(version,source_repository,source_revision,content_sha256,attribution,generated_at) VALUES (${sql(registry.catalogue_version)},${sql(SOURCE_REPOSITORY)},${sql(registry.source_revision)},${sql(registry.content_sha256)},${sql(ATTRIBUTION)},${sql(registry.generated_at)}) ON CONFLICT (version) DO NOTHING;`
  ];
  for (const unit of registry.units) {
    lines.push(`INSERT INTO public.btech_catalogue_units(catalogue_version,unit_id,source_uuid,definition) VALUES (${sql(registry.catalogue_version)},${sql(unit.id)},${unit.source_uuid ? sql(unit.source_uuid) : 'NULL'},${jsonSql(unit.definition)}) ON CONFLICT (catalogue_version,unit_id) DO NOTHING;`);
    for (const mount of unit.mounts) lines.push(`INSERT INTO public.btech_catalogue_mounts(catalogue_version,unit_id,mount_id,weapon_key,raw_name,location,definition) VALUES (${sql(registry.catalogue_version)},${sql(unit.id)},${sql(mount.mount_id)},${mount.weapon_key ? sql(mount.weapon_key) : 'NULL'},${sql(mount.raw_name)},${sql(mount.location)},${jsonSql(mount.definition || {})}) ON CONFLICT (catalogue_version,unit_id,mount_id) DO NOTHING;`);
    for (const [location, slots] of Object.entries(unit.criticals)) slots.forEach((label,index) => { if (label) lines.push(`INSERT INTO public.btech_catalogue_critical_slots(catalogue_version,unit_id,location,slot_index,label) VALUES (${sql(registry.catalogue_version)},${sql(unit.id)},${sql(location)},${index},${sql(label)}) ON CONFLICT (catalogue_version,unit_id,location,slot_index) DO NOTHING;`); });
    for (const bin of unit.ammo_bins) lines.push(`INSERT INTO public.btech_catalogue_ammo_bins(catalogue_version,unit_id,bin_id,ammo_type,raw_name,location,shots) VALUES (${sql(registry.catalogue_version)},${sql(unit.id)},${sql(bin.bin_id)},${sql(bin.ammo_type)},${sql(bin.raw_name)},${sql(bin.location)},${bin.shots}) ON CONFLICT (catalogue_version,unit_id,bin_id) DO NOTHING;`);
  }
  lines.push('COMMIT;','');
  return lines.join('\n');
}

async function main() {
  const source = option('--source', DEFAULT_SOURCE);
  const configPath = option('--config', DEFAULT_CONFIG);
  const registryPath = option('--registry-output', DEFAULT_REGISTRY);
  const sqlPath = option('--sql-output', DEFAULT_SQL);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const units = [];
  for (const entry of config.units) units.push(parseMtf(await readFile(join(source, entry.source), 'utf8'), entry));
  const sourceRevision = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding:'utf8' }).trim();
  const stable = { catalogue_version:config.catalogue_version, source_revision:sourceRevision, units };
  const contentSha256 = createHash('sha256').update(JSON.stringify(stable)).digest('hex');
  const registry = { ...stable, content_sha256:contentSha256, generated_at:new Date().toISOString(), attribution:ATTRIBUTION, source_repository:SOURCE_REPOSITORY };
  await mkdir(dirname(registryPath), { recursive:true });
  await mkdir(dirname(sqlPath), { recursive:true });
  await writeFile(registryPath, `${JSON.stringify(registry,null,2)}\n`);
  await writeFile(sqlPath, contentPack(registry));
  const slots = units.reduce((total,unit) => total + Object.values(unit.criticals).flat().filter(Boolean).length,0);
  const unsupported = units.flatMap(unit => unit.mounts.filter(mount => !mount.weapon_key).map(mount => `${unit.id}: ${mount.raw_name}`));
  console.log(`Generated ${units.length} units, ${units.reduce((n,u)=>n+u.mounts.length,0)} mounts, ${slots} occupied critical slots and ${units.reduce((n,u)=>n+u.ammo_bins.length,0)} ammo bins.`);
  if (unsupported.length) throw new Error(`Unsupported equipment in supported allowlist:\n${unsupported.join('\n')}`);
}

main().catch(error => { console.error(`Content-pack generation failed: ${error.message}`); process.exitCode=1; });
