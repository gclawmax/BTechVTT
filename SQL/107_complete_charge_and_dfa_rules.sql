-- Complete the server-authoritative displacement-attack rules for the
-- supported BattleMech game: validate the actual plotted movement, preserve
-- Movement-phase declaration / Physical-phase resolution, and correct the
-- weapon-phase fall and consciousness edge cases.

CREATE OR REPLACE FUNCTION public.btech_validate_special_attack_path(
 p_state jsonb,p_catalogue_version text,p_attacker_id text,p_mode text,p_path jsonb,p_staging_col int,p_staging_row int,p_staging_facing int,p_reported_mp int DEFAULT NULL
) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE attacker jsonb;definition jsonb;action jsonb;kind text;col int;row int;facing int;next_col int;next_row int;direction int;cost int:=0;hexes int:=0;limit_mp int;heat_penalty int;terrain text;
BEGIN
 IF jsonb_typeof(p_path)<>'array' OR jsonb_array_length(p_path)=0 OR jsonb_array_length(p_path)>40 THEN RAISE EXCEPTION 'A complete special-attack movement path is required';END IF;
 SELECT value INTO attacker FROM jsonb_array_elements(coalesce(p_state->'mech_instances','[]'::jsonb)) value WHERE value->>'instanceId'=p_attacker_id;
 IF attacker IS NULL THEN RAISE EXCEPTION 'Special-attack attacker is missing';END IF;
 SELECT cu.definition INTO definition FROM btech_catalogue_units cu WHERE cu.catalogue_version=p_catalogue_version AND cu.unit_id=attacker->>'unitId';
 IF definition IS NULL THEN RAISE EXCEPTION 'BattleMech is missing from its pinned catalogue';END IF;
 heat_penalty:=CASE WHEN coalesce((attacker->>'roundStartingHeat')::int,coalesce((attacker->>'heat')::int,0))>=25 THEN 4 WHEN coalesce((attacker->>'roundStartingHeat')::int,coalesce((attacker->>'heat')::int,0))>=20 THEN 3 WHEN coalesce((attacker->>'roundStartingHeat')::int,coalesce((attacker->>'heat')::int,0))>=15 THEN 2 WHEN coalesce((attacker->>'roundStartingHeat')::int,coalesce((attacker->>'heat')::int,0))>=10 THEN 1 ELSE 0 END;
 limit_mp:=greatest(0,coalesce((definition->'movement'->>p_mode)::int,0)-heat_penalty);col:=(attacker->>'col')::int;row:=(attacker->>'row')::int;facing:=coalesce((attacker->>'facing')::int,0);
 FOR action IN SELECT value FROM jsonb_array_elements(p_path) value LOOP
  kind:=action->>'action';
  IF kind='turn' THEN
   IF p_mode='jump' OR action->>'direction' NOT IN ('left','right') THEN RAISE EXCEPTION 'Invalid special-attack facing change';END IF;
   cost:=cost+1;facing:=(facing+CASE action->>'direction' WHEN 'left' THEN 1 ELSE -1 END+6)%6;
  ELSIF kind='step' THEN
   IF p_mode NOT IN ('walk','run') THEN RAISE EXCEPTION 'Only walking or running may use ground steps';END IF;
   next_col:=(action->>'col')::int;next_row:=(action->>'row')::int;
   IF next_col NOT BETWEEN 0 AND 15 OR next_row NOT BETWEEN 0 AND 11 OR btech_hex_distance(col,row,next_col,next_row)<>1 THEN RAISE EXCEPTION 'Each Charge step must be adjacent';END IF;
   IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_state->'mech_instances','[]'::jsonb)) unit WHERE unit->>'instanceId'<>p_attacker_id AND (unit->>'col')::int=next_col AND (unit->>'row')::int=next_row AND NOT coalesce((unit->>'destroyed')::boolean,false)) THEN RAISE EXCEPTION 'A Charge path cannot enter an occupied hex';END IF;
   direction:=btech_direction_to(col,row,next_col,next_row);IF direction=(facing+3)%6 AND p_mode='run' THEN RAISE EXCEPTION 'A running Charge cannot move backward';END IF;
   terrain:=btech_terrain(coalesce(p_state->>'map_id','training-grounds'),lpad(next_col::text,2,'0')||lpad(next_row::text,2,'0'));
   IF terrain='impassable' THEN RAISE EXCEPTION 'Charge path enters prohibited terrain';END IF;
   IF abs(btech_elevation(coalesce(p_state->>'map_id','training-grounds'),lpad(next_col::text,2,'0')||lpad(next_row::text,2,'0'))-btech_elevation(coalesce(p_state->>'map_id','training-grounds'),lpad(col::text,2,'0')||lpad(row::text,2,'0')))>2 THEN RAISE EXCEPTION 'Charge path climbs too steeply';END IF;
   cost:=cost+CASE WHEN direction=facing OR direction=(facing+3)%6 THEN 1 ELSE least(abs(direction-facing),6-abs(direction-facing))+1 END+CASE terrain WHEN 'light_woods' THEN 1 WHEN 'heavy_woods' THEN 2 WHEN 'rough' THEN 1 WHEN 'rubble' THEN 1 WHEN 'shallow_water' THEN 1 WHEN 'deep_water' THEN 3 WHEN 'mud' THEN 1 WHEN 'deep_snow' THEN 1 WHEN 'ice' THEN 1 WHEN 'swamp' THEN 1 ELSE 0 END;
   IF direction<>(facing+3)%6 THEN facing:=direction;END IF;col:=next_col;row:=next_row;hexes:=hexes+1;
  ELSIF kind='jump' THEN
   IF p_mode<>'jump' OR jsonb_array_length(p_path)<>1 THEN RAISE EXCEPTION 'A DFA requires one direct jump path';END IF;
   next_col:=(action->>'col')::int;next_row:=(action->>'row')::int;
   IF next_col<>p_staging_col OR next_row<>p_staging_row THEN RAISE EXCEPTION 'DFA jump path does not match its staging hex';END IF;
   cost:=btech_hex_distance(col,row,next_col,next_row);hexes:=cost;col:=next_col;row:=next_row;facing:=coalesce((action->>'facing')::int,btech_direction_to((attacker->>'col')::int,(attacker->>'row')::int,next_col,next_row));
  ELSE RAISE EXCEPTION 'Invalid special-attack movement action';END IF;
  IF cost>limit_mp THEN RAISE EXCEPTION 'Special-attack path exceeds available Movement Points';END IF;
 END LOOP;
 IF col<>p_staging_col OR row<>p_staging_row OR facing<>p_staging_facing THEN RAISE EXCEPTION 'Special-attack staging state does not match its plotted path';END IF;
 IF p_reported_mp IS NOT NULL AND p_reported_mp<>cost THEN RAISE EXCEPTION 'Special-attack Movement Points do not match its plotted path';END IF;
