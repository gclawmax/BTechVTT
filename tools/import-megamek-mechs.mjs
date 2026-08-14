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

function firstMatch(text, expression) {
  const match = text.match(expression);
  return match ? match[1].trim() : null;
}

function integerMatch(text, expression) {
  const value = firstMatch(text, expression);
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseWeapons(lines) {
  const start = lines.findIndex(line => /^weapons\s*:/i.test(line));
  if (start < 0) return [];
  return lines.slice(start + 1)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/^(location|critical slots|overview)\s*:/i.test(line))
    .map(line => line.replace(/^\d+\s+/, ''))
    .slice(0, 32);
}

function parseMtf(text, sourceFile) {
  const lines = text.replace(/\r/g, '').split('\n');
  const name = lines.find(line => /^name\s*:/i.test(line))?.replace(/^name\s*:\s*/i, '').trim()
    || lines.find(line => line.trim() && !/^version\s*:/i.test(line))?.trim()
    || 'Unknown unit';
  const [chassis, ...variantParts] = name.split(/\s+/);
  const walk = integerMatch(text, /^walk\s*mp\s*:\s*(\d+)/im);
  const run = integerMatch(text, /^run\s*mp\s*:\s*(\d+)/im);
  const jump = integerMatch(text, /^jump\s*mp\s*:\s*(\d+)/im);
  const mass = integerMatch(text, /^mass\s*:\s*(\d+)/im);

  return {
    id: relative(process.cwd(), sourceFile).replace(/\\/g, '/').replace(/\.mtf$/i, ''),
    name,
    chassis,
    variant: variantParts.join(' ') || null,
    mass,
    movement: { walk, run, jump },
    tech_base: firstMatch(text, /^techbase\s*:\s*(.+)$/im),
    era: integerMatch(text, /^era\s*:\s*(\d+)/im),
    weapons: parseWeapons(lines),
    source_file: relative(process.cwd(), sourceFile).replace(/\\/g, '/'),
    // The current VTT only supports a small equipment subset. Importing a
    // record makes it discoverable; it does not make it playable yet.
    supported_by_vtt: false
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
