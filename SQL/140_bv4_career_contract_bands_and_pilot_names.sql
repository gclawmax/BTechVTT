-- BV-4: pilot-adjusted Career contract bands and pilot identity management.
-- Run after SQL/139. Career BV is calculated from pinned stock records and
-- current pilot skills; saved battle damage and ammunition never alter it.

CREATE OR REPLACE FUNCTION public.btech_career_force_bv(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE row record;entry jsonb;entries jsonb:='[]'::jsonb;stock_total int:=0;adjusted_total int:=0;
BEGIN
 FOR row IN
  SELECT m.id AS mech_id,m.unit_id,m.catalogue_version,p.id AS pilot_id,p.name AS pilot_name,p.callsign,p.gunnery,p.piloting
  FROM btech_career_owned_mechs m
  JOIN btech_career_mech_pilots mp ON mp.mech_id=m.id
  JOIN btech_career_pilots p ON p.id=mp.pilot_id
  WHERE m.company_id=p_company_id AND m.status='operational' AND p.status IN ('assigned','injured')
  ORDER BY m.acquired_at LIMIT 4
 LOOP
  entry:=btech_bv2_unit_value(row.catalogue_version,row.unit_id,row.gunnery,row.piloting)
   ||jsonb_build_object('mech_id',row.mech_id,'pilot_id',row.pilot_id,'pilot_name',row.pilot_name,'pilot_callsign',row.callsign);
  entries:=entries||jsonb_build_array(entry);
  stock_total:=stock_total+(entry->>'stock')::int;adjusted_total:=adjusted_total+(entry->>'adjusted')::int;
 END LOOP;
 RETURN jsonb_build_object('system','BV2','bv_version','BV2.1','stock',stock_total,'adjusted',adjusted_total,'entries',entries,'basis','pinned_stock_plus_current_pilot_skills');
END $$;
REVOKE ALL ON FUNCTION public.btech_career_force_bv(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_career_seed_contracts(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cycle int;company public.btech_career_companies%ROWTYPE;
BEGIN
 SELECT * INTO company FROM btech_career_companies WHERE id=p_company_id FOR UPDATE;
 IF company.id IS NULL THEN RAISE EXCEPTION 'Career company not found';END IF;
 IF EXISTS(SELECT 1 FROM btech_career_contracts WHERE company_id=company.id AND status IN ('available','accepted')) THEN RETURN;END IF;
 SELECT count(*)::int/3 INTO cycle FROM btech_career_contracts WHERE company_id=company.id;
 INSERT INTO btech_career_contracts(company_id,title,tier,opponent_kind,terms,status)
 VALUES
  (company.id,'Perimeter Security '||(cycle+1),'low','ai',jsonb_build_object('map_id','training-grounds','victory_mode','annihilation','ai_difficulty','beginner','ai_personality','balanced','base_pay',180000,'success_bonus',50000,'reputation',2,'bv_version','BV2.1','bv_min',1000,'bv_max',2300),'available'),
  (company.id,'Ridge Recon '||(cycle+1),'medium','ai',jsonb_build_object('map_id','ridge-and-ford','victory_mode','annihilation','ai_difficulty','intermediate','ai_personality','aggressive','base_pay',320000,'success_bonus',80000,'reputation',4,'bv_version','BV2.1','bv_min',1600,'bv_max',3600),'available'),
  (company.id,'Industrial Interdiction '||(cycle+1),'high','ai',jsonb_build_object('map_id','industrial-crossing','victory_mode','control','ai_difficulty','veteran','ai_personality','coordinated','base_pay',520000,'success_bonus',120000,'reputation',6,'bv_version','BV2.1','bv_min',2200,'bv_max',5200),'available');
END $$;
REVOKE ALL ON FUNCTION public.btech_career_seed_contracts(uuid) FROM PUBLIC;

-- Only unsigned offers are upgraded. Accepted contracts retain the terms they
-- were launched with, preserving rejoin and settlement behaviour.
UPDATE public.btech_career_contracts
SET terms=terms||CASE tier
 WHEN 'low' THEN jsonb_build_object('bv_version','BV2.1','bv_min',1000,'bv_max',2300)
 WHEN 'medium' THEN jsonb_build_object('bv_version','BV2.1','bv_min',1600,'bv_max',3600)
 ELSE jsonb_build_object('bv_version','BV2.1','bv_min',2200,'bv_max',5200) END
WHERE status='available' AND NOT terms?'bv_version';

DO $$
BEGIN
 IF to_regprocedure('public.btech_career_hq_without_bv4()') IS NULL THEN
  ALTER FUNCTION public.get_btech_career_hq() RENAME TO btech_career_hq_without_bv4;
 END IF;
 IF to_regprocedure('public.btech_career_launch_contract_without_bv4(uuid)') IS NULL THEN
  ALTER FUNCTION public.launch_btech_career_contract(uuid) RENAME TO btech_career_launch_contract_without_bv4;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.btech_career_hq_without_bv4() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.btech_career_launch_contract_without_bv4(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_btech_career_hq()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;company_id uuid;force_value jsonb;
BEGIN
 result:=btech_career_hq_without_bv4();
 company_id:=NULLIF(result->'company'->>'id','')::uuid;
 IF company_id IS NULL THEN RETURN result||jsonb_build_object('force_value',NULL);END IF;
 force_value:=btech_career_force_bv(company_id);
 RETURN result||jsonb_build_object('force_value',force_value);
END $$;
REVOKE ALL ON FUNCTION public.get_btech_career_hq() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_btech_career_hq() TO authenticated;

CREATE OR REPLACE FUNCTION public.launch_btech_career_contract(p_contract_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE company public.btech_career_companies%ROWTYPE;contract public.btech_career_contracts%ROWTYPE;force_value jsonb;force_total int;minimum_bv int;maximum_bv int;launched jsonb;game_state jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in before launching a Career contract';END IF;
 SELECT * INTO company FROM btech_career_companies WHERE user_id=auth.uid() FOR UPDATE;
 IF company.id IS NULL THEN RAISE EXCEPTION 'Create a Career company first';END IF;
 SELECT * INTO contract FROM btech_career_contracts WHERE id=p_contract_id AND company_id=company.id FOR UPDATE;
 IF contract.id IS NULL OR contract.status<>'available' THEN RAISE EXCEPTION 'This Career contract is no longer available';END IF;
 IF coalesce(contract.terms->>'bv_version','')<>'BV2.1' OR coalesce(contract.terms->>'bv_min','')!~'^[1-9][0-9]*$' OR coalesce(contract.terms->>'bv_max','')!~'^[1-9][0-9]*$' THEN RAISE EXCEPTION 'Career contract has no valid BV2.1 force band';END IF;
 minimum_bv:=(contract.terms->>'bv_min')::int;maximum_bv:=(contract.terms->>'bv_max')::int;
 IF minimum_bv>maximum_bv THEN RAISE EXCEPTION 'Career contract has an invalid BV band';END IF;
 force_value:=btech_career_force_bv(company.id);force_total:=(force_value->>'adjusted')::int;
 IF jsonb_array_length(force_value->'entries')=0 THEN RAISE EXCEPTION 'No operational Career BattleMech with an assigned pilot is available';END IF;
 IF force_total<minimum_bv OR force_total>maximum_bv THEN RAISE EXCEPTION 'Assigned Career lance is outside this contract''s BV2 band (% BV; requires %–%)',force_total,minimum_bv,maximum_bv;END IF;
 launched:=btech_career_launch_contract_without_bv4(p_contract_id);
 SELECT CASE jsonb_typeof(state) WHEN 'string' THEN (state#>>'{}')::jsonb ELSE state END INTO game_state FROM btech_games WHERE id=(launched->>'game_id')::uuid FOR UPDATE;
 game_state:=jsonb_set(game_state,'{career_context,signed_force_bv}',force_value,true);
 game_state:=jsonb_set(game_state,'{career_context,contract_bv_band}',jsonb_build_object('system','BV2','bv_version','BV2.1','minimum',minimum_bv,'maximum',maximum_bv),true);
 game_state:=jsonb_set(game_state,'{force_values,1}',force_value,true);
 UPDATE btech_games SET state=game_state WHERE id=(launched->>'game_id')::uuid;
 RETURN launched||jsonb_build_object('signed_force_bv',force_value,'contract_bv_band',game_state->'career_context'->'contract_bv_band');
END $$;
REVOKE ALL ON FUNCTION public.launch_btech_career_contract(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.launch_btech_career_contract(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rename_btech_career_pilot(p_pilot_id uuid,p_name text,p_callsign text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE pilot public.btech_career_pilots%ROWTYPE;clean_name text:=btrim(coalesce(p_name,''));clean_callsign text:=NULLIF(btrim(coalesce(p_callsign,'')),'');
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in before renaming a Career pilot';END IF;
 IF char_length(clean_name) NOT BETWEEN 1 AND 48 THEN RAISE EXCEPTION 'Pilot names must be between 1 and 48 characters';END IF;
 IF clean_callsign IS NOT NULL AND char_length(clean_callsign) NOT BETWEEN 1 AND 32 THEN RAISE EXCEPTION 'Pilot callsigns must be between 1 and 32 characters';END IF;
 SELECT p.* INTO pilot FROM btech_career_pilots p JOIN btech_career_companies c ON c.id=p.company_id WHERE p.id=p_pilot_id AND c.user_id=auth.uid() FOR UPDATE OF p;
 IF pilot.id IS NULL THEN RAISE EXCEPTION 'Career pilot not found';END IF;
 UPDATE btech_career_pilots SET name=clean_name,callsign=clean_callsign WHERE id=pilot.id;
 RETURN jsonb_build_object('id',pilot.id,'name',clean_name,'callsign',clean_callsign);
END $$;
REVOKE ALL ON FUNCTION public.rename_btech_career_pilot(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rename_btech_career_pilot(uuid,text,text) TO authenticated;

NOTIFY pgrst,'reload schema';
