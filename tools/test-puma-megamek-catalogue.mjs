#!/usr/bin/env node
// Verifies the generated Puma / Adder catalogue pack includes every local
// MegaMek record selected for this release and retains its verified BV2 value.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const packDirectory = 'SQL/138_puma_variants_catalogue.sql.parts';
const expected = new Map([
  ['adder-prime', 2083], ['puma-adder-a', 1437], ['puma-adder-b', 1422],
  ['puma-adder-c', 1372], ['puma-adder-d', 1255], ['puma-adder-e', 1272],
  ['puma-adder-h', 1453], ['puma-adder-j', 1222], ['puma-adder-tc', 1247],
  ['puma-adder-i', 1575], ['puma-adder-k', 1281], ['puma-adder-l', 1738],
  ['puma-adder-s', 1427], ['puma-adder-t', 2182]
]);

const entries = (await readdir(packDirectory)).filter(name => /^00[1-4]_of_004\.sql$/.test(name));
const source = (await Promise.all(entries.map(name => readFile(join(packDirectory, name), 'utf8')))).join('\n');
let failures = 0;
for (const [unitId, bv] of expected) {
  const unit = new RegExp(`'${unitId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'.*?\\"stock\\":${bv}`).test(source);
  const supported = new RegExp(`'${unitId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'.*?\\"supported_by_vtt\\":true`).test(source);
  if (!unit || !supported) {
    failures += 1;
    console.error(`FAIL ${unitId}: missing, wrong BV2, or not playable`);
  } else console.log(`PASS ${unitId}: BV2 ${bv}`);
}
if (failures) {
  console.error(`Puma catalogue regression failed (${failures} issue(s)).`);
  process.exitCode = 1;
} else console.log(`Puma catalogue regression passed (${expected.size} configurations).`);
