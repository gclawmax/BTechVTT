#!/usr/bin/env node
// Hermetic string-contract guard for SQL/164 (coop per-force initiative,
// issue #21 ruling). Pins the client<->server pairing that must not drift:
// coop matches call the 3-arg coop RPC (NOT the per-seat RPC), coop markers
// survive the state rebuild, and force-mode button gating exists. Run with
// the pSQL suite in tools/ (scratch) for behavioural coverage.
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const [sql164, phases, indexHtml, ciScript] = await Promise.all([
  read('SQL/164_coop_force_initiative.sql'),
  read('js/game/phases.js'),
  read('index.html'),
  read('tools/ci-hermetic-tests.sh')
]);
let failures = 0;
function check(label, condition) { console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`); if (!condition) failures += 1; }

// server contract
check('SQL/164 defines the coop RPC with the exact 3-argument signature',
  sql164.includes('submit_coop_initiative_roll(\n  p_game_id uuid,\n  p_die_a smallint,\n  p_die_b smallint\n)'));
check('the coop RPC is revoked from PUBLIC and granted to authenticated only',
  /REVOKE ALL ON FUNCTION public\.submit_coop_initiative_roll/.test(sql164)
  && /GRANT EXECUTE ON FUNCTION public\.submit_coop_initiative_roll\(uuid, smallint, smallint\) TO authenticated/.test(sql164));
check('the coop-only gate uses NULL-safe logic (jsonb_typeof(NULL) must not open the gate)',
  sql164.includes("COALESCE(jsonb_typeof(v_state->'coop'->'force_of_seat'),'null') <> 'object'"));
check('one roll per force is enforced by the partial unique index',
  sql164.includes('ON public.btech_initiative (game_id, round, force_key)') && sql164.includes('WHERE force_key IS NOT NULL'));
check('the legacy per-seat RPC is untouched by SQL/164',
  !sql164.includes('CREATE OR REPLACE FUNCTION public.submit_initiative_roll'));

// client contract
const coopCall = phases.indexOf("db.rpc('submit_coop_initiative_roll'");
const legacyCall = phases.indexOf("db.rpc('submit_initiative_roll'");
check('coop matches route to submit_coop_initiative_roll with its FULL 3-argument payload',
  coopCall !== -1 && phases.slice(coopCall, coopCall + 260).includes('p_game_id')
  && phases.slice(coopCall, coopCall + 260).includes('p_die_a') && phases.slice(coopCall, coopCall + 260).includes('p_die_b'));
check('the coop branch runs BEFORE the per-seat branch (coop never double-submits per seat)',
  coopCall !== -1 && coopCall < legacyCall && phases.indexOf('coopPhaseMode(currentGameState)\n      && (vsAiMode ? isHost : mySeatNumber != null))') !== -1);
check('coop detection does NOT depend on lobby.js load order (own coopPhaseMode helper)',
  phases.includes('function coopPhaseMode(state)') && !phases.includes("typeof isCoopSkirmish === 'function' && isCoopSkirmish(currentGameState)"));
check('the rebuilt snapshot carries match_type and coop so the branch survives rebuild',
  phases.includes("match_type: gameState.match_type || null,") && phases.includes('coop: gameState.coop ?? null,'));
check('force-mode button gating exists and is force-aware',
  phases.includes('function forceRollSubmittedThisRound()') && phases.includes('coopPhaseMode(currentGameState)\n    ? forceRollSubmittedThisRound()'));

// cache-buster discipline (CI check 2 would catch drift; pin the intent here)
check('phases.js cache stamp was bumped for the per-force change',
  indexHtml.includes('phases.js?v=coop-1b-force-init'));
check('the string-contract suite is registered in CI',
  ciScript.includes('test-coop-force-initiative-contract.mjs'));

if (failures) { console.error(`${failures} contract check(s) FAILED`); process.exitCode = 1; }
else console.log('coop per-force initiative contracts intact');
