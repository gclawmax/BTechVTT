// Repeats the real two-player BattleMech regression against disposable test
// accounts. It intentionally does not run as part of every quick check.
//
// Examples:
//   BT_SOAK_RUNS=3 node tools/run-battlemech-duel-soak.mjs
//   BT_SOAK_RUNS=20 BT_SOAK_KEEP_PASSED=1 node tools/run-battlemech-duel-soak.mjs

import { spawn } from 'node:child_process';
import { mkdir, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { setTimeout as wait } from 'node:timers/promises';

const root = new URL('..', import.meta.url).pathname;
const runs = Math.max(1, Math.min(100, Number(process.env.BT_SOAK_RUNS || 3)) || 3);
// Pick a port nobody else owns. A foreign dev server squatting the default
// 8790 once made every stage download someone else's HTML instead of the
// game ("Unexpected token '<'"), because the readiness probe only checked
// that HTTP said 200, not that the answer was BattleTech.
const isPortBusy = (candidate) => new Promise(resolve => {
  const probe = net.connect(candidate, '127.0.0.1');
  probe.setTimeout(300);
  probe.once('connect', () => { probe.destroy(); resolve(true); });
  probe.once('error', () => { probe.destroy(); resolve(false); });
  probe.once('timeout', () => { probe.destroy(); resolve(false); });
});
const suppliedUrl = process.env.SHOT_URL;
let port = Number(process.env.BT_TEST_PORT || 8790);
if (!suppliedUrl) {
  const requested = port;
  while (port < requested + 20 && await isPortBusy(port)) port++;
  if (port !== requested) console.log(`Port ${requested} is occupied by another service — running the disposable battle-test server on ${port} instead.`);
}
const baseUrl = suppliedUrl || `http://127.0.0.1:${port}/index.html`;
const keepPassed = process.env.BT_SOAK_KEEP_PASSED === '1';
const continueAfterFailure = process.env.BT_SOAK_CONTINUE === '1';
const reportDir = join(tmpdir(), 'btechvtt-duel-soak');
const lockPath = join(tmpdir(), 'btechvtt-duel-soak.lock');
const seedBase = String(process.env.BT_SOAK_SEED || Date.now());

function run(command, args, env, label) {
  return new Promise((resolve, reject) => {
    console.log(`\n=== ${label} ===`);
    const child = spawn(command, args, { cwd:root, stdio:'inherit', env:{ ...process.env, ...env, SHOT_URL:baseUrl } });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${label} exited with status ${code}`)));
  });
}
async function waitForServer(url) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* server is starting */ }
    await wait(200);
  }
  throw new Error(`Local battle-test server did not start at ${url}`);
}

if (process.env.BT_SOAK_LIST === '1') {
  console.log(`BattleMech duel soak: ${runs} iteration(s), ${keepPassed ? 'preserving' : 'removing'} passing disposable matches.`);
  console.log(`Failure handling: ${continueAfterFailure ? 'collect every iteration and write one summary' : 'stop at the first failure'}.`);
  console.log(`Seed base: ${seedBase} (reuse with BT_SOAK_SEED to reproduce a force selection).`);
  console.log('Per iteration: two-player UI battle → focused authoritative rules → Dragon Level 2 acceptance.');
  process.exit(0);
}

let server = null;
let lock = null;
try {
  try {
    lock = await open(lockPath, 'wx');
    await lock.writeFile(JSON.stringify({ pid:process.pid, startedAt:new Date().toISOString(), runs, seedBase }) + '\n');
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`Another BattleMech duel soak is already using the disposable test accounts (${lockPath}). Wait for it to finish before starting another run.`);
    throw error;
  }
  await mkdir(reportDir, { recursive:true });
  await rm(join(reportDir, 'soak-summary.json'), { force:true });
  await run('node', ['test-fixes.mjs'], {}, 'Static rules regression');
  await run('node', ['tools/test-heat-mobility-equipment-regression.mjs'], {}, 'SR-4 heat and mobility regression');
  await run('node', ['tools/test-signature-electronics-regression.mjs'], {}, 'SR-5 signature and electronics regression');
  await run('node', ['tools/test-ruleset-controls-regression.mjs'], {}, 'SR-6 ruleset controls regression');
  await run('node', ['tools/test-specialist-physical-equipment-regression.mjs'], {}, 'SR-6b specialist physical-equipment regression');
  await run('node', ['test-sr7-catalogue-audit.mjs'], {}, 'SR-7 catalogue audit regression');
  await run('node', ['tools/test-ai-foundation.mjs'], {}, 'AI-1 decision foundation regression');
  await run('node', ['tools/test-ai-weapon-planning.mjs'], {}, 'AI-2 weapon-package regression');
  await run('node', ['tools/test-ai-difficulty-personality.mjs'], {}, 'AI-6 difficulty and personality regression');
  await run('node', ['tools/test-ai-evaluation.mjs'], {}, 'AI-7 evaluation and retention regression');
  await run('node', ['tools/test-game-modes-regression.mjs'], {}, 'objective modes and minefield planning regression');
  await run('node', ['tools/test-game-modes-matrix.mjs'], {}, 'authoritative game-mode matrix regression');
  await run('node', ['tools/test-private-minefields.mjs'], {}, 'private minefield and scenario-budget regression');
  await run('node', ['tools/test-vs-ai-game-modes.mjs'], {}, 'configurable Play vs AI regression');
  if (!suppliedUrl) {
    // Node static server, not python http.server: measured A/B on this Mac
    // (7 Oct) — parallel headless loads through python lost 13-33 script
    // downloads per page load (16/16 loads incomplete); the node server served
    // 16/16 perfectly under the same load. Keeps the whole live-test layer
    // honest instead of intermittently fake-red.
    server = spawn('node', [join(root, 'tools', 'static-test-server.cjs')], { cwd:root, stdio:'ignore', env:{ ...process.env, PORT:String(port) } });
    await waitForServer(baseUrl);
  }
  // Fixture hygiene (see tools/sweep-test-fixtures.mjs): disposable matches
  // are shared across the three live stages, so cleanup happens per
  // iteration here rather than inside any stage. Failed-stage debris is
  // deliberately collectable, so this only runs when debris is NOT wanted.
  const sweep = async label => {
    if (keepPassed) return;
    try { await run('node', ['tools/sweep-test-fixtures.mjs', '--apply'], {}, label); }
    catch (error) { console.error(`Fixture sweep did not remove everything (non-fatal): ${error.message}`); }
  };
  await sweep('Fixture sweep before duel soak (leftovers from a previous run)');
  const failedStages = [];
  // Unattended nightly mode: BT_SOAK_MAP_ROTATION names maps by id; each
  // iteration takes its map from the rotation instead of the fixed 5-map
  // matrix, and BT_SOAK_PROFILE selects that entry. Lets a single-iteration
  // nightly job still cover all battlefields across successive runs.
  const rotation = (process.env.BT_SOAK_MAP_ROTATION || '').split(',').map(s => s.trim()).filter(Boolean);
  const rotationStart = Math.max(0, Number(process.env.BT_SOAK_ROTATION_START || 0) || 0);
  for (let index = 1; index <= runs; index++) {
    const rotationActive = rotation.length > 0;
    const env = { BT_H2H_REPORT:join(reportDir, `human-${index}.json`), BT_FOCUSED_REPORT:join(reportDir, `focused-${index}.json`), BT_DRAGON_REPORT:join(reportDir, `dragon-${index}.json`),
      BT_SOAK_PROFILE:rotationActive ? rotation[(rotationStart + index - 1) % rotation.length] : String(index - 1),
      BT_SOAK_SEED:`${seedBase}-${index}`,
      ...(keepPassed ? {} : { BT_SOAK_CLEANUP:'1' }) };
    // A later stage may not run after an earlier failure. Delete any report
    // left by a previous collection so the summary can never point at stale
    // Dragon/focused diagnostics.
    await Promise.all([env.BT_H2H_REPORT, env.BT_FOCUSED_REPORT, env.BT_DRAGON_REPORT].map(path => rm(path, { force:true })));
    const stages = [
      { label:'two-player UI battle', script:'tools/test-human-vs-human.mjs' },
      { label:'focused rules', script:'tools/test-human-vs-human-rules.mjs' },
      { label:'Dragon Level 2 acceptance', script:'tools/test-dragon-level2-live.mjs' }
    ];
    let iterationFailed = false;
    // Retry is ITERATION-level (7 Oct): stage 2/3 rejoin the match stage 1
    // created, and a failed attempt leaves that match half-consumed — a
    // stage-level retry then fails on contaminated state ("already has a
    // declaration") and burns the night proving nothing. Each attempt replays
    // the whole chain against a freshly created match; leftovers go to the
    // end-of-run sweep. BT_TEST_STAGE_RETRIES=1 restores single-attempt mode.
    const iterationAttempts = Math.max(1, Math.min(3, Number(process.env.BT_TEST_STAGE_RETRIES ?? 2) || 1));
    let lastError = null;
    let passed = false;
    for (let attempt = 1; attempt <= iterationAttempts && !passed; attempt++) {
      if (attempt > 1) {
        // Clear the half-used match so attempt 2 creates a clean one.
        await sweep(`Fixture sweep before retry ${attempt-1} (iteration ${index})`);
      }
      passed = true;
      for (const stage of stages) {
        try {
          await run('node', [stage.script], env, `Duel soak ${index}/${runs} (attempt ${attempt}): ${stage.label}`);
        } catch (error) {
          lastError = error;
          passed = false;
          break;
        }
      }
    }
    if (!passed) {
      iterationFailed = true;
      failedStages.push({ iteration:index, stage:stages.map(s=>s.label), message:lastError.message, reports:{ human:env.BT_H2H_REPORT, focused:env.BT_FOCUSED_REPORT, dragon:env.BT_DRAGON_REPORT } });
      console.error(`COLLECTED FAILURE: iteration ${index} after ${iterationAttempts} attempt(s) — ${lastError.message}`);
      // Sweep BEFORE bailing: a red iteration must never leak its disposable
      // matches into the live project. The stop-at-first-failure throw used to
      // jump past the end-of-iteration sweep, so every failed soak deposited
      // in-progress zombies that later runs inherited as ambient noise.
      await sweep(`Fixture sweep after iteration ${index} failure`);
      if (!continueAfterFailure) throw lastError;
    }
    // Whether stages passed or broke early, the disposable match has served
    // its purpose once the iteration ends (failure details are already in
    // the report files). Removing it here is what stops fixture accumulation.
    if (!iterationFailed) await sweep(`Fixture sweep after duel soak ${index}/${runs}`);
  }
  if (failedStages.length) {
    const summaryPath = join(reportDir, 'soak-summary.json');
    await writeFile(summaryPath, JSON.stringify({ runs, seedBase, failedStages }, null, 2));
    console.error(`\nBATTLEMECH DUEL SOAK COMPLETED WITH ${failedStages.length} FAILURE(S)`);
    console.error(`Consolidated summary: ${summaryPath}`);
    process.exitCode = 1;
  } else {
    console.log(`\nBATTLEMECH DUEL SOAK PASSED (${runs} iteration${runs === 1 ? '' : 's'})`);
  }
} catch (error) {
  console.error(`\nBATTLEMECH DUEL SOAK FAILED: ${error.message}`);
  console.error(`Failure reports, when available, are in ${reportDir}`);
  process.exitCode = 1;
} finally {
  if (server && !server.killed) server.kill('SIGTERM');
  if (lock) { await lock.close(); await rm(lockPath, { force:true }); }
}
