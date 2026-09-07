#!/usr/bin/env node
// Convert MegaMek's MekCacheCSVTool export into a small, developer-local BV2
// fixture for the BT-VTT reviewed unit allowlist. MTF files do not carry a
// Battle Value header, so values must come from MegaMek's own calculator.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const DEFAULT_CONFIG = 'config/supported-megamek-units.json';
const DEFAULT_INPUT = 'local-data/megamek-bv2/Units.txt';
const DEFAULT_OUTPUT = 'local-data/megamek-bv2/supported-bv2.json';

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function normaliseSource(value) {
  const source = String(value || '').replaceAll('\\', '/');
  const marker = source.toLowerCase().indexOf('data/mekfiles/');
  return marker >= 0 ? source.slice(marker) : source.replace(/^\.\//, '');
}

function parsePipeTable(text) {
  const lines = text.replaceAll('\r', '').split('\n').filter(line => line.trim());
  const headers = (lines.shift() || '').split('|').map(value => value.trim());
  const indexOf = name => headers.indexOf(name);
  for (const name of ['BV', 'File Location']) if (indexOf(name) < 0) throw new Error(`MegaMek BV export is missing its ${name} column.`);
  const fileLocationIndex = indexOf('File Location');
  return lines.map((line, lineNumber) => {
    const values = line.split('|');
    // MekCacheCSVTool does not quote pipe characters in several free-text
    // columns (such as manufacturers). The fields we need are stable: BV is
    // before those fields, while File Location and File Modified are last.
    // Reading File Location from the right keeps the provenance join exact.
    return {
      'MUL ID': (values[indexOf('MUL ID')] || '').trim(),
      Chassis: (values[indexOf('Chassis')] || '').trim(),
      Model: (values[indexOf('Model')] || '').trim(),
      BV: (values[indexOf('BV')] || '').trim(),
      'File Location': (values[values.length - (headers.length - fileLocationIndex)] || '').trim()
    };
  }).filter(row => row['File Location'] || row.BV);
}

async function main() {
  const configPath = option('--config', DEFAULT_CONFIG);
  const inputPath = option('--input', DEFAULT_INPUT);
  const outputPath = option('--output', DEFAULT_OUTPUT);
  const megaMekRelease = option('--megamek-release');
  const sourceRevision = option('--source-revision');
  if (!megaMekRelease || !sourceRevision) throw new Error('Pass --megamek-release and --source-revision from the MegaMek release used to make the export.');

  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (!Array.isArray(config.units) || !config.units.length) throw new Error('Supported-unit configuration contains no units.');
  const rows = parsePipeTable(await readFile(inputPath, 'utf8'));
  const rowsBySource = new Map();
  for (const row of rows) {
    const source = normaliseSource(row['File Location']);
    if (!source) continue;
    (rowsBySource.get(source) || rowsBySource.set(source, []).get(source)).push(row);
  }

  const records = {};
  const missing = [];
  for (const unit of config.units) {
    const matches = rowsBySource.get(normaliseSource(unit.source)) || [];
    if (matches.length !== 1) {
      missing.push({ id:unit.id, source:unit.source, reason:matches.length ? 'ambiguous source-file match' : 'missing source-file match' });
      continue;
    }
    const stock = Number.parseInt(matches[0].BV, 10);
    if (!Number.isInteger(stock) || stock <= 0) {
      missing.push({ id:unit.id, source:unit.source, reason:`invalid BV value ${JSON.stringify(matches[0].BV)}` });
      continue;
    }
    records[unit.id] = {
      stock_bv: stock,
      source_file: normaliseSource(unit.source),
      mul_id: matches[0]['MUL ID'] || null,
      chassis: matches[0].Chassis || null,
      model: matches[0].Model || null
    };
  }
  if (missing.length) throw new Error(`BV2 import could not verify every reviewed unit:\n${missing.map(entry => `${entry.id}: ${entry.reason} (${entry.source})`).join('\n')}`);

  const fixture = {
    schema: 'btechvtt-megamek-bv2-01',
    battle_value_system: 'BV2',
    reference_pilot: { gunnery:4, piloting:5 },
    megamek_release: megaMekRelease,
    source_revision: sourceRevision,
    generated_at: new Date().toISOString(),
    unit_count: Object.keys(records).length,
    records
  };
  await mkdir(dirname(outputPath), { recursive:true });
  await writeFile(outputPath, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`Imported ${fixture.unit_count} verified MegaMek BV2 values into ${outputPath}.`);
}

main().catch(error => { console.error(`MegaMek BV2 import failed: ${error.message}`); process.exitCode = 1; });
