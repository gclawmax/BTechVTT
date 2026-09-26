-- 158_ai_club_search_authority.sql
-- Run after SQL 157. Safe to rerun (CREATE OR REPLACE only; no data changes).
--
-- Live defect found by Step 0 Battle B v11 (vs-AI, game BT-M6YC, round 10):
-- the AI's legal 'find_club' action (js/ai/engine.js AI_ACTIONS_BY_PHASE:
-- weapon_attack includes 'find_club') was rejected by the LIVE
-- find_improvised_club with 'It is not your Weapon Attack activation'.
--
-- Diagnosis: SQL 126 was meant to swap the actor authorization of
-- find_improvised_club to public.btech_authorized_ai_phase_player so the AI
-- controller may spend a Weapon Attack searching for a club. The live
-- function still carries the SQL 88 human-only actor check, while the AI
-- weapon package (SQL 124) and AI physical package (SQL 126, first loop
-- positions) ARE patched live (AI weapons and physical attacks succeed).
-- SQL 126 has no explicit transaction, so its string-substitution loop can
-- partially apply: statements already EXECUTEd before a failed substitution
-- stay installed, the rest roll back. The club function sits in that gap.
--
-- Effect in play: the AI plans find_club for its Weapon Attack slot, the
-- server rejects it, the shipped AI latch fires ('AI activation paused after
-- a failed action'), the AI never fires, weapon_attack can never close and
-- the match deadlocks for a human opponent.
--
-- This migration reinstalls find_improvised_club from the SQL 88 body with
-- the exact actor line SQL 126 was supposed to install. Nothing else changes:
-- the club roll (woods = tree, rubble = girder on 7+), the eligibility rules
-- and the nested submit_multi_target_weapon_declaration('[]') call that
-- consumes the weapon declaration all stay byte-for-byte identical.

CREATE OR REPLACE FUNCTION public.find_improvised_club(p_game_id uuid,p_instance_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;mech jsonb;units jsonb;terrain_name text;club_type text;die_a int;die_b int;found boolean:=false;submission jsonb;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM public.btech_authorized_ai_phase_player(p_game_id); /* ai5_authoritative_phase_actor_v1 */
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_phase<>'weapon_attack' OR g.active_player_id IS DISTINCT FROM player.id THEN RAISE EXCEPTION 'It is not your Weapon Attack activation';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 SELECT value INTO mech FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=p_instance_id;
 IF mech IS NULL OR (mech->>'owner')::int<>player.seat_number OR coalesce((mech->>'hasFired')::boolean,false) OR coalesce((mech->>'destroyed')::boolean,false) OR coalesce((mech->>'prone')::boolean,false) THEN RAISE EXCEPTION 'Choose an eligible standing BattleMech';END IF;
 IF mech ? 'improvisedClub' THEN RAISE EXCEPTION 'This BattleMech is already holding an improvised club';END IF;
 IF EXISTS (SELECT 1 FROM unnest(ARRAY['la','ra']) arm WHERE coalesce((mech->'structure'->>arm)::int,0)<=0
  OR NOT btech_physical_component_exists(g.catalogue_version,mech,arm,'Hand Actuator')
  OR btech_physical_component_damaged(g.catalogue_version,mech,arm,'Hand Actuator')
  OR btech_physical_component_damaged(g.catalogue_version,mech,arm,'Shoulder')) THEN RAISE EXCEPTION 'Two working arms, shoulders and hands are required to find a club';END IF;
 terrain_name:=coalesce(st->'terrain_overrides'->>(lpad(mech->>'col',2,'0')||lpad(mech->>'row',2,'0')),btech_terrain(coalesce(st->>'map_id','training-grounds'),lpad(mech->>'col',2,'0')||lpad(mech->>'row',2,'0')));
 IF terrain_name IN ('light_woods','heavy_woods') THEN club_type:='tree';found:=true;
 ELSIF terrain_name='rubble' THEN club_type:='girder';die_a:=floor(random()*6+1);die_b:=floor(random()*6+1);found:=die_a+die_b>=7;
 ELSE RAISE EXCEPTION 'An improvised club requires woods or rubble in the BattleMech''s hex';END IF;
 IF found THEN mech:=jsonb_set(mech,'{improvisedClub}',jsonb_build_object('type',club_type,'found_round',g.current_round),true);SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_instance_id THEN mech ELSE value END) INTO units FROM jsonb_array_elements(st->'mech_instances') value;st:=jsonb_set(st,'{mech_instances}',units,true);UPDATE btech_games SET state=st WHERE id=p_game_id;END IF;
 SELECT submit_multi_target_weapon_declaration(p_game_id,p_instance_id,'[]'::jsonb) INTO submission;
 RETURN jsonb_build_object('found',found,'club_type',club_type,'die_a',die_a,'die_b',die_b,'submission',submission);
END $$;
REVOKE ALL ON FUNCTION public.find_improvised_club(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_improvised_club(uuid,text) TO authenticated;

DO $$
DECLARE source text;
BEGIN
 SELECT pg_get_functiondef(to_regprocedure('public.find_improvised_club(uuid,text)')) INTO source;
 IF position('btech_authorized_ai_phase_player(p_game_id)' IN coalesce(source,''))=0 OR position('ai5_authoritative_phase_actor_v1' IN coalesce(source,''))=0 THEN
  RAISE EXCEPTION 'find_improvised_club was not reinstalled with AI authority';
 END IF;
END $$;

NOTIFY pgrst,'reload schema';