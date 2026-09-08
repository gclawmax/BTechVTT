import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../js/network/lobby.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('const BV2_SKILL_MULTIPLIERS'), source.indexOf('function bv2RosterValue')), context);
const value = (stock, gunnery, piloting) => vm.runInContext(`bv2EntryValue({battleValue:{stock:${stock}}},{gunnery:${gunnery},piloting:${piloting}})`, context);
// Independent reference examples from MegaMek's combined skill table.
for (const [g,p,expected] of [[4,5,1000],[3,4,1320],[3,5,1200],[4,4,1100],[0,0,2420],[8,8,640],[6,2,1070]]) {
 assert.equal(value(1000,g,p).adjusted,expected, `G${g}/P${p}`);
}
assert.equal(value(2737,3,4).adjusted,3613);
assert.equal(value(0,4,5),null);
assert.equal(value(1000,-1,5),null);
assert.equal(value(1000,4,9),null);
assert.equal(value(1000,3.5,5),null);
const sql = readFileSync(new URL('../SQL/144_correct_bv2_pilot_skill_table.sql', import.meta.url),'utf8');
const table = JSON.parse(sql.match(/numeric\[\]\[\] := ARRAY(\[.*\]);/)[1]);
for(let g=0;g<=8;g++) for(let p=0;p<=8;p++) assert.equal(value(1000,g,p).adjusted,Math.round(1000*table[g][p]));
console.log('PASS: reference skill examples, rounding, invalid inputs and all 81 browser/SQL combinations');
