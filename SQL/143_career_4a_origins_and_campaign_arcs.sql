-- Career-4a: immutable origins, origin starter packages and campaign arcs.
-- Run after SQL/142. Cross-company PvP tenders remain a separate Career-4b
-- slice because they require two-company consent and settlement.

ALTER TABLE public.btech_career_companies ADD COLUMN IF NOT EXISTS origin text CHECK(origin IN('Independent','Inner Sphere','Clan'));
UPDATE public.btech_career_companies SET origin=affiliation WHERE origin IS NULL;
ALTER TABLE public.btech_career_companies ALTER COLUMN origin SET DEFAULT 'Independent';
ALTER TABLE public.btech_career_companies ALTER COLUMN origin SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.btech_career_arc_definitions (
 id text PRIMARY KEY,origin text NOT NULL UNIQUE CHECK(origin IN('Independent','Inner Sphere','Clan')),
 title text NOT NULL,summary text NOT NULL,steps jsonb NOT NULL CHECK(jsonb_typeof(steps)='array' AND jsonb_array_length(steps)=3)
);
INSERT INTO public.btech_career_arc_definitions(id,origin,title,summary,steps) VALUES
 ('mercenary-ascendant','Independent','Mercenary Ascendant','Turn an unknown command into a trusted independent company.','[{"title":"Proving the Company","briefing":"Win a clean field engagement and establish your name."},{"title":"A Contract in Question","briefing":"Secure disputed objectives without losing operational control."},{"title":"The Commander’s Gambit","briefing":"Break through a veteran screen and claim a place among established commands."}]'),
 ('border-guard','Inner Sphere','The Border Guard','Defend vulnerable worlds while political pressure tests the company.','[{"title":"Border Patrol","briefing":"Destroy raiders threatening the local supply corridor."},{"title":"Counterstroke","briefing":"Retake strategic ground before reinforcements arrive."},{"title":"Hold the Line","briefing":"Pierce the hostile advance and preserve the regional defence."}]'),
 ('trial-by-fire','Clan','Trial by Fire','Earn recognition through escalating battlefield trials.','[{"title":"Trial of Position","briefing":"Demonstrate the command’s right to take the field."},{"title":"Blooded Pursuit","briefing":"Seize contested ground from a worthy opponent."},{"title":"Trial of Possession","briefing":"Break the final defence and claim the campaign prize."}]')
ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,summary=EXCLUDED.summary,steps=EXCLUDED.steps;
REVOKE ALL ON public.btech_career_arc_definitions FROM PUBLIC,anon,authenticated;

