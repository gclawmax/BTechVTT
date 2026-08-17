-- Repair incomplete match snapshots created before the lobby saved full
-- armour/internal-structure records. Run once after SQL/42.
--
-- The browser could render those fields from the catalogue, but the
-- authoritative server saw absent leg structure as zero and rejected all
-- movement. New games now save complete records; this migration repairs any
-- lobby or in-progress game created by the earlier client.

CREATE OR REPLACE FUNCTION public.btech_hydrate_catalogue_mech(
 p_catalogue_version text,p_mech jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE result jsonb:=p_mech;unit_definition jsonb;bins jsonb;
BEGIN
 SELECT definition INTO unit_definition FROM btech_catalogue_units
  WHERE catalogue_version=p_catalogue_version AND unit_id=p_mech->>'unitId';
 IF unit_definition IS NULL THEN RETURN result;END IF;
 IF NOT (result ? 'armor') THEN result:=jsonb_set(result,'{armor}',coalesce(unit_definition->'armor','{}'::jsonb),true);END IF;
 IF NOT (result ? 'structure') THEN result:=jsonb_set(result,'{structure}',coalesce(unit_definition->'structure','{}'::jsonb),true);END IF;
 IF NOT (result ? 'ammoBins') THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',bin.bin_id,'type',bin.ammo_type,'location',bin.location,'shots',bin.shots,'maxShots',bin.shots
  ) ORDER BY bin.bin_id),'[]'::jsonb) INTO bins
  FROM btech_catalogue_ammo_bins bin
  WHERE bin.catalogue_version=p_catalogue_version AND bin.unit_id=p_mech->>'unitId';
  result:=jsonb_set(result,'{ammoBins}',bins,true);
 END IF;
 IF NOT (result ? 'pilot') THEN result:=jsonb_set(result,'{pilot}','{"hits":0,"consciousness":"conscious"}'::jsonb,true);END IF;
 IF NOT (result ? 'criticalSlotDamage') THEN result:=jsonb_set(result,'{criticalSlotDamage}','{}'::jsonb,true);END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.btech_hydrate_catalogue_mech(text,jsonb) FROM PUBLIC;

WITH hydrated AS (
 SELECT game.id,
  jsonb_set(
   CASE jsonb_typeof(game.state) WHEN 'string' THEN (game.state#>>'{}')::jsonb ELSE game.state END,
   '{mech_instances}',
   coalesce((SELECT jsonb_agg(btech_hydrate_catalogue_mech(game.catalogue_version,entry.value) ORDER BY entry.ordinality)
     FROM jsonb_array_elements(coalesce((CASE jsonb_typeof(game.state) WHEN 'string' THEN (game.state#>>'{}')::jsonb ELSE game.state END)->'mech_instances','[]'::jsonb)) WITH ORDINALITY entry(value, ordinality)), '[]'::jsonb),
   true
  ) AS state
 FROM btech_games game
 WHERE game.status IN ('lobby','in-progress') AND game.catalogue_version IS NOT NULL
)
UPDATE btech_games game SET state=hydrated.state FROM hydrated WHERE game.id=hydrated.id;
