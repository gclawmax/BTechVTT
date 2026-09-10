const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.BT_PGLITE_MODULE||'/tmp/btech-sql-validation/node_modules/@electric-sql/pglite');
const code=(c,r)=>String(c).padStart(2,'0')+String(r).padStart(2,'0');
let terrain={},levels={};
const ctx=vm.createContext({offsetToAxial:(col,row)=>({q:col-(row-(row&1))/2,r:row}),terrainAt:(c,r)=>terrain[code(c,r)]||'clear',elevationAt:(c,r)=>levels[code(c,r)]||0});
ctx.axialDistance=(ac,ar,bc,br)=>{const a=ctx.offsetToAxial(ac,ar),b=ctx.offsetToAxial(bc,br);return Math.max(Math.abs(a.q-b.q),Math.abs(ar-br),Math.abs(a.q-b.q+ar-br))};
vm.runInContext(fs.readFileSync('js/game/weapon-attack.js','utf8'),ctx);
(async()=>{const db=new PGlite();try{
await db.exec(`CREATE FUNCTION btech_state_terrain(s jsonb,c text) RETURNS text LANGUAGE sql AS $$ SELECT coalesce(s->'terrain'->>c,'clear') $$;
CREATE FUNCTION btech_state_elevation(s jsonb,c text) RETURNS int LANGUAGE sql AS $$ SELECT coalesce((s->'levels'->>c)::int,0) $$;
CREATE FUNCTION btech_hex_distance(ac int,ar int,bc int,br int) RETURNS int LANGUAGE sql AS $$ SELECT greatest(abs((ac-(ar-(ar&1))/2)-(bc-(br-(br&1))/2)),abs(ar-br),abs((ac-(ar-(ar&1))/2)-(bc-(br-(br&1))/2)+ar-br)) $$;`);
await db.exec(fs.readFileSync('SQL/149_straight_line_of_sight.sql','utf8'));
let count=0;
async function check(a,b,expected,units=[]){const js=ctx.analyseWeaponLineOfSight(a,b);const {rows}=await db.query('SELECT btech_los_analysis($1,$2,$3,$4,$5) AS result',[JSON.stringify({terrain,levels,mech_instances:[a,b,...units]}),a.col,a.row,b.col,b.row]);const sql=rows[0].result;assert.equal(!sql.blocked,js.valid);assert.equal(sql.terrain_modifier,js.terrainModifier);assert.equal(sql.partial_cover,js.partialCover);if(expected!==undefined)assert.equal(js.valid,expected);count++;return js;}
const dragon={col:9,row:9},puma={col:1,row:13};
terrain={'0709':'light_woods','0809':'heavy_woods','0909':'light_woods','0808':'light_woods','0908':'light_woods'};
const shot=await check(dragon,puma,true,[{col:8,row:9,owner:2}]);assert.equal(shot.interveningModifier,2);assert.equal(shot.hexes.map(h=>code(h.col,h.row)).join(','),'0809,0810,0710,0611,0511,0411,0412,0312,0213');console.log('Screenshot path:',shot.hexes.map(h=>code(h.col,h.row)).join(' → '));await check(puma,dragon,true);
const a={col:0,row:4},b={col:5,row:4};
terrain={'0104':'light_woods','0204':'light_woods'};await check(a,b,true);
terrain['0304']='light_woods';await check(a,b,false);
terrain={'0104':'heavy_woods','0204':'light_woods'};await check(a,b,false);
terrain={'0104':'heavy_woods'};await check(a,b,true);
terrain={'0104':'heavy_smoke','0204':'light_smoke'};await check(a,b,false);
terrain={'0004':'heavy_woods','0504':'heavy_woods'};assert.equal((await check(a,b,true)).terrainModifier,2);
terrain={};await check(a,b,true,[{col:2,row:4,owner:1},{col:3,row:4,owner:2}]);
levels={'0204':2};await check(a,b,false);levels={'0404':1};assert.equal((await check(a,b,true)).partialCover,true);levels={};
// Exact shared edge: alternatives each contain one woods hex, not two.
const e={col:0,row:0},f={col:1,row:1};terrain={'0100':'heavy_woods','0001':'heavy_woods'};assert.equal((await check(e,f,true)).interveningModifier,2);
// All directions, odd/even rows, elevations and reversal: server/browser agree.
for(let i=0;i<160;i++){terrain={};levels={};for(let j=0;j<12;j++)terrain[code((i*3+j*7)%16,(i+j*3)%17)]=j%2?'light_woods':'heavy_woods';const a={col:i%16,row:(i*3)%17},b={col:(i*7+3)%16,row:(i*11+7)%17};const x=await check(a,b),y=await check(b,a);assert.equal(x.valid,y.valid);const forward=ctx.interveningHexes(a,b,1).map(h=>code(h.col,h.row)).join(',');const reverse=ctx.interveningHexes(b,a,-1).reverse().map(h=>code(h.col,h.row)).join(',');assert.equal(forward,reverse);}
console.log(`PASS ${count} browser/server LOS cases: screenshot, woods threshold, smoke, endpoints, units, cover, shared edges and reversal.`);
}finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
