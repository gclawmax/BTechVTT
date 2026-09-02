#!/usr/bin/env node
// Fast guardrails for SR-1 Rotary AC support. This is deliberately local: it
// catches accidental changes to the profiles, fire-rate limits and jam table
// before the live two-player suite is run against Supabase.

import { readFile } from 'node:fs/promises';

const failures = [];
function check(label, condition) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) failures.push(label);
}

const sql = await readFile(new URL('../SQL/115_rotary_autocannon_fire_modes.sql', import.meta.url), 'utf8');
const client = await readFile(new URL('../js/game/weapon-attack.js', import.meta.url), 'utf8');
const importer = await readFile(new URL('./build-megamek-content-pack.mjs', import.meta.url), 'utf8');

const expectedProfiles = {
  rac2: [2, 1, '6, 12, 18', 45],
  rac5: [5, 1, '5, 10, 15', 20],
  rac10: [10, 3, '4, 8, 12', 10],
  rac20: [20, 7, '3, 6, 9', 5]
};
for (const [key, [damage, heat, range, shots]] of Object.entries(expectedProfiles)) {
  check(`${key} profile is imported with the correct damage, heat and ammunition`,
    new RegExp(`key: '${key}', damage: ${damage}, heat: ${heat}, range: \\[${range}\\], ammoType: '${key}'`).test(importer) &&
    importer.includes(`'${key}', ${shots}`));
}
check('the client offers every legal Rotary AC firing rate',
  client.includes("['1', '2', '3', '4', '5', '6']") && client.includes('[1,2,3,4,5,6]'));
check('the client requires one ammunition round and heat point per selected shot',
  client.includes('weaponShotsForMode') && client.includes('heat * weaponShotsForMode'));
check('the server accepts only one to six Rotary AC shots',
  sql.includes("mode NOT IN ('1','2','3','4','5','6')"));
check('the server consumes every declared Rotary AC round before resolution',
  sql.includes('FOR i IN 1..rac_shots LOOP validation_attacker') && sql.includes('FOR i IN 1..rac_shots LOOP attacker:=btech_consume_simultaneous_ammo'));
check('the server uses the correct 2/3/4 jam thresholds for 2–6 shot bursts',
  sql.includes("rac_shots IN (2,3) THEN 2 WHEN rac_shots IN (4,5) THEN 3 WHEN rac_shots=6 THEN 4"));
check('the server keeps a Rotary AC jam on the mount and reports it in the result',
  sql.includes("'{weaponJams}'") && sql.includes("'rotary_shots'"));
check('a declared jam-clear attempt is restricted to standing still or walking',
  sql.includes('declare_rotary_autocannon_clear') && sql.includes("requires standing still or walking"));
check('multi-shot Rotary AC bursts use the Cluster Hits Table',
  sql.includes('cluster_size:=rac_shots;damage_per_missile:=weapon_damage'));

if (failures.length) {
  console.error(`\n${failures.length} Rotary AC regression failure(s).`);
  process.exit(1);
}
console.log('\nRotary AC regression checks passed.');
