// Isolated PostgreSQL regression. Requires @electric-sql/pglite (or BT_PGLITE_MODULE).
// Uses deterministic PSR and activation fixtures; does not replace live H2H validation.
const {PGlite}=require(process.env.BT_PGLITE_MODULE || '@electric-sql/pglite'); const fs=require('fs');
const root=require('path').resolve(__dirname,'..')+'/';
(async()=>{const db=new PGlite();await db.exec(`
CREATE ROLE authenticated; CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-0000-0000-000000000001'::uuid $$;
CREATE TABLE btech_games(id uuid primary key,status text,current_phase text,current_round int,active_player_id uuid,catalogue_version text,state jsonb);
CREATE TABLE btech_players(id uuid,game_id uuid,user_id uuid,role text,seat_number int);
CREATE TABLE btech_initiative(game_id uuid,round int);
CREATE TABLE btech_catalogue_units(catalogue_version text,unit_id text,definition jsonb);
CREATE TABLE btech_catalogue_critical_slots(catalogue_version text,unit_id text,label text,location text,slot_index int);
CREATE FUNCTION btech_special_ammo_load_types(text) RETURNS text[] LANGUAGE sql AS $$ SELECT ARRAY['standard','precision'] $$;
CREATE FUNCTION btech_equipment_label_key(text) RETURNS text LANGUAGE sql AS $$ SELECT lower($1) $$;
CREATE FUNCTION btech_critical_slot_is_damaged(jsonb,text,int) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION btech_critical_movement_profile(text,jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"destroyed_legs":0,"gyro_destroyed":false}'::jsonb $$;
CREATE FUNCTION btech_resolve_displacement_psr(text,jsonb,text,int) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('mech',$2,'check',jsonb_build_object('passed',coalesce(($2->>'testPass')::boolean,true),'die_a',4,'die_b',4,'total',8,'target',5)) $$;
CREATE FUNCTION submit_phase_state_nonphysical_core(uuid,jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE before_units jsonb; b int;a int;
BEGIN
 SELECT state->'mech_instances' INTO before_units FROM btech_games WHERE id=$1;
 SELECT count(*) INTO b FROM jsonb_array_elements(before_units) WHERE NOT coalesce((value->>'hasMoved')::boolean,false);
 SELECT count(*) INTO a FROM jsonb_array_elements($2) WHERE NOT coalesce((value->>'hasMoved')::boolean,false);
 IF b-a<>1 THEN RAISE EXCEPTION 'Expected exactly one completed activation';END IF;
 UPDATE btech_games SET state=jsonb_set(state,'{mech_instances}',$2) WHERE id=$1;
END $$;
INSERT INTO btech_catalogue_units VALUES('test','testmech','{"heat_sink_capacity":22}');
INSERT INTO btech_games VALUES ('10000000-0000-0000-0000-000000000001','in-progress','heat',3,'20000000-0000-0000-0000-000000000001','test','{"mech_instances":[{"unitId":"testmech","hasManagedHeat":true,"heatDissipated":0,"heat":22,"roundStartingHeat":5,"movementHeat":2,"weaponHeat":15},{"unitId":"testmech","hasManagedHeat":true,"heatDissipated":22,"heat":0}]}');
INSERT INTO btech_players VALUES('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','player',1);
`);
let helper=fs.readFileSync(root+'SQL/96_mrm_mml_and_snub_nose_ppc.sql','utf8');helper=helper.slice(helper.indexOf('CREATE OR REPLACE FUNCTION public.btech_set_ammo_load_type'));helper=helper.slice(0,helper.indexOf('\n--',helper.indexOf('END $$;')));await db.exec(helper);
const migration=fs.readFileSync(root+'SQL/146_combat_flow_ammunition_standing_heat.sql','utf8');await db.exec(migration);await db.exec(migration);
const state=async()=> (await db.query('select state from btech_games')).rows[0].state;
let s=await state();if(s.mech_instances[0].hasManagedHeat||!s.mech_instances[1].hasManagedHeat)throw Error('Legacy heat repair incorrect');console.log('PASS migration runs twice; stale heat repaired, completed heat preserved');
await db.exec(`UPDATE btech_games SET current_phase='movement';UPDATE btech_games SET current_phase='heat';`);s=await state();if(s.mech_instances.some(m=>m.hasManagedHeat))throw Error('Phase entry reset');await db.exec(`UPDATE btech_games SET state=jsonb_set(state,'{mech_instances,0,hasManagedHeat}','true');`);if(!(await state()).mech_instances[0].hasManagedHeat)throw Error('Same phase should not reset');console.log('PASS heat reset only on phase entry');
const set=async(phase,round,units)=>db.query("UPDATE btech_games SET current_phase=$1,current_round=$2,state=jsonb_build_object('special_ammo_setup_v1',true,'mech_instances',$3::jsonb)",[phase,round,JSON.stringify(units)]);
const id='10000000-0000-0000-0000-000000000001';
await set('initiative',1,[{instanceId:'m',owner:1,ammoBins:[{id:'lt:1',type:'ac5'},{id:'lt:2',type:'ac5'}]},{instanceId:'enemy',owner:2,ammoBins:[{id:'lt:1',type:'ac5'}]}]);
await db.query('select confirm_round_one_ammunition_bin($1,$2,$3)',[id,'m:lt:1','precision']);s=await state();if(s.mech_instances[0].ammoBins[0].loadType!=='precision'||s.mech_instances[0].ammoBins[1].loadType||s.mech_instances[1].ammoBins[0].loadType)throw Error('Bin isolation');
try{await db.query('select confirm_round_one_ammunition_bin($1,$2,$3)',[id,'enemy:lt:1','standard']);throw Error('accepted enemy bin')}catch(e){if(e.message==='accepted enemy bin')throw e}console.log('PASS one physical bin changes; other bins and enemy bins protected');
for(const passed of [true,false]){
 await set('movement',3,[{instanceId:'m',unitId:'testmech',owner:1,prone:true,hasMoved:false,facing:0,testPass:passed,pilot:{consciousness:'conscious'}}]);
 await db.query('select attempt_stand_with_facing_choice($1,$2)',[id,'m']);let mech=(await state()).mech_instances[0];
 if(passed){if(mech.hasMoved||mech.standFacingPending!==3||mech.prone)throw Error('Standing activation closed early');
 try{await db.query('select confirm_stand_facing($1,$2,6)',[id,'m']);throw Error('accepted invalid facing')}catch(e){if(e.message==='accepted invalid facing')throw e}
 await db.query('select confirm_stand_facing($1,$2,4)',[id,'m']);mech=(await state()).mech_instances[0];if(!mech.hasMoved||mech.facing!==4||mech.torsoFacing!==4||mech.standFacingPending)throw Error('Facing not persisted');
 try{await db.query('select confirm_stand_facing($1,$2,2)',[id,'m']);throw Error('accepted second facing')}catch(e){if(e.message==='accepted second facing')throw e}
 }else if(!mech.hasMoved||!mech.prone||mech.standFacingPending)throw Error('Failed stand should close activation');
 console.log('PASS',passed?'successful stand waits for facing; six-facing validation and duplicate confirmation guard':'failed stand has no free facing');
}
await db.close();})().catch(e=>{console.error(e);process.exitCode=1});
