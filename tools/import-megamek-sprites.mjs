#!/usr/bin/env node
// Import individual MegaMek unit sprites into a reviewable, attributed web
// manifest. Ambiguous and atlas-only images are reported, never guessed.
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative } from 'node:path';
import { createRequire } from 'node:module';

function option(name, fallback) { const i = process.argv.indexOf(name); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback; }
function normalise(value) { return String(value).toLowerCase().replace(/\.(png|gif|jpe?g|webp)$/i, '').replace(/[^a-z0-9]/g, ''); }
async function imageFiles(directory, result = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await imageFiles(path, result);
    else if (/\.(png|gif|jpe?g|webp)$/i.test(entry.name)) result.push(path);
  }
  return result;
}

const source = option('--source', 'local-data/megamek-artwork');
const cataloguePath = option('--catalogue', 'local-data/mw5-skirmish-import-candidates.json');
const additionalCataloguePath = option('--additional-catalogue', null);
const output = option('--output', 'assets/mechs');
const sourceRelease = option('--release', 'MegaMek official release');
const overridesPath = option('--overrides', 'config/megamek-sprite-overrides.json');
const meksetPath = option('--mekset', join(source, 'mekset.txt'));
const atlasMapPath = option('--atlas-map', join(dirname(source), 'imgFileAtlasMap.yml'));
const catalogue = JSON.parse(await readFile(cataloguePath, 'utf8'));
const additionalCatalogue = additionalCataloguePath ? JSON.parse(await readFile(additionalCataloguePath, 'utf8')) : { units: [] };
const catalogueUnits = [...(catalogue.units || []), ...(additionalCatalogue.units || [])]
  .filter((unit, index, all) => all.findIndex(candidate => candidate.id === unit.id) === index);
const overrides = JSON.parse(await readFile(overridesPath, 'utf8'));
const files = await imageFiles(source);
const byName = new Map();
for (const file of files) {
  const key = normalise(basename(file));
  const matches = byName.get(key) || [];
  matches.push(file); byName.set(key, matches);
}
const spriteMap = new Map(), chassisMap = [];
try {
  const mekset = await readFile(meksetPath, 'utf8');
  for (const line of mekset.split(/\r?\n/)) {
    const match = line.match(/^\s*(exact|chassis)\s+"([^"]+)"\s+"([^"]+)"/);
    if (!match) continue;
    if (match[1] === 'exact') spriteMap.set(normalise(match[2]), match[3]);
    else chassisMap.push({ name: match[2], key: normalise(match[2]), file: match[3] });
  }
  chassisMap.sort((a, b) => b.key.length - a.key.length);
} catch {}
const atlasMap = new Map();
try {
  const yaml = await readFile(atlasMapPath, 'utf8');
  const records = [...yaml.matchAll(/originalFilePath:\s*"data\/images\/units\/([^"]+)"\s*\n\s*atlasFilePath:\s*"data\/images\/units\/([^"(]+)\((\d+),(\d+)-(\d+),(\d+)\)"/g)];
  for (const record of records) atlasMap.set(record[1].toLowerCase(), { atlas: record[2], left: Number(record[3]), top: Number(record[4]), width: Number(record[5]), height: Number(record[6]) });
} catch {}
let sharp = null;
function mappedSprite(requested) {
  const exact = spriteMap.get(normalise(requested));
  if (exact) return exact;
  return chassisMap.find(entry => normalise(requested).startsWith(entry.key))?.file || null;
}
await mkdir(output, { recursive: true });
const units = {}, unresolved = [];
for (const unit of catalogueUnits) {
  const requested = unit.requested || basename(unit.source || unit.id, extname(unit.source || ''));
  const mapped = overrides[unit.id] || mappedSprite(requested);
  const explicit = mapped ? join(source, mapped) : null;
  const candidates = explicit ? [explicit] : (byName.get(normalise(requested)) || byName.get(normalise(unit.id)) || []);
  const atlas = mapped ? atlasMap.get(mapped.toLowerCase()) : null;
  if (!atlas && candidates.length !== 1) { unresolved.push({ unit_id: unit.id, requested, reason: candidates.length ? 'ambiguous' : 'not_found' }); continue; }
  const filename = `${unit.id}.png`;
  if (atlas) {
    if (!sharp) {
      try { sharp = createRequire(import.meta.url)('sharp'); }
      catch { throw new Error('Atlas extraction requires the optional sharp package (npm install --no-save sharp).'); }
    }
    await sharp(join(source, atlas.atlas)).extract({ left: atlas.left, top: atlas.top, width: atlas.width, height: atlas.height }).png().toFile(join(output, filename));
    units[unit.id] = { file: filename, source_file: mapped, atlas_file: atlas.atlas, crop: [atlas.left, atlas.top, atlas.width, atlas.height] };
  } else {
    await copyFile(candidates[0], join(output, filename));
    units[unit.id] = { file: filename, source_file: relative(source, candidates[0]) };
  }
}
const manifest = {
  schema_version: 1, source: 'MegaMek official release unit artwork', source_repository: 'https://github.com/MegaMek/megamek',
  source_release: sourceRelease, license: 'CC-BY-NC-4.0', license_url: 'https://creativecommons.org/licenses/by-nc/4.0/',
  attribution: 'MegaMek artwork by The MegaMek Team and individual contributors', units, unresolved
};
await writeFile(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Imported ${Object.keys(units).length} sprites; ${unresolved.length} require an override or another artwork source.`);
