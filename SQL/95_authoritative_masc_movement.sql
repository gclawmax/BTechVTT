-- Total Warfare BattleMech MASC movement.
-- Run after SQL/94's four catalogue parts. Safe to rerun.
--
-- MASC doubles the current Walking MP for a running activation. Successive
-- rounds of use require 3+, 5+, 7+, 11+, then 13+ on 2D6, matching MegaMek's
-- standard Total Warfare equipment table. Unused turns progressively reduce
-- that accumulated risk. Failure causes one random critical
-- hit in each leg and an immediate Piloting Skill Roll. A standing survivor
-- may replot an ordinary move; a BattleMech that falls has spent its activation.

CREATE OR REPLACE FUNCTION public.btech_masc_target(p_consecutive int)
RETURNS int LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE greatest(1,p_consecutive) WHEN 1 THEN 3 WHEN 2 THEN 5 WHEN 3 THEN 7 WHEN 4 THEN 11 ELSE 13 END
$$;
REVOKE ALL ON FUNCTION public.btech_masc_target(int) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_apply_masc_failure(p_catalogue_version text,p_mech jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE m jsonb:=p_mech;leg text;chosen int;slot_label text;hits int:=0;events jsonb:='[]'::jsonb;
 resolved jsonb;raw_check jsonb;fall_result jsonb;
BEGIN
 FOREACH leg IN ARRAY ARRAY['ll','rl']::text[] LOOP
  SELECT slot.slot_index,slot.label INTO chosen,slot_label
  FROM btech_catalogue_critical_slots slot
  WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=m->>'unitId' AND slot.location=leg
   AND coalesce((m->'structure'->>leg)::int,0)>0
   AND btech_equipment_label_key(slot.label) NOT IN ('endosteel','ferrofibrous','case')
   AND NOT btech_critical_slot_is_damaged(m,leg,slot.slot_index)
  ORDER BY random() LIMIT 1;
  IF FOUND THEN
   m:=btech_mark_critical_slot(m,leg,chosen);hits:=hits+1;
   events:=events||jsonb_build_array(jsonb_build_object('location',leg,'slot_index',chosen,'label',slot_label));
  END IF;
 END LOOP;
 m:=jsonb_set(m,'{criticalHits}',to_jsonb(coalesce((m->>'criticalHits')::int,0)+hits),true);
 resolved:=btech_resolve_displacement_psr(p_catalogue_version,m,'MASC failure',0);m:=resolved->'mech';raw_check:=resolved->'check';fall_result:=raw_check->'fall';
 RETURN jsonb_build_object('mech',m,'critical_hits',events,'piloting_check',CASE WHEN raw_check IS NULL THEN NULL ELSE jsonb_build_object(
  'target',raw_check->'target','die_a',raw_check->'die_a','die_b',raw_check->'die_b','total',raw_check->'total','automatic',raw_check->'automatic','passed',raw_check->'passed') END,
  'fall_damage',coalesce(fall_result->'fall_damage','0'::jsonb),'fall_angle',fall_result->'fall_angle','fall_groups',coalesce(fall_result->'fall_groups','[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.btech_apply_masc_failure(text,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_resolve_masc_activation(p_catalogue_version text,p_mech jsonb,p_round int)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE m jsonb:=p_mech;use_level int;previous_level int;rounds_since_use int;target int;da int;db int;passed boolean;failure jsonb:=NULL;
BEGIN
 previous_level:=greatest(0,coalesce((m->>'mascUseLevel')::int,(m->>'mascConsecutiveUses')::int,0));rounds_since_use:=p_round-coalesce((m->>'mascLastRound')::int,-99);
 use_level:=CASE WHEN previous_level=0 OR rounds_since_use<=0 THEN 1 WHEN rounds_since_use=1 THEN previous_level+1 ELSE greatest(1,previous_level-rounds_since_use+1) END;
 target:=btech_masc_target(use_level);da:=floor(random()*6+1);db:=floor(random()*6+1);passed:=da+db>=target;
 m:=jsonb_set(m,'{mascLastRound}',to_jsonb(p_round),true);m:=jsonb_set(m,'{mascUseLevel}',to_jsonb(use_level),true);m:=jsonb_set(m,'{mascUsedThisRound}','true'::jsonb,true);
 IF NOT passed THEN failure:=btech_apply_masc_failure(p_catalogue_version,m);m:=failure->'mech';END IF;
 RETURN jsonb_build_object('mech',m,'requested',true,'use_level',use_level,'target',target,'die_a',da,'die_b',db,'total',da+db,'passed',passed,'failure',failure-'mech');
END $$;
REVOKE ALL ON FUNCTION public.btech_resolve_masc_activation(text,jsonb,int) FROM PUBLIC;

DO $$
DECLARE fn regprocedure;source text;patched text;previous text;
BEGIN
 fn:=to_regprocedure('public.submit_battlemech_movement(uuid,text,text,jsonb)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Movement resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('authoritative_masc_movement_v1' IN source)>0 THEN RETURN;END IF;

 -- Add private locals at the function's single DECLARE boundary instead of
 -- depending on the order in which earlier terrain migrations added theirs.
 patched:=regexp_replace(source,'DECLARE[[:space:]]+',
  'DECLARE masc_requested boolean:=false;masc_result jsonb:=NULL; /* authoritative_masc_movement_v1 */ ','i');
 IF patched=source THEN RAISE EXCEPTION 'Could not locate the movement declaration boundary for MASC';END IF;

 previous:=patched;
 patched:=regexp_replace(patched,E'path_length[[:space:]]*:=[[:space:]]*jsonb_array_length\\(p_path\\);',
  'path_length:=jsonb_array_length(p_path);SELECT coalesce(bool_or(coalesce((value->>''masc'')::boolean,false)),false) INTO masc_requested FROM jsonb_array_elements(p_path) value;','i');
 IF patched=previous THEN RAISE EXCEPTION 'Could not locate movement path initialisation for MASC';END IF;

 previous:=patched;
 patched:=regexp_replace(patched,E'mobility[[:space:]]*:=[[:space:]]*btech_critical_movement_profile\\(g\\.catalogue_version[[:space:]]*,[[:space:]]*mech\\);',
  'mobility:=btech_critical_movement_profile(g.catalogue_version,mech);IF masc_requested THEN IF p_mode<>''run'' THEN RAISE EXCEPTION ''MASC may only boost a running movement'';END IF;IF coalesce((mech->>''mascLastRound'')::int,-99)=g.current_round THEN RAISE EXCEPTION ''MASC has already been attempted this round'';END IF;IF NOT btech_equipment_operational(g.catalogue_version,mech,ARRAY[''masc'']) THEN RAISE EXCEPTION ''This BattleMech has no operational MASC system'';END IF;END IF;','i');
 IF patched=previous THEN RAISE EXCEPTION 'Could not locate the critical movement profile for MASC';END IF;

 previous:=patched;
 patched:=regexp_replace(patched,E'mp_max[[:space:]]*:=[[:space:]]*greatest\\(0[[:space:]]*,[[:space:]]*coalesce\\(\\(mobility[[:space:]]*->>[[:space:]]*p_mode\\)::(int|integer)[[:space:]]*,[[:space:]]*0\\)[[:space:]]*-[[:space:]]*heat_penalty\\);',
  'mp_max:=greatest(0,CASE WHEN masc_requested THEN coalesce((mobility->>''walk'')::int,0)*2 ELSE coalesce((mobility->>p_mode)::int,0) END-heat_penalty);','i');
 IF patched=previous THEN RAISE EXCEPTION 'Could not locate the movement-point calculation for MASC';END IF;

 -- Add the ordinary-success response before introducing the failure response,
 -- so only the resolver's existing final return can match.
 previous:=patched;
 patched:=regexp_replace(patched,E'RETURN[[:space:]]+jsonb_build_object\\([[:space:]]*''instance_id''',
  'RETURN jsonb_build_object(''masc'',CASE WHEN masc_result IS NULL THEN NULL ELSE masc_result-''mech'' END,''instance_id''','i');
 IF patched=previous THEN RAISE EXCEPTION 'Could not locate the movement result for MASC';END IF;

 previous:=patched;
 patched:=regexp_replace(patched,E'FOR[[:space:]]+action[[:space:]]+IN[[:space:]]+SELECT[[:space:]]+value[[:space:]]+FROM[[:space:]]+jsonb_array_elements\\(p_path\\)[[:space:]]+value[[:space:]]+LOOP',
  E'IF masc_requested THEN masc_result:=btech_resolve_masc_activation(g.catalogue_version,mech,g.current_round);mech:=masc_result->''mech'';IF NOT coalesce((masc_result->>''passed'')::boolean,false) THEN IF coalesce((mech->>''prone'')::boolean,false) THEN mech:=jsonb_set(mech,''{hasMoved}'',''true''::jsonb,true);mech:=jsonb_set(mech,''{movementMode}'',''"run"''::jsonb,true);mech:=jsonb_set(mech,''{movementHeat}'',''2''::jsonb,true);END IF;SELECT jsonb_agg(CASE WHEN value->>''instanceId''=p_instance_id THEN mech ELSE value END) INTO units FROM jsonb_array_elements(before_units) value;PERFORM submit_phase_state_nonphysical_core(p_game_id,units);RETURN (masc_result-''mech'')||jsonb_build_object(''instance_id'',p_instance_id,''mode'',p_mode,''col'',current_col,''row'',current_row,''mp_used'',0,''mp_max'',mp_max,''hexes_moved'',0,''masc'',masc_result-''mech'');END IF;END IF;\n FOR action IN SELECT value FROM jsonb_array_elements(p_path) value LOOP','i');
 IF patched=previous THEN RAISE EXCEPTION 'Could not locate the movement path loop for MASC';END IF;

 previous:=patched;
 patched:=regexp_replace(patched,E'mech[[:space:]]*:=[[:space:]]*jsonb_set\\(mech[[:space:]]*,[[:space:]]*''\\{movementMode\\}''[[:space:]]*,[[:space:]]*to_jsonb\\(p_mode\\)[[:space:]]*,[[:space:]]*true\\);',
  'mech:=jsonb_set(mech,''{movementMode}'',to_jsonb(p_mode),true);mech:=jsonb_set(mech,''{mascUsedThisRound}'',to_jsonb(masc_requested),true);','i');
 IF patched=previous THEN RAISE EXCEPTION 'Could not locate movement completion state for MASC';END IF;

 IF position('authoritative_masc_movement_v1' IN patched)=0 OR position('btech_resolve_masc_activation' IN patched)=0
  OR position('mascUsedThisRound' IN patched)=0 OR position('masc_result-''mech''' IN patched)=0 THEN
  RAISE EXCEPTION 'The completed MASC resolver failed its integrity check';END IF;
 EXECUTE patched;
END $$;

GRANT EXECUTE ON FUNCTION public.btech_masc_target(int) TO authenticated;
