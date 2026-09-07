#!/usr/bin/env node
// Source regression for the Career-1b AI activation bridge. The authoritative
// movement resolver ultimately uses this scheduler to hand off unit actions.
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [sql, phases, opponent] = await Promise.all([
  readFile(new URL('SQL/136_career_ai_activation_bridge.sql', root), 'utf8'),
  readFile(new URL('js/game/phases.js', root), 'utf8'),
  readFile(new URL('js/ai/opponent.js', root), 'utf8')
]);

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) failures += 1;
}

check('the shared non-physical scheduler authorizes the active AI seat',
  sql.includes('submit_phase_state_nonphysical_core') && sql.includes('btech_authorized_ai_phase_player') && sql.includes('career1b_ai_phase_state_actor_v1'));
check('the bridge requires the prior AI authority layer and verifies installation',
  sql.includes('run SQL 126 first') && sql.includes('Career AI activation authorization was not installed'));
check('a failed AI action is reported to its scheduler',
  opponent.includes('return !decisionFailed;') && opponent.includes("const completed = await executeAIPlan(aiPlan)"));
check('a failed AI activation is not repeatedly rescheduled for the same turn',
  phases.includes('failedAiTurnKey') && phases.includes('AI activation paused after a failed action'));

if (failures) {
  console.error(`Career AI activation bridge regression failed: ${failures} check(s).`);
  process.exitCode = 1;
} else {
  console.log('Career AI activation bridge regression passed.');
}