CREATE TABLE IF NOT EXISTS public.btech_career_company_arcs (
 company_id uuid PRIMARY KEY REFERENCES public.btech_career_companies(id) ON DELETE CASCADE,
 arc_id text NOT NULL REFERENCES public.btech_career_arc_definitions(id),current_step integer NOT NULL DEFAULT 1 CHECK(current_step BETWEEN 1 AND 3),
 status text NOT NULL DEFAULT 'active' CHECK(status IN('active','completed')),started_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.btech_career_arc_awards (
 settlement_id uuid PRIMARY KEY REFERENCES public.btech_career_settlements(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES public.btech_career_companies(id) ON DELETE CASCADE,arc_id text NOT NULL,attempted_step integer NOT NULL CHECK(attempted_step BETWEEN 1 AND 3),succeeded boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.btech_career_company_arcs ENABLE ROW LEVEL SECURITY;ALTER TABLE public.btech_career_arc_awards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.btech_career_company_arcs,public.btech_career_arc_awards FROM PUBLIC,anon,authenticated;
DROP POLICY IF EXISTS "Career arc owner read" ON public.btech_career_company_arcs;
CREATE POLICY "Career arc owner read" ON public.btech_career_company_arcs FOR SELECT USING(EXISTS(SELECT 1 FROM btech_career_companies c WHERE c.id=btech_career_company_arcs.company_id AND c.user_id=auth.uid()));
DROP POLICY IF EXISTS "Career arc award owner read" ON public.btech_career_arc_awards;
CREATE POLICY "Career arc award owner read" ON public.btech_career_arc_awards FOR SELECT USING(EXISTS(SELECT 1 FROM btech_career_companies c WHERE c.id=btech_career_arc_awards.company_id AND c.user_id=auth.uid()));

CREATE OR REPLACE FUNCTION public.btech_career_ensure_arc(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 INSERT INTO btech_career_company_arcs(company_id,arc_id) SELECT c.id,a.id FROM btech_career_companies c JOIN btech_career_arc_definitions a ON a.origin=c.origin WHERE c.id=p_company_id ON CONFLICT(company_id) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.btech_career_ensure_arc(uuid) FROM PUBLIC;

DO $$ BEGIN
 IF to_regprocedure('public.btech_career_create_without_career4a(text,text,text,text)') IS NULL THEN ALTER FUNCTION public.create_btech_career_company(text,text,text,text) RENAME TO btech_career_create_without_career4a;END IF;
END $$;
REVOKE ALL ON FUNCTION public.btech_career_create_without_career4a(text,text,text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.create_btech_career_company(p_name text,p_commander_callsign text,p_affiliation text,p_banner_color text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE existing btech_career_companies%ROWTYPE;result jsonb;company btech_career_companies%ROWTYPE;mech record;replacement text;condition jsonb;position int:=0;
BEGIN
 SELECT * INTO existing FROM btech_career_companies WHERE user_id=auth.uid() FOR UPDATE;
 IF existing.id IS NOT NULL AND existing.origin<>p_affiliation THEN RAISE EXCEPTION 'A Career company origin is fixed after founding';END IF;
 result:=btech_career_create_without_career4a(p_name,p_commander_callsign,p_affiliation,p_banner_color);
 SELECT * INTO company FROM btech_career_companies WHERE id=(result->>'company_id')::uuid FOR UPDATE;
 IF coalesce((result->>'created')::boolean,false) THEN
  UPDATE btech_career_companies SET origin=p_affiliation,current_world_id=CASE p_affiliation WHEN 'Clan' THEN 'twycross' WHEN 'Inner Sphere' THEN 'northwind' ELSE 'galatea' END,market_epoch=market_epoch+1 WHERE id=company.id;
  IF p_affiliation='Clan' THEN
   FOR mech IN SELECT id,catalogue_version FROM btech_career_owned_mechs WHERE company_id=company.id ORDER BY acquired_at LOOP
    position:=position+1;replacement:=CASE position WHEN 1 THEN 'adder-prime' ELSE 'puma-adder-a' END;
    IF NOT EXISTS(SELECT 1 FROM btech_catalogue_units u WHERE u.catalogue_version=mech.catalogue_version AND u.unit_id=replacement AND coalesce((u.definition->>'supported_by_vtt')::boolean,false)) THEN RAISE EXCEPTION 'Clan Career origin requires % in catalogue %',replacement,mech.catalogue_version;END IF;
    condition:=btech_career_fresh_condition(mech.catalogue_version,replacement);
    UPDATE btech_career_owned_mechs SET unit_id=replacement,armor=condition->'armor',structure=condition->'structure',critical_slot_damage=condition->'critical_slot_damage',ammo_bins=condition->'ammo_bins',pilot_state=condition->'pilot_state' WHERE id=mech.id;
   END LOOP;
  END IF;
 END IF;
 PERFORM btech_career_ensure_arc(company.id);RETURN result||jsonb_build_object('origin',CASE WHEN coalesce((result->>'created')::boolean,false) THEN p_affiliation ELSE company.origin END);
END $$;
REVOKE ALL ON FUNCTION public.create_btech_career_company(text,text,text,text) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.create_btech_career_company(text,text,text,text) TO authenticated;

-- The middle offer is the current origin-arc operation. Regular low/high work
-- remains available so an arc never blocks the broader Career economy.
CREATE OR REPLACE FUNCTION public.btech_career_seed_contracts(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cycle_no int;company btech_career_companies%ROWTYPE;world btech_career_worlds%ROWTYPE;employer text;opposition text;arc record;step_data jsonb;featured_title text;
BEGIN
 SELECT * INTO company FROM btech_career_companies WHERE id=p_company_id FOR UPDATE;IF company.id IS NULL THEN RAISE EXCEPTION 'Career company not found';END IF;IF EXISTS(SELECT 1 FROM btech_career_contracts WHERE company_id=company.id AND status IN('available','accepted')) THEN RETURN;END IF;
 PERFORM btech_career_ensure_arc(company.id);SELECT ca.*,ad.title AS arc_title,ad.steps INTO arc FROM btech_career_company_arcs ca JOIN btech_career_arc_definitions ad ON ad.id=ca.arc_id WHERE ca.company_id=company.id;
 step_data:=arc.steps->(arc.current_step-1);featured_title:=CASE WHEN arc.status='active' THEN step_data->>'title' ELSE 'Veteran Objective Raid' END;
 SELECT * INTO world FROM btech_career_worlds WHERE id=company.current_world_id;SELECT count(*)::int/3 INTO cycle_no FROM btech_career_contracts WHERE company_id=company.id;
 employer:=CASE world.id WHEN 'outreach' THEN 'Wolf''s Dragoons' WHEN 'northwind' THEN 'Northwind Highlanders' WHEN 'twycross' THEN 'Lyran Commonwealth' ELSE 'Mercenary Guild' END;opposition:=CASE world.id WHEN 'twycross' THEN 'Clan Jade Falcon' WHEN 'galatea' THEN 'Lyran Commonwealth' ELSE 'Federated Commonwealth' END;
 INSERT INTO btech_career_contracts(company_id,title,tier,opponent_kind,terms,status) VALUES
  (company.id,world.name||' Security '||(cycle_no+1),'low','ai',jsonb_build_object('world_id',world.id,'employer_faction',employer,'opposition_faction',opposition,'map_id',world.maps->>0,'victory_mode','annihilation','ai_difficulty','beginner','ai_personality','balanced','base_pay',180000,'success_bonus',50000,'reputation',2,'bv_version','BV2.1','bv_min',1000,'bv_max',2300),'available'),
  (company.id,featured_title,'medium','ai',jsonb_build_object('world_id',world.id,'employer_faction',employer,'opposition_faction',opposition,'map_id',world.maps->>1,'victory_mode','control','ai_difficulty','intermediate','ai_personality','aggressive','base_pay',340000,'success_bonus',100000,'reputation',5,'bv_version','BV2.1','bv_min',1600,'bv_max',3600,'arc_featured',arc.status='active','arc_id',arc.arc_id,'arc_step',arc.current_step,'arc_briefing',step_data->>'briefing'),'available'),
  (company.id,world.name||' Breakthrough '||(cycle_no+1),'high','ai',jsonb_build_object('world_id',world.id,'employer_faction',employer,'opposition_faction',opposition,'map_id',world.maps->>2,'victory_mode','breakthrough','ai_difficulty','veteran','ai_personality','coordinated','base_pay',520000,'success_bonus',120000,'reputation',6,'bv_version','BV2.1','bv_min',2200,'bv_max',5200),'available');
END $$;
REVOKE ALL ON FUNCTION public.btech_career_seed_contracts(uuid) FROM PUBLIC;

DO $$ BEGIN
 IF to_regprocedure('public.btech_career_hq_without_career4a()') IS NULL THEN ALTER FUNCTION public.get_btech_career_hq() RENAME TO btech_career_hq_without_career4a;END IF;
 IF to_regprocedure('public.btech_career_settle_without_career4a(uuid)') IS NULL THEN ALTER FUNCTION public.settle_btech_career_contract(uuid) RENAME TO btech_career_settle_without_career4a;END IF;
END $$;
REVOKE ALL ON FUNCTION public.btech_career_hq_without_career4a() FROM PUBLIC,anon,authenticated;REVOKE ALL ON FUNCTION public.btech_career_settle_without_career4a(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.settle_btech_career_contract(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result_receipt jsonb;settlement btech_career_settlements%ROWTYPE;contract btech_career_contracts%ROWTYPE;company_arc btech_career_company_arcs%ROWTYPE;award btech_career_arc_awards%ROWTYPE;winner int;inserted int:=0;next_step jsonb;
BEGIN
 result_receipt:=btech_career_settle_without_career4a(p_game_id);SELECT * INTO settlement FROM btech_career_settlements WHERE game_id=p_game_id;SELECT * INTO contract FROM btech_career_contracts WHERE id=settlement.contract_id;winner:=NULLIF(result_receipt->'result'->>'winner_seat','')::int;
 SELECT * INTO award FROM btech_career_arc_awards WHERE settlement_id=settlement.id;
 IF award.settlement_id IS NOT NULL THEN
  result_receipt:=result_receipt||jsonb_build_object('career4a',jsonb_build_object('arc_advanced',award.succeeded,'arc_id',award.arc_id,'arc_step',award.attempted_step));UPDATE btech_career_settlements SET receipt=result_receipt WHERE id=settlement.id;RETURN result_receipt;
 END IF;
 IF coalesce((contract.terms->>'arc_featured')::boolean,false) THEN
  SELECT * INTO company_arc FROM btech_career_company_arcs WHERE company_id=settlement.company_id FOR UPDATE;
  IF company_arc.arc_id=contract.terms->>'arc_id' AND company_arc.current_step=(contract.terms->>'arc_step')::int AND company_arc.status='active' THEN
   INSERT INTO btech_career_arc_awards(settlement_id,company_id,arc_id,attempted_step,succeeded) VALUES(settlement.id,settlement.company_id,company_arc.arc_id,company_arc.current_step,winner=1) ON CONFLICT DO NOTHING;GET DIAGNOSTICS inserted=ROW_COUNT;
   IF inserted=1 THEN
    IF winner=1 THEN UPDATE btech_career_company_arcs SET current_step=least(3,current_step+1),status=CASE WHEN current_step=3 THEN 'completed' ELSE 'active' END,completed_at=CASE WHEN current_step=3 THEN now() ELSE NULL END WHERE company_id=settlement.company_id;END IF;
    SELECT * INTO company_arc FROM btech_career_company_arcs WHERE company_id=settlement.company_id;
    IF company_arc.status='active' THEN
     SELECT steps->(company_arc.current_step-1) INTO next_step FROM btech_career_arc_definitions WHERE id=company_arc.arc_id;
     INSERT INTO btech_career_contracts(company_id,title,tier,opponent_kind,terms,status) VALUES(settlement.company_id,next_step->>'title',contract.tier,contract.opponent_kind,contract.terms||jsonb_build_object('arc_step',company_arc.current_step,'arc_briefing',next_step->>'briefing'),'available');
    END IF;
   END IF;
  END IF;
 END IF;
 result_receipt:=result_receipt||jsonb_build_object('career4a',jsonb_build_object('arc_advanced',inserted=1 AND winner=1,'arc_id',contract.terms->>'arc_id','arc_step',contract.terms->'arc_step'));UPDATE btech_career_settlements SET receipt=result_receipt WHERE id=settlement.id;RETURN result_receipt;
END $$;
REVOKE ALL ON FUNCTION public.settle_btech_career_contract(uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.settle_btech_career_contract(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_btech_career_hq()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;owner_company_id uuid;
BEGIN
 result:=btech_career_hq_without_career4a();owner_company_id:=NULLIF(result->'company'->>'id','')::uuid;IF owner_company_id IS NULL THEN RETURN result;END IF;PERFORM btech_career_ensure_arc(owner_company_id);
 RETURN jsonb_set(result,'{company}',result->'company'||jsonb_build_object('origin',(SELECT origin FROM btech_career_companies WHERE id=owner_company_id)),true)||jsonb_build_object('campaign_arc',(SELECT jsonb_build_object('id',ca.arc_id,'title',ad.title,'summary',ad.summary,'current_step',ca.current_step,'status',ca.status,'step',ad.steps->(ca.current_step-1)) FROM btech_career_company_arcs ca JOIN btech_career_arc_definitions ad ON ad.id=ca.arc_id WHERE ca.company_id=owner_company_id));
END $$;
REVOKE ALL ON FUNCTION public.get_btech_career_hq() FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.get_btech_career_hq() TO authenticated;

NOTIFY pgrst,'reload schema';