END $$;
REVOKE ALL ON FUNCTION public.btech_validate_special_attack_path(jsonb,text,text,text,jsonb,int,int,int,int) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.declare_charge_attack(
 p_game_id uuid,p_attacker_instance_id text,p_target_instance_id text,p_staging_col int,p_staging_row int,p_staging_facing int,p_mode text,p_hexes_moved int,p_mp_used int,p_path jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE state jsonb;catalogue text;
BEGIN
 SELECT CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END,g.catalogue_version INTO state,catalogue FROM btech_games g WHERE g.id=p_game_id;
 PERFORM btech_validate_special_attack_path(state,catalogue,p_attacker_instance_id,p_mode,p_path,p_staging_col,p_staging_row,p_staging_facing,p_mp_used);
 IF p_mode NOT IN ('walk','run') OR p_hexes_moved<>(SELECT count(*) FROM jsonb_array_elements(p_path) step WHERE step->>'action'='step') THEN RAISE EXCEPTION 'Charge movement must match its plotted path';END IF;
 RETURN declare_charge_attack(p_game_id,p_attacker_instance_id,p_target_instance_id,p_staging_col,p_staging_row,p_staging_facing,p_mode,p_hexes_moved,p_mp_used);
END $$;
REVOKE ALL ON FUNCTION public.declare_charge_attack(uuid,text,text,int,int,int,text,int,int) FROM authenticated;
REVOKE ALL ON FUNCTION public.declare_charge_attack(uuid,text,text,int,int,int,text,int,int,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.declare_charge_attack(uuid,text,text,int,int,int,text,int,int,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.declare_death_from_above(
 p_game_id uuid,p_attacker_instance_id text,p_target_instance_id text,p_staging_col int,p_staging_row int,p_staging_facing int,p_path jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE state jsonb;catalogue text;
BEGIN
 SELECT CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END,g.catalogue_version INTO state,catalogue FROM btech_games g WHERE g.id=p_game_id;
 PERFORM btech_validate_special_attack_path(state,catalogue,p_attacker_instance_id,'jump',p_path,p_staging_col,p_staging_row,p_staging_facing,NULL);
 RETURN declare_death_from_above(p_game_id,p_attacker_instance_id,p_target_instance_id,p_staging_col,p_staging_row,p_staging_facing);
END $$;
REVOKE ALL ON FUNCTION public.declare_death_from_above(uuid,text,text,int,int,int) FROM authenticated;
REVOKE ALL ON FUNCTION public.declare_death_from_above(uuid,text,text,int,int,int,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.declare_death_from_above(uuid,text,text,int,int,int,jsonb) TO authenticated;

-- Charge uses the usual physical terrain modifier, and must miss after a
-- weapon-phase fall or loss of consciousness.  DFA has the same latter edge
-- case.  A missed DFA is a two-level rear fall, not three levels of front hits.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.resolve_declared_charge_legacy(uuid,text)');IF fn IS NULL THEN fn:=to_regprocedure('public.resolve_declared_charge(uuid,text)');END IF;
 IF fn IS NULL THEN RAISE EXCEPTION 'Charge resolution resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;IF position('charge_complete_rules_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,'target_mod int;tn int;','target_mod int;terrain_mod int;tn int;');
 patched:=replace(patched,'tn:=att_p+(att_p-tgt_p)+CASE decl->>''mode'' WHEN ''run'' THEN 2 ELSE 1 END+target_mod;',
  'terrain_mod:=CASE btech_terrain(coalesce(st->>''map_id'',''training-grounds''),lpad(target->>''col'',2,''0'')||lpad(target->>''row'',2,''0'')) WHEN ''heavy_woods'' THEN 2 WHEN ''light_woods'' THEN 1 ELSE 0 END;tn:=att_p+(att_p-tgt_p)+CASE decl->>''mode'' WHEN ''run'' THEN 2 ELSE 1 END+target_mod+terrain_mod; /* charge_complete_rules_v1 */');
 patched:=replace(patched,'hit:=tn<=12 AND da+db>=tn;','hit:=tn<=12 AND da+db>=tn AND coalesce(attacker->''pilot''->>''consciousness'',''conscious'')=''conscious'' AND NOT coalesce((attacker->>''prone'')::boolean,false);');
 IF patched=source OR position('charge_complete_rules_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely complete Charge rules';END IF;EXECUTE patched;
END $$;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.resolve_declared_death_from_above_legacy(uuid,text)');IF fn IS NULL THEN fn:=to_regprocedure('public.resolve_declared_death_from_above(uuid,text)');END IF;
 IF fn IS NULL THEN RAISE EXCEPTION 'DFA resolution resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;IF position('dfa_complete_rules_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,E'hit:=coalesce(attacker->''pilot''->>''consciousness'',''conscious'')=''conscious'' AND tn<=12 AND da+db>=tn;',E'hit:=coalesce(attacker->''pilot''->>''consciousness'',''conscious'')=''conscious'' AND NOT coalesce((attacker->>''prone'')::boolean,false) AND tn<=12 AND da+db>=tn; /* dfa_complete_rules_v1 */');
 patched:=replace(patched,'fall_damage:=ceil(attacker_mass/10.0)::int*3;','fall_damage:=ceil(attacker_mass/10.0)::int*2;');
 patched:=replace(patched,E'loc:=btech_roll_mech_hit_location(''front'');damage_result:=btech_apply_direct_damage(attacker,group_damage,loc->>''location'',false);attacker:=damage_result->''mech'';fall_groups:=',E'loc:=btech_roll_mech_hit_location(''rear'');damage_result:=btech_apply_direct_damage(attacker,group_damage,loc->>''location'',true);attacker:=damage_result->''mech'';fall_groups:=');
 IF patched=source OR position('dfa_complete_rules_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely complete DFA rules';END IF;EXECUTE patched;
END $$;

NOTIFY pgrst,'reload schema';
