#!/usr/bin/env node
// Regression guard for SQL/163 (coop lobby authority completion).
// String-contract suite in the style of test-bv3-match-creation.mjs: it pins
// the client↔server function pairing that issue #13 broke (client called an
// RPC no migration defined), keeps the non-coop deployment predicate
// byte-identical to SQL/79, and pins the coop zone rule to FORCE (team model)
// instead of the historical per-seat column rule (issue #14).
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const [sql, lobby, mapsJs, teamModel, ciScript] = await Promise.all([
  read('SQL/163_coop_lobby_authority_completion.sql'),
  read('js/network/lobby.js'),
  read('js/game/maps.js'),
  read('js/game/team-model.js'),
  read('tools/ci-hermetic-tests.sh')
]);
let failures = 0;
function check(label, condition) { console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`); if (!condition) failures += 1; }

// ── client ↔ server pairing (issue #13) ───────────────────────────────────
check('the coop lobby still calls update_coop_skirmish_hangar', lobby.includes("db.rpc(isCoopSkirmish(state) ? 'update_coop_skirmish_hangar' : 'update_skirmish_hangar'"));
check('SQL/163 now DEFINES update_coop_skirmish_hangar (PGRST202 closure)', sql.includes('CREATE OR REPLACE FUNCTION public.update_coop_skirmish_hangar(p_game_id uuid,p_hangar jsonb,p_deployed jsonb)'));
check('the new RPC is revoked from PUBLIC, granted to authenticated, and schema-reloaded', sql.includes('REVOKE ALL ON FUNCTION public.update_coop_skirmish_hangar(uuid,jsonb,jsonb) FROM PUBLIC;') && sql.includes('GRANT EXECUTE ON FUNCTION public.update_coop_skirmish_hangar(uuid,jsonb,jsonb) TO authenticated;') && sql.includes("NOTIFY pgrst,'reload schema';"));

// ── hangar authority shape ─────────────────────────────────────────────────
check('coop hangar writes lock a Readied seat and exclude the AI seat', sql.includes("IF player.ready THEN RAISE EXCEPTION 'A Readied seat is locked until the pilot un-readies';END IF;") && sql.includes('IF NOT FOUND OR player.seat_number NOT IN (1,2) THEN RAISE EXCEPTION'));
check('coop hangar keeps unit legality gates (catalogue support + ruleset)', sql.includes('unsupported, archived, or another player') && sql.includes("btech_ruleset_unit_allowed(g.catalogue_version,item->>'unit_id',ruleset)"));
check('rosters are rebuilt from DEPLOYED entries in order (not the whole hangar)', sql.includes('jsonb_agg(sel.unit_id ORDER BY sel.ord)'));

// ── deployment zones per FORCE (issue #14) ─────────────────────────────────
check('coop deployment is rejected unless the hex is inside the CALLER FORCE zone', sql.includes('NOT btech_coop_zone_contains(st,player.seat_number,lpad((e->>\'col\')::text,2,\'0\')||lpad((e->>\'row\')::text,2,\'0\'))'));
check('the legacy per-seat predicate survives untouched for non-coop games', sql.includes('(player.seat_number=1 AND (e->>\'col\')::int>4) OR (player.seat_number=2 AND (e->>\'col\')::int<11)'));
check('a corrupt team assignment refuses rather than guessing a side', sql.includes('refusing to guess') && sql.includes('refusing to infer a side'));
check('default coop strips mirror js/game/maps.js (depth 5, force-keyed)', sql.includes('depth:=least(5,cols);') && mapsJs.includes('const depth = Math.min(5, dimensions.cols);') && sql.includes("p_state->'deployment_zones'->force_key"));
check('team model remains the single seat→force interpretation (client parity)', teamModel.includes('forceOfSeat') && sql.includes('team_assignments'));

// ── wiring ─────────────────────────────────────────────────────────────────
check('this suite runs in CI', ciScript.includes('test-coop-lobby-authority-sql.mjs'));
check('deployment writer keeps its grants after the rewrite', sql.includes('GRANT EXECUTE ON FUNCTION public.set_match_deployment(uuid,jsonb) TO authenticated;'));

if (failures) { console.error(`Coop lobby authority SQL failed: ${failures} checks failing`); process.exit(1); }
console.log('coop lobby authority SQL green');
