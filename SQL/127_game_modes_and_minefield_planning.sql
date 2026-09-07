-- GM-1: map-aware objective modes and atomic per-seat minefield planning.
-- Run after SQL/126_ai_specialist_tactics.sql and SQL/110_variable_map_edge_effects.sql.

CREATE OR REPLACE FUNCTION public.btech_map_dimensions(p_map text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE custom_id uuid;definition jsonb;cols int:=16;rows int:=17;
BEGIN
 IF p_map='standard-dual-vertical' THEN rows:=34;
 ELSIF p_map='standard-dual-horizontal' THEN cols:=32;
 ELSIF p_map LIKE 'custom:%' THEN
  BEGIN custom_id:=substring(p_map FROM 8)::uuid;EXCEPTION WHEN invalid_text_representation THEN RETURN jsonb_build_object('columns',cols,'rows',rows);END;
  SELECT scenario.definition INTO definition FROM btech_custom_scenarios scenario WHERE scenario.id=custom_id;
  cols:=coalesce((definition->>'columns')::int,(definition->>'cols')::int,16);rows:=coalesce((definition->>'rows')::int,17);
 END IF;
 IF cols NOT BETWEEN 8 AND 48 THEN cols:=16;END IF;IF rows NOT BETWEEN 8 AND 48 THEN rows:=17;END IF;
 RETURN jsonb_build_object('columns',cols,'rows',rows);
END $$;
REVOKE ALL ON FUNCTION public.btech_map_dimensions(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_scenario_objective_hexes(p_map_id text)
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE p_map_id
  WHEN 'standard-single-sheet' THEN '["0406","0808","1110"]'::jsonb
  WHEN 'standard-dual-vertical' THEN '["0408","0816","1125"]'::jsonb
  WHEN 'standard-dual-horizontal' THEN '["0806","1508","2310"]'::jsonb
  WHEN 'industrial-crossing' THEN '["0703","0806","0809"]'::jsonb
  WHEN 'desert-hills' THEN '["0302","0906","1108"]'::jsonb
  WHEN 'flatlands-open-terrain' THEN '["0505","0806","1108"]'::jsonb
  WHEN 'ridge-and-ford' THEN '["0704","0804","0805"]'::jsonb
  WHEN 'weathered-frontier' THEN '["0403","1005","0408"]'::jsonb
  ELSE '["0704","0806","0808"]'::jsonb END
$$;
REVOKE ALL ON FUNCTION public.btech_scenario_objective_hexes(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_scenario_zone_contains(p_state jsonb,p_seat int,p_code text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE dimensions jsonb;cols int;rows int;col_number int;row_number int;depth int;
BEGIN
 IF p_code IS NULL OR p_code !~ '^[0-9]{4}$' OR p_seat IS NULL OR p_seat NOT IN (1,2) THEN RETURN false;END IF;
 dimensions:=btech_map_dimensions(coalesce(p_state->>'map_id','training-grounds'));cols:=(dimensions->>'columns')::int;rows:=(dimensions->>'rows')::int;
 col_number:=left(p_code,2)::int;row_number:=right(p_code,2)::int;
 IF col_number<0 OR col_number>=cols OR row_number<0 OR row_number>=rows THEN RETURN false;END IF;
 IF jsonb_typeof(p_state->'deployment_zones'->p_seat::text)='array' THEN RETURN (p_state->'deployment_zones'->p_seat::text) ? p_code;END IF;
 depth:=least(5,cols);RETURN CASE WHEN p_seat=1 THEN col_number<depth ELSE col_number>=cols-depth END;
END $$;
REVOKE ALL ON FUNCTION public.btech_scenario_zone_contains(jsonb,int,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.set_match_minefield_plan(p_game_id uuid,p_minefields jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;field jsonb;opponent_fields jsonb:='[]'::jsonb;own_fields jsonb:='[]'::jsonb;allowance int;code text;
BEGIN
 IF coalesce(jsonb_typeof(p_minefields),'')<>'array' THEN RAISE EXCEPTION 'Minefield plan must be an array';END IF;
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'lobby' THEN RAISE EXCEPTION 'Minefields can be planned only by seated players in a lobby';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE coalesce(g.state,'{}'::jsonb) END;
 allowance:=greatest(0,least(12,coalesce((st->'minefield_allowance'->>player.seat_number::text)::int,2)));
 IF jsonb_array_length(p_minefields)>allowance THEN RAISE EXCEPTION 'This side may place only % minefields',allowance;END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_minefields) AS planned(field_value))<>(SELECT count(DISTINCT (field_value->>'col')||','||(field_value->>'row')) FROM jsonb_array_elements(p_minefields) AS planned(field_value)) THEN RAISE EXCEPTION 'Two minefields cannot occupy the same hex';END IF;
 FOR field IN SELECT field_value FROM jsonb_array_elements(coalesce(st->'minefields','[]'::jsonb)) AS existing(field_value) WHERE (field_value->>'owner')::int<>player.seat_number LOOP opponent_fields:=opponent_fields||jsonb_build_array(field);END LOOP;
 FOR field IN SELECT field_value FROM jsonb_array_elements(p_minefields) AS planned(field_value) LOOP
  IF coalesce(field->>'col','') !~ '^[0-9]+$' OR coalesce(field->>'row','') !~ '^[0-9]+$' OR coalesce(field->>'type','') NOT IN ('conventional','vibrabomb') OR coalesce((field->>'density')::int,0) NOT IN (10,20,30) THEN RAISE EXCEPTION 'Invalid minefield declaration';END IF;
  IF field->>'type'='vibrabomb' AND coalesce((field->>'sensitivity')::int,0) NOT BETWEEN 20 AND 100 THEN RAISE EXCEPTION 'Vibrabomb trigger weight must be between 20 and 100 tons';END IF;
  IF NOT btech_map_contains(coalesce(st->>'map_id','training-grounds'),(field->>'col')::int,(field->>'row')::int) THEN RAISE EXCEPTION 'Minefield lies outside this battlefield';END IF;
  code:=lpad(field->>'col',2,'0')||lpad(field->>'row',2,'0');
  IF NOT btech_scenario_zone_contains(st,player.seat_number,code) THEN RAISE EXCEPTION 'A pre-placed minefield must be inside your deployment zone';END IF;
  IF btech_state_terrain(st,code) IN ('shallow_water','deep_water','building','impassable','magma_liquid') THEN RAISE EXCEPTION 'That terrain cannot contain this ground minefield';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(coalesce(st->'deployment_positions','{}'::jsonb)) AS owner(seat,positions),jsonb_array_elements(owner.positions) AS deployed(position) WHERE deployed.position->>'col'=field->>'col' AND deployed.position->>'row'=field->>'row') THEN RAISE EXCEPTION 'A minefield cannot be placed in an occupied hex';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(opponent_fields) AS existing(field_value) WHERE field_value->>'col'=field->>'col' AND field_value->>'row'=field->>'row') THEN RAISE EXCEPTION 'That hex already contains a minefield';END IF;
  own_fields:=own_fields||jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'owner',player.seat_number,'col',(field->>'col')::int,'row',(field->>'row')::int,'type',field->>'type','density',(field->>'density')::int,'sensitivity',CASE WHEN field->>'type'='vibrabomb' THEN (field->>'sensitivity')::int ELSE NULL END,'weapon_delivered',false,'revealed_to',jsonb_build_array(player.seat_number)));
 END LOOP;
 st:=jsonb_set(st,'{minefields}',opponent_fields||own_fields,true);UPDATE btech_games SET state=st WHERE id=p_game_id;
 UPDATE btech_players SET ready=false WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 RETURN own_fields;
END $$;
REVOKE ALL ON FUNCTION public.set_match_minefield_plan(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_match_minefield_plan(uuid,jsonb) TO authenticated;
