-- Complete Total Warfare prone BattleMech weapon-fire restrictions.
-- Run after SQL/63_complete_common_terrain.sql.

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
 IF coalesce((mech->'structure'->>'la')::int,0)<=0 OR coalesce((mech->'structure'->>'ra')::int,0)<=0 THEN RAISE EXCEPTION 'A prone BattleMech cannot fire after either arm is destroyed';END IF;
 mech:=jsonb_set(mech,'{proneSupportArm}',to_jsonb(p_arm),true);
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_instance_id THEN mech ELSE value END) INTO units FROM jsonb_array_elements(st->'mech_instances') value;
 UPDATE btech_games SET state=jsonb_set(st,'{mech_instances}',units,true) WHERE id=p_game_id;
END $$;
REVOKE ALL ON FUNCTION public.set_prone_weapon_support_arm(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_prone_weapon_support_arm(uuid,text,text) TO authenticated;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Weapon resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('complete_prone_fire_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  'IF prone_mod>0 AND mount_location=attacker->>''proneSupportArm'' THEN RAISE EXCEPTION ''Supporting-arm weapons cannot fire while prone'';END IF;',
  '/* complete_prone_fire_v1 */ IF prone_mod>0 AND (coalesce((attacker_start->''structure''->>''la'')::int,0)<=0 OR coalesce((attacker_start->''structure''->>''ra'')::int,0)<=0) THEN RAISE EXCEPTION ''A prone BattleMech cannot fire after either arm is destroyed'';END IF;IF prone_mod>0 AND mount_location=attacker->>''proneSupportArm'' THEN RAISE EXCEPTION ''Supporting-arm weapons cannot fire while prone'';END IF;IF prone_mod>0 AND mount_location IN (''ll'',''rl'') THEN RAISE EXCEPTION ''Leg-mounted weapons cannot fire while prone'';END IF;');
 IF patched=source OR position('complete_prone_fire_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install complete prone-fire restrictions';END IF;
 EXECUTE patched;
END $$;
