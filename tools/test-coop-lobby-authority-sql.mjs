#!/usr/bin/env node
// Regression guard for SQL/163 (coop lobby authority completion).
// String-contract suite in the style of test-bv3-match-creation.mjs: it pins
// the client↔server function pairing that issue #13 broke (client called the
// coop hangar RPC with the wrong arity — see the live-schema audit note in
// SQL/163), keeps the non-coop deployment predicate
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

// ── client ↔ server pairing (issue #13: ARITY, not absence) ───────────────
const sql162 = await read('SQL/162_coop_lobby_authority.sql');
check('the coop lobby calls update_coop_skirmish_hangar with its FULL 5-argument signature', lobby.includes("rpcName = 'update_coop_skirmish_hangar';") && lobby.includes('p_target_seat: mySeatNumber') && lobby.includes('p_overage_confirmed: overageConfirmed'));
check('SQL/162 defines that signature (the function was never missing; the 3-arg call was the bug)', sql162.includes('CREATE OR REPLACE FUNCTION public.update_coop_skirmish_hangar(p_game_id uuid,p_target_seat int,p_hangar jsonb,p_deployed jsonb,p_overage_confirmed boolean DEFAULT false)'));
check('no file shadows the LIVE 5-arg function with a colliding overload', !sql.includes('CREATE OR REPLACE FUNCTION public.update_coop_skirmish_hangar'));
check('the soft cap stays explicit — client asks before saving over-cap forces', lobby.includes('if (!overageConfirmed) return false;'));

// ── deployment authority shape ─────────────────────────────────────────────
check('coop deploys cannot stack on a hex another seat already took (AI included)', sql.includes('already occupied') && sql.includes('jsonb_each(all_positions)'));
check('the roster-size cap and the shared zone helper survive the rewrite', sql.includes('more BattleMechs than the roster') && sql.includes('btech_coop_zone_contains'));

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
