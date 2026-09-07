// AI-7 deterministic planner tournament. It loads the production browser and
// catalogue, creates no database matches, and retains only failures plus a
// bounded set of representative local replays.

import { createRequire } from 'node:module';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

const require=createRequire(import.meta.url);
const {chromium}=require('/Users/mattperkins/.hermes/hermes-agent/node_modules/playwright');
const root=new URL('..',import.meta.url).pathname;
const runs=Math.max(1,Math.min(500,Number(process.env.BT_AI7_RUNS||12)||12));
const maxRounds=Math.max(1,Math.min(50,Number(process.env.BT_AI7_MAX_ROUNDS||12)||12));
const requestedRepresentativeLimit=Number(process.env.BT_AI7_REPRESENTATIVES??6);
const representativeLimit=Math.max(0,Math.min(30,Number.isFinite(requestedRepresentativeLimit)?requestedRepresentativeLimit:6));
const seed=String(process.env.BT_AI7_SEED||'ai7-release');
const ruleset=String(process.env.BT_AI7_RULESET||'advanced_3060');
const port=Number(process.env.BT_TEST_PORT||8790);
const suppliedUrl=process.env.SHOT_URL;
const baseUrl=suppliedUrl||`http://127.0.0.1:${port}/index.html`;
const reportDir=process.env.BT_AI7_REPORT_DIR||join(tmpdir(),'btechvtt-ai-evaluation');
const baselinePath=process.env.BT_AI7_BASELINE||null;
const user=String(process.env.BT_AI7_USER||'ai7-evaluation');
const password=String(process.env.BT_AI7_PASS||'AI7!Evaluate01');

async function waitForServer(url){
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){try{if((await fetch(url)).ok)return;}catch{/* starting */}await wait(200);}
  throw new Error(`Local AI evaluation server did not start at ${url}`);
}
function compareBaseline(current,baseline){
  if(!baseline?.summary)return null;
  const changes={};
  for(const difficulty of ['beginner','intermediate','advanced','expert']) changes[difficulty]={
    currentWinRate:current.byDifficulty?.[difficulty]?.winRate??null,
    baselineWinRate:baseline.summary.byDifficulty?.[difficulty]?.winRate??null,
    change:Number(((current.byDifficulty?.[difficulty]?.winRate||0)-(baseline.summary.byDifficulty?.[difficulty]?.winRate||0)).toFixed(1))
  };
  return {difficultyWinRates:changes,illegalActionChange:current.illegalActions-Number(baseline.summary.illegalActions||0),stallChange:current.stalls-Number(baseline.summary.stalls||0)};
}
async function activeScreen(page){return page.evaluate(()=>Array.from(document.querySelectorAll('.screen')).find(screen=>screen.classList.contains('active'))?.id||null);}
async function waitForScreen(page,id,timeout=20000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await activeScreen(page)===id)return true;await wait(250);}return false;}
async function signIn(page){
  await page.fill('#login-username',user); await page.fill('#login-password',password); await page.click('#btn-login').catch(()=>{});
  if(await waitForScreen(page,'menu-screen',12000))return;
  await page.fill('#login-username',user); await page.fill('#login-password',password); await page.click('#btn-signup').catch(()=>{});
  if(!await waitForScreen(page,'menu-screen',20000))throw new Error(`Could not sign in as the dedicated ${user} evaluation account.`);
}

if(process.env.BT_AI7_LIST==='1'){
  console.log(`AI-7 evaluation: ${runs} deterministic duel(s), maximum ${maxRounds} rounds, seed ${seed}.`);
  console.log('Coverage rotates four difficulties, six personalities, six maps, three victory conditions and seeded catalogue BattleMechs.');
  console.log(`Artifacts: ${reportDir}. No database match is created.`);
  process.exit(0);
}

let server=null,browser=null;
try{
  await mkdir(reportDir,{recursive:true});
  const replayDir=join(reportDir,'replays');
  await rm(replayDir,{recursive:true,force:true}); await mkdir(replayDir,{recursive:true});
  if(!suppliedUrl){server=spawn('python3',['-m','http.server',String(port)],{cwd:root,stdio:'ignore'});await waitForServer(baseUrl);}
  browser=await chromium.launch({headless:true,channel:'chrome',args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const browserErrors=[];
  page.on('pageerror',error=>browserErrors.push(`PAGEERROR: ${error.message}`));
  page.on('console',message=>{if(message.type()==='error')browserErrors.push(`CONSOLE: ${message.text()}`);});
  await page.goto(baseUrl,{waitUntil:'networkidle',timeout:30000});
  await signIn(page);
  const result=await page.evaluate(async options=>{
    await loadLatestUnitCatalogue();
    return runAIEvaluationTournament(options);
  },{runs,maxRounds,representativeLimit,seed,ruleset});
  const baseline=baselinePath?JSON.parse(await readFile(baselinePath,'utf8')):null;
  const artifact={generatedAt:new Date().toISOString(),build:await page.evaluate(()=>BT_BUILD_ID),source:baseUrl,config:{runs,maxRounds,representativeLimit,seed,ruleset},summary:result.summary,comparison:compareBaseline(result.summary,baseline),matches:result.matches,browserErrors};
  await writeFile(join(reportDir,'ai7-summary.json'),JSON.stringify(artifact,null,2));
  for(const [kind,matches] of [['failure',result.retention.failures],['representative',result.retention.representatives]]) for(const match of matches) {
    await writeFile(join(replayDir,`${kind}-${match.id}.json`),JSON.stringify({format:'btvtt-ai-evaluation-replay-v1',engineVersion:result.engineVersion,...match},null,2));
  }
  console.log(`AI-7 EVALUATION ${result.summary.failures?'FAILED':'PASSED'} — ${result.summary.matches} deterministic duels, ${result.eligibleUnits} eligible catalogue BattleMechs`);
  console.log(`Illegal actions ${result.summary.illegalActions} · stalls ${result.summary.stalls} · mean decision ${result.summary.meanDecisionMs} ms · maximum ${result.summary.maxDecisionMs} ms`);
  console.log(`Average ${result.summary.averageRounds} rounds · heat efficiency ${result.summary.heatEfficiency} damage/heat · unused viable weapons ${result.summary.unusedWeaponRate}%`);
  console.log(`Modes: ${Object.entries(result.summary.byVictory).map(([mode,item])=>`${mode} ${item.completed}/${item.appearances} complete, ${item.averageRounds} rounds${item.objectivePoints?`, ${item.objectivePoints} objective points`:''}`).join(' · ')}`);
  console.log(`Retained ${result.retention.failures.length} failure and ${result.retention.representatives.length} representative replay(s); discarded ${result.retention.discarded} routine replay(s).`);
  console.log(`Summary: ${join(reportDir,'ai7-summary.json')}`);
  if(browserErrors.length)console.log(`Browser errors: ${browserErrors.length}`);
  if(result.summary.failures||result.summary.illegalActions||result.summary.stalls||browserErrors.length)process.exitCode=1;
}catch(error){
  console.error(`AI-7 EVALUATION FAILED: ${error.message}`); process.exitCode=1;
}finally{
  if(browser)await browser.close(); if(server&&!server.killed)server.kill('SIGTERM');
}
