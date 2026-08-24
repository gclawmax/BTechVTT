-- Repair matches created before catalogue versions were pinned.
--
-- The repair is deliberately participant-scoped and evidence-based: it will
-- only choose a release containing every unit already saved in the match. Once
-- set, SQL 18's immutability trigger prevents the pin from changing again.

CREATE OR REPLACE FUNCTION public.repair_legacy_match_catalogue_pin(p_game_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g public.btech_games%ROWTYPE;
  match_state jsonb;
  saved_version text;
  selected_version text;
  deployed_unit_ids text[];
  stamped_instances jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO g
  FROM public.btech_games
  WHERE id = p_game_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.btech_players p
    WHERE p.game_id = p_game_id
      AND p.user_id = auth.uid()
      AND p.role = 'player'
  ) THEN
    RAISE EXCEPTION 'Only a player in this match may repair its catalogue pin';
  END IF;

  match_state := CASE
    WHEN g.state IS NULL THEN '{}'::jsonb
    WHEN jsonb_typeof(g.state) = 'object' THEN g.state
    ELSE '{}'::jsonb
  END;

  IF g.catalogue_version IS NOT NULL THEN
    RETURN jsonb_build_object(
      'catalogue_version', g.catalogue_version,
      'state', match_state,
      'repaired', false
    );
  END IF;

  SELECT array_agg(DISTINCT unit_id ORDER BY unit_id)
  INTO deployed_unit_ids
  FROM (
    SELECT instance.value->>'unitId' AS unit_id
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(match_state->'mech_instances') = 'array'
        THEN match_state->'mech_instances' ELSE '[]'::jsonb END
    ) AS instance(value)
    UNION
    SELECT roster_unit.value #>> '{}' AS unit_id
    FROM jsonb_each(
      CASE WHEN jsonb_typeof(match_state->'rosters') = 'object'
        THEN match_state->'rosters' ELSE '{}'::jsonb END
    ) AS roster
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(roster.value) = 'array'
        THEN roster.value ELSE '[]'::jsonb END
    ) AS roster_unit(value)
  ) ids
  WHERE coalesce(unit_id, '') <> '';

  IF coalesce(array_length(deployed_unit_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'This legacy match has no roster or deployed units from which to identify its catalogue';
  END IF;

  -- Prefer a release recorded in the old JSON snapshot when it is complete.
  saved_version := nullif(match_state->>'catalogue_version', '');
  IF saved_version IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.btech_catalogue_releases r WHERE r.version = saved_version)
     AND NOT EXISTS (
       SELECT 1 FROM unnest(deployed_unit_ids) unit_id
       WHERE NOT EXISTS (
         SELECT 1 FROM public.btech_catalogue_units u
         WHERE u.catalogue_version = saved_version AND u.unit_id = unit_id
       )
     ) THEN
    selected_version := saved_version;
  END IF;

  -- Otherwise use the newest single release that contains every deployed unit.
  IF selected_version IS NULL THEN
    SELECT r.version INTO selected_version
    FROM public.btech_catalogue_releases r
    WHERE NOT EXISTS (
      SELECT 1 FROM unnest(deployed_unit_ids) unit_id
      WHERE NOT EXISTS (
        SELECT 1 FROM public.btech_catalogue_units u
        WHERE u.catalogue_version = r.version AND u.unit_id = unit_id
      )
    )
    ORDER BY r.generated_at DESC, r.version DESC
    LIMIT 1;
  END IF;

  IF selected_version IS NULL THEN
    RAISE EXCEPTION 'No installed catalogue contains every BattleMech deployed in this legacy match';
  END IF;

  SELECT jsonb_agg(
    jsonb_set(instance, '{catalogueVersion}', to_jsonb(selected_version), true)
    ORDER BY ordinal
  )
  INTO stamped_instances
  FROM jsonb_array_elements(match_state->'mech_instances') WITH ORDINALITY AS item(instance, ordinal);

  match_state := jsonb_set(match_state, '{catalogue_version}', to_jsonb(selected_version), true);
  match_state := jsonb_set(match_state, '{mech_instances}', coalesce(stamped_instances, '[]'::jsonb), true);

  UPDATE public.btech_games
  SET catalogue_version = selected_version,
      state = match_state
  WHERE id = p_game_id;

  RETURN jsonb_build_object(
    'catalogue_version', selected_version,
    'state', match_state,
    'repaired', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.repair_legacy_match_catalogue_pin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.repair_legacy_match_catalogue_pin(uuid) TO authenticated;
