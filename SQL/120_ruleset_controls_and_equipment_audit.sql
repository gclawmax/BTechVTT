-- SR-6: era/ruleset controls for curated BattleMech duels. Run after SQL/119.
-- The catalogue stays immutable; this reads its pinned definition and critical
-- layout whenever a lobby roster is saved.

CREATE OR REPLACE FUNCTION public.btech_ruleset_unit_allowed(p_catalogue_version text,p_unit_id text,p_ruleset text)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE definition jsonb;era int;has_void boolean;has_standard_excluded boolean;
BEGIN
 IF p_ruleset NOT IN ('standard_3060','advanced_3060','open_experimental') THEN RETURN false;END IF;
 IF p_ruleset='open_experimental' THEN RETURN EXISTS(SELECT 1 FROM btech_catalogue_units unit WHERE unit.catalogue_version=p_catalogue_version AND unit.unit_id=p_unit_id AND coalesce((unit.definition->>'supported_by_vtt')::boolean,false));END IF;
 SELECT unit.definition INTO definition FROM btech_catalogue_units unit WHERE unit.catalogue_version=p_catalogue_version AND unit.unit_id=p_unit_id AND coalesce((unit.definition->>'supported_by_vtt')::boolean,false);
 IF definition IS NULL THEN RETURN false;END IF;
 era:=coalesce((definition->>'era')::int,0);IF era>3060 THEN RETURN false;END IF;
 SELECT EXISTS(SELECT 1 FROM btech_catalogue_critical_slots slot WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=p_unit_id AND btech_equipment_label_key(slot.label)='voidsignaturesystem') INTO has_void;
 IF has_void THEN RETURN false;END IF;
 IF p_ruleset='advanced_3060' THEN RETURN true;END IF;
 IF coalesce((definition->>'custom_design')::boolean,false) THEN RETURN false;END IF;
 SELECT EXISTS(SELECT 1 FROM btech_catalogue_critical_slots slot WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=p_unit_id AND btech_equipment_label_key(slot.label) IN ('supercharger','triplestrengthmyomer','angelecmsuite','watchdogcews','watchdogecm','nullsignaturesystem','chameleonlightpolarizationshield','chameleonlightpolarizationfield')) INTO has_standard_excluded;
 RETURN NOT has_standard_excluded;
END $$;
REVOKE ALL ON FUNCTION public.btech_ruleset_unit_allowed(text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.update_lobby_roster(p_game_id uuid,p_roster jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE seat_no int;version_id text;match_state jsonb;ruleset text;
BEGIN
 IF jsonb_typeof(p_roster)<>'array' OR jsonb_array_length(p_roster)>6 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_roster) entry WHERE jsonb_typeof(entry.value)<>'string') THEN RAISE EXCEPTION 'Roster must be an array of at most six unit IDs';END IF;
 SELECT player.seat_number,game.catalogue_version,CASE jsonb_typeof(game.state) WHEN 'string' THEN coalesce((game.state#>>'{}')::jsonb,'{}'::jsonb) WHEN 'object' THEN game.state ELSE '{}'::jsonb END INTO seat_no,version_id,match_state FROM btech_players player JOIN btech_games game ON game.id=player.game_id WHERE player.game_id=p_game_id AND player.user_id=auth.uid() AND player.role='player';
 IF seat_no IS NULL THEN RAISE EXCEPTION 'Only a seated player may update a roster';END IF;
 ruleset:=coalesce(match_state->>'ruleset','advanced_3060');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_roster) chosen(unit_value) WHERE NOT EXISTS(SELECT 1 FROM btech_catalogue_units unit WHERE unit.catalogue_version=version_id AND unit.unit_id=chosen.unit_value AND coalesce((unit.definition->>'supported_by_vtt')::boolean,false) AND (NOT coalesce((unit.definition->>'custom_design')::boolean,false) OR (unit.definition->>'custom_owner_id'=auth.uid()::text AND NOT coalesce((unit.definition->>'custom_archived')::boolean,false))))) THEN RAISE EXCEPTION 'Roster contains an unsupported, archived, or another player''s custom BattleMech';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_roster) chosen(unit_value) WHERE NOT btech_ruleset_unit_allowed(version_id,chosen.unit_value,ruleset)) THEN RAISE EXCEPTION 'Roster contains a BattleMech unavailable under the % ruleset',ruleset;END IF;
 UPDATE btech_games SET state=jsonb_set(CASE jsonb_typeof(state) WHEN 'string' THEN coalesce((state#>>'{}')::jsonb,'{}'::jsonb) WHEN 'object' THEN state ELSE '{}'::jsonb END,ARRAY['rosters',seat_no::text],p_roster,true) WHERE id=p_game_id AND status='lobby';IF NOT FOUND THEN RAISE EXCEPTION 'Roster updates are available only while the game is in the lobby';END IF;
END $$;
REVOKE ALL ON FUNCTION public.update_lobby_roster(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_lobby_roster(uuid,jsonb) TO authenticated;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.update_skirmish_hangar(uuid,jsonb,jsonb)');IF fn IS NULL THEN RAISE EXCEPTION 'Skirmish Hangar function is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('sr6_ruleset_hangar_v1' IN source)=0 THEN
  patched:=replace(source,'total_tonnage int; entry jsonb;','total_tonnage int; ruleset text; entry jsonb;');
  IF patched=source THEN RAISE EXCEPTION 'Could not locate Skirmish Hangar declarations';END IF;
  source:=patched;
  patched:=replace(source,'st:=CASE jsonb_typeof(g.state) WHEN ''string'' THEN (g.state#>>''{}'')::jsonb ELSE coalesce(g.state,''{}''::jsonb) END;IF total_tonnage>','st:=CASE jsonb_typeof(g.state) WHEN ''string'' THEN (g.state#>>''{}'')::jsonb ELSE coalesce(g.state,''{}''::jsonb) END;ruleset:=coalesce(st->>''ruleset'',''advanced_3060'');IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_deployed) deployment(entry_id) JOIN LATERAL (SELECT value AS entry FROM jsonb_array_elements(normalized_hangar) WHERE value->>''id''=deployment.entry_id) item ON true WHERE NOT btech_ruleset_unit_allowed(g.catalogue_version,item.entry->>''unit_id'',ruleset)) THEN RAISE EXCEPTION ''A deployed BattleMech is unavailable under the % ruleset'',ruleset;END IF;IF total_tonnage>');
  IF patched=source OR position('sr6_ruleset_hangar_v1' IN patched)>0 THEN RAISE EXCEPTION 'Could not safely install Skirmish Hangar ruleset enforcement';END IF;
  patched:=replace(patched,'IF total_tonnage>','/* sr6_ruleset_hangar_v1 */ IF total_tonnage>');
  IF position('sr6_ruleset_hangar_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not mark Skirmish Hangar ruleset enforcement';END IF;EXECUTE patched;
 END IF;
END $$;

NOTIFY pgrst,'reload schema';
