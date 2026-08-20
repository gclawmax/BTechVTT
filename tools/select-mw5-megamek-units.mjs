#!/usr/bin/env node
// Resolve the supplied MW5 chassis/variant wishlist against a local MegaMek
// checkout. This creates a reviewable allowlist; it never marks a unit
// playable until build-megamek-content-pack.mjs can validate its equipment.

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

const DEFAULT_LIST = 'tools/Claude/Latest Claude Notes/mw5_mech_list.txt';
const DEFAULT_SOURCE = 'local-data/megamek-mm-data';
const DEFAULT_OUTPUT = 'local-data/mw5-skirmish-import-candidates.json';
const DEFAULT_VERSION = 'megamek-2026-08-mw5-compatible-01';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function normalise(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function mtfFiles(directory, collected = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await mtfFiles(path, collected);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mtf')) collected.push(path);
  }
  return collected;
}

function requestedNames(text) {
  return text.replace(/\r/g, '').split('\n').map(line => line.trim()).filter(line =>
    line && !line.startsWith('#') && !/^(MechWarrior|Source:|Total |Distinct |Format:)/.test(line)
  );
}

async function main() {
  const listPath = option('--list', DEFAULT_LIST);
  const source = option('--source', DEFAULT_SOURCE);
  const output = option('--output', DEFAULT_OUTPUT);
  const catalogueVersion = option('--catalogue-version', DEFAULT_VERSION);
  const names = requestedNames(await readFile(listPath, 'utf8'));
  const files = await mtfFiles(source);
  const byName = new Map();
  for (const file of files) {
    const key = normalise(file.split('/').pop().replace(/\.mtf$/i, ''));
    const entries = byName.get(key) || [];
    entries.push(file);
    byName.set(key, entries);
  }
  const matches = [], unresolved = [];
  for (const name of names) {
    const candidates = byName.get(normalise(name)) || [];
    if (candidates.length === 1) matches.push({ id: slug(name), requested: name, source: relative(source, candidates[0]) });
    else unresolved.push({ requested: name, reason: candidates.length ? 'ambiguous' : 'not_found', candidates: candidates.map(file => relative(source, file)) });
  }
  const report = {
    catalogue_version: catalogueVersion,
    source_list: listPath,
    source_root: source,
    requested_count: names.length,
    matched_count: matches.length,
    unresolved_count: unresolved.length,
    units: matches,
    unresolved
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Resolved ${matches.length}/${names.length} MW5 requests into ${output}. ${unresolved.length} need a manual name match.`);
  if (unresolved.length) console.log(unresolved.map(entry => `${entry.requested}: ${entry.reason}`).join('\n'));
}

main().catch(error => { console.error(`MW5 list resolution failed: ${error.message}`); process.exitCode = 1; });
