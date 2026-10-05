// Hermetic harness for SQL/164 — coop per-force initiative (throwaway PG via PGlite).
// Deliberately skips (exit 0) when no PGlite runner is installed.
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
let mod;
for (const p of ['/tmp/btech-sql-validation/node_modules/@electric-sql/pglite',
                 path.join(__dirname,'../.pgtest/node_modules/@electric-sql/pglite')]) {
  if (fs.existsSync(p)) { mod=require(p); break; }
}
if (!mod) { console.log('SKIP: no PGlite runner available'); process.exit(0); }
const {PGlite}=mod;
const dir=path.resolve(__dirname,'../SQL');
const read=n=>fs.readFileSync(path.join(dir,fs.readdirSync(dir).find(f=>f.startsWith(n+'_'))),'utf8');
(async()=>{
const db=new PGlite();
await db.exec(`CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $q$SELECT current_setting('test.uid')::uuid$q$;
CREATE TABLE btech_games(id uuid PRIMARY KEY,status text,current_round int,current_phase text,active_player_id uuid,initiative_winner uuid,state jsonb);
CREATE TABLE btech_players(id uuid,game_id uuid,user_id uuid,role text,seat_number int,is_ai boolean);
CREATE TABLE btech_initiative(game_id uuid,round int,player_id uuid,roll int,die_a smallint,die_b smallint,created_at timestamptz DEFAULT now(),UNIQUE(game_id,round,player_id));`);
await db.exec(read('09'));
await db.exec(read('164'));

const G1='00000000-0000-0000-0000-000000000010',G2='00000000-0000-0000-0000-000000000011',
      G3='00000000-0000-0000-0000-000000000012',G4='00000000-0000-0000-0000-000000000013',
      X='00000000-0000-0000-0000-000000000009';
const A='00000000-0000-0000-0000-000000000001',B='00000000-0000-0000-0000-000000000002',C='00000000-0000-0000-0000-000000000003';
const mk=(id,state)=>db.query("INSERT INTO btech_games VALUES($1,'in-progress',1,'initiative',NULL,NULL,$2::jsonb)",[id,state]);
const mkCoop=(id)=>db.query("INSERT INTO btech_players VALUES($1,$4,$1,'player',1,false),($2,$4,$2,'player',2,false),($3,$4,NULL,'player',3,true)",[A,B,C,id]);
await mk(G1,'{"coop": true}'); await mk(G2,'{"coop": true}'); await mk(G4,'{"coop": true}');
await mk(G3,'{}');
await mkCoop(G1); await mkCoop(G2); await mkCoop(G4);
await db.query("INSERT INTO btech_players VALUES($1,$4,$1,'player',1,false),($2,$4,$2,'player',2,false)",[A,B,G3]);
const uid=u=>db.query("select set_config('test.uid',$1,false)",[u]);
const roll=(g,x,y)=>db.query('select public.submit_coop_initiative_roll($1,$2::smallint,$3::smallint) as r',[g,x,y]);
const legacy=(g,x,y)=>db.query('select public.submit_initiative_roll($1,$2::smallint,$3::smallint) as r',[g,x,y]);
const st=async g=>(await db.query('select state, current_phase, active_player_id from btech_games where id=$1',[g])).rows[0];

// 1. Strangers cannot roll.
await uid(X);
await assert.rejects(roll(G1,3,4), /seated pilot/);

// 2. Explicit enemy roll present: friendly 7 vs enemy 9 resolves, seats ordered by force roll.
await db.query("INSERT INTO btech_initiative(game_id,round,player_id,roll,die_a,die_b,force_key) VALUES($1,1,$2,9,4,5,'enemy')",[G1,C]);
await uid(A);
let r=await roll(G1,3,4);
let s=await st(G1);
assert.equal(r.rows[0].r.status,'resolved');
assert.equal(s.current_phase,'movement');
assert.deepEqual(s.state.initiative_order.map(e=>e.seat_number),[1,2,3]);
assert.equal(s.state.initiative_order[2].roll,9);
assert.equal(s.active_player_id.toLowerCase(),A);

// 3. Tie clears both rolls and re-seeds; partner pilot may take the re-roll.
await db.query("INSERT INTO btech_initiative(game_id,round,player_id,roll,die_a,die_b,force_key) VALUES($1,1,$2,7,3,4,'enemy')",[G2,C]);
await uid(A);
r=await roll(G2,3,4);
assert.equal(r.rows[0].r.status,'tie');
s=await st(G2);
assert.equal(s.state.initiative_attempts,1);
assert.equal((await db.query('select count(*)::int n from btech_initiative where game_id=$1',[G2])).rows[0].n,0);
await uid(B);
r=await roll(G2,4,4);
s=await st(G2);
if (r.rows[0].r.status==='tie') assert.equal(s.state.initiative_attempts,2);
else { assert.equal(r.rows[0].r.status,'resolved'); assert.equal(s.current_phase,'movement'); }

// 4. Server auto-rolls the enemy force from a single friendly submission.
await uid(A);
r=await roll(G4,2,5);
s=await st(G4);
if (r.rows[0].r.status==='tie') { await uid(B); r=await roll(G4,5,6); s=await st(G4); }
assert.equal(r.rows[0].r.status,'resolved');
assert.equal(s.state.initiative_order.length,3);
assert.equal(s.current_phase,'movement');

// 5. Non-coop games reject the coop RPC and keep the legacy per-seat RPC byte-identical.
await uid(A);
await assert.rejects(roll(G3,3,4), /only available in coop/);
r=await legacy(G3,3,4);
assert.equal(r.rows[0].r.status,'waiting');
await uid(B);
r=await legacy(G3,2,2);
s=await st(G3);
assert.equal(r.rows[0].r.status,'resolved');
assert.equal(s.state.initiative_order.length,2);
assert.equal(s.current_phase,'movement');

console.log('PASS per-force initiative: stranger guard, explicit-enemy ordering, tie re-roll via partner, single-click auto enemy roll, coop-only gate, legacy PvP path intact');
await db.close();
})().catch(e=>{console.error('FAIL:',e.message);process.exitCode=1});
