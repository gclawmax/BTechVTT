// Hermetic calibration suite for the physical-phase visibility predicate
// (tools/physical-contract.mjs). Guards the false-C3 class found on
// BT-CWWV: the v1 cross-message regex judged REAL result lines invisible,
// which would have masked any evidence claim built on the rig.
//
// Ground truth comes from two recorded runs:
//   POSITIVE lines  = actual replay-rebuilt result lines (must read visible)
//   NEGATIVE lines  = turn bookkeeping / declaration noise (must NOT match,
//                     else every battle reads "green" no matter what)
// Run: node tools/test-physical-contract-calibration.mjs
import { physicalResultLinePredicate } from './physical-contract.mjs';

const T = 'Timber Wolf / Mad Cat Prime';
const M = 'Marauder MAD-3R';

const POSITIVES = [
  [T, "Marauder MAD-3R (P2) kicked Timber Wolf / Mad Cat Prime (P1) — need 3, rolled 6 + 1 = 7: hit Right Leg for 15 damage. Critical check 4 + 1 = 5: 0 hits."],
  [T, "Timber Wolf / Mad Cat Prime (P1) kicked at Marauder MAD-3R (P2) — need 6, rolled 4 + 1 = 5: miss."],
  [M, "Timber Wolf / Mad Cat Prime (P1) kicked at Marauder MAD-3R (P2) — need 6, rolled 4 + 1 = 5: miss."],
  [T, "Timber Wolf / Mad Cat Prime (P1) failed its Piloting Skill Roll for missed kick and successful kick — need 4, rolled 1 + 2 = 3; fell front for 8 damage (Center Torso 5, Left Leg 3)."],
  [T, "Marauder MAD-3R (P2) kicked Timber Wolf / Mad Cat Prime (P1) — need 3, rolled 2 + 4 = 6: hit Center Torso for 15 damage. Critical check 6 + 1 = 7: 0 hits."],
  [T, "Orion ON1-K (P1) punched with Left Arm Timber Wolf / Mad Cat Prime (P2) — need 8, rolled 4 + 6 = 10: hit Left Torso for 8 damage."],
];

const NEGATIVES = [
  [T, "AI turn started (Physical Attack)."],
  [M, "Marauder MAD-3R (P2) (AI) submitted kick for authoritative resolution."],
  [T, "AI action failed safely: Server rejected AI physical attack: Choose an eligible enemy target"],
  [M, "Timber Wolf / Mad Cat Prime (P1) has no legal physical target — declaration completed automatically."],
  [T, "Round 4 — movement phase begins."],
  [T, "Physical Attack complete — unavailable actions cleared and submitted attacks resolved before Heat."],
];

let fails = 0;
for (const [target, line] of POSITIVES) {
  if (!physicalResultLinePredicate(target)(line)) {
    fails++;
    console.error(`FAIL (must be visible): [${target}] ${line.slice(0, 80)}`);
  }
}
for (const [target, line] of NEGATIVES) {
  if (physicalResultLinePredicate(target)(line)) {
    fails++;
    console.error(`FAIL (noise must not count as a result trace): [${target}] ${line.slice(0, 80)}`);
  }
}
if (fails) {
  console.error(`physical-contract calibration: ${fails} failure(s) — detector is blind or lie-green; do NOT trust rig C3 results.`);
  process.exit(1);
}
console.log(`physical-contract calibration OK (${POSITIVES.length} result lines visible, ${NEGATIVES.length} noise lines rejected)`);
