// Runs maintained PostgreSQL functions locally; fixture schema is not a live deployment.
const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.BT_PGLITE_MODULE||'/tmp/btech-sql-validation/node_modules/@electric-sql/pglite');
const read=n=>fs.readFileSync('SQL/'+fs.readdirSync('SQL').find(f=>f.startsWith(n+'_')&&f.endsWith('.sql')),'utf8');
function fn(n,name){const s=read(n),a=s.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'(');if(a<0)throw Error(name);const b=s.indexOf('$$;',s.indexOf('AS $$',a)+5);return s.slice(a,b+3);}
(async()=>{const db=new PGlite();try{
await db.exec(`CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
CREATE TABLE btech_games(id uuid,status text,current_phase text,current_round int,active_player_id uuid,initiative_winner uuid,catalogue_version text,state jsonb);
CREATE TABLE btech_players(id uuid,game_id uuid,user_id uuid,role text,is_ai boolean,seat_number int);
CREATE TABLE btech_catalogue_units(catalogue_version text,unit_id text,definition jsonb);
CREATE TABLE btech_catalogue_mounts(catalogue_version text,unit_id text,mount_id text,weapon_key text,raw_name text,location text);
CREATE TABLE btech_catalogue_critical_slots(catalogue_version text,unit_id text,location text,slot_index int,label text);
CREATE TABLE btech_catalogue_ammo_bins(catalogue_version text,unit_id text,bin_id text,ammo_type text);
CREATE TABLE btech_authoritative_critical_slots(unit_id text,location text,slot_index int,label text);
`);
for(const [n,names] of [[51,['btech_equipment_label_key','btech_weapon_slot_matches','btech_ammo_damage_per_shot','btech_resolve_critical_slots']],[16,['btech_critical_slot_is_damaged','btech_mark_critical_slot']],[29,['btech_apply_pilot_hit']],[62,['btech_location_has_case','btech_destroy_location_components','btech_apply_internal_damage','btech_apply_ammunition_explosion']],[67,['btech_mount_for_critical_slot','btech_weapon_mount_destroyed']],[20,['btech_consume_simultaneous_ammo']],[19,['btech_consume_selected_ammo']],[85,['declare_shutdown_override','resolve_heat_management']],[126,['btech_authorized_ai_phase_player']]])for(const name of names)await db.exec(fn(n,name));
// Label counter and pilot target are real helpers, relocated in later migrations.
await db.exec(`CREATE FUNCTION btech_critical_label_count(m jsonb,l text) RETURNS int LANGUAGE sql AS $$SELECT count(*)::int FROM btech_catalogue_critical_slots s WHERE s.catalogue_version=m->>'catalogueVersion' AND s.unit_id=m->>'unitId' AND btech_equipment_label_key(s.label)=btech_equipment_label_key(l) AND btech_critical_slot_is_damaged(m,s.location,s.slot_index)$$;`);
await db.exec(read(29).slice(0,read(29).indexOf('CREATE OR REPLACE FUNCTION public.btech_apply_pilot_hit')));
// Apply the same critical patches that 153 expects from the installed chain.
for(const n of [62,67]){const s=read(n),a=s.indexOf('DO $$'),b=s.indexOf('END $$;',a);await db.exec(s.slice(a,b+7));}
// Real shared scheduler with the existing AI actor bridge (136).
await db.exec(fn(22,'submit_phase_state').replace('public.submit_phase_state(', 'public.submit_phase_state_nonphysical_core('));
await db.exec(read(136));
// Recompute heat from the round ledger, as installed by 104.
const ledger=read(104),a=ledger.indexOf('DO $$',ledger.indexOf('END $$;')+7),b=ledger.indexOf('END $$;',a);await db.exec(ledger.slice(a,b+7));
await db.exec(read(153));await db.exec(read(153));await db.exec(read(154));await db.exec(read(154));
const base={instanceId:'m',unitId:'test',catalogueVersion:'v',owner:1,structure:{ct:100,lt:100,rt:100,la:100,ra:100},armor:{lt:30,rt:30},criticalSlotDamage:{},pilot:{hits:0,consciousness:'conscious'}};
const resolve=async(m,loc)=> (await db.query('select btech_resolve_critical_slots($1,$2,8) r',[JSON.stringify(m),loc])).rows[0].r;
await db.exec(`INSERT INTO btech_catalogue_units VALUES('v','test','{"tech_base":"Inner Sphere","heat_sink_capacity":10}');
INSERT INTO btech_catalogue_mounts VALUES('v','test','g:lt:1','gauss_rifle','Gauss Rifle','lt'),('v','test','g:rt:1','gauss_rifle','Gauss Rifle','rt');
INSERT INTO btech_catalogue_critical_slots VALUES('v','test','lt',0,'ISGaussRifle'),('v','test','lt',1,'ISGaussRifle'),('v','test','rt',0,'ISGaussRifle');`);
let hit=await resolve(base,'lt');assert.equal(hit.mech.structure.lt,80);assert.equal(hit.mech.pilot.hits,2);assert.equal(hit.mech.armor.lt,30);assert.equal(hit.events.filter(e=>e.gauss_explosion).length,1);
let twice=await resolve(hit.mech,'lt');assert.equal(twice.mech.structure.lt,80);assert.equal(twice.mech.pilot.hits,2);assert.equal(twice.events.filter(e=>e.gauss_explosion).length,0);
let second=await resolve(twice.mech,'rt');assert.equal(second.mech.structure.rt,80);assert.equal(second.events.filter(e=>e.gauss_explosion).length,1);
console.log('PASS rifle causes 20 internal damage, two pilot hits, no armour loss; each rifle explodes once independently');
// Two identical mounts in one location each have their own critical slots.
await db.exec("DELETE FROM btech_catalogue_mounts;DELETE FROM btech_catalogue_critical_slots;INSERT INTO btech_catalogue_mounts VALUES('v','test','g:lt:1','gauss_rifle','Gauss Rifle','lt'),('v','test','g:lt:2','gauss_rifle','Gauss Rifle','lt');INSERT INTO btech_catalogue_critical_slots SELECT 'v','test','lt',i,'ISGaussRifle' FROM generate_series(0,3) i");
let repeated=base,explosions=0;for(let i=0;i<4;i++){const r=await resolve(repeated,'lt');repeated=r.mech;explosions+=r.events.filter(e=>e.gauss_explosion).length;}assert.equal(explosions,2);assert.equal(repeated.structure.lt,60);assert.equal(repeated.pilot.hits,4);
console.log('PASS identical rifles sharing a location explode independently, once per mount');
await db.exec("DELETE FROM btech_catalogue_mounts;DELETE FROM btech_catalogue_critical_slots;INSERT INTO btech_catalogue_mounts VALUES('v','test','g:lt:1','gauss_rifle','Gauss Rifle','lt');INSERT INTO btech_catalogue_critical_slots VALUES('v','test','lt',0,'ISGaussRifle')");
await db.exec("INSERT INTO btech_catalogue_critical_slots VALUES('v','test','lt',2,'CASE')");
hit=await resolve({...base,structure:{...base.structure,lt:5}},'lt');assert.equal(hit.mech.structure.ct,100);assert.equal(hit.events.find(e=>e.gauss_explosion).vented_damage,15);
await db.exec("DELETE FROM btech_catalogue_critical_slots WHERE label='CASE'");hit=await resolve({...base,structure:{...base.structure,lt:5}},'lt');assert.equal(hit.mech.structure.ct,85);
console.log('PASS CASE vents excess; unprotected explosion transfers inward');
await db.exec("INSERT INTO btech_catalogue_critical_slots VALUES('v','test','lt',2,'CASE')");
const transferred=(await db.query("select btech_apply_ammunition_explosion($1,'la',20) r",[JSON.stringify({...base,structure:{...base.structure,la:3,lt:5}})])).rows[0].r;assert.equal(transferred.mech.structure.la,0);assert.equal(transferred.mech.structure.lt,0);assert.equal(transferred.mech.structure.ct,100);assert.equal(transferred.vented_damage,12);assert.equal(transferred.case_protected,true);assert.equal(transferred.mech.pilot.hits,2);
console.log('PASS side-torso CASE vents an explosion arriving from the arm, preserving centre torso');
await db.exec("DELETE FROM btech_catalogue_critical_slots;INSERT INTO btech_catalogue_critical_slots VALUES('v','test','lt',0,'IS Gauss Ammo');INSERT INTO btech_catalogue_ammo_bins VALUES('v','test','lt:0','gauss')");
for(const shots of [8,0]){const m={...base,ammoBins:[{id:'lt:0',type:'gauss',shots},{id:'rt:1',type:'gauss',shots:8}]};hit=await resolve(m,'lt');assert.equal(hit.mech.ammoBins[0].shots,0);assert.equal(hit.mech.ammoBins[0].destroyed,true);assert.equal(hit.mech.ammoBins[1].shots,8);assert.deepEqual(hit.mech.structure,base.structure);assert.equal(hit.mech.pilot.hits,0);}
const ammo={...base,ammoBins:[{id:'lt:0',type:'gauss',shots:8},{id:'rt:1',type:'gauss',shots:8}]};let fired=(await db.query("select btech_consume_simultaneous_ammo($1,$1,'gauss','lt:0') m",[JSON.stringify(ammo)])).rows[0].m;assert.equal(fired.ammoBins[0].shots,7);assert.equal(fired.ammoBins[1].shots,8);
await assert.rejects(db.query("select btech_consume_selected_ammo($1,'gauss','lt:0')",[JSON.stringify(hit.mech)]));console.log('PASS Gauss bin hit is inert, empty bins destroyed, other bin untouched; selected shot decremented; destroyed bin rejected');
const game='00000000-0000-0000-0000-000000000010',human='00000000-0000-0000-0000-000000000001',ai='00000000-0000-0000-0000-000000000002';
await db.query("select set_config('test.uid',$1,false)",[human]);await db.query("INSERT INTO btech_players VALUES($1,$2,$1,'player',false,1),($3,$2,null,'player',true,2)",[human,game,ai]);
const units=[1,2].map(owner=>({...base,instanceId:'m'+owner,owner,heat:99,roundStartingHeat:5,movementHeat:2,weaponHeat:1,externalHeat:0,hasManagedHeat:false}));
await db.query("INSERT INTO btech_games VALUES($1,'in-progress','heat',2,$2,null,'v',$3)",[game,human,JSON.stringify({vs_ai_mode:true,initiative_order:[{player_id:human},{player_id:ai}],mech_instances:units})]);
for(const seat of [1,2]){const out=(await db.query('select resolve_heat_management($1) r',[game])).rows[0].r.results;assert.equal(out.length,1);assert.equal(out[0].instance_id,'m'+seat);assert.equal(out[0].before,8);assert.equal(out[0].after,0);}
const g=(await db.query('select * from btech_games')).rows[0];assert.equal(g.current_phase,'initiative');assert.equal(g.current_round,3);await assert.rejects(db.query('select resolve_heat_management($1)',[game]));
const hot={...base,owner:1,instanceId:'hot',roundStartingHeat:0,movementHeat:0,weaponHeat:40,heat:999,hasManagedHeat:false,ammoBins:[{id:'lt:0',type:'gauss',shots:8}]};
await db.query("UPDATE btech_games SET current_phase='heat',active_player_id=$1,state=$2",[human,JSON.stringify({vs_ai_mode:true,initiative_order:[{player_id:human}],mech_instances:[hot]})]);
const hotResult=(await db.query('select resolve_heat_management($1) r',[game])).rows[0].r.results[0];assert.equal(hotResult.before,40);assert.equal(hotResult.after,30);assert.equal(hotResult.shutdown,true);assert.equal(hotResult.ammo_explosion,null);assert.equal((await db.query('select state from btech_games')).rows[0].state.mech_instances[0].ammoBins[0].shots,8);
console.log('PASS high heat applies sinks before automatic shutdown; inert Gauss ammunition survives');
await db.query("UPDATE btech_games SET current_phase='heat',active_player_id=$1,state=jsonb_set(state,'{vs_ai_mode}','false')",[ai]);await assert.rejects(db.query('select resolve_heat_management($1)',[game]));
await db.query("UPDATE btech_games SET state=jsonb_set(state,'{vs_ai_mode}','true')");await db.exec("select set_config('test.uid','00000000-0000-0000-0000-000000000099',false)");await assert.rejects(db.query('select resolve_heat_management($1)',[game]));console.log('PASS both heat seats use ledger not stale aggregate; advance to next round; duplicate, non-AI and outsider guards');
}finally{await db.close()}})().catch(e=>{console.error(e.message);process.exitCode=1});
