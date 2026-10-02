#!/usr/bin/env bash
# CI check 3: hermetic tests (pure Node, no network/DB) — 21 suites, ~2s.
# New no-network suites: append here. Supabase/browser suites stay in the
# manual live lane so CI remains deterministic.
suites="
test-advanced-direct-fire-regression.mjs
test-advanced-missiles-regression.mjs
test-ai-evaluation.mjs
test-ai-foundation.mjs
test-ai-weapon-planning.mjs
test-bv2-catalogue-import.mjs
test-bv2-roster-checks.mjs
test-bv2-skill-values.mjs
test-bv3-match-creation.mjs
test-bv4-career-contracts.mjs
test-career-ai-activation-bridge.mjs
test-game-modes-matrix.mjs
test-heat-mobility-equipment-regression.mjs
test-mechlab-case-sql.cjs
test-mechlab-construction.cjs
test-private-minefields.mjs
test-rotary-ac-regression.mjs
test-ruleset-controls-regression.mjs
test-signature-electronics-regression.mjs
test-specialist-physical-equipment-regression.mjs
test-vs-ai-game-modes.mjs
"
cd "$(dirname "$0")"
fails=0; ran=0
for t in $suites; do
  ran=$((ran+1))
  out=$(node "$t" 2>&1); rc=$?
  if [ $rc -ne 0 ]; then echo "SUITE CRASHED (rc=$rc): $t"; echo "$out" | tail -3; fails=$((fails+1)); continue; fi
  if echo "$out" | grep -q "FAIL"; then echo "SUITE FAILED: $t"; echo "$out" | grep FAIL | head -3; fails=$((fails+1)); fi
done
echo "ran $ran suites, $fails failing"
[ $fails -eq 0 ]
