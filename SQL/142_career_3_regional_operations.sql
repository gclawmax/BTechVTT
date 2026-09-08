-- Career-3: curated regional operations, travel, local supply and factions.
-- Run after SQL/141. Signed contracts retain their original terms; new boards
-- are themed by the company's current world.

CREATE TABLE IF NOT EXISTS public.btech_career_worlds (
 id text PRIMARY KEY,name text NOT NULL,region text NOT NULL,description text NOT NULL,
 supply_multiplier numeric(5,2) NOT NULL CHECK(supply_multiplier BETWEEN .5 AND 2),
 market_multiplier numeric(5,2) NOT NULL CHECK(market_multiplier BETWEEN .5 AND 2),
 maps jsonb NOT NULL,neighbors jsonb NOT NULL
);
INSERT INTO public.btech_career_worlds(id,name,region,description,supply_multiplier,market_multiplier,maps,neighbors) VALUES
 ('galatea','Galatea','Lyran Commonwealth','The old mercenary crossroads: affordable support and dependable contracts.',1.00,1.00,'["training-grounds","ridge-and-ford","forest-lanes"]','{"solaris-vii":12,"northwind":20,"outreach":18}'),
 ('outreach','Outreach','Chaos March','A premier mercenary hiring hall with excellent technical support.',.90,.92,'["industrial-crossing","weathered-frontier","forest-lanes"]','{"galatea":18,"northwind":10,"twycross":24}'),
 ('solaris-vii','Solaris VII','Lyran Commonwealth','Arena industry and abundant parts, sold at prestige prices.',1.10,1.15,'["industrial-crossing","training-grounds","weathered-frontier"]','{"galatea":12,"northwind":16}'),
 ('northwind','Northwind','Federated Commonwealth','Highlander territory offering disciplined employers and mixed terrain.',1.00,1.04,'["ridge-and-ford","forest-lanes","weathered-frontier"]','{"galatea":20,"outreach":10,"solaris-vii":16}'),
 ('twycross','Twycross','Clan Border','A dangerous frontier with scarce parts and high-risk operations.',1.35,1.25,'["weathered-frontier","ridge-and-ford","industrial-crossing"]','{"outreach":24}')
ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,region=EXCLUDED.region,description=EXCLUDED.description,supply_multiplier=EXCLUDED.supply_multiplier,market_multiplier=EXCLUDED.market_multiplier,maps=EXCLUDED.maps,neighbors=EXCLUDED.neighbors;
REVOKE ALL ON public.btech_career_worlds FROM PUBLIC,anon,authenticated;

