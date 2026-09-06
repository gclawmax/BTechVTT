// Repeats the dedicated AI-2 live acceptance over deterministic, rotating
// catalogue forces and built-in maps. Passing fixtures are deleted; failed
// matches and their complete reports are retained.

import { spawn } from 'node:child_process';
import { mkdir, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

const root = new URL('..',import.meta.url).pathname;
const requestedRuns = Math.max(1,Math.min(100,Number(process.env.BT_AI_SOAK_RUNS || 10)) || 10);
const start = Math.max(1,Number(process.env.BT_AI_SOAK_START || 1) || 1);
const explicitProfiles = String(process.env.BT_AI_SOAK_PROFILES || '').split(',')
  .map(value => Number(value.trim())).filter(value => Number.isInteger(value) && value > 0);
const profiles = explicitProfiles.length ? [...new Set(explicitProfiles)] : Array.from({ length:requestedRuns },(_,offset) => start + offset);
const runs = profiles.length;
const port = Number(process.env.BT_TEST_PORT || 8790);
const suppliedUrl = process.env.SHOT_URL;
const baseUrl = suppliedUrl || `http://127.0.0.1:${port}/index.html`;
const reportDir = process.env.BT_AI_SOAK_REPORT_DIR || join(tmpdir(),'btechvtt-ai-weapon-soak');
const lockPath = join(tmpdir(),'btechvtt-ai-weapon-soak.lock');
const seedBase = String(process.env.BT_AI_SOAK_SEED || Date.now());
const continueAfterFailure = process.env.BT_AI_SOAK_CONTINUE !== '0';

function run(script,env,label) {
  return new Promise((resolve,reject) => {
    console.log(`\n=== ${label} ===`);
    const child = spawn('node',[script],{ cwd:root,stdio:'inherit',env:{ ...process.env,...env,SHOT_URL:baseUrl } });
    child.once('error',reject);
    child.once('exit',code => code === 0 ? resolve() : reject(new Error(`${label} exited with status ${code}`)));
  });
}
async function waitForServer(url) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* starting */ }
    await wait(200);
  }
  throw new Error(`Local AI test server did not start at ${url}`);
}

if (process.env.BT_AI_SOAK_LIST === '1') {
  console.log(`AI-2 weapon soak: ${runs} Play-vs-AI activation(s), profiles ${profiles.join(', ')}, seed ${seedBase}.`);
  console.log('Each run rotates supported catalogue units and built-in maps, deletes passes, and retains failed game codes.');
  process.exit(0);
}

let server = null;
let lock = null;
try {
  try {
    lock = await open(lockPath,'wx');
    await lock.writeFile(JSON.stringify({ pid:process.pid,startedAt:new Date().toISOString(),runs,seedBase }) + '\n');
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`Another AI soak is using the disposable account (${lockPath}).`);
    throw error;
  }
  await mkdir(reportDir,{ recursive:true });
  await rm(join(reportDir,'soak-summary.json'),{ force:true });
  if (!suppliedUrl) {
    server = spawn('python3',['-m','http.server',String(port)],{ cwd:root,stdio:'ignore' });
    await waitForServer(baseUrl);
  }
  const failures = [];
  const reports = [];
  for (let offset = 0; offset < profiles.length; offset++) {
    const index = profiles[offset];
    const reportPath = join(reportDir,`ai2-${index}.json`);
    await rm(reportPath,{ force:true });
    reports.push(reportPath);
    try {
      await run('tools/test-ai-weapon-live.mjs',{
        BT_AI2_RANDOMIZE:'1',BT_AI2_PROFILE:String(index - 1),BT_AI2_SEED:`${seedBase}-${index}`,BT_AI2_REPORT:reportPath
      },`AI-2 Play-vs-AI soak profile ${index} (${offset + 1}/${runs})`);
    } catch (error) {
      failures.push({ iteration:index,message:error.message,report:reportPath });
      if (!continueAfterFailure) break;
    }
  }
  const summaryPath = join(reportDir,'soak-summary.json');
  await writeFile(summaryPath,JSON.stringify({ generatedAt:new Date().toISOString(),runs,profiles,seedBase,passed:failures.length === 0,failures,reports },null,2));
  if (failures.length) {
    console.error(`\nAI-2 PLAY-VS-AI SOAK COMPLETED WITH ${failures.length} FAILURE(S)`);
    console.error(`Summary: ${summaryPath}`);
    process.exitCode = 1;
  } else {
    console.log(`\nAI-2 PLAY-VS-AI SOAK PASSED (${runs} activation${runs === 1 ? '' : 's'})`);
    console.log(`Summary: ${summaryPath}`);
  }
} catch (error) {
  console.error(`\nAI-2 PLAY-VS-AI SOAK FAILED: ${error.message}`);
  console.error(`Reports, when available, are in ${reportDir}`);
  process.exitCode = 1;
} finally {
  if (server && !server.killed) server.kill('SIGTERM');
  if (lock) { await lock.close(); await rm(lockPath,{ force:true }); }
}
