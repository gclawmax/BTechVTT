// Repeats the real two-player BattleMech regression against disposable test
// accounts. It intentionally does not run as part of every quick check.
//
// Examples:
//   BT_SOAK_RUNS=3 node tools/run-battlemech-duel-soak.mjs
//   BT_SOAK_RUNS=20 BT_SOAK_KEEP_PASSED=1 node tools/run-battlemech-duel-soak.mjs

import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

const root = new URL('..', import.meta.url).pathname;
const runs = Math.max(1, Math.min(100, Number(process.env.BT_SOAK_RUNS || 3)) || 3);
const port = Number(process.env.BT_TEST_PORT || 8790);
const suppliedUrl = process.env.SHOT_URL;
const baseUrl = suppliedUrl || `http://127.0.0.1:${port}/index.html`;
const keepPassed = process.env.BT_SOAK_KEEP_PASSED === '1';
const continueAfterFailure = process.env.BT_SOAK_CONTINUE === '1';
const reportDir = join(tmpdir(), 'btechvtt-duel-soak');
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
try {
  await mkdir(reportDir, { recursive:true });
  await rm(join(reportDir, 'soak-summary.json'), { force:true });
  await run('node', ['test-fixes.mjs'], {}, 'Static rules regression');
  await run('node', ['tools/test-heat-mobility-equipment-regression.mjs'], {}, 'SR-4 heat and mobility regression');
  await run('node', ['tools/test-signature-electronics-regression.mjs'], {}, 'SR-5 signature and electronics regression');
  await run('node', ['tools/test-ruleset-controls-regression.mjs'], {}, 'SR-6 ruleset controls regression');
  if (!suppliedUrl) {
    server = spawn('python3', ['-m','http.server',String(port)], { cwd:root, stdio:'ignore' });
    await waitForServer(baseUrl);
  }
  const failedStages = [];
  for (let index = 1; index <= runs; index++) {
    const env = { BT_H2H_REPORT:join(reportDir, `human-${index}.json`), BT_FOCUSED_REPORT:join(reportDir, `focused-${index}.json`), BT_DRAGON_REPORT:join(reportDir, `dragon-${index}.json`),
      BT_SOAK_PROFILE:String(index - 1),
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
    for (const stage of stages) {
      try {
        await run('node', [stage.script], env, `Duel soak ${index}/${runs}: ${stage.label}`);
      } catch (error) {
        failedStages.push({ iteration:index, stage:stage.label, message:error.message, reports:{ human:env.BT_H2H_REPORT, focused:env.BT_FOCUSED_REPORT, dragon:env.BT_DRAGON_REPORT } });
        console.error(`COLLECTED FAILURE: iteration ${index}, ${stage.label} — ${error.message}`);
        if (!continueAfterFailure) throw error;
        // The later stages depend on a usable match state. A failed stage
        // invalidates the remaining stages for this iteration only.
        break;
      }
    }
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
}
