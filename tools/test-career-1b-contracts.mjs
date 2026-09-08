#!/usr/bin/env node
// Career-1b source regression: contracts are server-created and only a sealed
// Career report can update the persistent company exactly once.
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [sql, hq, phases, helpers, roadmap, css] = await Promise.all([
  readFile(new URL('SQL/135_career_1b_contract_launch_and_settlement.sql', root), 'utf8'),
  readFile(new URL('js/game/career-hq.js', root), 'utf8'),
  readFile(new URL('js/game/phases.js', root), 'utf8'),
  readFile(new URL('js/core/helpers.js', root), 'utf8'),
  readFile(new URL('docs/DEVELOPMENT_ROADMAP.md', root), 'utf8'),
  readFile(new URL('css/main.css', root), 'utf8')
]);
let failures = 0;
function check(label, condition) { console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`); if (!condition) failures += 1; }

check('a deterministic three-tier AI contract board is generated server-side', ['Perimeter Security','Ridge Recon','Industrial Interdiction','btech_career_seed_contracts'].every(marker => sql.includes(marker)));
check('Career launch is an authenticated server RPC that creates a career match', sql.includes('launch_btech_career_contract') && sql.includes("'career'") && sql.includes("status='in-progress'") && sql.includes('auth.uid() IS NULL'));
check('launch maps owned BattleMechs and pilots to immutable Career match instances', sql.includes("'persistent_units'") && sql.includes('btech_career_instance') && sql.includes("m.status='operational'"));
check('Career launch creates an AI opponent and pins the catalogue', sql.includes("'vs_ai_mode',true") && sql.includes('btech_catalogue_units') && sql.includes("'catalogue_version',catalogue"));
check('contract launch does not depend on optional database extensions', !sql.includes('gen_random_bytes') && sql.includes('md5(random()::text||clock_timestamp()::text)'));
check('settlement requires the sealed Career report and rejects invalid mappings', sql.includes("btech_match_reports WHERE game_id=game.id AND match_type='career'") && sql.includes('Sealed Career battle mapping is invalid'));
check('settlement is exactly once and writes an immutable receipt', sql.includes('btech_career_settlements WHERE game_id=game.id') && sql.includes('INSERT INTO btech_career_settlements') && sql.includes('RETURN existing.receipt'));
check('settlement persists condition, ammunition, pilot injuries, credits and reputation', ['armor=coalesce(final_unit', 'ammo_bins=coalesce(final_unit', 'injuries=coalesce(final_unit', 'credits=credits+reward', 'reputation=least'].every(marker => sql.includes(marker)));
check('the browser launches contracts and requests settlement only after match end', hq.includes("db.rpc('launch_btech_career_contract'") && hq.includes("db.rpc('settle_btech_career_contract'") && phases.includes('settleCareerMatchIfNeeded'));
check('Company HQ finds and visibly resumes an active Career contract', hq.includes('getActiveCareerMatch') && hq.includes('Resume Contract') && hq.includes('resumeCareerContract'));
check('completed Career matches stay visible as settled records', helpers.includes("g.match_type === 'career'") && helpers.includes('Career result settled in Company HQ'));
check('Company HQ uses a full-width, scrollable workspace', css.includes('width:min(1500px,100%)') && css.includes('overflow:auto') && css.includes('min-height:calc(100vh - 48px)'));
check('the roadmap records Career-1b as a completed prerequisite', roadmap.includes('Career-1b adds deterministic AI contracts') && roadmap.includes('Current development priority — Career-4b PvP tender design'));

if (failures) { console.error(`Career-1b regression failed: ${failures} check(s).`); process.exitCode = 1; }
else console.log('Career-1b contract and settlement regression passed.');
