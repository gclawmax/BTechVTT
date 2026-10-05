#!/usr/bin/env bash
# CI check 3: hermetic tests (pure Node, no network/DB). When adding a
# no-network suite, append it to the list below; keep Supabase/browser suites
# in the manual live lane so CI stays deterministic (~5s). Failure detail is
# emitted as ONE GitHub annotation so it is readable without log access.
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
test-coop-match-creation.mjs
test-coop-force-initiative-contract.mjs
test-coop-force-initiative-sql.cjs
test-coop-lobby-authority-sql.mjs
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
fails=0; bad=""
for t in $suites; do
  out=$(node "$t" 2>&1); rc=$?
  v=PASS
  if [ $rc -ne 0 ]; then v="CRASH rc=$rc: $(echo "$out" | tail -1 | cut -c1-100)"; fails=$((fails+1))
  elif echo "$out" | grep -q FAIL; then v="FAILED: $(echo "$out" | grep FAIL | head -1 | cut -c1-120)"; fails=$((fails+1)); fi
  [ "$v" != PASS ] && bad="$bad$t $v;"
done
if [ $fails -ne 0 ]; then echo "::error::$fails/$(( $(echo $suites|wc -w) )) failing :: ${bad:0:1800}"; exit 1; fi
echo "all $(echo $suites | wc -w) hermetic suites green"
