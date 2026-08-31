// One-command live battle regression.
//
// Runs the real browser/Supabase battle paths in sequence:
//   node tools/run-battle-regression.mjs
//
// It starts a temporary local static server unless SHOT_URL is supplied.
// Set BT_BATTLE_SUITE=quick to skip the longer focused rules battle, or
// BT_BATTLE_SUITE=list to show exactly what would run without changing data.

import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

const root = new URL('..', import.meta.url).pathname;
const suite = process.env.BT_BATTLE_SUITE || 'full';
const port = Number(process.env.BT_TEST_PORT || 8790);
const suppliedUrl = process.env.SHOT_URL;
const baseUrl = suppliedUrl || `http://127.0.0.1:${port}/index.html`;
const steps = [
  { label: 'Static rules regression', command: 'node', args: ['test-fixes.mjs'] },
  { label: 'Two-player complete battle', command: 'node', args: ['tools/test-human-vs-human.mjs'] },
  ...(suite === 'quick' ? [] : [{ label: 'Two-player focused rules battle', command: 'node', args: ['tools/test-human-vs-human-rules.mjs'] }]),
  ...(suite === 'quick' ? [] : [{ label: 'Dragon Level 2 live acceptance', command: 'node', args: ['tools/test-dragon-level2-live.mjs'] }]),
  { label: 'Vs-AI complete battle', command: 'node', args: ['tools/test-vs-ai-fix.mjs'] }
];

function run(command, args, label) {
  return new Promise((resolve, reject) => {
    console.log(`\n=== ${label} ===`);
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, SHOT_URL: baseUrl }
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${label} exited with status ${code}`)));
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* server is still starting */ }
    await wait(200);
  }
  throw new Error(`Local battle-test server did not start at ${url}`);
}

if (suite === 'list') {
  console.log(`Battle suite (${suppliedUrl ? 'external server' : `local server on ${port}`}):`);
  steps.forEach(step => console.log(` - ${step.label}: ${step.command} ${step.args.join(' ')}`));
  process.exit(0);
}

let server = null;
try {
  if (!suppliedUrl) {
    console.log(`Starting temporary battle-test server at ${baseUrl}`);
    server = spawn('python3', ['-m', 'http.server', String(port)], { cwd: root, stdio: 'ignore' });
    await waitForServer(baseUrl);
  }
  for (const step of steps) await run(step.command, step.args, step.label);
  console.log('\nBATTLE REGRESSION PASSED');
} catch (error) {
  console.error(`\nBATTLE REGRESSION FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (server && !server.killed) server.kill('SIGTERM');
}
