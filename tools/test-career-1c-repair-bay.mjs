#!/usr/bin/env node
// Career-1c source regression: the Repair Bay calculates every charge on the
// server and cannot be reached through a skirmish or an active contract.
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [sql, hq, roadmap, campaign] = await Promise.all([
  readFile(new URL('SQL/139_career_1c_repair_bay.sql', root), 'utf8'),
  readFile(new URL('js/game/career-hq.js', root), 'utf8'),
  readFile(new URL('docs/DEVELOPMENT_ROADMAP.md', root), 'utf8'),
  readFile(new URL('docs/PERSISTENT_CAMPAIGN_DESIGN.md', root), 'utf8')
]);
let failures = 0;
function check(label, condition) { console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`); if (!condition) failures += 1; }

check('service quotes compare saved condition with the pinned catalogue maximum', sql.includes('btech_career_fresh_condition(mech.catalogue_version,mech.unit_id)') && sql.includes("jsonb_each(fresh->'armor')") && sql.includes("jsonb_each(fresh->'structure')"));
check('owned BattleMech lookup assigns one complete row variable', sql.includes('SELECT m.* INTO mech FROM btech_career_owned_mechs') && !sql.includes('INTO mech,company_id'));
check('repair, structure, component and reload prices are computed server-side', ['btech_career_ammo_round_cost','btech_career_component_replacement_cost',"'armor_cost'","'structure_cost'","'component_cost'","'reload'"].every(marker => sql.includes(marker)));
check('price tables use valid searched CASE conditions for grouped equipment families', !sql.includes('SELECT CASE p_type') && !/WHEN\s+'[^']+'\s*,/.test(sql) && sql.includes("WHEN p_type IN ('lrm5'"));
check('confirmed service locks the owner company and refuses an active contract', sql.includes('FOR UPDATE') && sql.includes("status='accepted'") && sql.includes('Finish the active Career contract before servicing the hangar'));
check('destroyed BattleMechs remain recoverable wrecks', sql.includes("mech.status='destroyed'") && sql.includes('cannot be restored by the Career-1 repair bay'));
check('repair restores condition but reload does not revive a destroyed ammunition bin', sql.includes("critical_slot_damage='{}'::jsonb") && sql.includes("CASE WHEN coalesce((value->>'destroyed')::boolean,false) THEN value ELSE"));
check('every charge is written to the immutable Career ledger', ['repair_armour','repair_structure','repair_component','reload_ammo','credits=credits-cost'].every(marker => sql.includes(marker)));
check('only authenticated Career owners may invoke service RPCs', sql.includes('c.user_id=auth.uid()') && sql.includes('GRANT EXECUTE ON FUNCTION public.confirm_btech_career_service(uuid,text) TO authenticated'));
check('HQ displays server quotes and asks for confirmation before service', hq.includes('service_quote') && hq.includes('confirmCareerService') && hq.includes('window.confirm') && hq.includes("db.rpc('confirm_btech_career_service'"));
check('roadmap records Career-1c as the completed first-loop slice', roadmap.includes('Career-1c completes the initial loop') && campaign.includes('Career-1c — HQ and repair bay') && campaign.includes('Implementation status: implemented in SQL 139'));

if (failures) { console.error(`Career-1c repair-bay regression failed: ${failures} check(s).`); process.exitCode = 1; }
else console.log('Career-1c repair-bay regression passed.');
