#!/usr/bin/env node
// Career-1a regression guard: persistent records exist, but no skirmish path
// is allowed to settle or otherwise mutate them.
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [sql, avatar, hq, index, roadmap] = await Promise.all([
  readFile(new URL('SQL/134_career_1a_persistence_and_isolation.sql', root), 'utf8'),
  readFile(new URL('js/game/career-avatar.js', root), 'utf8'),
  readFile(new URL('js/game/career-hq.js', root), 'utf8'),
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('docs/DEVELOPMENT_ROADMAP.md', root), 'utf8')
]);
let failures = 0;
function check(label, condition) { console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`); if (!condition) failures += 1; }

check('Career-1a creates every persistent record family', ['btech_career_companies','btech_career_owned_mechs','btech_career_pilots','btech_career_contracts','btech_career_ledger','btech_career_settlements'].every(name => sql.includes(`public.${name}`)));
check('Career rows are RLS protected and direct client privileges are revoked', sql.includes('ENABLE ROW LEVEL SECURITY') && sql.includes('REVOKE ALL ON public.btech_career_companies'));
check('company creation is an authenticated server RPC with pinned starter condition', sql.includes('create_btech_career_company') && sql.includes('btech_career_fresh_condition') && sql.includes('auth.uid() IS NULL'));
check('HQ data is returned through an owner-only RPC', sql.includes('get_btech_career_hq') && sql.includes('WHERE user_id=auth.uid()'));
check('future match mutations are explicitly guarded against skirmishes', sql.includes('btech_career_require_match') && sql.includes("game_match_type IS DISTINCT FROM 'career'"));
check('Career-1a does not introduce a settlement or match-end hook', !/CREATE OR REPLACE FUNCTION public\.btech_settle|resolve_btech_match_end[\s\S]*btech_career_/i.test(sql));
check('Start Career opens Company HQ and onboarding creates the persistent company', index.includes('onclick="openCareerHQ()"') && avatar.includes("db.rpc('create_btech_career_company'"));
check('Company HQ is a read-only foundation UI', hq.includes('Career-1a foundation complete') && (hq.match(/db\.rpc\(/g) || []).length === 1 && hq.includes("db.rpc('get_btech_career_hq'"));
check('the roadmap makes Career-1a the active programme', roadmap.includes('Current development priority — Career-1a'));

if (failures) { console.error(`Career-1a foundation regression failed: ${failures} check(s).`); process.exitCode = 1; }
else console.log('Career-1a foundation regression passed.');
