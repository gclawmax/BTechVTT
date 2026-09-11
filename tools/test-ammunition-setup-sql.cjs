const {PGlite}=require('/tmp/btech-sql-validation/node_modules/@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const dir=path.resolve(__dirname,'../SQL');const read=n=>fs.readFileSync(path.join(dir,fs.readdirSync(dir).find(f=>f.startsWith(n+'_'))),'utf8');
const fn=(n,name)=>{const s=read(n),a=s.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'('),b=s.indexOf('$$;',s.indexOf('AS $$',a));return s.slice(a,b+3)};
(async()=>{const db=new PGlite();await db.exec(`CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT current_setting('test.uid')::uuid$$;
CREATE TABLE btech_games(id uuid PRIMARY KEY,status text,current_round int,current_phase text,active_player_id uuid,initiative_winner uuid,state jsonb);
CREATE TABLE btech_players(id uuid,game_id uuid,user_id uuid,role text,seat_number int,is_ai boolean);
CREATE TABLE btech_initiative(game_id uuid,round int,player_id uuid,roll int,die_a smallint,die_b smallint,created_at timestamptz DEFAULT now(),UNIQUE(game_id,round,player_id));`);
await db.exec(fn(96,'btech_special_ammo_load_types'));await db.exec(fn(96,'btech_set_ammo_load_type'));await db.exec(fn(98,'submit_initiative_roll'));await db.exec(read(155));await db.exec(read(155));
const g='00000000-0000-0000-0000-000000000010',a='00000000-0000-0000-0000-000000000001',b='00000000-0000-0000-0000-000000000002';
const bins=[{id:'lt:1',type:'srm6',shots:15,maxShots:15},{id:'lt:2',type:'srm6',shots:15,maxShots:15,loadType:null}];
await db.query("select set_config('test.uid',$1,false)",[a]);await db.query("INSERT INTO btech_games VALUES($1,'in-progress',1,'initiative',null,null,$2)",[g,JSON.stringify({special_ammo_setup_v1:true,mech_instances:[{instanceId:'m',owner:1,ammoBins:bins},{instanceId:'n',owner:2,ammoBins:[{...bins[0]}]}]})]);await db.query("INSERT INTO btech_players VALUES($1,$3,$1,'player',1,false),($2,$3,$2,'player',2,false)",[a,b,g]);
const confirm=(key)=>db.query("select confirm_round_one_ammunition_bin($1,$2,'standard')",[g,key]);const roll=()=>db.query('select submit_initiative_roll($1,1::smallint,2::smallint)',[g]);const state=async()=>(await db.query('select state from btech_games')).rows[0].state;
await assert.rejects(roll(),/Confirm every/);await confirm('m:lt:1');let s=await state();assert.equal(s.mech_instances[0].ammoBins[0].loadType,'standard');assert.equal(s.mech_instances[0].ammoBins[1].loadType,null);assert.equal(s.mech_instances[1].ammoBins[0].loadType,undefined);await assert.rejects(roll(),/Confirm every/);await assert.rejects(confirm('n:lt:1'));await assert.rejects(confirm('m:lt:1'),/already confirmed/);
// Recreate the reported legacy lock with a prematurely saved roll.
await db.query('INSERT INTO btech_initiative(game_id,round,player_id,roll) VALUES($1,1,$2,3)',[g,a]);await confirm('m:lt:2');assert.equal((await db.query('select count(*)::int n from btech_initiative')).rows[0].n,0);assert.equal((await state()).ammunition_setup_recovered,true);await assert.rejects(roll(),/Confirm every/);
await db.query("select set_config('test.uid',$1,false)",[b]);await confirm('n:lt:1');assert.equal((await roll()).rows[0].submit_initiative_roll.status,'waiting');await db.query("UPDATE btech_games SET current_phase='movement'");await assert.rejects(confirm('m:lt:1'),/only during/);
console.log('PASS individual bins, null load, both-side initiative gate, ownership, duplicate, early-roll recovery and phase guard; migration rerunnable');await db.close();})().catch(e=>{console.error(e);process.exitCode=1});
