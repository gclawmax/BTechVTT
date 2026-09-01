// Repeats the real two-player BattleMech regression against disposable test
// accounts. It intentionally does not run as part of every quick check.
//
// Examples:
//   BT_SOAK_RUNS=3 node tools/run-battlemech-duel-soak.mjs
//   BT_SOAK_RUNS=20 BT_SOAK_KEEP_PASSED=1 node tools/run-battlemech-duel-soak.mjs

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

const root = new URL('..', import.meta.url).pathname;
const runs = Math.max(1, Math.min(100, Number(process.env.BT_SOAK_RUNS || 3)) || 3);
const port = Number(process.env.BT_TEST_PORT || 8790);
const suppliedUrl = process.env.SHOT_URL;
const baseUrl = suppliedUrl || `http://127.0.0.1:${port}/index.html`;
const keepPassed = process.env.BT_SOAK_KEEP_PASSED === '1';
const reportDir = join(tmpdir(), 'btechvtt-duel-soak');

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
  console.log('Per iteration: two-player UI battle → focused authoritative rules → Dragon Level 2 acceptance.');
  process.exit(0);
}

let server = null;
try {
  await mkdir(reportDir, { recursive:true });
  await run('node', ['test-fixes.mjs'], {}, 'Static rules regression');
  if (!suppliedUrl) {
    server = spawn('python3', ['-m','http.server',String(port)], { cwd:root, stdio:'ignore' });
    await waitForServer(baseUrl);
  }
  for (let index = 1; index <= runs; index++) {
    const env = { BT_H2H_REPORT:join(reportDir, `human-${index}.json`), BT_FOCUSED_REPORT:join(reportDir, `focused-${index}.json`), BT_DRAGON_REPORT:join(reportDir, `dragon-${index}.json`),
      BT_SOAK_PROFILE:String(index - 1),
      ...(keepPassed ? {} : { BT_SOAK_CLEANUP:'1' }) };
    await run('node', ['tools/test-human-vs-human.mjs'], env, `Duel soak ${index}/${runs}: two-player UI battle`);
    await run('node', ['tools/test-human-vs-human-rules.mjs'], env, `Duel soak ${index}/${runs}: focused rules`);
    await run('node', ['tools/test-dragon-level2-live.mjs'], env, `Duel soak ${index}/${runs}: Dragon Level 2 acceptance`);
  }
  console.log(`\nBATTLEMECH DUEL SOAK PASSED (${runs} iteration${runs === 1 ? '' : 's'})`);
} catch (error) {
  console.error(`\nBATTLEMECH DUEL SOAK FAILED: ${error.message}`);
  console.error(`Failure reports, when available, are in ${reportDir}`);
  process.exitCode = 1;
} finally {
  if (server && !server.killed) server.kill('SIGTERM');
}
