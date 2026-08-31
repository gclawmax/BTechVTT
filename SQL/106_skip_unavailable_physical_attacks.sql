-- A Physical Attack phase must not remain open merely because enemies are
-- adjacent.  Check the same meaningful prerequisites as the authoritative
-- resolver: a current special-attack declaration, a usable punch, kick or
-- push.  Physical weapons are deliberately treated as a possible option
-- here; their specific mounted-equipment check remains in the resolver, so a
-- rare catalogue profile can never be skipped incorrectly.

CREATE OR REPLACE FUNCTION public.btech_has_remaining_physical_option(
 p_game_id uuid,p_catalogue_version text,p_round int,p_state jsonb,p_attacker jsonb
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE attacker_start jsonb:=coalesce(p_attacker->'physicalPhaseStart'->'mech',p_attacker);target jsonb;target_start jsonb;
 attack_direction int;attack_diff int;level_difference int;limb text;arm_weapon_fired boolean;has_physical_weapon boolean;
BEGIN
 IF p_attacker ? 'dfaDeclaration' OR p_attacker ? 'chargeDeclaration' OR coalesce((attacker_start->>'improvisedClub')::boolean,false) THEN RETURN true;END IF;
 IF coalesce((p_attacker->>'hasPhysicalAttacked')::boolean,false) OR coalesce((attacker_start->>'destroyed')::boolean,false)
  OR coalesce((attacker_start->>'prone')::boolean,false) OR coalesce((attacker_start->>'shutdown')::boolean,false)
  OR coalesce(attacker_start->'pilot'->>'consciousness','conscious')<>'conscious' THEN RETURN false;END IF;
 -- Do not auto-skip a BattleMech that has a catalogue-defined physical weapon;
 -- its detailed installation and actuator tests are performed on declaration.
 SELECT EXISTS (SELECT 1 FROM btech_catalogue_critical_slots slot
  WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=attacker_start->>'unitId'
   AND btech_physical_weapon_profile(lower(replace(slot.label,' ', '_'))) IS NOT NULL) INTO has_physical_weapon;
 IF has_physical_weapon THEN RETURN true;END IF;
 FOR target IN SELECT value FROM jsonb_array_elements(coalesce(p_state->'mech_instances','[]'::jsonb)) value LOOP
  target_start:=coalesce(target->'physicalPhaseStart'->'mech',target);
  IF (target_start->>'owner')::int=(attacker_start->>'owner')::int OR coalesce((target_start->>'destroyed')::boolean,false) THEN CONTINUE;END IF;
  IF btech_hex_distance((attacker_start->>'col')::int,(attacker_start->>'row')::int,(target_start->>'col')::int,(target_start->>'row')::int)<>1 THEN CONTINUE;END IF;
  attack_direction:=btech_direction_to((attacker_start->>'col')::int,(attacker_start->>'row')::int,(target_start->>'col')::int,(target_start->>'row')::int);
  attack_diff:=(attack_direction-(attacker_start->>'facing')::int+6)%6;
  level_difference:=btech_elevation(coalesce(p_state->>'map_id','training-grounds'),lpad(target_start->>'col',2,'0')||lpad(target_start->>'row',2,'0'))
   - btech_elevation(coalesce(p_state->>'map_id','training-grounds'),lpad(attacker_start->>'col',2,'0')||lpad(attacker_start->>'row',2,'0'));
  IF abs(level_difference)>1 THEN CONTINUE;END IF;
  -- A kick remains legal when a target is prone, but not when it is higher
  -- than the attacker; no arm-weapon use can prevent a kick.
  IF attack_diff IN (0,1,5) AND (coalesce((target_start->>'prone')::boolean,false) OR level_difference<=0)
   AND NOT (btech_physical_component_damaged(p_catalogue_version,attacker_start,'ll','Hip') OR btech_physical_component_damaged(p_catalogue_version,attacker_start,'rl','Hip'))
   AND (coalesce((attacker_start->'structure'->>'ll')::int,0)>0 OR coalesce((attacker_start->'structure'->>'rl')::int,0)>0) THEN RETURN true;END IF;
  -- Standard punches need a standing target, a non-rear arc, the matching
  -- surviving arm/shoulder, and an arm that did not fire in Weapon Attack.
  IF NOT coalesce((target_start->>'prone')::boolean,false) AND level_difference>=0 AND attack_diff<>3 THEN
   FOREACH limb IN ARRAY CASE WHEN attack_diff IN (1,2) THEN ARRAY['la']::text[] WHEN attack_diff IN (4,5) THEN ARRAY['ra']::text[] ELSE ARRAY['la','ra']::text[] END LOOP
    IF coalesce((attacker_start->'structure'->>limb)::int,0)<=0 OR btech_physical_component_damaged(p_catalogue_version,attacker_start,limb,'Shoulder') THEN CONTINUE;END IF;
    SELECT EXISTS (SELECT 1 FROM btech_combat_events event CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(event.declaration->'weapon_mounts','[]'::jsonb)) chosen(mount_id)
     JOIN btech_catalogue_mounts mount ON mount.catalogue_version=p_catalogue_version AND mount.unit_id=attacker_start->>'unitId' AND mount.mount_id=chosen.mount_id
     WHERE event.game_id=p_game_id AND event.round=p_round AND event.phase='weapon_attack' AND event.attacker_instance_id=p_attacker->>'instanceId' AND mount.location=limb) INTO arm_weapon_fired;
    IF NOT arm_weapon_fired THEN RETURN true;END IF;
   END LOOP;
  END IF;
 END LOOP;
 RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.btech_has_remaining_physical_option(uuid,text,int,jsonb,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.skip_empty_physical_phase(p_game_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;st jsonb;first_player uuid;has_option boolean;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 IF NOT FOUND OR g.current_phase<>'physical_attack' THEN RETURN false;END IF;
 IF NOT EXISTS (SELECT 1 FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid()) THEN RAISE EXCEPTION 'Only a game participant may check the Physical Attack phase';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN coalesce((g.state#>>'{}')::jsonb,'{}'::jsonb) WHEN 'object' THEN g.state ELSE '{}'::jsonb END;
 SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(st->'mech_instances','[]'::jsonb)) mech(value)
  WHERE btech_has_remaining_physical_option(p_game_id,g.catalogue_version,g.current_round,st,mech.value)) INTO has_option;
 IF has_option THEN RETURN false;END IF;
 SELECT (st->'initiative_order'->0->>'player_id')::uuid INTO first_player;
 st:=jsonb_set(st,'{mech_instances}',(SELECT jsonb_agg(jsonb_set(jsonb_set(value,'{hasPhysicalAttacked}','true'::jsonb,true),'{hasManagedHeat}','false'::jsonb,true)) FROM jsonb_array_elements(coalesce(st->'mech_instances','[]'::jsonb)) value),true);
 st:=jsonb_set(st,'{active_player_player_id}',to_jsonb(first_player),true);
 UPDATE btech_games SET current_phase='heat',active_player_id=first_player,state=st WHERE id=p_game_id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.skip_empty_physical_phase(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.skip_empty_physical_phase(uuid) TO authenticated;

NOTIFY pgrst,'reload schema';
