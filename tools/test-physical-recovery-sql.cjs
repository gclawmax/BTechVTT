// Isolated PostgreSQL test; deterministic damage/PSR fixtures exercise phase completion.
const {PGlite}=require(process.env.BT_PGLITE_MODULE || '@electric-sql/pglite');const fs=require('fs');
(async()=>{const db=new PGlite();await db.exec(`
CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT '00000000-0000-0000-0000-000000000001'::uuid$$;
CREATE TABLE btech_games(id uuid primary key,status text,current_phase text,current_round int,active_player_id uuid,catalogue_version text,state jsonb);
CREATE TABLE btech_players(id uuid,game_id uuid,user_id uuid,role text,seat_number int);
CREATE TABLE btech_combat_events(id uuid primary key,game_id uuid,round int,phase text,status text,sequence int,attacker_instance_id text,target_instance_id text,declaration jsonb,resolution jsonb,resolved_at timestamptz);
CREATE TABLE btech_catalogue_critical_slots(catalogue_version text,unit_id text,label text,location text,slot_index int);
CREATE TABLE btech_catalogue_mounts(catalogue_version text,unit_id text,mount_id text,location text);
CREATE FUNCTION btech_physical_weapon_profile(text) RETURNS jsonb LANGUAGE sql AS $$SELECT null::jsonb$$;
CREATE FUNCTION btech_hex_distance(int,int,int,int) RETURNS int LANGUAGE sql AS $$SELECT abs($1-$3)+abs($2-$4)$$;
CREATE FUNCTION btech_direction_to(int,int,int,int) RETURNS int LANGUAGE sql AS $$SELECT 0$$;
CREATE FUNCTION btech_elevation(text,text) RETURNS int LANGUAGE sql AS $$SELECT 0$$;
CREATE FUNCTION btech_physical_component_damaged(text,jsonb,text,text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE FUNCTION btech_process_physical_declaration(uuid,text,int,jsonb,text,text,text,text[],boolean) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('state',jsonb_set($4,'{damageApplied}',to_jsonb(coalesce(($4->>'damageApplied')::int,0)+5),true),'results',jsonb_build_array(jsonb_build_object('hit',true,'damage',5)))$$;
CREATE FUNCTION btech_resolve_physical_piloting_checks(uuid,text,int,jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('state',$4,'checks','[{"passed":true}]'::jsonb)$$;
INSERT INTO btech_games VALUES('10000000-0000-0000-0000-000000000001','in-progress','physical_attack',14,'20000000-0000-0000-0000-000000000001','test','{}');
INSERT INTO btech_players VALUES('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','player',1);
`);const migration=fs.readFileSync(require('path').resolve(__dirname,'../SQL/147_physical_phase_recovery.sql'),'utf8');await db.exec(migration);await db.exec(migration);
const id='10000000-0000-0000-0000-000000000001';const state=async()=>(await db.query('select * from btech_games')).rows[0];
const units=[{instanceId:'a',unitId:'test',owner:1,col:0,row:0,facing:0,structure:{ll:10,rl:10},hasPhysicalAttacked:false,physicalPhaseStart:{round:13,mech:{instanceId:'a',owner:1,col:1,row:1,facing:0,structure:{ll:10,rl:10}}}},{instanceId:'b',unitId:'test',owner:2,col:8,row:8,facing:3,structure:{ll:10,rl:10},hasPhysicalAttacked:false,physicalPhaseStart:{round:13,mech:{instanceId:'b',owner:2,col:2,row:1,facing:3,structure:{ll:10,rl:10}}}}];
const set=async(u)=>db.query("update btech_games set current_phase='physical_attack',state=$1",[JSON.stringify({mech_instances:u,initiative_order:[{player_id:'20000000-0000-0000-0000-000000000001',seat_number:1}]})]);
await set(units);await db.query('select recover_stalled_physical_phase($1)',[id]);let g=await state();if(g.current_phase!=='heat'||g.state.mech_instances.some(m=>m.physicalPhaseStart||!m.hasPhysicalAttacked||m.hasManagedHeat))throw Error('Stale snapshot recovery');console.log('PASS previous-round adjacency does not lock an empty current phase');
const adjacent=JSON.parse(JSON.stringify(units));adjacent[1].col=1;adjacent[1].row=0;await set(adjacent);let r=await db.query('select recover_stalled_physical_phase($1) as result',[id]);if(r.rows[0].result.status!=='actions_remaining'||(await state()).current_phase!=='physical_attack')throw Error('Skipped legal actions');console.log('PASS recovery refuses to skip legal undeclared actions');
adjacent.forEach(m=>{m.hasPhysicalAttacked=true;m.physicalPhaseStart={round:14,mech:{...m,physicalPhaseStart:undefined}}});await set(adjacent);
await db.query("insert into btech_combat_events values('30000000-0000-0000-0000-000000000001',$1,14,'physical_attack','declared',1,'a','b','{\"attack_type\":\"kick\",\"limbs\":[\"ll\"]}',null,null)",[id]);
await db.query('select skip_empty_physical_phase($1)',[id]);g=await state();const ev=(await db.query('select * from btech_combat_events')).rows[0];if(g.current_phase!=='heat'||g.state.damageApplied!==5||ev.status!=='resolved'||!ev.resolution.piloting_checks)throw Error('Kick dropped');await db.query('select recover_stalled_physical_phase($1)',[id]);if((await state()).state.damageApplied!==5)throw Error('Double resolution');console.log('PASS empty-phase check resolves the submitted kick and piloting checks exactly once');
try{await db.query("select recover_stalled_physical_phase('99999999-0000-0000-0000-000000000001')");throw Error('Unauthorized recovery accepted')}catch(e){if(e.message==='Unauthorized recovery accepted')throw e}console.log('PASS nonparticipant recovery denied');await db.close();})().catch(e=>{console.error(e);process.exitCode=1});
