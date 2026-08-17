-- Server-authoritative prone weapon-fire support arm and modifiers.
-- Run after SQL/29_authoritative_pilot_injuries.sql.

CREATE OR REPLACE FUNCTION public.set_prone_weapon_support_arm(p_game_id uuid,p_instance_id text,p_arm text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;units jsonb;mech jsonb;
BEGIN
 IF p_arm NOT IN ('la','ra') THEN RAISE EXCEPTION 'Choose the left or right arm to support a prone BattleMech';END IF;
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_phase<>'weapon_attack' OR g.active_player_id IS DISTINCT FROM player.id THEN RAISE EXCEPTION 'It is not your Weapon Attack activation';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 SELECT value INTO mech FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=p_instance_id;
 IF mech IS NULL OR (mech->>'owner')::int<>player.seat_number OR NOT coalesce((mech->>'prone')::boolean,false) OR coalesce((mech->>'hasFired')::boolean,false) THEN RAISE EXCEPTION 'Choose one of your prone BattleMechs that has not fired';END IF;
 IF coalesce((mech->'structure'->>p_arm)::int,0)<=0 THEN RAISE EXCEPTION 'A destroyed arm cannot support the BattleMech';END IF;
 mech:=jsonb_set(mech,'{proneSupportArm}',to_jsonb(p_arm),true);
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_instance_id THEN mech ELSE value END) INTO units FROM jsonb_array_elements(st->'mech_instances') value;
 st:=jsonb_set(st,'{mech_instances}',units,true);
 UPDATE btech_games SET state=st WHERE id=p_game_id;
END $$;
REVOKE ALL ON FUNCTION public.set_prone_weapon_support_arm(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_prone_weapon_support_arm(uuid,text,text) TO authenticated;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Weapon declaration resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('proneSupportArm' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,'location_roll jsonb;cluster_da int;cluster_db int;missiles_hit int;missiles_remaining int;group_damage int;groups jsonb;','location_roll jsonb;cluster_da int;cluster_db int;missiles_hit int;missiles_remaining int;group_damage int;groups jsonb;prone_support_arm text;prone_mod int;target_prone_mod int;');
 patched:=replace(patched,
  E' base_tn:=4+move_mod+target_mod+woods+sensor_mod+heat_mod;validation_attacker:=attacker_start;',
  E' prone_support_arm:=attacker->>''proneSupportArm'';\n IF coalesce((attacker_start->>''prone'')::boolean,false) AND prone_support_arm NOT IN (''la'',''ra'') THEN RAISE EXCEPTION ''Choose a supporting arm before firing while prone'';END IF;\n prone_mod:=CASE WHEN coalesce((attacker_start->>''prone'')::boolean,false) THEN 2 ELSE 0 END;\n target_prone_mod:=CASE WHEN coalesce((target_start->>''prone'')::boolean,false) THEN CASE WHEN dist=1 THEN -2 ELSE 1 END ELSE 0 END;\n base_tn:=4+move_mod+target_mod+woods+sensor_mod+heat_mod+prone_mod+target_prone_mod;validation_attacker:=attacker_start;');
 patched:=replace(patched,
  E'  IF NOT FOUND OR selected_weapon_key IS NULL THEN RAISE EXCEPTION ''Unsupported weapon mount: %'',selected_mount_id;END IF;',
  E'  IF NOT FOUND OR selected_weapon_key IS NULL THEN RAISE EXCEPTION ''Unsupported weapon mount: %'',selected_mount_id;END IF;\n  IF coalesce((attacker_start->>''prone'')::boolean,false) AND mount_location=prone_support_arm THEN RAISE EXCEPTION ''A prone BattleMech cannot fire weapons from its supporting arm'';END IF;');
 IF patched=source OR position('prone_support_arm' IN patched)=0 OR position('target_prone_mod' IN patched)=0 THEN RAISE EXCEPTION 'Weapon resolver markers were not found';END IF;
 EXECUTE patched;
END $$;
