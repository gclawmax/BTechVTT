-- Scenario presets once used hyphenated variant IDs while the expanded
-- MegaMek catalogue uses compact IDs (for example WVR-6R -> wvr6r).
-- Repair only a lobby or an untouched Round 1 Initiative match, and only
-- when every saved unit has one unambiguous equivalent in its pinned release.

CREATE OR REPLACE FUNCTION public.repair_btech_match_catalogue_unit_ids(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE; st jsonb; roster_key text; roster jsonb; revised_roster jsonb; instance jsonb; revised_instances jsonb:='[]'::jsonb; source_id text; resolved_id text; changed boolean:=false;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 IF NOT FOUND OR auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM btech_players p WHERE p.game_id=p_game_id AND p.user_id=auth.uid()) THEN RAISE EXCEPTION 'Only a match participant may repair scenario unit IDs';END IF;
 IF g.catalogue_version IS NULL THEN RAISE EXCEPTION 'This match has no pinned catalogue';END IF;
 IF g.status NOT IN ('lobby','in-progress') OR (g.status='in-progress' AND (g.current_round<>1 OR g.current_phase<>'initiative')) THEN RAISE EXCEPTION 'Scenario catalogue IDs can be repaired only before Round 1 actions begin';END IF;
 st:=CASE WHEN jsonb_typeof(g.state)='string' THEN (g.state#>>'{}')::jsonb ELSE coalesce(g.state,'{}'::jsonb) END;
 FOR roster_key,roster IN SELECT key,value FROM jsonb_each(CASE WHEN jsonb_typeof(st->'rosters')='object' THEN st->'rosters' ELSE '{}'::jsonb END) LOOP
  SELECT coalesce(jsonb_agg(to_jsonb(coalesce(mapped.unit_id,item.value#>>'{}')) ORDER BY item.ordinality),'[]'::jsonb) INTO revised_roster
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(roster)='array' THEN roster ELSE '[]'::jsonb END) WITH ORDINALITY item(value,ordinality)
  LEFT JOIN LATERAL (SELECT u.unit_id FROM btech_catalogue_units u WHERE u.catalogue_version=g.catalogue_version AND replace(u.unit_id,'-','')=replace(item.value#>>'{}','-','') ORDER BY CASE WHEN u.unit_id=item.value#>>'{}' THEN 0 ELSE 1 END,u.unit_id LIMIT 1) mapped ON true;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(revised_roster) item WHERE NOT EXISTS (SELECT 1 FROM btech_catalogue_units u WHERE u.catalogue_version=g.catalogue_version AND u.unit_id=item#>>'{}')) THEN RAISE EXCEPTION 'The pinned catalogue does not contain every scenario BattleMech';END IF;
  changed:=changed OR revised_roster IS DISTINCT FROM roster;st:=jsonb_set(st,ARRAY['rosters',roster_key],revised_roster,true);
 END LOOP;
 FOR instance IN SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(st->'mech_instances')='array' THEN st->'mech_instances' ELSE '[]'::jsonb END) LOOP
  source_id:=instance->>'unitId';SELECT u.unit_id INTO resolved_id FROM btech_catalogue_units u WHERE u.catalogue_version=g.catalogue_version AND replace(u.unit_id,'-','')=replace(source_id,'-','') ORDER BY CASE WHEN u.unit_id=source_id THEN 0 ELSE 1 END,u.unit_id LIMIT 1;
  IF resolved_id IS NULL THEN RAISE EXCEPTION 'The pinned catalogue does not contain scenario BattleMech: %',source_id;END IF;
  changed:=changed OR resolved_id IS DISTINCT FROM source_id;revised_instances:=revised_instances || jsonb_build_array(jsonb_set(jsonb_set(instance,'{unitId}',to_jsonb(resolved_id),true),'{catalogueVersion}',to_jsonb(g.catalogue_version),true));
 END LOOP;
 st:=jsonb_set(st,'{mech_instances}',revised_instances,true);
 IF changed THEN UPDATE btech_games SET state=st WHERE id=p_game_id;END IF;
 RETURN jsonb_build_object('repaired',changed,'catalogue_version',g.catalogue_version,'state',st);
END $$;
REVOKE ALL ON FUNCTION public.repair_btech_match_catalogue_unit_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.repair_btech_match_catalogue_unit_ids(uuid) TO authenticated;
