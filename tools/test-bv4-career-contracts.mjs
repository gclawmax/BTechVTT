#!/usr/bin/env node
// BV-4 source acceptance: Career offers use authoritative, pilot-adjusted BV
// while persistent damage cannot alter the value signed into a match.
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [sql, hq, design, roadmap, index] = await Promise.all([
  readFile(new URL('SQL/140_bv4_career_contract_bands_and_pilot_names.sql', root), 'utf8'),
  readFile(new URL('js/game/career-hq.js', root), 'utf8'),
  readFile(new URL('docs/BATTLE_VALUE_DESIGN.md', root), 'utf8'),
  readFile(new URL('docs/DEVELOPMENT_ROADMAP.md', root), 'utf8'),
  readFile(new URL('index.html', root), 'utf8')
]);
let failures = 0;
function check(label, condition) { console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`); if (!condition) failures += 1; }

check('Career force BV uses the pinned stock unit function and current pilot skills', sql.includes('btech_bv2_unit_value(row.catalogue_version,row.unit_id,row.gunnery,row.piloting)'));
check('Career force valuation ignores saved battle condition', !/btech_career_force_bv[\s\S]*?(armor|structure|critical_slot_damage|ammo_bins)[\s\S]*?END \$\$;/.test(sql.slice(0, sql.indexOf('CREATE OR REPLACE FUNCTION public.btech_career_seed_contracts'))));
check('all contract tiers advertise BV2.1 minimum and maximum values', ["'low'","'medium'","'high'","'bv_version','BV2.1'","'bv_min'","'bv_max'"].every(marker => sql.includes(marker)));
check('only unsigned available offers receive the migration backfill', sql.includes("WHERE status='available' AND NOT terms?'bv_version'"));
check('launch recalculates and authoritatively enforces the signed band', sql.includes("force_total<minimum_bv OR force_total>maximum_bv") && sql.includes("outside this contract''s BV2 band"));
check('the renamed pre-BV launcher cannot be called to bypass enforcement', sql.includes('REVOKE ALL ON FUNCTION public.btech_career_launch_contract_without_bv4(uuid) FROM PUBLIC,anon,authenticated'));
check('launch seals the force value and band into Career match state', sql.includes("'{career_context,signed_force_bv}'") && sql.includes("'{career_context,contract_bv_band}'") && sql.includes("'{force_values,1}'"));
check('pilot renaming validates identity and limits mutation to the owner', sql.includes('rename_btech_career_pilot') && sql.includes('c.user_id=auth.uid()') && sql.includes('Pilot names must be between 1 and 48 characters'));
check('Company HQ shows force BV, bands, eligibility, and pilot rename controls', ['Assigned lance','Lance Outside BV Band','renameCareerPilot','careerPilotDisplay'].every(marker => hq.includes(marker)));
check('BV-4 remains recorded as complete', design.includes('Implementation status: implemented in SQL 140') && roadmap.includes('BV-1 through BV-4'));
check('the browser build includes BV-4 or a later Career release', ['20260908-career-bv4-94','20260908-career2-growth-95','20260908-career3-regions-96'].some(build => index.includes(build)));

if (failures) { console.error(`BV-4 Career regression failed: ${failures} check(s).`); process.exitCode = 1; }
else console.log('BV-4 Career regression passed.');
