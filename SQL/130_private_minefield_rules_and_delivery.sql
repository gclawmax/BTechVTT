-- GM-4: scenario-configured, private minefields. Run after SQL/129.
-- Mine positions no longer live in btech_games.state, which every participant
-- can read. The authoritative movement resolver alone sees the full field.

CREATE TABLE IF NOT EXISTS public.btech_minefields (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), game_id uuid NOT NULL REFERENCES public.btech_games(id) ON DELETE CASCADE,
 owner_seat smallint NOT NULL CHECK(owner_seat IN (1,2)), col smallint NOT NULL, row smallint NOT NULL,
 mine_type text NOT NULL CHECK(mine_type IN ('conventional','vibrabomb')), density smallint NOT NULL CHECK(density IN (10,20,30)),
 sensitivity smallint, weapon_delivered boolean NOT NULL DEFAULT false, revealed_to jsonb NOT NULL DEFAULT '[]'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(game_id,col,row)
);
CREATE INDEX IF NOT EXISTS btech_minefields_game_idx ON public.btech_minefields(game_id);
ALTER TABLE public.btech_minefields ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Minefield owners and discoverers can view fields" ON public.btech_minefields;
CREATE POLICY "Minefield owners and discoverers can view fields" ON public.btech_minefields FOR SELECT USING (
 EXISTS(SELECT 1 FROM public.btech_players player WHERE player.game_id=btech_minefields.game_id AND player.user_id=auth.uid() AND player.role='player'
   AND (player.seat_number=btech_minefields.owner_seat OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(btech_minefields.revealed_to) revealed(seat) WHERE revealed.seat=player.seat_number::text)))
);

