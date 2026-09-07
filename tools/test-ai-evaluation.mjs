import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const failures=[];
const check=(label,condition,detail='')=>{console.log(`${condition?'PASS':'FAIL'}  ${label}${detail?` — ${detail}`:''}`);if(!condition)failures.push(label);};
const sandbox={console}; vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT,'js/ai/evaluation.js'),'utf8'),sandbox,{filename:'js/ai/evaluation.js'});

const match=(id,{winner=1,failed=false,mapId='training-grounds',victory='annihilation',one='beginner',two='expert',onePersonality='balanced',twoPersonality='aggressive'}={})=>({
  id,winner,failed,mapId,victory,rounds:5,sides:{'1':{difficulty:one,personality:onePersonality},'2':{difficulty:two,personality:twoPersonality}},
  objectiveScores:victory==='annihilation'?{'1':0,'2':0}:{'1':3,'2':2},
  metrics:{illegalActions:failed?1:0,stalls:0,decisions:20,decisionMs:40,maxDecisionMs:4,damage:100,heatGenerated:80,heatDissipated:70,unusedViableWeapons:2,viableWeapons:20},replay:[{round:1,phase:'movement'}]
});
const matches=[
  match('one'),
  match('two',{winner:2,mapId:'ridge-and-ford',victory:'control',one:'intermediate',two:'advanced',onePersonality:'cautious',twoPersonality:'objective'}),
  match('three',{winner:0,mapId:'industrial-crossing',victory:'breakthrough',one:'advanced',two:'expert',onePersonality:'brawler',twoPersonality:'sniper'}),
  match('failure',{failed:true,mapId:'weathered-frontier'})
];
const summary=sandbox.summarizeAIEvaluation(matches);
check('AI-7 summary counts matches, failures, draws and planner violations',summary.matches===4&&summary.failures===1&&summary.draws===1&&summary.illegalActions===1,JSON.stringify(summary));
check('AI-7 summary reports decision, heat and unused-weapon efficiency',summary.meanDecisionMs===2&&summary.heatEfficiency===1.25&&summary.unusedWeaponRate===10,JSON.stringify({mean:summary.meanDecisionMs,heat:summary.heatEfficiency,unused:summary.unusedWeaponRate}));
check('AI-7 produces per-difficulty and per-personality win-rate groups',summary.byDifficulty.expert.appearances===3&&summary.byPersonality.sniper.appearances===1);
check('AI-7 reports mode completion and objective points by victory condition',summary.byVictory.control.completed===1&&summary.byVictory.control.objectivePoints===5);

const retained=sandbox.selectAIEvaluationReplays(matches,2);
check('every failed evaluation replay is retained',retained.failures.length===1&&retained.failures[0].id==='failure');
check('representative replay retention is bounded',retained.representatives.length===2&&retained.discarded===1,JSON.stringify(retained));
check('representatives cover distinct outcomes, maps or victory modes',new Set(retained.representatives.map(item=>`${item.winner}:${item.mapId}:${item.victory}`)).size===2);
const retainNone=sandbox.selectAIEvaluationReplays(matches,0);
check('routine replay retention can be disabled without dropping failures',retainNone.failures.length===1&&retainNone.representatives.length===0&&retainNone.discarded===3);

const runner=fs.readFileSync(path.join(ROOT,'tools/run-ai-evaluation.mjs'),'utf8');
const evaluation=fs.readFileSync(path.join(ROOT,'js/ai/evaluation.js'),'utf8');
check('evaluation uses production catalogue, map and AI planner code',['loadLatestUnitCatalogue','databaseSupportedUnitIds','setActiveMap','generateAIPlan'].every(marker=>(runner+evaluation).includes(marker)));
check('evaluation rotates all requested coverage dimensions',['AI_EVALUATION_DIFFICULTIES','AI_EVALUATION_PERSONALITIES','AI_EVALUATION_MAPS','AI_EVALUATION_VICTORIES'].every(marker=>evaluation.includes(marker)));
check('the AI-7 runner creates no database matches',!runner.includes("from('btech_games')")&&!runner.includes('.insert('));
check('the AI-7 runner saves only failures and bounded representatives',runner.includes("['failure',result.retention.failures]")&&runner.includes("['representative',result.retention.representatives]"));
check('optional baseline comparison reports difficulty win-rate changes',runner.includes('BT_AI7_BASELINE')&&runner.includes('difficultyWinRates'));

if(failures.length){console.error(`\n${failures.length} AI-7 evaluation regression failure(s).`);process.exitCode=1;}
else console.log('\nAI-7 evaluation and retention regression passed.');
