const fs=require('fs'),assert=require('node:assert/strict'),vm=require('vm');
const {PGlite}=require(process.env.BT_PGLITE_MODULE||'/tmp/btech-sql-validation/node_modules/@electric-sql/pglite');
(async()=>{const db=new PGlite();try{await db.exec(`
CREATE TABLE btech_games(id uuid,state jsonb,current_round int);
CREATE TABLE btech_players(id uuid,seat_number int);
CREATE TABLE btech_initiative(game_id uuid,round int,player_id uuid,roll int);
CREATE TABLE btech_match_telemetry(id int,game_id uuid,round int,event_index int,event_type text,payload jsonb,actor_seat int,actor_instance_id text,target_instance_id text);
CREATE TABLE btech_match_reports(game_id uuid,report jsonb);
CREATE FUNCTION btech_capture_game_state_telemetry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE new_state jsonb:=NEW.state;initiative_public jsonb;
BEGIN
SELECT coalesce(jsonb_agg(value-'player_id'-'user_id'),'[]'::jsonb) INTO initiative_public FROM jsonb_array_elements(coalesce(new_state->'initiative_rolls','[]'::jsonb)) value;
INSERT INTO btech_match_telemetry(game_id,round,event_index,event_type,payload) VALUES(NEW.id,NEW.current_round,100,'initiative_updated',jsonb_build_object('rolls',initiative_public));RETURN NEW;END $$;
`);
const stat=fs.readFileSync('SQL/101_authoritative_match_statistics.sql','utf8').split('-- Future completed matches')[0];await db.exec(stat);
const id='00000000-0000-0000-0000-000000000001';
await db.query('INSERT INTO btech_games VALUES($1,$2,5)',[id,JSON.stringify({mech_instances:[]})]);
async function event(round,index,rolls){await db.query("INSERT INTO btech_match_telemetry(game_id,round,event_index,event_type,payload) VALUES($1,$2,$3,'initiative_updated',$4)",[id,round,index,JSON.stringify({rolls})]);}
const rolls=(a,b)=>[{seat_number:1,roll:a},{seat_number:2,roll:b}];
await event(1,1,rolls(8,8));await event(1,2,rolls(10,5));await event(1,3,rolls(10,5));await event(2,4,rolls(4,9));await event(3,5,[]);await event(4,6,[{seat_number:1,roll:12}]);
await db.query('INSERT INTO btech_match_reports VALUES($1,$2)',[id,JSON.stringify({statistics:{players:{'1':{damage:42},'2':{damage:24}}}})]);
const migration=fs.readFileSync('SQL/150_initiative_win_report.sql','utf8');await db.exec(migration);await db.exec(migration);
let stats=(await db.query('SELECT btech_build_match_statistics($1) s',[id])).rows[0].s;
assert.equal(stats.players['1'].initiative_wins,1);assert.equal(stats.players['2'].initiative_wins,1);assert.equal(stats.players['1'].initiative_rounds_recorded,2);
const saved=(await db.query('SELECT report FROM btech_match_reports')).rows[0].report;assert.equal(saved.statistics.players['1'].damage,42);assert.equal(saved.statistics.players['1'].initiative_wins,1);
await db.exec('CREATE TRIGGER capture AFTER UPDATE ON btech_games FOR EACH ROW EXECUTE FUNCTION btech_capture_game_state_telemetry()');
await db.query('UPDATE btech_games SET state=$1 WHERE id=$2',[JSON.stringify({initiative_order:[{player_id:'host',seat_number:1},{player_id:'ai',seat_number:2}],initiative_rolls:[{player_id:'host',roll:4},{player_id:'ai',roll:11}],mech_instances:[]}),id]);
stats=(await db.query('SELECT btech_build_match_statistics($1) s',[id])).rows[0].s;assert.equal(stats.players['2'].initiative_wins,2);
const pub=(await db.query('SELECT payload FROM btech_match_telemetry WHERE event_index=100')).rows[0].payload;assert.equal(pub.rolls[1].seat_number,2);assert.equal(pub.rolls[1].player_id,undefined);
const ctx=vm.createContext({document:{addEventListener(){}},escapeHtml:s=>String(s).replaceAll('<','&lt;'),matchCommanderLabel:seat=>seat===1?'Dad':'Test-Sign'});vm.runInContext(fs.readFileSync('js/game/telemetry.js','utf8'),ctx);
assert.match(ctx.reportPlayerCard(1,stats.players['1']),/Dad/);assert.match(ctx.reportPlayerCard(2,stats.players['2']),/<b>2<\/b> initiative wins/);assert.match(ctx.reportPlayerCard(1,{}),/Not recorded/);
console.log('PASS resolved rounds only, ties/incomplete rolls excluded, duplicates deduplicated, AI seats preserved, old reports enriched, rerunnable migration and callsign UI.');
}finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
