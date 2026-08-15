#!/usr/bin/env node
// Build a developer-local catalogue from MegaMek MTF unit files.
//
// This tool deliberately does not download, bundle, or publish MegaMek data.
// The source checkout and generated JSON are both Git-ignored; see
// docs/MEGAMEK_LOCAL_IMPORT.md for attribution and licence obligations.

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';

const DEFAULT_SOURCE = 'local-data/megamek-mm-data';
const DEFAULT_OUTPUT = 'local-data/megamek-catalogue.json';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function filesUnder(directory, collected = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await filesUnder(path, collected);
    else if (entry.isFile() && extname(entry.name).toLowerCase() === '.mtf') collected.push(path);
  }
  return collected;
}

function integer(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseWeapons(lines) {
  const start = lines.findIndex(line => /^weapons\s*:\s*\d+/i.test(line));
  if (start < 0) return [];
  const count = integer(lines[start].match(/^weapons\s*:\s*(\d+)/i)?.[1]) ?? 0;
  return lines.slice(start + 1, start + 1 + count).map(line => {
    const [name, ...location] = line.split(',').map(part => part.trim());
    return { name, location: location.join(', ') || null };
  });
}

function headersFrom(lines) {
  const headers = new Map();
  for (const line of lines) {
    const match = line.match(/^([^:]+):\s*(.+)$/);
    if (match) headers.set(match[1].trim().toLowerCase(), match[2].trim());
  }
  return headers;
}

function parseArmor(lines) {
  const locations = {
    la: 'left_arm', ra: 'right_arm', lt: 'left_torso', rt: 'right_torso',
    ct: 'centre_torso', hd: 'head', ll: 'left_leg', rl: 'right_leg',
    rtl: 'left_torso_rear', rtr: 'right_torso_rear', rtc: 'centre_torso_rear'
  };
  const armor = {};
  for (const line of lines) {
    const match = line.match(/^([a-z]+)\s+armor:\s*(\d+)$/i);
    if (match && locations[match[1].toLowerCase()]) {
      armor[locations[match[1].toLowerCase()]] = integer(match[2]);
    }
  }
  return armor;
}

function parseMtf(text, sourceFile) {
  // Current MegaMek files start with CC BY-NC-SA notices. Ignore those
  // comments before identifying headers, so their attribution is preserved
  // in the source while never being mistaken for a unit name.
  const lines = text.replace(/\r/g, '').split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  const headers = headersFrom(lines);
  const legacyNameLines = lines.filter(line => !line.includes(':'));
  const chassis = headers.get('chassis') || headers.get('name') || legacyNameLines[0] || 'Unknown unit';
  const variant = headers.get('model') || headers.get('variant') || legacyNameLines[1] || null;
  const name = variant ? `${chassis} ${variant}` : chassis;
  const walk = integer(headers.get('walk mp'));
  const run = integer(headers.get('run mp'));
  const jump = integer(headers.get('jump mp'));
  const mass = integer(headers.get('mass'));

  return {
    id: headers.get('uuid') || relative(process.cwd(), sourceFile).replace(/\\/g, '/').replace(/\.mtf$/i, ''),
    name,
    chassis,
    variant,
    mass,
    movement: { walk, run, jump },
    tech_base: headers.get('techbase') || null,
    era: integer(headers.get('era')),
    weapons: parseWeapons(lines),
    armor: parseArmor(lines),
    source_file: relative(process.cwd(), sourceFile).replace(/\\/g, '/'),
    // The current VTT only supports a small equipment subset. Importing a
    // record makes it discoverable; it does not make it playable yet.
    supported_by_vtt: false,
    catalogue_status: 'discovered'
  };
}

async function main() {
  const source = option('--source', DEFAULT_SOURCE);
  const output = option('--output', DEFAULT_OUTPUT);
  const mtfFiles = await filesUnder(source);
  if (mtfFiles.length === 0) {
    throw new Error(`No MTF unit files found in ${source}. Complete the local MegaMek checkout first.`);
  }
  const units = [];
  const skipped = [];

  for (const file of mtfFiles) {
    try {
      units.push(parseMtf(await readFile(file, 'utf8'), file));
    } catch (error) {
      skipped.push({ file: relative(process.cwd(), file), error: error.message });
    }
  }

  units.sort((a, b) => a.name.localeCompare(b.name));
  const catalogue = {
    attribution: 'MegaMek Data © 2025 by The MegaMek Team — CC BY-NC-SA 4.0',
    source_repository: 'https://github.com/MegaMek/mm-data',
    source_path: source,
    generated_at: new Date().toISOString(),
    unit_count: units.length,
    skipped_count: skipped.length,
    units,
    skipped
  };

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(catalogue, null, 2)}\n`);
  console.log(`Imported ${units.length} MTF files into ${output}${skipped.length ? ` (${skipped.length} skipped)` : ''}.`);
}

main().catch(error => {
  console.error(`MegaMek import failed: ${error.message}`);
  process.exitCode = 1;
});
