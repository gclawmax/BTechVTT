-- 157_prone_physical_pass.sql
-- Run after SQL 156. Safe to rerun (CREATE OR REPLACE only; no data changes).
--
-- A BattleMech that cannot legally attack (prone, shutdown, unconscious
-- pilot, or simply no adjacent target) must still be able to PASS its
-- physical attack. Otherwise the physical phase can never close:
--
--   * btech_units_left_to_act (SQL 22/27) counts every living unit as
--     needing to declare, and btech_advance_unit_activation only reports
--     phase_complete once every counted unit has hasPhysicalAttacked=true.
--   * btech_process_physical_declaration (installed by SQL 60, lines
--     238-245) rejected a destroyed/prone/shutdown/unconscious attacker
--     BEFORE the p_attack_type='pass' branch could run, so an ineligible
--     attacker's pass failed with
--     'Attacker is not eligible for a standard physical attack'.
--
-- Result: whenever such a Mech belongs to the active declarer, its pass is
-- rejected, its activation never completes, the opposing Mechs never become
-- active, and the phase wedges until the deadline. The client already
-- designed for this case: autoPassIneligiblePhysicalAttackers (js/game/
-- phases.js:881) auto-submits exactly that pass on every loadGameState, but
-- the server rejection aborts it. The shipped recovery
-- (skip_empty_physical_phase / recover_stalled_physical_phase, SQL 147)
-- correctly refuses in that state because the opposing side's living Mechs
-- still have legal options, so no UI escape hatch exists either.
--
-- Reproduced live in Step 0 Battle A (game BT-DY4P, round 4 physical_attack:
-- Timber Wolf Prime prone at 8:5, activeSeat=2, all three units
-- hasPhysicalAttacked=false, phase stuck at the deadline).
--
-- Fix: a pass from a living BattleMech is always accepted. The destroyed /
-- prone / shutdown / unconscious attacker rejection is retained for actual
-- attacks (prone/shutdown/unconscious Mechs still cannot punch, kick or use
-- a physical weapon; destroyed Mechs never declare at all — they are
-- excluded from btech_units_left_to_act). Only the order of the checks
-- changes: the pass branch runs before the attack-eligibility gate.
--
-- This re-installs the complete resolver body from SQL 60 (which adds arm
-- physical weapons, heat and fumble handling over the SQL 23 baseline) so
-- no behaviour other than the pass path is changed.
--
-- btech_has_remaining_physical_option (SQL 106) already returns false for a
-- prone/shutdown/unconscious attacker, so the recovery predicate stays
-- consistent with this fix without changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.btech_process_physical_declaration(
 p_game_id uuid,p_catalogue_version text,p_round int,p_state jsonb,p_attacker_id text,p_target_id text,
 p_attack_type text,p_limbs text[],p_resolve boolean
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE st jsonb:=p_state;attacker jsonb;target jsonb;attacker_start jsonb;target_start jsonb;units jsonb;
 unit_mass int;attack_direction int;attack_diff int;target_direction int;target_diff int;angle text;level_difference int;
 attacker_mod int;target_mod int;terrain_mod int;base_tn int;limb text;tn int;damage int;reduction int;
 die_a int;die_b int;location_roll jsonb;damage_result jsonb;results jsonb:='[]'::jsonb;
 upper_label text;lower_label text;hand_or_foot text;weapon_fired boolean;hit boolean;
 physical_key text;physical_aim text;physical_profile jsonb;physical_label text;physical_heat int;fumble_psr jsonb;
BEGIN
 SELECT value INTO attacker FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=p_attacker_id;
 attacker_start:=attacker->'physicalPhaseStart'->'mech';
 IF attacker IS NULL OR attacker_start IS NULL OR coalesce(attacker->'physicalPhaseStart'->>'round','-1')::int<>p_round
 THEN RAISE EXCEPTION 'Attacker is not eligible for a standard physical attack';END IF;
 -- A pass is always a legal declaration for a living BattleMech, even when
 -- it cannot attack (prone, shutdown, unconscious pilot, no adjacent
 -- target, ...). It consumes the Mech's physical activation so the phase
 -- can close: btech_units_left_to_act counts every living unit, and the
 -- client auto-pass (autoPassIneligiblePhysicalAttackers, js/game/phases.js)
 -- relies on the server accepting it. A destroyed attacker never declares.
 IF p_attack_type='pass' THEN
  IF p_target_id IS NOT NULL OR coalesce(array_length(p_limbs,1),0)>0 THEN RAISE EXCEPTION 'A pass cannot include a target or limb';END IF;
  IF coalesce((attacker_start->>'destroyed')::boolean,false) THEN RAISE EXCEPTION 'Attacker is not eligible for a standard physical attack';END IF;
  RETURN jsonb_build_object('state',st,'results',results);
 END IF;
 IF coalesce((attacker_start->>'destroyed')::boolean,false) OR coalesce((attacker_start->>'prone')::boolean,false)
  OR coalesce((attacker_start->>'shutdown')::boolean,false) OR coalesce(attacker_start->'pilot'->>'consciousness','conscious')<>'conscious'
 THEN RAISE EXCEPTION 'Attacker is not eligible for a standard physical attack';END IF;
 IF p_attack_type LIKE 'physical_%' THEN
  physical_key:=split_part(substring(p_attack_type from 10),'__',1);physical_aim:=nullif(split_part(substring(p_attack_type from 10),'__',2),'');
  IF physical_aim IS NOT NULL AND physical_aim NOT IN ('punch','kick') THEN RAISE EXCEPTION 'Choose the standard, punch or kick location table';END IF;
  physical_profile:=btech_physical_weapon_profile(physical_key);
  IF physical_profile IS NULL THEN RAISE EXCEPTION 'Unsupported physical weapon';END IF;
  physical_label:=physical_profile->>'label';
 ELSIF p_attack_type='hatchet' THEN
  physical_key:='hatchet';physical_profile:=btech_physical_weapon_profile(physical_key);physical_label:=physical_profile->>'label';
 ELSIF p_attack_type NOT IN ('punch','kick') THEN RAISE EXCEPTION 'Choose punch, kick, physical weapon, or pass';END IF;

 SELECT value INTO target FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=p_target_id;
 target_start:=target->'physicalPhaseStart'->'mech';
 IF target IS NULL OR target_start IS NULL OR (target_start->>'owner')::int=(attacker_start->>'owner')::int
  OR coalesce((target_start->>'destroyed')::boolean,false)
  OR (coalesce((target_start->>'prone')::boolean,false) AND p_attack_type<>'kick')
 THEN RAISE EXCEPTION 'Choose an eligible enemy target';END IF;
 IF btech_hex_distance((attacker_start->>'col')::int,(attacker_start->>'row')::int,(target_start->>'col')::int,(target_start->>'row')::int)<>1
 THEN RAISE EXCEPTION 'Physical attacks require an adjacent target';END IF;
 SELECT (unit.definition->>'mass')::int INTO unit_mass FROM btech_catalogue_units unit
  WHERE unit.catalogue_version=p_catalogue_version AND unit.unit_id=attacker_start->>'unitId';
 IF unit_mass IS NULL THEN RAISE EXCEPTION 'Attacker is missing from the pinned catalogue';END IF;

 attack_direction:=btech_direction_to((attacker_start->>'col')::int,(attacker_start->>'row')::int,(target_start->>'col')::int,(target_start->>'row')::int);
 attack_diff:=(attack_direction-(attacker_start->>'facing')::int+6)%6;
 target_direction:=btech_direction_to((target_start->>'col')::int,(target_start->>'row')::int,(attacker_start->>'col')::int,(attacker_start->>'row')::int);
 target_diff:=(target_direction-(target_start->>'facing')::int+6)%6;
 angle:=CASE WHEN target_diff=1 THEN 'left' WHEN target_diff=5 THEN 'right' WHEN target_diff IN (2,3,4) THEN 'rear' ELSE 'front' END;
 level_difference:=btech_elevation(coalesce(st->>'map_id','training-grounds'),lpad(target_start->>'col',2,'0')||lpad(target_start->>'row',2,'0'))
  -btech_elevation(coalesce(st->>'map_id','training-grounds'),lpad(attacker_start->>'col',2,'0')||lpad(attacker_start->>'row',2,'0'));
 IF abs(level_difference)>1 THEN RAISE EXCEPTION 'Physical target must be within one elevation level';END IF;
 IF NOT coalesce((target_start->>'prone')::boolean,false) AND p_attack_type='kick' AND level_difference>0 THEN RAISE EXCEPTION 'A standing target one level higher cannot be kicked';END IF;
 IF NOT coalesce((target_start->>'prone')::boolean,false) AND p_attack_type='punch' AND level_difference<0 THEN RAISE EXCEPTION 'A standing target one level lower cannot be punched';END IF;
 IF p_attack_type='kick' AND attack_diff NOT IN (0,1,5) THEN RAISE EXCEPTION 'Kick target is outside the three forward hexes';END IF;
 IF (p_attack_type='punch' OR physical_profile->>'arc'='arm') AND attack_diff=3 THEN RAISE EXCEPTION 'Physical target is in the rear arc';END IF;
 IF physical_profile->>'arc'='forward' AND attack_diff NOT IN (0,1,5) THEN RAISE EXCEPTION 'Physical weapon target is outside the forward arc';END IF;

 IF p_attack_type='punch' AND (coalesce(array_length(p_limbs,1),0)<1 OR array_length(p_limbs,1)>2
  OR EXISTS (SELECT 1 FROM unnest(p_limbs) x WHERE x NOT IN ('la','ra'))
  OR (SELECT count(DISTINCT x) FROM unnest(p_limbs) x)<>array_length(p_limbs,1))
 THEN RAISE EXCEPTION 'Choose one or both unique arms for a punch';END IF;
 IF p_attack_type='kick' AND (coalesce(array_length(p_limbs,1),0)<>1 OR p_limbs[1] NOT IN ('ll','rl')) THEN RAISE EXCEPTION 'Choose one leg for a kick';END IF;
 IF physical_profile IS NOT NULL AND (coalesce(array_length(p_limbs,1),0)<>1 OR p_limbs[1] NOT IN ('la','ra')) THEN RAISE EXCEPTION 'Choose the arm mounting the physical weapon';END IF;
 IF physical_profile IS NOT NULL AND (NOT btech_physical_component_exists(p_catalogue_version,attacker_start,p_limbs[1],physical_label)
  OR btech_physical_component_damaged(p_catalogue_version,attacker_start,p_limbs[1],physical_label)) THEN RAISE EXCEPTION 'A functioning % is required',physical_label;END IF;
 IF p_attack_type='kick' AND (btech_physical_component_damaged(p_catalogue_version,attacker_start,'ll','Hip')
  OR btech_physical_component_damaged(p_catalogue_version,attacker_start,'rl','Hip')) THEN RAISE EXCEPTION 'A damaged hip prevents all kick attacks';END IF;

 attacker_mod:=CASE attacker_start->>'movementMode' WHEN 'walk' THEN 1 WHEN 'run' THEN 2 WHEN 'jump' THEN 3 ELSE 0 END;
 target_mod:=CASE WHEN coalesce((target_start->>'hexesMoved')::int,0)>=25 THEN 6 WHEN coalesce((target_start->>'hexesMoved')::int,0)>=18 THEN 5
  WHEN coalesce((target_start->>'hexesMoved')::int,0)>=10 THEN 4 WHEN coalesce((target_start->>'hexesMoved')::int,0)>=7 THEN 3
  WHEN coalesce((target_start->>'hexesMoved')::int,0)>=5 THEN 2 WHEN coalesce((target_start->>'hexesMoved')::int,0)>=3 THEN 1 ELSE 0 END
  +CASE WHEN target_start->>'movementMode'='jump' THEN 1 ELSE 0 END;
 terrain_mod:=CASE btech_terrain(coalesce(st->>'map_id','training-grounds'),lpad(target_start->>'col',2,'0')||lpad(target_start->>'row',2,'0'))
  WHEN 'heavy_woods' THEN 2 WHEN 'light_woods' THEN 1 ELSE 0 END;
 base_tn:=coalesce((attacker_start->'pilot'->>'piloting')::int,(attacker_start->>'pilotingSkill')::int,5)
  +attacker_mod+target_mod+terrain_mod+CASE WHEN p_attack_type='kick' THEN -2 ELSE 0 END;

 FOREACH limb IN ARRAY p_limbs LOOP
  IF coalesce((attacker_start->'structure'->>limb)::int,0)<=0 THEN RAISE EXCEPTION '% is destroyed',limb;END IF;
  IF (p_attack_type='punch' OR physical_profile->>'arc'='arm')
   AND ((attack_diff IN (1,2) AND limb<>'la') OR (attack_diff IN (4,5) AND limb<>'ra'))
  THEN RAISE EXCEPTION 'Only the arm facing the target side may attack';END IF;
  SELECT EXISTS (SELECT 1 FROM btech_combat_events event
   CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(event.declaration->'weapon_mounts','[]'::jsonb)) chosen(mount_id)
   JOIN btech_catalogue_mounts mount ON mount.catalogue_version=p_catalogue_version AND mount.unit_id=attacker_start->>'unitId' AND mount.mount_id=chosen.mount_id
   WHERE event.game_id=p_game_id AND event.round=p_round AND event.phase='weapon_attack'
    AND event.attacker_instance_id=p_attacker_id AND mount.location=limb) INTO weapon_fired;
  IF weapon_fired THEN RAISE EXCEPTION 'A weapon fired from % this round',limb;END IF;
  tn:=base_tn;reduction:=0;
  IF p_attack_type='punch' OR physical_profile IS NOT NULL THEN
   IF btech_physical_component_damaged(p_catalogue_version,attacker_start,limb,'Shoulder') THEN RAISE EXCEPTION 'A damaged shoulder prevents this attack';END IF;
   upper_label:='Upper Arm Actuator';lower_label:='Lower Arm Actuator';hand_or_foot:='Hand Actuator';
   IF btech_physical_component_damaged(p_catalogue_version,attacker_start,limb,upper_label) THEN tn:=tn+2;reduction:=reduction+1;END IF;
   IF NOT btech_physical_component_exists(p_catalogue_version,attacker_start,limb,lower_label)
    OR btech_physical_component_damaged(p_catalogue_version,attacker_start,limb,lower_label) THEN tn:=tn+2;reduction:=reduction+1;END IF;
   IF NOT coalesce((physical_profile->>'ignore_hand')::boolean,false) AND (NOT btech_physical_component_exists(p_catalogue_version,attacker_start,limb,hand_or_foot)
    OR btech_physical_component_damaged(p_catalogue_version,attacker_start,limb,hand_or_foot)) THEN tn:=tn+1;END IF;
   IF physical_profile IS NULL THEN damage:=ceil(unit_mass/10.0)::int;
   ELSE
    damage:=CASE WHEN physical_profile ? 'damage' THEN (physical_profile->>'damage')::int
     ELSE ceil(unit_mass/(physical_profile->>'damage_divisor')::numeric)::int END+coalesce((physical_profile->>'damage_bonus')::int,0);
    tn:=tn+coalesce((physical_profile->>'to_hit')::int,0)+CASE WHEN physical_aim IS NULL THEN 0 ELSE 4 END;
    IF NOT coalesce((physical_profile->>'damage_actuators')::boolean,false) THEN reduction:=0;END IF;
   END IF;
  ELSE
   upper_label:='Upper Leg Actuator';lower_label:='Lower Leg Actuator';hand_or_foot:='Foot Actuator';damage:=ceil(unit_mass/5.0)::int;
   IF btech_physical_component_damaged(p_catalogue_version,attacker_start,limb,upper_label) THEN tn:=tn+2;reduction:=reduction+1;END IF;
   IF btech_physical_component_damaged(p_catalogue_version,attacker_start,limb,lower_label) THEN tn:=tn+2;reduction:=reduction+1;END IF;
   IF btech_physical_component_damaged(p_catalogue_version,attacker_start,limb,hand_or_foot) THEN tn:=tn+1;END IF;
  END IF;
  WHILE reduction>0 LOOP damage:=floor(damage/2.0)::int;reduction:=reduction-1;END LOOP;damage:=greatest(1,damage);
  IF p_resolve THEN
   die_a:=floor(random()*6+1);die_b:=floor(random()*6+1);hit:=tn<=2 OR (tn<=12 AND die_a+die_b>=tn);
   IF physical_profile IS NOT NULL AND coalesce((physical_profile->>'fumble')::boolean,false) AND die_a+die_b=2 THEN
    location_roll:=btech_roll_mech_hit_location('front');damage_result:=btech_apply_direct_damage(attacker,ceil(damage/2.0)::int,location_roll->>'location',false);attacker:=damage_result->'mech';
    fumble_psr:=btech_resolve_displacement_psr(p_catalogue_version,attacker,'wrecking ball fumble',0);attacker:=fumble_psr->'mech';
    results:=results||jsonb_build_array(jsonb_build_object('attack_type','physical_weapon','physical_weapon',physical_label,'physical_location_table',coalesce(physical_aim,'standard'),
     'limb',limb,'to_hit',jsonb_build_object('die_a',die_a,'die_b',die_b,'total',die_a+die_b,'target',tn),'hit',false,'fumble',true,
     'self_damage',ceil(damage/2.0)::int,'location',location_roll->>'location','critical_checks',damage_result->'critical_checks','pilot_check',fumble_psr->'check'));
   ELSIF hit THEN
    location_roll:=CASE
     WHEN coalesce((target_start->>'prone')::boolean,false) THEN btech_roll_mech_hit_location(angle)
     WHEN physical_aim='punch' OR (physical_profile IS NOT NULL AND physical_aim IS NULL AND level_difference<0) OR (p_attack_type='kick' AND level_difference<0) THEN btech_roll_physical_location('punch',angle)
     WHEN physical_aim='kick' OR (physical_profile IS NOT NULL AND physical_aim IS NULL AND level_difference>0) OR (p_attack_type='punch' AND level_difference>0) THEN btech_roll_physical_location('kick',angle)
     WHEN physical_profile IS NULL THEN btech_roll_physical_location(p_attack_type,angle)
     WHEN physical_profile->>'location_table'='punch' THEN btech_roll_physical_location('punch',angle)
     ELSE btech_roll_mech_hit_location(angle) END;
    damage_result:=btech_apply_direct_damage(target,damage,location_roll->>'location',angle='rear');target:=damage_result->'mech';
    results:=results||jsonb_build_array(jsonb_build_object('attack_type',CASE WHEN physical_profile IS NULL THEN p_attack_type ELSE 'physical_weapon' END,
     'physical_weapon',physical_label,'physical_location_table',coalesce(physical_aim,'standard'),'limb',limb,
     'to_hit',jsonb_build_object('die_a',die_a,'die_b',die_b,'total',die_a+die_b,'target',tn),'hit',true,'angle',angle,
     'location_roll',location_roll,'location',location_roll->>'location','damage',damage,'critical_checks',damage_result->'critical_checks','pilot_check',damage_result->'pilot_check',
     'target_prone',coalesce((target_start->>'prone')::boolean,false),'piloting_check_required',p_attack_type='kick' AND NOT coalesce((target_start->>'prone')::boolean,false),
     'piloting_check_unit',CASE WHEN p_attack_type='kick' AND NOT coalesce((target_start->>'prone')::boolean,false) THEN p_target_id END));
   ELSE
    results:=results||jsonb_build_array(jsonb_build_object('attack_type',CASE WHEN physical_profile IS NULL THEN p_attack_type ELSE 'physical_weapon' END,
     'physical_weapon',physical_label,'physical_location_table',coalesce(physical_aim,'standard'),'limb',limb,
     'to_hit',jsonb_build_object('die_a',die_a,'die_b',die_b,'total',die_a+die_b,'target',tn),'hit',false,
     'target_prone',coalesce((target_start->>'prone')::boolean,false),'piloting_check_required',p_attack_type='kick' AND NOT coalesce((target_start->>'prone')::boolean,false),
     'piloting_check_unit',CASE WHEN p_attack_type='kick' AND NOT coalesce((target_start->>'prone')::boolean,false) THEN p_attacker_id END));
   END IF;
  END IF;
 END LOOP;
 IF p_resolve THEN
  IF physical_profile IS NOT NULL AND coalesce((physical_profile->>'heat')::int,0)>0 THEN
   physical_heat:=(physical_profile->>'heat')::int;attacker:=jsonb_set(attacker,'{weaponHeat}',to_jsonb(coalesce((attacker->>'weaponHeat')::int,0)+physical_heat),true);
   attacker:=jsonb_set(attacker,'{heat}',to_jsonb(coalesce((attacker->>'heat')::int,0)+physical_heat),true);
  END IF;
  SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_target_id THEN target WHEN value->>'instanceId'=p_attacker_id THEN attacker ELSE value END)
   INTO units FROM jsonb_array_elements(st->'mech_instances') value;
  st:=jsonb_set(st,'{mech_instances}',units,true);
 END IF;
 RETURN jsonb_build_object('state',st,'results',results);
END $$;
REVOKE ALL ON FUNCTION public.btech_process_physical_declaration(uuid,text,int,jsonb,text,text,text,text[],boolean) FROM PUBLIC;

NOTIFY pgrst,'reload schema';
COMMIT;