CREATE OR REPLACE FUNCTION public.btech_minefield_rules(p_state jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE source jsonb:=coalesce(p_state->'minefield_rules','{}'::jsonb);budget int;types jsonb;densities jsonb;sensitivities jsonb;
BEGIN
 budget:=greatest(0,least(120,coalesce((source->>'budget')::int,40)));
 types:=CASE WHEN jsonb_typeof(source->'permitted_types')='array' THEN source->'permitted_types' ELSE '["conventional","vibrabomb"]'::jsonb END;
 densities:=CASE WHEN jsonb_typeof(source->'permitted_densities')='array' THEN source->'permitted_densities' ELSE '[10,20,30]'::jsonb END;
 sensitivities:=CASE WHEN jsonb_typeof(source->'vibrabomb_sensitivities')='array' THEN source->'vibrabomb_sensitivities' ELSE '[20,30,40,50,60,70,80,90,100]'::jsonb END;
 RETURN jsonb_build_object('budget',budget,'permitted_types',types,'permitted_densities',densities,'vibrabomb_sensitivities',sensitivities);
END $$;
REVOKE ALL ON FUNCTION public.btech_minefield_rules(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.get_match_minefield_view(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE seat int;
BEGIN
 SELECT seat_number INTO seat FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF seat IS NULL THEN RAISE EXCEPTION 'Only a seated player may view minefields';END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',field.id,'owner',field.owner_seat,'col',field.col,'row',field.row,'type',field.mine_type,'density',field.density,'sensitivity',field.sensitivity,'weapon_delivered',field.weapon_delivered,'revealed_to',field.revealed_to)) ORDER BY field.created_at)
  FROM btech_minefields field WHERE field.game_id=p_game_id AND (field.owner_seat=seat OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(field.revealed_to) revealed(value) WHERE revealed.value=seat::text))),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.get_match_minefield_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_match_minefield_view(uuid) TO authenticated;

-- One-time migration removes legacy field coordinates from participant-readable
-- state. Existing fields retain their owner, density, detection and depletion.
INSERT INTO public.btech_minefields(id,game_id,owner_seat,col,row,mine_type,density,sensitivity,weapon_delivered,revealed_to)
SELECT coalesce(nullif(value->>'id','')::uuid,gen_random_uuid()),game.id,(value->>'owner')::smallint,(value->>'col')::smallint,(value->>'row')::smallint,
 coalesce(value->>'type','conventional'),coalesce((value->>'density')::smallint,20),NULLIF(value->>'sensitivity','')::smallint,coalesce((value->>'weapon_delivered')::boolean,false),coalesce(value->'revealed_to',jsonb_build_array(value->>'owner'))
FROM public.btech_games game CROSS JOIN LATERAL jsonb_array_elements(coalesce((CASE jsonb_typeof(game.state) WHEN 'string' THEN (game.state#>>'{}')::jsonb ELSE game.state END)->'minefields','[]'::jsonb)) value
WHERE (value->>'owner') IN ('1','2') AND (value->>'col') ~ '^[0-9]+$' AND (value->>'row') ~ '^[0-9]+$'
ON CONFLICT (game_id,col,row) DO NOTHING;
UPDATE public.btech_games SET state=CASE jsonb_typeof(state) WHEN 'string' THEN to_jsonb(((state#>>'{}')::jsonb)-'minefields') ELSE coalesce(state,'{}'::jsonb)-'minefields' END
WHERE (CASE jsonb_typeof(state) WHEN 'string' THEN (state#>>'{}')::jsonb ELSE state END) ? 'minefields';

CREATE OR REPLACE FUNCTION public.set_match_minefield_plan(p_game_id uuid,p_minefields jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE game btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;rules jsonb;field jsonb;code text;spent int:=0;
BEGIN
 IF jsonb_typeof(p_minefields)<>'array' THEN RAISE EXCEPTION 'Minefield plan must be an array';END IF;
 SELECT * INTO game FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR game.status<>'lobby' THEN RAISE EXCEPTION 'Minefields can be planned only by seated players in a lobby';END IF;
 st:=CASE jsonb_typeof(game.state) WHEN 'string' THEN (game.state#>>'{}')::jsonb ELSE coalesce(game.state,'{}'::jsonb) END;rules:=btech_minefield_rules(st);
 IF (SELECT count(*) FROM jsonb_array_elements(p_minefields))<>(SELECT count(DISTINCT (value->>'col')||','||(value->>'row')) FROM jsonb_array_elements(p_minefields) value) THEN RAISE EXCEPTION 'Two minefields cannot occupy the same hex';END IF;
 FOR field IN SELECT value FROM jsonb_array_elements(p_minefields) value LOOP
  IF coalesce(field->>'col','') !~ '^[0-9]+$' OR coalesce(field->>'row','') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Invalid minefield hex';END IF;
  IF NOT ((rules->'permitted_types') ? coalesce(field->>'type','')) THEN RAISE EXCEPTION 'This scenario does not permit that minefield type';END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rules->'permitted_densities') item WHERE item#>>'{}'=field->>'density') THEN RAISE EXCEPTION 'This scenario does not permit that minefield density';END IF;
  IF field->>'type'='vibrabomb' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rules->'vibrabomb_sensitivities') item WHERE item#>>'{}'=field->>'sensitivity') THEN RAISE EXCEPTION 'This scenario does not permit that vibrabomb trigger weight';END IF;
  spent:=spent+(field->>'density')::int;code:=lpad(field->>'col',2,'0')||lpad(field->>'row',2,'0');
  IF NOT btech_map_contains(coalesce(st->>'map_id','training-grounds'),(field->>'col')::int,(field->>'row')::int) OR NOT btech_scenario_zone_contains(st,player.seat_number,code) THEN RAISE EXCEPTION 'A minefield must be inside your deployment zone';END IF;
  IF btech_state_terrain(st,code) IN ('shallow_water','deep_water','building','impassable','magma_liquid') THEN RAISE EXCEPTION 'That terrain cannot contain this ground minefield';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(coalesce(st->'deployment_positions','{}'::jsonb)) owner,jsonb_array_elements(owner.value) position WHERE position->>'col'=field->>'col' AND position->>'row'=field->>'row') OR EXISTS(SELECT 1 FROM btech_minefields existing WHERE existing.game_id=p_game_id AND existing.owner_seat<>player.seat_number AND existing.col=(field->>'col')::int AND existing.row=(field->>'row')::int) THEN RAISE EXCEPTION 'That hex is already occupied or mined';END IF;
 END LOOP;
 IF spent>(rules->>'budget')::int THEN RAISE EXCEPTION 'Minefield plan spends % points but this scenario allows %',spent,rules->>'budget';END IF;
 DELETE FROM btech_minefields WHERE game_id=p_game_id AND owner_seat=player.seat_number;
 INSERT INTO btech_minefields(game_id,owner_seat,col,row,mine_type,density,sensitivity,revealed_to)
 SELECT p_game_id,player.seat_number,(value->>'col')::int,(value->>'row')::int,value->>'type',(value->>'density')::int,CASE WHEN value->>'type'='vibrabomb' THEN (value->>'sensitivity')::int END,jsonb_build_array(player.seat_number) FROM jsonb_array_elements(p_minefields) value;
 UPDATE btech_games SET state=st-'minefields' WHERE id=p_game_id;UPDATE btech_players SET ready=false WHERE game_id=p_game_id AND id=player.id;
 RETURN get_match_minefield_view(p_game_id);
END $$;
REVOKE ALL ON FUNCTION public.set_match_minefield_plan(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_match_minefield_plan(uuid,jsonb) TO authenticated;

-- The browser-controlled AI cannot choose secret coordinates safely. For solo
-- matches the server therefore seeds a deterministic legal AI plan as play
-- begins and returns only its count, never its locations.
CREATE OR REPLACE FUNCTION public.seed_ai_minefield_plan(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE game btech_games%ROWTYPE;controller btech_players%ROWTYPE;st jsonb;rules jsonb;budget int;seed text;candidate record;placed int:=0;density_value int;used int:=0;
BEGIN
 SELECT * INTO game FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO controller FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player' AND NOT coalesce(is_ai,false);
 IF NOT FOUND OR game.status<>'lobby' THEN RAISE EXCEPTION 'AI minefields can be prepared only by the seated player in an AI lobby';END IF;
 st:=CASE jsonb_typeof(game.state) WHEN 'string' THEN (game.state#>>'{}')::jsonb ELSE coalesce(game.state,'{}'::jsonb) END;
 IF NOT coalesce((st->>'vs_ai_mode')::boolean,false) THEN RETURN jsonb_build_object('status','not_ai_match','count',0);END IF;
 IF EXISTS(SELECT 1 FROM btech_minefields WHERE game_id=p_game_id AND owner_seat=2) THEN RETURN jsonb_build_object('status','already_prepared','count',(SELECT count(*) FROM btech_minefields WHERE game_id=p_game_id AND owner_seat=2));END IF;
 rules:=btech_minefield_rules(st);budget:=(rules->>'budget')::int;IF budget<10 OR NOT ((rules->'permitted_types') ? 'conventional') THEN RETURN jsonb_build_object('status','not_permitted','count',0);END IF;
 density_value:=CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(rules->'permitted_densities') item WHERE item#>>'{}'='20') AND budget>=20 THEN 20 ELSE 10 END;seed:=coalesce(st->>'ai_seed',p_game_id::text);
 FOR candidate IN SELECT col,row FROM generate_series(0,(btech_map_dimensions(coalesce(st->>'map_id','training-grounds'))->>'columns')::int-1) col CROSS JOIN generate_series(0,(btech_map_dimensions(coalesce(st->>'map_id','training-grounds'))->>'rows')::int-1) row
  WHERE btech_scenario_zone_contains(st,2,lpad(col::text,2,'0')||lpad(row::text,2,'0'))
   AND btech_state_terrain(st,lpad(col::text,2,'0')||lpad(row::text,2,'0')) NOT IN ('shallow_water','deep_water','building','impassable','magma_liquid')
   AND NOT EXISTS(SELECT 1 FROM jsonb_each(coalesce(st->'deployment_positions','{}'::jsonb)) owner,jsonb_array_elements(owner.value) deployed WHERE (deployed->>'col')::int=col AND (deployed->>'row')::int=row)
  ORDER BY md5(seed||':'||col||':'||row) LOOP
  EXIT WHEN used+density_value>budget OR placed>=2;
  INSERT INTO btech_minefields(game_id,owner_seat,col,row,mine_type,density,revealed_to) VALUES(p_game_id,2,candidate.col,candidate.row,'conventional',density_value,'[2]'::jsonb) ON CONFLICT(game_id,col,row) DO NOTHING;
  IF FOUND THEN placed:=placed+1;used:=used+density_value;END IF;
 END LOOP;
 RETURN jsonb_build_object('status','prepared','count',placed,'spent',used);
END $$;
REVOKE ALL ON FUNCTION public.seed_ai_minefield_plan(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_ai_minefield_plan(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.btech_resolve_hidden_mines(p_game_id uuid,p_catalogue_version text,p_moved_id text,p_path jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE game btech_games%ROWTYPE;st jsonb;units jsonb;moved jsonb;candidate jsonb;field btech_minefields%ROWTYPE;probe_range int;distance int;roll int;target int;mass int;triggered boolean;damage_left int;group_damage int;location_roll jsonb;damage_result jsonb;events jsonb:='[]'::jsonb;traversed text[]:=ARRAY[]::text[];seen_ids text[]:=ARRAY[]::text[];action jsonb;
BEGIN
 SELECT * INTO game FROM btech_games WHERE id=p_game_id FOR UPDATE;IF NOT FOUND THEN RETURN;END IF;st:=CASE jsonb_typeof(game.state) WHEN 'string' THEN (game.state#>>'{}')::jsonb ELSE game.state END;units:=coalesce(st->'mech_instances','[]'::jsonb);SELECT value INTO moved FROM jsonb_array_elements(units) value WHERE value->>'instanceId'=p_moved_id;IF moved IS NULL THEN RETURN;END IF;
 IF coalesce((moved->>'hidden')::boolean,false) AND jsonb_array_length(coalesce(p_path,'[]'::jsonb))>0 THEN moved:=jsonb_set(moved,'{hidden}','false'::jsonb,true);events:=events||jsonb_build_array(jsonb_build_object('type','unit_revealed','instance_id',p_moved_id,'reason','moved'));END IF;
 FOR candidate IN SELECT value FROM jsonb_array_elements(units) value WHERE (value->>'owner')::int<>(moved->>'owner')::int AND coalesce((value->>'hidden')::boolean,false) LOOP
  distance:=btech_hex_distance((moved->>'col')::int,(moved->>'row')::int,(candidate->>'col')::int,(candidate->>'row')::int);IF distance<=1 THEN seen_ids:=array_append(seen_ids,candidate->>'instanceId');events:=events||jsonb_build_array(jsonb_build_object('type','unit_revealed','instance_id',candidate->>'instanceId','reason','adjacent enemy'));END IF;
 END LOOP;
 SELECT (definition->>'mass')::int INTO mass FROM btech_catalogue_units WHERE catalogue_version=p_catalogue_version AND unit_id=moved->>'unitId';probe_range:=btech_active_probe_range(p_catalogue_version,moved);
 IF probe_range>0 THEN FOR candidate IN SELECT value FROM jsonb_array_elements(units) value WHERE (value->>'owner')::int<>(moved->>'owner')::int AND coalesce((value->>'hidden')::boolean,false) LOOP
  distance:=btech_hex_distance((moved->>'col')::int,(moved->>'row')::int,(candidate->>'col')::int,(candidate->>'row')::int);IF distance<=probe_range AND NOT btech_ecm_interferes_line(p_catalogue_version,st,(moved->>'owner')::int,(moved->>'col')::int,(moved->>'row')::int,(candidate->>'col')::int,(candidate->>'row')::int) AND NOT coalesce((btech_los_analysis(st,(moved->>'col')::int,(moved->>'row')::int,(candidate->>'col')::int,(candidate->>'row')::int)->>'blocked')::boolean,false) THEN seen_ids:=array_append(seen_ids,candidate->>'instanceId');events:=events||jsonb_build_array(jsonb_build_object('type','unit_revealed','instance_id',candidate->>'instanceId','reason','active probe'));END IF;
 END LOOP;END IF;
 FOR action IN SELECT value FROM jsonb_array_elements(coalesce(p_path,'[]'::jsonb)) value LOOP IF action->>'action' IN ('step','jump') THEN traversed:=array_append(traversed,lpad(action->>'col',2,'0')||lpad(action->>'row',2,'0'));END IF;END LOOP;
 FOR field IN SELECT * FROM btech_minefields WHERE game_id=p_game_id FOR UPDATE LOOP
  IF field.owner_seat=(moved->>'owner')::int THEN CONTINUE;END IF;distance:=btech_hex_distance((moved->>'col')::int,(moved->>'row')::int,field.col,field.row);
  IF probe_range>0 AND distance<=probe_range AND NOT btech_ecm_interferes_line(p_catalogue_version,st,(moved->>'owner')::int,(moved->>'col')::int,(moved->>'row')::int,field.col,field.row) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(field.revealed_to) revealed(value) WHERE revealed.value=moved->>'owner') THEN roll:=floor(random()*6+1)+floor(random()*6+1);target:=CASE WHEN field.weapon_delivered THEN 7 ELSE 10 END;IF roll>=target THEN UPDATE btech_minefields SET revealed_to=revealed_to||to_jsonb((moved->>'owner')::int) WHERE id=field.id;events:=events||jsonb_build_array(jsonb_build_object('type','minefield_detected','hex',lpad(field.col::text,2,'0')||lpad(field.row::text,2,'0'),'roll',roll,'target',target));END IF;END IF;
  triggered:=(lpad(field.col::text,2,'0')||lpad(field.row::text,2,'0'))=ANY(traversed) AND (field.mine_type='conventional' OR mass>=coalesce(field.sensitivity,50));
  IF triggered THEN target:=CASE field.density WHEN 10 THEN 9 WHEN 20 THEN 8 ELSE 7 END;roll:=floor(random()*6+1)+floor(random()*6+1);triggered:=roll>=target;END IF;
  IF triggered THEN damage_left:=field.density;WHILE damage_left>0 AND NOT coalesce((moved->>'destroyed')::boolean,false) LOOP group_damage:=least(5,damage_left);damage_left:=damage_left-group_damage;location_roll:=btech_roll_physical_location('kick','front');damage_result:=btech_apply_direct_damage(moved,group_damage,location_roll->>'location',false);moved:=damage_result->'mech';END LOOP;UPDATE btech_minefields SET density=greatest(0,density-5),revealed_to='[1,2]'::jsonb WHERE id=field.id;DELETE FROM btech_minefields WHERE id=field.id AND density<=0;events:=events||jsonb_build_array(jsonb_build_object('type','minefield_triggered','instance_id',p_moved_id,'hex',lpad(field.col::text,2,'0')||lpad(field.row::text,2,'0'),'mine_type',field.mine_type,'roll',roll,'target',target,'damage',field.density));END IF;
 END LOOP;
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_moved_id THEN moved WHEN (value->>'instanceId')=ANY(seen_ids) THEN jsonb_set(value,'{hidden}','false'::jsonb,true) ELSE value END) INTO units FROM jsonb_array_elements(units) value;st:=jsonb_set(st,'{mech_instances}',units,true);st:=jsonb_set(st,'{detection_events}',events,true);UPDATE btech_games SET state=st-'minefields' WHERE id=p_game_id;
END $$;
REVOKE ALL ON FUNCTION public.btech_resolve_hidden_mines(uuid,text,text,jsonb) FROM PUBLIC;
