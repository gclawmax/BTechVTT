-- Corrects SQL/55's early DFA implementation. Run this after SQL/55.
-- DFA is declared in Movement from a jump staging hex, not selected as an
-- ordinary Physical Attack. This migration makes the old direct declaration
-- unavailable and adds the authoritative Movement declaration ledger.

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_physical_declaration(uuid,text,integer,jsonb,text,text,text,text[],boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Physical attack resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('p_attack_type NOT IN (''punch'',''kick'',''hatchet'',''dfa'')' IN source)=0 THEN RETURN;END IF;
 patched:=replace(source,E'p_attack_type NOT IN (''punch'',''kick'',''hatchet'',''dfa'')',E'p_attack_type NOT IN (''punch'',''kick'',''hatchet'')');
 patched:=replace(patched,E'Choose punch, kick, hatchet, Death From Above, or pass',E'Choose punch, kick, hatchet, or pass');
 IF patched=source THEN RAISE EXCEPTION 'Could not disable the obsolete direct DFA declaration';END IF;
 EXECUTE patched;
END $$;

CREATE OR REPLACE FUNCTION public.declare_death_from_above(
 p_game_id uuid,p_attacker_instance_id text,p_target_instance_id text,
 p_staging_col int,p_staging_row int,p_staging_facing int
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;units jsonb;attacker jsonb;target jsonb;
 definition jsonb;mp_max int;heat_penalty int;target_distance int;staging_distance int;heat int;source_level int;target_level int;height_required int;
BEGIN
 IF p_staging_col NOT BETWEEN 0 AND 15 OR p_staging_row NOT BETWEEN 0 AND 11 OR p_staging_facing NOT BETWEEN 0 AND 5 THEN RAISE EXCEPTION 'DFA staging position is outside the battlefield';END IF;
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_phase<>'movement' OR g.active_player_id IS DISTINCT FROM player.id THEN RAISE EXCEPTION 'It is not your Movement activation';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 SELECT value INTO attacker FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=p_attacker_instance_id;
 SELECT value INTO target FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=p_target_instance_id;
 IF attacker IS NULL OR (attacker->>'owner')::int<>player.seat_number OR coalesce((attacker->>'hasMoved')::boolean,false) OR coalesce((attacker->>'destroyed')::boolean,false) OR coalesce((attacker->>'prone')::boolean,false) OR coalesce((attacker->>'shutdown')::boolean,false) OR coalesce(attacker->'pilot'->>'consciousness','conscious')<>'conscious' THEN RAISE EXCEPTION 'Attacker is not eligible to declare Death From Above';END IF;
 IF target IS NULL OR (target->>'owner')::int=(attacker->>'owner')::int OR NOT coalesce((target->>'hasMoved')::boolean,false) OR coalesce((target->>'destroyed')::boolean,false) OR target ? 'dfaDeclaration' THEN RAISE EXCEPTION 'Choose an enemy that has completed movement and is not already committed to a special attack';END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(st->'mech_instances') unit WHERE unit->>'instanceId'<>p_attacker_instance_id AND (unit->>'col')::int=p_staging_col AND (unit->>'row')::int=p_staging_row AND NOT coalesce((unit->>'destroyed')::boolean,false)) THEN RAISE EXCEPTION 'DFA staging hex is occupied';END IF;
 IF btech_hex_distance(p_staging_col,p_staging_row,(target->>'col')::int,(target->>'row')::int)<>1 THEN RAISE EXCEPTION 'DFA staging hex must be one hex short of the target';END IF;
 SELECT definition INTO definition FROM btech_catalogue_units WHERE catalogue_version=g.catalogue_version AND unit_id=attacker->>'unitId';
 IF definition IS NULL THEN RAISE EXCEPTION 'BattleMech is missing from the pinned catalogue';END IF;
 heat_penalty:=CASE WHEN coalesce((attacker->>'roundStartingHeat')::int,coalesce((attacker->>'heat')::int,0))>=25 THEN 4 WHEN coalesce((attacker->>'roundStartingHeat')::int,coalesce((attacker->>'heat')::int,0))>=20 THEN 3 WHEN coalesce((attacker->>'roundStartingHeat')::int,coalesce((attacker->>'heat')::int,0))>=15 THEN 2 WHEN coalesce((attacker->>'roundStartingHeat')::int,coalesce((attacker->>'heat')::int,0))>=10 THEN 1 ELSE 0 END;
 mp_max:=greatest(0,coalesce((definition->'movement'->>'jump')::int,0)-heat_penalty);target_distance:=btech_hex_distance((attacker->>'col')::int,(attacker->>'row')::int,(target->>'col')::int,(target->>'row')::int);staging_distance:=btech_hex_distance((attacker->>'col')::int,(attacker->>'row')::int,p_staging_col,p_staging_row);
 source_level:=btech_elevation(coalesce(st->>'map_id','training-grounds'),lpad(attacker->>'col',2,'0')||lpad(attacker->>'row',2,'0'));target_level:=btech_elevation(coalesce(st->>'map_id','training-grounds'),lpad(target->>'col',2,'0')||lpad(target->>'row',2,'0'));height_required:=greatest(0,target_level+CASE WHEN coalesce((target->>'prone')::boolean,false) THEN 1 ELSE 2 END-source_level);
 IF btech_terrain(coalesce(st->>'map_id','training-grounds'),lpad(target->>'col',2,'0')||lpad(target->>'row',2,'0'))='impassable' THEN RAISE EXCEPTION 'The target hex is prohibited terrain for a DFA landing';END IF;
 IF mp_max<=0 OR target_distance>mp_max OR height_required>mp_max THEN RAISE EXCEPTION 'This BattleMech lacks the Jumping MP to enter and clear the target hex';END IF;
 heat:=coalesce((attacker->>'roundStartingHeat')::int,0)+3+coalesce((attacker->>'weaponHeat')::int,0)+coalesce((attacker->>'externalHeat')::int,0);
 attacker:=jsonb_set(attacker,'{col}',to_jsonb(p_staging_col),true);attacker:=jsonb_set(attacker,'{row}',to_jsonb(p_staging_row),true);attacker:=jsonb_set(attacker,'{facing}',to_jsonb(p_staging_facing),true);attacker:=jsonb_set(attacker,'{torsoFacing}',to_jsonb(p_staging_facing),true);
 attacker:=jsonb_set(attacker,'{movementMode}','"jump"'::jsonb,true);attacker:=jsonb_set(attacker,'{mpUsed}',to_jsonb(target_distance),true);attacker:=jsonb_set(attacker,'{hexesMoved}',to_jsonb(staging_distance),true);attacker:=jsonb_set(attacker,'{hasMoved}','true'::jsonb,true);attacker:=jsonb_set(attacker,'{movementHeat}','3'::jsonb,true);attacker:=jsonb_set(attacker,'{heat}',to_jsonb(heat),true);
 attacker:=jsonb_set(attacker,'{dfaDeclaration}',jsonb_build_object('target_instance_id',p_target_instance_id,'target_col',(target->>'col')::int,'target_row',(target->>'row')::int,'staging_col',p_staging_col,'staging_row',p_staging_row,'staging_facing',p_staging_facing,'target_mp',target_distance),true);
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_attacker_instance_id THEN attacker ELSE value END) INTO units FROM jsonb_array_elements(st->'mech_instances') value;
 PERFORM submit_phase_state_nonphysical_core(p_game_id,units);
 RETURN jsonb_build_object('status','declared','attacker_instance_id',p_attacker_instance_id,'target_instance_id',p_target_instance_id,'target_mp',target_distance,'staging_hex',lpad(p_staging_col::text,2,'0')||lpad(p_staging_row::text,2,'0'));
END $$;
REVOKE ALL ON FUNCTION public.declare_death_from_above(uuid,text,text,int,int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.declare_death_from_above(uuid,text,text,int,int,int) TO authenticated;
