import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const failures=[];
const check=(label,condition,detail='')=>{console.log(`${condition?'PASS':'FAIL'}  ${label}${detail?` — ${detail}`:''}`);if(!condition)failures.push(label);};
const sandbox={console,GRID_COLS:16,GRID_ROWS:17,currentMatchConfig:{},hexCode:(col,row)=>`${String(col).padStart(2,'0')}${String(row).padStart(2,'0')}`};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT,'js/game/maps.js'),'utf8'),sandbox,{filename:'js/game/maps.js'});

sandbox.setActiveMap('standard-dual-horizontal');
check('side-by-side boards expose all 32 columns to client rules',sandbox.GRID_COLS===32&&sandbox.GRID_ROWS===17,`${sandbox.GRID_COLS}×${sandbox.GRID_ROWS}`);
const left=sandbox.scenarioDeploymentZoneHexes(1,{map_id:'standard-dual-horizontal'}),right=sandbox.scenarioDeploymentZoneHexes(2,{map_id:'standard-dual-horizontal'});
check('default deployment zones stay on opposite five-column edges of larger maps',left.includes('0008')&&left.includes('0408')&&!left.includes('0508')&&right.includes('2708')&&right.includes('3108')&&!right.includes('2608'));
check('dual-board control objectives are distributed across the battlefield',JSON.stringify(sandbox.objectiveHexesForMap('standard-dual-horizontal'))===JSON.stringify(['0806','1508','2310']));
check('victory mode contracts describe their actual scoring thresholds',sandbox.victoryModeDetails('control').target===5&&sandbox.victoryModeDetails('breakthrough').target===2);

const sql=fs.readFileSync(path.join(ROOT,'SQL/127_game_modes_and_minefield_planning.sql'),'utf8');
check('SQL 127 teaches authoritative map bounds both dual-board dimensions',sql.includes("p_map='standard-dual-vertical'")&&sql.includes("p_map='standard-dual-horizontal'"));
check('authoritative default deployment zones derive from current map width',sql.includes('col_number>=cols-depth')&&!sql.includes('col_number>=11'));
check('minefield plans replace only the authenticated seat while preserving the opponent',sql.includes('opponent_fields||own_fields')&&sql.includes("user_id=auth.uid()")&&sql.includes("g.status<>'lobby'"));
check('minefield plans validate allowance, terrain, occupancy, bounds and duplicates',['jsonb_array_length(p_minefields)>allowance','Two minefields cannot occupy the same hex','btech_map_contains','btech_state_terrain','deployment_positions'].every(marker=>sql.includes(marker)));
check('editing a minefield plan withdraws that player readiness',sql.includes('UPDATE btech_players SET ready=false'));

const lobby=fs.readFileSync(path.join(ROOT,'js/network/lobby.js'),'utf8');
const create=fs.readFileSync(path.join(ROOT,'js/network/create-game.js'),'utf8');
const movement=fs.readFileSync(path.join(ROOT,'js/movement/rules.js'),'utf8');
const opponent=fs.readFileSync(path.join(ROOT,'js/ai/opponent.js'),'utf8');
const evaluation=fs.readFileSync(path.join(ROOT,'js/ai/evaluation.js'),'utf8');
check('lobby minefields have a visible editable plan and atomic per-seat save',['minefield-plan-row','removeLobbyMinefield','set_match_minefield_plan'].every(marker=>lobby.includes(marker)));
check('match preview and battlefield display expose objective and breakthrough areas',create.includes('map-preview-mode')&&movement.includes('P1 GOAL')&&movement.includes('P2 GOAL'));
check('AI scores progress toward both control and breakthrough goals',['aiVictoryTargets','aiVictoryProgress','objectiveProgress','breakthrough_scored_units'].every(marker=>opponent.includes(marker)));
check('AI evaluation uses two-unit objective forces and scores only after Heat',evaluation.includes('const forceSize=index%AI_EVALUATION_VICTORIES.length===0?1:2')&&evaluation.includes("phase==='heat'&&config.victory!=='annihilation'"));

if(failures.length){console.error(`\n${failures.length} game-mode regression failure(s).`);process.exitCode=1;}
else console.log('\nGame-mode and minefield-planning regression passed.');
