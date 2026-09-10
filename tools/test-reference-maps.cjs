const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.BT_PGLITE_MODULE||'/tmp/btech-sql-validation/node_modules/@electric-sql/pglite');
const ctx=vm.createContext({escapeHtml:s=>s});vm.runInContext(fs.readFileSync('js/game/maps.js','utf8'),ctx);const maps=ctx.buildReferenceMapFamilies();
const code=(c,r)=>String(c).padStart(2,'0')+String(r).padStart(2,'0');
(async()=>{const db=new PGlite();try{
await db.exec('CREATE TABLE btech_custom_scenarios(id uuid,definition jsonb)');
for(const [file,names] of [['SQL/131_expanded_builtin_map_catalogue.sql',['btech_terrain','btech_elevation','btech_scenario_objective_hexes']],['SQL/127_game_modes_and_minefield_planning.sql',['btech_map_dimensions','btech_scenario_zone_contains']]]){
 const s=fs.readFileSync(file,'utf8');for(const name of names){const start=s.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'('),end=s.indexOf('REVOKE ALL',start);await db.exec(s.slice(start,end));}
}
const migration=fs.readFileSync('SQL/151_reference_inspired_maps.sql','utf8');await db.exec(migration);await db.exec(migration);
let hexes=0;
for(const [id,map] of Object.entries(maps)){
 assert.equal(map.columns*map.rows,map.sheet_count*272);
 for(const key of [...Object.keys(map.terrain),...Object.keys(map.elevation),...map.objective_hexes,...map.deployment_zones['1'],...map.deployment_zones['2']]){assert.match(key,/^\d{4}$/);assert.ok(+key.slice(0,2)<map.columns&&+key.slice(2)<map.rows);}
 assert.ok(Object.keys(map.terrain).length>25);assert.ok(map.deployment_zones['1'].every(k=>!map.deployment_zones['2'].includes(k)));
 const dims=(await db.query('SELECT btech_map_dimensions($1) d,btech_scenario_objective_hexes($1) o',[id])).rows[0];assert.equal(dims.d.columns,map.columns);assert.equal(dims.d.rows,map.rows);assert.equal(JSON.stringify(dims.o),JSON.stringify(map.objective_hexes));
 const {rows}=await db.query("SELECT c,r,btech_terrain($1,lpad(c::text,2,'0')||lpad(r::text,2,'0')) t,btech_elevation($1,lpad(c::text,2,'0')||lpad(r::text,2,'0')) e,btech_scenario_zone_contains(jsonb_build_object('map_id',$1::text),1,lpad(c::text,2,'0')||lpad(r::text,2,'0')) z FROM generate_series(0,$2::int-1)c CROSS JOIN generate_series(0,$3::int-1)r",[id,map.columns,map.rows]);
 for(const h of rows){const key=code(h.c,h.r);assert.equal(h.t,map.terrain[key]||'clear');assert.equal(h.e,map.elevation[key]||0);assert.equal(h.z,map.deployment_zones['1'].includes(key));hexes++;}
 // Woods, rough ground and depth-one water leave the whole board traversable.
 assert.ok(Object.values(map.terrain).every(t=>['clear','light_woods','heavy_woods','rough','shallow_water'].includes(t)));
}
assert.equal((await db.query("SELECT btech_map_dimensions('standard-dual-horizontal') d")).rows[0].d.columns,32);
console.log(`PASS ${Object.keys(maps).length} maps / ${hexes} hexes: browser/server terrain, elevation, objectives, deployment, dimensions and rerunnable migration.`);
}finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