ALTER TABLE public.btech_career_companies ADD COLUMN IF NOT EXISTS current_world_id text REFERENCES public.btech_career_worlds(id) DEFAULT 'galatea';
ALTER TABLE public.btech_career_companies ADD COLUMN IF NOT EXISTS campaign_day integer NOT NULL DEFAULT 0 CHECK(campaign_day>=0);
ALTER TABLE public.btech_career_companies ADD COLUMN IF NOT EXISTS market_epoch integer NOT NULL DEFAULT 0 CHECK(market_epoch>=0);
UPDATE public.btech_career_companies SET current_world_id='galatea' WHERE current_world_id IS NULL;
ALTER TABLE public.btech_career_companies ALTER COLUMN current_world_id SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.btech_career_faction_standings (
 company_id uuid NOT NULL REFERENCES public.btech_career_companies(id) ON DELETE CASCADE,
 faction text NOT NULL,standing integer NOT NULL DEFAULT 0 CHECK(standing BETWEEN -100 AND 100),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(company_id,faction)
);
CREATE TABLE IF NOT EXISTS public.btech_career_regional_awards (
 settlement_id uuid PRIMARY KEY REFERENCES public.btech_career_settlements(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES public.btech_career_companies(id) ON DELETE CASCADE,employer_faction text NOT NULL,opposition_faction text NOT NULL,
 employer_delta integer NOT NULL,opposition_delta integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.btech_career_faction_standings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.btech_career_regional_awards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.btech_career_faction_standings,public.btech_career_regional_awards FROM PUBLIC,anon,authenticated;
DROP POLICY IF EXISTS "Career faction owner read" ON public.btech_career_faction_standings;
CREATE POLICY "Career faction owner read" ON public.btech_career_faction_standings FOR SELECT USING(EXISTS(SELECT 1 FROM btech_career_companies c WHERE c.id=btech_career_faction_standings.company_id AND c.user_id=auth.uid()));
DROP POLICY IF EXISTS "Career regional award owner read" ON public.btech_career_regional_awards;
CREATE POLICY "Career regional award owner read" ON public.btech_career_regional_awards FOR SELECT USING(EXISTS(SELECT 1 FROM btech_career_companies c WHERE c.id=btech_career_regional_awards.company_id AND c.user_id=auth.uid()));

CREATE OR REPLACE FUNCTION public.btech_career_ensure_factions(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 INSERT INTO btech_career_faction_standings(company_id,faction) VALUES
  (p_company_id,'Mercenary Guild'),(p_company_id,'Lyran Commonwealth'),(p_company_id,'Federated Commonwealth'),
  (p_company_id,'Wolf''s Dragoons'),(p_company_id,'Northwind Highlanders'),(p_company_id,'Clan Jade Falcon') ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.btech_career_ensure_factions(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_career_travel_quote(p_company_id uuid,p_destination text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE company btech_career_companies%ROWTYPE;origin btech_career_worlds%ROWTYPE;destination btech_career_worlds%ROWTYPE;travel_days int;travel_cost bigint;
BEGIN
 SELECT * INTO company FROM btech_career_companies WHERE id=p_company_id;SELECT * INTO origin FROM btech_career_worlds WHERE id=company.current_world_id;SELECT * INTO destination FROM btech_career_worlds WHERE id=p_destination;
 IF destination.id IS NULL THEN RETURN NULL;END IF;
 travel_days:=NULLIF(origin.neighbors->>destination.id,'')::int;travel_cost:=coalesce(travel_days,0)::bigint*5000;
 RETURN jsonb_build_object('destination_id',destination.id,'reachable',travel_days IS NOT NULL,'days',travel_days,'cost',travel_cost);
END $$;
REVOKE ALL ON FUNCTION public.btech_career_travel_quote(uuid,text) FROM PUBLIC;

-- Local supply affects every repair/reload quote. The existing confirmation
-- function calls this public name, so its authoritative charge and ledger
-- details automatically use the same multiplier.
DO $$ BEGIN
 IF to_regprocedure('public.btech_career_service_quote_without_career3(uuid)') IS NULL THEN ALTER FUNCTION public.btech_career_service_quote_for_mech(uuid) RENAME TO btech_career_service_quote_without_career3;END IF;
END $$;
REVOKE ALL ON FUNCTION public.btech_career_service_quote_without_career3(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.btech_career_service_quote_for_mech(p_mech_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE quote jsonb;factor numeric;world_name text;armor_cost bigint;structure_cost bigint;component_cost bigint;reload_cost bigint;
BEGIN
 quote:=btech_career_service_quote_without_career3(p_mech_id);
 SELECT w.supply_multiplier,w.name INTO factor,world_name FROM btech_career_owned_mechs m JOIN btech_career_companies c ON c.id=m.company_id JOIN btech_career_worlds w ON w.id=c.current_world_id WHERE m.id=p_mech_id AND c.user_id=auth.uid();
 IF factor IS NULL THEN RAISE EXCEPTION 'Career supply location is unavailable';END IF;
 armor_cost:=ceil(coalesce((quote->'repair'->>'armor_cost')::numeric,0)*factor);structure_cost:=ceil(coalesce((quote->'repair'->>'structure_cost')::numeric,0)*factor);component_cost:=ceil(coalesce((quote->'repair'->>'component_cost')::numeric,0)*factor);reload_cost:=ceil(coalesce((quote->'reload'->>'total')::numeric,0)*factor);
 quote:=jsonb_set(quote,'{repair,armor_cost}',to_jsonb(armor_cost),true);quote:=jsonb_set(quote,'{repair,structure_cost}',to_jsonb(structure_cost),true);quote:=jsonb_set(quote,'{repair,component_cost}',to_jsonb(component_cost),true);quote:=jsonb_set(quote,'{repair,total}',to_jsonb(armor_cost+structure_cost+component_cost),true);quote:=jsonb_set(quote,'{reload,total}',to_jsonb(reload_cost),true);
 RETURN quote||jsonb_build_object('supply_world',world_name,'supply_multiplier',factor);
END $$;
REVOKE ALL ON FUNCTION public.btech_career_service_quote_for_mech(uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.btech_career_service_quote_for_mech(uuid) TO authenticated;

-- Each settlement or journey gets a fresh deterministic local market.
CREATE OR REPLACE FUNCTION public.btech_career_seed_market(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cycle_no int;catalogue text;candidate record;slot_no int:=0;company btech_career_companies%ROWTYPE;world btech_career_worlds%ROWTYPE;
BEGIN
 SELECT * INTO company FROM btech_career_companies WHERE id=p_company_id;SELECT * INTO world FROM btech_career_worlds WHERE id=company.current_world_id;
 SELECT count(*)::int*1000+company.market_epoch INTO cycle_no FROM btech_career_settlements WHERE company_id=p_company_id;
 IF EXISTS(SELECT 1 FROM btech_career_market_offers WHERE company_id=p_company_id AND cycle=cycle_no) THEN RETURN;END IF;
 UPDATE btech_career_market_offers SET status='expired',resolved_at=now() WHERE company_id=p_company_id AND status='available';
 SELECT catalogue_version INTO catalogue FROM btech_career_owned_mechs WHERE company_id=p_company_id ORDER BY acquired_at LIMIT 1;
 FOR candidate IN SELECT unit_id,definition FROM btech_catalogue_units WHERE catalogue_version=catalogue AND coalesce((definition->>'supported_by_vtt')::boolean,false) AND NOT coalesce((definition->>'custom_design')::boolean,false) AND coalesce(definition->'battle_value'->>'stock','')~'^[1-9][0-9]*$' ORDER BY md5(p_company_id::text||':'||cycle_no||':'||unit_id) LIMIT 3 LOOP
  slot_no:=slot_no+1;INSERT INTO btech_career_market_offers(company_id,cycle,slot,kind,payload,price) VALUES(p_company_id,cycle_no,slot_no,'mech',jsonb_build_object('unit_id',candidate.unit_id,'catalogue_version',catalogue,'chassis',candidate.definition->>'chassis','variant',candidate.definition->>'variant','mass',(candidate.definition->>'mass')::int,'bv',(candidate.definition->'battle_value'->>'stock')::int,'world_id',world.id),ceil(greatest(150000,(candidate.definition->>'mass')::bigint*9000+(candidate.definition->'battle_value'->>'stock')::bigint*120)*world.market_multiplier)) ON CONFLICT(company_id,cycle,kind,slot) DO NOTHING;
 END LOOP;
 INSERT INTO btech_career_market_offers(company_id,cycle,slot,kind,payload,price) VALUES
  (p_company_id,cycle_no,1,'pilot',jsonb_build_object('name','Alex Mercer','callsign','Vanguard','gunnery',4,'piloting',4,'specialty','brawler','world_id',world.id),ceil(120000*world.market_multiplier)),
  (p_company_id,cycle_no,2,'pilot',jsonb_build_object('name','Samira Holt','callsign','Longshot','gunnery',3,'piloting',5,'specialty','sniper','world_id',world.id),ceil(180000*world.market_multiplier)) ON CONFLICT(company_id,cycle,kind,slot) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.btech_career_seed_market(uuid) FROM PUBLIC;

-- New contract cycles draw their maps and factions from the current world.
CREATE OR REPLACE FUNCTION public.btech_career_seed_contracts(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cycle_no int;company btech_career_companies%ROWTYPE;world btech_career_worlds%ROWTYPE;employer text;opposition text;
BEGIN
 SELECT * INTO company FROM btech_career_companies WHERE id=p_company_id FOR UPDATE;IF company.id IS NULL THEN RAISE EXCEPTION 'Career company not found';END IF;IF EXISTS(SELECT 1 FROM btech_career_contracts WHERE company_id=company.id AND status IN('available','accepted')) THEN RETURN;END IF;
 SELECT * INTO world FROM btech_career_worlds WHERE id=company.current_world_id;SELECT count(*)::int/3 INTO cycle_no FROM btech_career_contracts WHERE company_id=company.id;
 employer:=CASE world.id WHEN 'outreach' THEN 'Wolf''s Dragoons' WHEN 'northwind' THEN 'Northwind Highlanders' WHEN 'twycross' THEN 'Lyran Commonwealth' ELSE 'Mercenary Guild' END;opposition:=CASE world.id WHEN 'twycross' THEN 'Clan Jade Falcon' WHEN 'galatea' THEN 'Lyran Commonwealth' ELSE 'Federated Commonwealth' END;
 INSERT INTO btech_career_contracts(company_id,title,tier,opponent_kind,terms,status) VALUES
  (company.id,world.name||' Security '||(cycle_no+1),'low','ai',jsonb_build_object('world_id',world.id,'employer_faction',employer,'opposition_faction',opposition,'map_id',world.maps->>0,'victory_mode','annihilation','ai_difficulty','beginner','ai_personality','balanced','base_pay',180000,'success_bonus',50000,'reputation',2,'bv_version','BV2.1','bv_min',1000,'bv_max',2300),'available'),
  (company.id,world.name||' Objective Raid '||(cycle_no+1),'medium','ai',jsonb_build_object('world_id',world.id,'employer_faction',employer,'opposition_faction',opposition,'map_id',world.maps->>1,'victory_mode','control','ai_difficulty','intermediate','ai_personality','aggressive','base_pay',320000,'success_bonus',80000,'reputation',4,'bv_version','BV2.1','bv_min',1600,'bv_max',3600),'available'),
  (company.id,world.name||' Breakthrough '||(cycle_no+1),'high','ai',jsonb_build_object('world_id',world.id,'employer_faction',employer,'opposition_faction',opposition,'map_id',world.maps->>2,'victory_mode','breakthrough','ai_difficulty','veteran','ai_personality','coordinated','base_pay',520000,'success_bonus',120000,'reputation',6,'bv_version','BV2.1','bv_min',2200,'bv_max',5200),'available');
END $$;
REVOKE ALL ON FUNCTION public.btech_career_seed_contracts(uuid) FROM PUBLIC;

DO $$ BEGIN
 IF to_regprocedure('public.btech_career_hq_without_career3()') IS NULL THEN ALTER FUNCTION public.get_btech_career_hq() RENAME TO btech_career_hq_without_career3;END IF;
 IF to_regprocedure('public.btech_career_settle_without_career3(uuid)') IS NULL THEN ALTER FUNCTION public.settle_btech_career_contract(uuid) RENAME TO btech_career_settle_without_career3;END IF;
END $$;
REVOKE ALL ON FUNCTION public.btech_career_hq_without_career3() FROM PUBLIC,anon,authenticated;REVOKE ALL ON FUNCTION public.btech_career_settle_without_career3(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.settle_btech_career_contract(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result_receipt jsonb;settlement btech_career_settlements%ROWTYPE;contract btech_career_contracts%ROWTYPE;winner int;employer text;opposition text;employer_delta int;opposition_delta int;inserted int;
BEGIN
 result_receipt:=btech_career_settle_without_career3(p_game_id);SELECT * INTO settlement FROM btech_career_settlements WHERE game_id=p_game_id;SELECT * INTO contract FROM btech_career_contracts WHERE id=settlement.contract_id;winner:=NULLIF(result_receipt->'result'->>'winner_seat','')::int;
 employer:=coalesce(contract.terms->>'employer_faction','Mercenary Guild');opposition:=coalesce(contract.terms->>'opposition_faction','Independent Opposition');employer_delta:=CASE WHEN winner=1 THEN 3 ELSE -1 END;opposition_delta:=CASE WHEN winner=1 THEN -1 ELSE 1 END;
 INSERT INTO btech_career_regional_awards(settlement_id,company_id,employer_faction,opposition_faction,employer_delta,opposition_delta) VALUES(settlement.id,settlement.company_id,employer,opposition,employer_delta,opposition_delta) ON CONFLICT DO NOTHING;GET DIAGNOSTICS inserted=ROW_COUNT;
 IF inserted=1 THEN
  INSERT INTO btech_career_faction_standings(company_id,faction,standing) VALUES(settlement.company_id,employer,employer_delta) ON CONFLICT(company_id,faction) DO UPDATE SET standing=greatest(-100,least(100,btech_career_faction_standings.standing+EXCLUDED.standing)),updated_at=now();
  INSERT INTO btech_career_faction_standings(company_id,faction,standing) VALUES(settlement.company_id,opposition,opposition_delta) ON CONFLICT(company_id,faction) DO UPDATE SET standing=greatest(-100,least(100,btech_career_faction_standings.standing+EXCLUDED.standing)),updated_at=now();
 END IF;
 result_receipt:=result_receipt||jsonb_build_object('career3',jsonb_build_object('employer_faction',employer,'employer_delta',employer_delta,'opposition_faction',opposition,'opposition_delta',opposition_delta));UPDATE btech_career_settlements SET receipt=result_receipt WHERE id=settlement.id;RETURN result_receipt;
END $$;
REVOKE ALL ON FUNCTION public.settle_btech_career_contract(uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.settle_btech_career_contract(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_btech_career_hq()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;owner_company_id uuid;current_world text;
BEGIN
 result:=btech_career_hq_without_career3();owner_company_id:=NULLIF(result->'company'->>'id','')::uuid;IF owner_company_id IS NULL THEN RETURN result;END IF;PERFORM btech_career_ensure_factions(owner_company_id);SELECT current_world_id INTO current_world FROM btech_career_companies WHERE id=owner_company_id;
 RETURN jsonb_set(result,'{company}',result->'company'||jsonb_build_object('current_world_id',current_world,'campaign_day',(SELECT campaign_day FROM btech_career_companies WHERE id=owner_company_id)),true)||jsonb_build_object(
  'current_world',(SELECT jsonb_build_object('id',w.id,'name',w.name,'region',w.region,'description',w.description,'supply_multiplier',w.supply_multiplier,'market_multiplier',w.market_multiplier) FROM btech_career_worlds w WHERE w.id=current_world),
  'worlds',coalesce((SELECT jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'region',w.region,'description',w.description,'supply_multiplier',w.supply_multiplier,'market_multiplier',w.market_multiplier,'travel',btech_career_travel_quote(owner_company_id,w.id)) ORDER BY w.name) FROM btech_career_worlds w),'[]'::jsonb),
  'factions',coalesce((SELECT jsonb_agg(jsonb_build_object('faction',f.faction,'standing',f.standing) ORDER BY f.standing DESC,f.faction) FROM btech_career_faction_standings f WHERE f.company_id=owner_company_id),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.get_btech_career_hq() FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.get_btech_career_hq() TO authenticated;

CREATE OR REPLACE FUNCTION public.travel_btech_career_company(p_destination text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE company btech_career_companies%ROWTYPE;quote jsonb;
BEGIN
 SELECT * INTO company FROM btech_career_companies WHERE user_id=auth.uid() FOR UPDATE;IF company.id IS NULL THEN RAISE EXCEPTION 'Career company not found';END IF;PERFORM btech_career_require_idle(company.id);IF company.current_world_id=p_destination THEN RAISE EXCEPTION 'The company is already on this world';END IF;quote:=btech_career_travel_quote(company.id,p_destination);
 IF quote IS NULL OR NOT coalesce((quote->>'reachable')::boolean,false) THEN RAISE EXCEPTION 'That world is not directly reachable from the current location';END IF;IF company.credits<(quote->>'cost')::bigint THEN RAISE EXCEPTION 'Insufficient credits for this journey';END IF;
 UPDATE btech_career_companies SET current_world_id=p_destination,campaign_day=campaign_day+(quote->>'days')::int,market_epoch=market_epoch+1,credits=credits-(quote->>'cost')::bigint,updated_at=now() WHERE id=company.id;UPDATE btech_career_market_offers SET status='expired',resolved_at=now() WHERE company_id=company.id AND status='available';UPDATE btech_career_contracts SET status='expired' WHERE company_id=company.id AND status='available';INSERT INTO btech_career_ledger(company_id,kind,amount,note) VALUES(company.id,'other',-(quote->>'cost')::bigint,'Interstellar travel to '||(SELECT name FROM btech_career_worlds WHERE id=p_destination));PERFORM btech_career_seed_market(company.id);PERFORM btech_career_seed_contracts(company.id);RETURN quote;
END $$;
REVOKE ALL ON FUNCTION public.travel_btech_career_company(text) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.travel_btech_career_company(text) TO authenticated;

NOTIFY pgrst,'reload schema';
