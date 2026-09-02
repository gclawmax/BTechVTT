-- A prone BattleMech can brace itself with its one remaining intact arm.
-- Also adds a player-authoritative, confirmed match concession.
-- Run after SQL/112_prone_battlemech_reaction.sql.

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
 IF coalesce((mech->'structure'->>p_arm)::int,0)<=0 THEN RAISE EXCEPTION 'Choose an intact supporting arm before firing while prone';END IF;
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
 IF position('prone_support_arm_damage_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  '/* complete_prone_fire_v1 */ IF prone_mod>0 AND (coalesce((attacker_start->''structure''->>''la'')::int,0)<=0 OR coalesce((attacker_start->''structure''->>''ra'')::int,0)<=0) THEN RAISE EXCEPTION ''A prone BattleMech cannot fire after either arm is destroyed'';END IF;IF prone_mod>0 AND mount_location=attacker->>''proneSupportArm'' THEN RAISE EXCEPTION ''Supporting-arm weapons cannot fire while prone'';END IF;IF prone_mod>0 AND mount_location IN (''ll'',''rl'') THEN RAISE EXCEPTION ''Leg-mounted weapons cannot fire while prone'';END IF;',
  '/* prone_support_arm_damage_v1 */ IF prone_mod>0 AND coalesce((attacker_start->''structure''->>coalesce(attacker->>''proneSupportArm'',''''))::int,0)<=0 THEN RAISE EXCEPTION ''Choose an intact supporting arm before firing while prone'';END IF;IF prone_mod>0 AND mount_location=attacker->>''proneSupportArm'' THEN RAISE EXCEPTION ''Supporting-arm weapons cannot fire while prone'';END IF;IF prone_mod>0 AND mount_location IN (''ll'',''rl'') THEN RAISE EXCEPTION ''Leg-mounted weapons cannot fire while prone'';END IF;');
 IF patched=source OR position('prone_support_arm_damage_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install prone supporting-arm damage rules';END IF;
 EXECUTE patched;
END $$;

CREATE OR REPLACE FUNCTION public.concede_btech_match(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;winner int;result jsonb;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' THEN RAISE EXCEPTION 'Only a seated player in an active game may concede';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 IF st->'match_result' IS NOT NULL AND st->'match_result'<>'null'::jsonb THEN RETURN jsonb_build_object('status','already_resolved','result',st->'match_result');END IF;
 SELECT seat_number INTO winner FROM btech_players WHERE game_id=p_game_id AND role='player' AND seat_number<>player.seat_number ORDER BY seat_number LIMIT 1;
 IF winner IS NULL THEN RAISE EXCEPTION 'A match needs an opposing player before it can be conceded';END IF;
 result:=jsonb_build_object('winner_seat',winner,'resolved_at',now(),'reason','concession','conceding_seat',player.seat_number);
 st:=jsonb_set(st,'{match_result}',result,true);
 st:=jsonb_set(st,'{active_player_player_id}','null'::jsonb,true);
 UPDATE btech_games SET current_phase='end',active_player_id=NULL,state=st WHERE id=p_game_id;
 RETURN jsonb_build_object('status','resolved','result',result);
END $$;
REVOKE ALL ON FUNCTION public.concede_btech_match(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.concede_btech_match(uuid) TO authenticated;
