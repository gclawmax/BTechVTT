#!/usr/bin/env node
// Static regression guard for BV-2's server-authoritative roster contract.
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../sql/132_bv2_authoritative_roster_checks.sql', import.meta.url), 'utf8');
let failures = 0;
function check(label, condition) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) failures += 1;
}

check('published BV2 Gunnery/Piloting factors are versioned server-side',
  sql.includes('WHEN 0 THEN 2.32') && sql.includes('WHEN 4 THEN 1.00') && sql.includes('ELSE .43') && sql.includes('ELSE .70'));
check('only explicit BV2 force limits activate BV enforcement',
  sql.includes("force_limit'->>'mode','tonnage')<>'bv2'"));
check('unit resolution rejects unverified and custom designs',
  sql.includes('has no verified BV2 value') && sql.includes('Custom BattleMechs are BV pending'));
check('Hangar pilots contribute to a sealed detailed value',
  sql.includes('btech_bv2_hangar_value') && sql.includes("'pilot_multiplier'"));
check('both roster routes reject an over-cap BV force',
  sql.includes("'Roster exceeds the BV2 limit") && sql.includes("'Deployed BattleMechs exceed the BV2 limit"));
check('legacy tonnage validation remains present', sql.includes('Deployed BattleMechs exceed the dropship tonnage limit'));
check('schema privileges are restricted to authenticated callers',
  sql.includes('GRANT EXECUTE ON FUNCTION public.update_skirmish_hangar(uuid,jsonb,jsonb) TO authenticated'));

if (failures) {
  console.error(`BV-2 regression failed: ${failures} check(s).`);
  process.exitCode = 1;
} else console.log('BV-2 roster regression passed.');
