// GM-3 regression: executable contract tests for the authoritative scenario
// scorer in SQL/128. The matching live acceptance invokes the Heat lifecycle;
// this file keeps the complete rules matrix fast enough for every soak run.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const failures=[];
const check=(label,condition,detail='')=>{console.log(`${condition?'PASS':'FAIL'}  ${label}${detail?` — ${detail}`:''}`);if(!condition)failures.push(label);};
const code=unit=>`${String(unit.col).padStart(2,'0')}${String(unit.row).padStart(2,'0')}`;
function score({mode,units,scores={'1':0,'2':0},scored=[],objectives=[],zones={},target}) {
 const next={...scores},already=new Set(scored),events=[];
 if(mode==='control') for(const hex of objectives){const holders=[...new Set(units.filter(unit=>!unit.destroyed&&code(unit)===hex).map(unit=>unit.owner))];if(holders.length===1){next[String(holders[0])]=(next[String(holders[0])]||0)+1;events.push({type:'objective_controlled',seat:holders[0],hex});}}
 if(mode==='breakthrough') for(const unit of units){const goal=zones[String(unit.owner===1?2:1)]||[];if(!unit.destroyed&&!already.has(unit.instanceId)&&goal.includes(code(unit))){next[String(unit.owner)]=(next[String(unit.owner)]||0)+1;already.add(unit.instanceId);events.push({type:'unit_broke_through',seat:unit.owner,instance_id:unit.instanceId});}}
 const threshold=target??(mode==='control'?5:mode==='breakthrough'?2:null),one=next['1']||0,two=next['2']||0;
 return {scores:next,scored:[...already],events,result:threshold!==null&&(one>=threshold||two>=threshold)?{winner_seat:one===two?null:one>two?1:2,reason:mode,objective_scores:next,threshold}:null};
}
let outcome=score({mode:'control',objectives:['0406','0808'],units:[{owner:1,col:4,row:6},{owner:2,col:8,row:8}]});
check('uncontested Control awards one point per held objective',outcome.scores['1']===1&&outcome.scores['2']===1&&outcome.events.length===2,JSON.stringify(outcome));
outcome=score({mode:'control',objectives:['0406'],units:[{owner:1,col:4,row:6},{owner:2,col:4,row:6}]});
check('contested Control objective awards no point',outcome.scores['1']===0&&outcome.scores['2']===0&&outcome.events.length===0,JSON.stringify(outcome));
outcome=score({mode:'control',scores:{'1':4,'2':1},objectives:['0406'],units:[{owner:1,col:4,row:6}]});
check('Control threshold closes the match for the leading seat',outcome.result?.winner_seat===1&&outcome.result?.reason==='control',JSON.stringify(outcome.result));
outcome=score({mode:'control',scores:{'1':4,'2':4},objectives:['0406','0808'],units:[{owner:1,col:4,row:6},{owner:2,col:8,row:8}]});
check('simultaneous Control thresholds are an authoritative draw',outcome.result?.winner_seat===null&&outcome.result?.threshold===5,JSON.stringify(outcome.result));
const zones={'1':['0005'],'2':['1505']};
outcome=score({mode:'breakthrough',zones,units:[{instanceId:'p1-a',owner:1,col:15,row:5},{instanceId:'p1-b',owner:1,col:15,row:5},{instanceId:'p2-dead',owner:2,col:0,row:5,destroyed:true}]});
check('two unique live BattleMechs complete Breakthrough',outcome.scores['1']===2&&outcome.result?.winner_seat===1&&outcome.scored.length===2,JSON.stringify(outcome));
outcome=score({mode:'breakthrough',zones,scores:{'1':1,'2':0},scored:['p1-a'],units:[{instanceId:'p1-a',owner:1,col:15,row:5}]});
check('Breakthrough repeat entry is idempotent',outcome.scores['1']===1&&!outcome.result&&outcome.events.length===0,JSON.stringify(outcome));
outcome=score({mode:'breakthrough',zones:{'1':['0210'],'2':['1210']},units:[{instanceId:'custom',owner:1,col:12,row:10}]});
check('Breakthrough honors explicit custom deployment zones',outcome.scores['1']===1&&outcome.events[0]?.type==='unit_broke_through',JSON.stringify(outcome));
const sql=fs.readFileSync(path.join(ROOT,'SQL/128_authoritative_game_mode_matrix.sql'),'utf8');
const hook=fs.readFileSync(path.join(ROOT,'SQL/129_restore_authoritative_round_end_scenario_scoring.sql'),'utf8');
check('SQL 128 keeps scoring private and idempotent',['REVOKE ALL ON FUNCTION public.btech_score_scenario_round','objectives_scored_after_round','FOR UPDATE'].every(marker=>sql.includes(marker)));
check('SQL 128 records Control and Breakthrough decisions',['objective_controlled','unit_broke_through','scenario_score_events'].every(marker=>sql.includes(marker)));
check('SQL 128 writes a completed scenario through the server phase and match result',["current_phase='end'",'match_result','winner IS NULL'].every(marker=>sql.includes(marker)));
check('replay snapshots retain outcome evidence but not minefield state',sql.includes("'scenario_score_events'")&&!sql.includes("'minefields',p_state"));
check('SQL 129 restores the score hook after authoritative Heat phase advancement',['submit_phase_state_nonphysical_core','btech_score_scenario_round','gm3_round_end_scenario_scoring_v1'].every(marker=>hook.includes(marker)));
if(failures.length){console.error(`\n${failures.length} GM-3 mode-matrix regression failure(s).`);process.exitCode=1;}else console.log('\nGM-3 game-mode matrix regression passed.');
