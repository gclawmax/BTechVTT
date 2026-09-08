-- Career-2: salvage, curated markets, pilot progression and company growth.
-- Run after SQL/140. Every persistent reward is derived from a sealed Career
-- report or confirmed by an owner-only RPC. Skirmishes have no route here.

CREATE TABLE IF NOT EXISTS public.btech_career_growth_awards (
 settlement_id uuid NOT NULL REFERENCES public.btech_career_settlements(id) ON DELETE CASCADE,
 pilot_id uuid NOT NULL REFERENCES public.btech_career_pilots(id) ON DELETE CASCADE,
 experience integer NOT NULL CHECK(experience>0),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(settlement_id,pilot_id)
);
CREATE TABLE IF NOT EXISTS public.btech_career_salvage_offers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.btech_career_companies(id) ON DELETE CASCADE,
 settlement_id uuid NOT NULL UNIQUE REFERENCES public.btech_career_settlements(id) ON DELETE CASCADE,
 options jsonb NOT NULL DEFAULT '[]'::jsonb,status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','claimed','declined')),
 selected_option text,claimed_mech_id uuid REFERENCES public.btech_career_owned_mechs(id),created_at timestamptz NOT NULL DEFAULT now(),resolved_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.btech_career_market_offers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.btech_career_companies(id) ON DELETE CASCADE,
 cycle integer NOT NULL CHECK(cycle>=0),slot integer NOT NULL CHECK(slot>0),kind text NOT NULL CHECK(kind IN('mech','pilot')),
 payload jsonb NOT NULL,price bigint NOT NULL CHECK(price>=0),status text NOT NULL DEFAULT 'available' CHECK(status IN('available','purchased','expired')),
 created_at timestamptz NOT NULL DEFAULT now(),resolved_at timestamptz,UNIQUE(company_id,cycle,kind,slot)
);
CREATE INDEX IF NOT EXISTS idx_btech_career_market_company ON public.btech_career_market_offers(company_id,status,cycle DESC);

ALTER TABLE public.btech_career_growth_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.btech_career_salvage_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.btech_career_market_offers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.btech_career_growth_awards,public.btech_career_salvage_offers,public.btech_career_market_offers FROM PUBLIC,anon,authenticated;
DROP POLICY IF EXISTS "Career growth owner read" ON public.btech_career_growth_awards;
CREATE POLICY "Career growth owner read" ON public.btech_career_growth_awards FOR SELECT USING(EXISTS(SELECT 1 FROM btech_career_pilots p JOIN btech_career_companies c ON c.id=p.company_id WHERE p.id=btech_career_growth_awards.pilot_id AND c.user_id=auth.uid()));
DROP POLICY IF EXISTS "Career salvage owner read" ON public.btech_career_salvage_offers;
CREATE POLICY "Career salvage owner read" ON public.btech_career_salvage_offers FOR SELECT USING(EXISTS(SELECT 1 FROM btech_career_companies c WHERE c.id=btech_career_salvage_offers.company_id AND c.user_id=auth.uid()));
DROP POLICY IF EXISTS "Career market owner read" ON public.btech_career_market_offers;
CREATE POLICY "Career market owner read" ON public.btech_career_market_offers FOR SELECT USING(EXISTS(SELECT 1 FROM btech_career_companies c WHERE c.id=btech_career_market_offers.company_id AND c.user_id=auth.uid()));

CREATE OR REPLACE FUNCTION public.btech_career_hangar_tonnage(p_company_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(sum((u.definition->>'mass')::integer),0)::integer FROM btech_career_owned_mechs m
 JOIN btech_catalogue_units u ON u.catalogue_version=m.catalogue_version AND u.unit_id=m.unit_id WHERE m.company_id=p_company_id
$$;
REVOKE ALL ON FUNCTION public.btech_career_hangar_tonnage(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_career_require_idle(p_company_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM btech_career_contracts WHERE company_id=p_company_id AND status='accepted') THEN RAISE EXCEPTION 'Finish the active Career contract before changing the company';END IF;
END $$;
REVOKE ALL ON FUNCTION public.btech_career_require_idle(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_career_seed_market(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cycle_no int;catalogue text;candidate record;slot_no int:=0;
BEGIN
 SELECT count(*)::int INTO cycle_no FROM btech_career_settlements WHERE company_id=p_company_id;
 IF EXISTS(SELECT 1 FROM btech_career_market_offers WHERE company_id=p_company_id AND cycle=cycle_no) THEN RETURN;END IF;
 UPDATE btech_career_market_offers SET status='expired',resolved_at=now() WHERE company_id=p_company_id AND status='available';
 SELECT catalogue_version INTO catalogue FROM btech_career_owned_mechs WHERE company_id=p_company_id ORDER BY acquired_at LIMIT 1;
 FOR candidate IN SELECT unit_id,definition FROM btech_catalogue_units
  WHERE catalogue_version=catalogue AND coalesce((definition->>'supported_by_vtt')::boolean,false)
   AND NOT coalesce((definition->>'custom_design')::boolean,false) AND coalesce(definition->'battle_value'->>'stock','')~'^[1-9][0-9]*$'
  ORDER BY md5(p_company_id::text||':'||cycle_no||':'||unit_id) LIMIT 3
 LOOP
  slot_no:=slot_no+1;
  INSERT INTO btech_career_market_offers(company_id,cycle,slot,kind,payload,price) VALUES(p_company_id,cycle_no,slot_no,'mech',
   jsonb_build_object('unit_id',candidate.unit_id,'catalogue_version',catalogue,'chassis',candidate.definition->>'chassis','variant',candidate.definition->>'variant','mass',(candidate.definition->>'mass')::int,'bv',(candidate.definition->'battle_value'->>'stock')::int),
   greatest(150000,(candidate.definition->>'mass')::bigint*9000+(candidate.definition->'battle_value'->>'stock')::bigint*120)) ON CONFLICT(company_id,cycle,kind,slot) DO NOTHING;
 END LOOP;
 INSERT INTO btech_career_market_offers(company_id,cycle,slot,kind,payload,price) VALUES
  (p_company_id,cycle_no,1,'pilot',jsonb_build_object('name','Alex Mercer','callsign','Vanguard','gunnery',4,'piloting',4,'specialty','brawler'),120000),
  (p_company_id,cycle_no,2,'pilot',jsonb_build_object('name','Samira Holt','callsign','Longshot','gunnery',3,'piloting',5,'specialty','sniper'),180000)
 ON CONFLICT(company_id,cycle,kind,slot) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.btech_career_seed_market(uuid) FROM PUBLIC;

-- Completed boards rotate maps and objectives while retaining the same clear
-- risk/BV ladder. Existing signed and available offers are never rewritten.
CREATE OR REPLACE FUNCTION public.btech_career_seed_contracts(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cycle int;company btech_career_companies%ROWTYPE;
BEGIN
 SELECT * INTO company FROM btech_career_companies WHERE id=p_company_id FOR UPDATE;IF company.id IS NULL THEN RAISE EXCEPTION 'Career company not found';END IF;
 IF EXISTS(SELECT 1 FROM btech_career_contracts WHERE company_id=company.id AND status IN('available','accepted')) THEN RETURN;END IF;
 SELECT count(*)::int/3 INTO cycle FROM btech_career_contracts WHERE company_id=company.id;
 INSERT INTO btech_career_contracts(company_id,title,tier,opponent_kind,terms,status) VALUES
  (company.id,'Perimeter Security '||(cycle+1),'low','ai',jsonb_build_object('map_id',CASE cycle%3 WHEN 0 THEN 'training-grounds' WHEN 1 THEN 'woodland-approach' ELSE 'forest-lanes' END,'victory_mode','annihilation','ai_difficulty','beginner','ai_personality','balanced','base_pay',180000,'success_bonus',50000,'reputation',2,'bv_version','BV2.1','bv_min',1000,'bv_max',2300),'available'),
  (company.id,'Objective Raid '||(cycle+1),'medium','ai',jsonb_build_object('map_id',CASE cycle%3 WHEN 0 THEN 'ridge-and-ford' WHEN 1 THEN 'weathered-frontier' ELSE 'industrial-crossing' END,'victory_mode','control','ai_difficulty','intermediate','ai_personality','aggressive','base_pay',320000,'success_bonus',80000,'reputation',4,'bv_version','BV2.1','bv_min',1600,'bv_max',3600),'available'),
  (company.id,'Breakthrough Operation '||(cycle+1),'high','ai',jsonb_build_object('map_id',CASE cycle%3 WHEN 0 THEN 'industrial-crossing' WHEN 1 THEN 'ridge-and-ford' ELSE 'weathered-frontier' END,'victory_mode','breakthrough','ai_difficulty','veteran','ai_personality','coordinated','base_pay',520000,'success_bonus',120000,'reputation',6,'bv_version','BV2.1','bv_min',2200,'bv_max',5200),'available');
END $$;
REVOKE ALL ON FUNCTION public.btech_career_seed_contracts(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_career_capacity_quote(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE company btech_career_companies%ROWTYPE;next_capacity int;required_rep int;price bigint;
BEGIN
 SELECT * INTO company FROM btech_career_companies WHERE id=p_company_id;
 next_capacity:=least(600,company.dropship_tonnage+100);required_rep:=CASE WHEN next_capacity<=400 THEN 25 WHEN next_capacity<=500 THEN 50 ELSE 75 END;price:=CASE WHEN next_capacity<=400 THEN 1000000 WHEN next_capacity<=500 THEN 2000000 ELSE 4000000 END;
 RETURN jsonb_build_object('available',company.dropship_tonnage<600,'current',company.dropship_tonnage,'next',next_capacity,'required_reputation',required_rep,'price',price,'eligible',company.dropship_tonnage<600 AND company.reputation>=required_rep AND company.credits>=price);
END $$;
REVOKE ALL ON FUNCTION public.btech_career_capacity_quote(uuid) FROM PUBLIC;

DO $$ BEGIN
 IF to_regprocedure('public.btech_career_hq_without_career2()') IS NULL THEN ALTER FUNCTION public.get_btech_career_hq() RENAME TO btech_career_hq_without_career2;END IF;
 IF to_regprocedure('public.btech_career_settle_without_career2(uuid)') IS NULL THEN ALTER FUNCTION public.settle_btech_career_contract(uuid) RENAME TO btech_career_settle_without_career2;END IF;
END $$;
REVOKE ALL ON FUNCTION public.btech_career_hq_without_career2() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.btech_career_settle_without_career2(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.settle_btech_career_contract(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE growth_receipt jsonb;game btech_games%ROWTYPE;settlement btech_career_settlements%ROWTYPE;report btech_match_reports%ROWTYPE;context jsonb;mapping jsonb;v_pilot_id uuid;xp int;inserted int:=0;options jsonb:='[]'::jsonb;unit jsonb;definition jsonb;winner int;tier text;
BEGIN
 growth_receipt:=btech_career_settle_without_career2(p_game_id);
 SELECT * INTO game FROM btech_games WHERE id=p_game_id;context:=(CASE jsonb_typeof(game.state) WHEN 'string' THEN (game.state#>>'{}')::jsonb ELSE game.state END)->'career_context';
 SELECT * INTO settlement FROM btech_career_settlements WHERE game_id=p_game_id;SELECT * INTO report FROM btech_match_reports WHERE game_id=p_game_id;
 SELECT c.tier INTO tier FROM btech_career_contracts c WHERE c.id=settlement.contract_id;winner:=NULLIF(report.result->>'winner_seat','')::int;
 xp:=100+CASE WHEN winner=1 THEN 50 ELSE 0 END+CASE tier WHEN 'medium' THEN 25 WHEN 'high' THEN 50 ELSE 0 END;
 FOR mapping IN SELECT value FROM jsonb_array_elements(coalesce(context->'persistent_units','[]'::jsonb)) value LOOP
  v_pilot_id:=(mapping->>'pilot_id')::uuid;
  INSERT INTO btech_career_growth_awards(settlement_id,pilot_id,experience) VALUES(settlement.id,v_pilot_id,xp) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT;IF inserted=1 THEN UPDATE btech_career_pilots SET experience=experience+xp WHERE id=v_pilot_id;END IF;
 END LOOP;
 IF winner=1 THEN
  FOR unit IN SELECT value FROM jsonb_array_elements(coalesce(report.final_state->'mech_instances','[]'::jsonb)) value WHERE (value->>'owner')::int=2 AND coalesce((value->>'destroyed')::boolean,false) LIMIT 3 LOOP
   SELECT u.definition INTO definition FROM btech_catalogue_units u WHERE u.catalogue_version=report.catalogue_version AND u.unit_id=unit->>'unitId';
   options:=options||jsonb_build_array(jsonb_build_object('option_id',unit->>'instanceId','unit_id',unit->>'unitId','catalogue_version',report.catalogue_version,'chassis',definition->>'chassis','variant',definition->>'variant','mass',(definition->>'mass')::int,'condition',jsonb_build_object('armor',unit->'armor','structure',unit->'structure','critical_slot_damage',unit->'criticalSlotDamage','ammo_bins',unit->'ammoBins','pilot_state','{"hits":0,"consciousness":"conscious"}'::jsonb)));
  END LOOP;
 END IF;
 INSERT INTO btech_career_salvage_offers(company_id,settlement_id,options,status) VALUES(settlement.company_id,settlement.id,options,CASE WHEN jsonb_array_length(options)>0 THEN 'pending' ELSE 'declined' END) ON CONFLICT(settlement_id) DO NOTHING;
 PERFORM btech_career_seed_market(settlement.company_id);
 growth_receipt:=growth_receipt||jsonb_build_object('career2',jsonb_build_object('experience_per_pilot',xp,'salvage_options',jsonb_array_length(options)));
 UPDATE btech_career_settlements SET receipt=growth_receipt WHERE id=settlement.id;RETURN growth_receipt;
END $$;
REVOKE ALL ON FUNCTION public.settle_btech_career_contract(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_btech_career_contract(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_btech_career_hq()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;owner_company_id uuid;
BEGIN
 result:=btech_career_hq_without_career2();owner_company_id:=NULLIF(result->'company'->>'id','')::uuid;IF owner_company_id IS NULL THEN RETURN result;END IF;
 PERFORM btech_career_seed_market(owner_company_id);
 RETURN result||jsonb_build_object(
  'salvage',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'options',s.options,'status',s.status,'selected_option',s.selected_option,'created_at',s.created_at) ORDER BY s.created_at DESC) FROM btech_career_salvage_offers s WHERE s.company_id=owner_company_id AND s.status='pending'),'[]'::jsonb),
  'market',coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'kind',m.kind,'payload',m.payload,'price',m.price,'status',m.status,'cycle',m.cycle) ORDER BY m.kind,m.slot) FROM btech_career_market_offers m WHERE m.company_id=owner_company_id AND m.status='available'),'[]'::jsonb),
  'capacity_upgrade',btech_career_capacity_quote(owner_company_id),'hangar_tonnage',btech_career_hangar_tonnage(owner_company_id));
END $$;
REVOKE ALL ON FUNCTION public.get_btech_career_hq() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_btech_career_hq() TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_btech_career_salvage(p_offer_id uuid,p_option_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE company btech_career_companies%ROWTYPE;offer btech_career_salvage_offers%ROWTYPE;choice jsonb;condition jsonb;mech_id uuid;used_tons int;mass int;
BEGIN
 SELECT c.* INTO company FROM btech_career_companies c JOIN btech_career_salvage_offers s ON s.company_id=c.id WHERE c.user_id=auth.uid() AND s.id=p_offer_id FOR UPDATE OF c;
 IF company.id IS NULL THEN RAISE EXCEPTION 'Career salvage offer not found';END IF;PERFORM btech_career_require_idle(company.id);
 SELECT * INTO offer FROM btech_career_salvage_offers WHERE id=p_offer_id AND company_id=company.id FOR UPDATE;IF offer.status<>'pending' THEN RAISE EXCEPTION 'This salvage decision is already resolved';END IF;
 SELECT value INTO choice FROM jsonb_array_elements(offer.options) value WHERE value->>'option_id'=p_option_id;IF choice IS NULL THEN RAISE EXCEPTION 'Choose a salvage option from this battle';END IF;
 mass:=(choice->>'mass')::int;used_tons:=btech_career_hangar_tonnage(company.id);IF used_tons+mass>company.dropship_tonnage THEN RAISE EXCEPTION 'Insufficient company capacity for this salvaged BattleMech';END IF;
 condition:=choice->'condition';INSERT INTO btech_career_owned_mechs(company_id,unit_id,catalogue_version,callsign,status,armor,structure,critical_slot_damage,ammo_bins,pilot_state)
 VALUES(company.id,choice->>'unit_id',choice->>'catalogue_version','Salvage '||upper(substr(offer.id::text,1,6)),'damaged',coalesce(condition->'armor','{}'::jsonb),coalesce(condition->'structure','{}'::jsonb),coalesce(condition->'critical_slot_damage','{}'::jsonb),coalesce(condition->'ammo_bins','[]'::jsonb),coalesce(condition->'pilot_state','{"hits":0,"consciousness":"conscious"}'::jsonb)) RETURNING id INTO mech_id;
 UPDATE btech_career_salvage_offers SET status='claimed',selected_option=p_option_id,claimed_mech_id=mech_id,resolved_at=now() WHERE id=offer.id;
 INSERT INTO btech_career_ledger(company_id,kind,amount,reference_id,note) VALUES(company.id,'other',0,mech_id,'Salvage claim: '||coalesce(choice->>'chassis',choice->>'unit_id'));
 RETURN jsonb_build_object('mech_id',mech_id,'unit_id',choice->>'unit_id','status','damaged');
END $$;
REVOKE ALL ON FUNCTION public.claim_btech_career_salvage(uuid,text) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.claim_btech_career_salvage(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.decline_btech_career_salvage(p_offer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE btech_career_salvage_offers s SET status='declined',resolved_at=now() FROM btech_career_companies c WHERE s.id=p_offer_id AND s.company_id=c.id AND c.user_id=auth.uid() AND s.status='pending';IF NOT FOUND THEN RAISE EXCEPTION 'Career salvage offer not found or already resolved';END IF;
END $$;
REVOKE ALL ON FUNCTION public.decline_btech_career_salvage(uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.decline_btech_career_salvage(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.purchase_btech_career_market_offer(p_offer_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE company btech_career_companies%ROWTYPE;offer btech_career_market_offers%ROWTYPE;condition jsonb;record_id uuid;used_tons int;mass int;
BEGIN
 SELECT c.* INTO company FROM btech_career_companies c JOIN btech_career_market_offers o ON o.company_id=c.id WHERE c.user_id=auth.uid() AND o.id=p_offer_id FOR UPDATE OF c;
 IF company.id IS NULL THEN RAISE EXCEPTION 'Career market offer not found';END IF;PERFORM btech_career_require_idle(company.id);
 SELECT * INTO offer FROM btech_career_market_offers WHERE id=p_offer_id AND company_id=company.id FOR UPDATE;IF offer.status<>'available' THEN RAISE EXCEPTION 'This market offer is no longer available';END IF;IF company.credits<offer.price THEN RAISE EXCEPTION 'Insufficient credits for this purchase';END IF;
 IF offer.kind='mech' THEN mass:=(offer.payload->>'mass')::int;used_tons:=btech_career_hangar_tonnage(company.id);IF used_tons+mass>company.dropship_tonnage THEN RAISE EXCEPTION 'Insufficient company capacity for this BattleMech';END IF;condition:=btech_career_fresh_condition(offer.payload->>'catalogue_version',offer.payload->>'unit_id');
  INSERT INTO btech_career_owned_mechs(company_id,unit_id,catalogue_version,callsign,armor,structure,critical_slot_damage,ammo_bins,pilot_state) VALUES(company.id,offer.payload->>'unit_id',offer.payload->>'catalogue_version','Market '||upper(substr(offer.id::text,1,6)),condition->'armor',condition->'structure',condition->'critical_slot_damage',condition->'ammo_bins',condition->'pilot_state') RETURNING id INTO record_id;
 ELSE INSERT INTO btech_career_pilots(company_id,name,callsign,gunnery,piloting,specialty,salary,status) VALUES(company.id,offer.payload->>'name',offer.payload->>'callsign',(offer.payload->>'gunnery')::int,(offer.payload->>'piloting')::int,offer.payload->>'specialty',25000,'available') RETURNING id INTO record_id;END IF;
 UPDATE btech_career_companies SET credits=credits-offer.price,updated_at=now() WHERE id=company.id;UPDATE btech_career_market_offers SET status='purchased',resolved_at=now() WHERE id=offer.id;
 INSERT INTO btech_career_ledger(company_id,kind,amount,reference_id,note) VALUES(company.id,CASE offer.kind WHEN 'pilot' THEN 'hire' ELSE 'purchase' END,-offer.price,record_id,'Career market: '||offer.kind);
 RETURN jsonb_build_object('kind',offer.kind,'record_id',record_id,'charged',offer.price);
END $$;
REVOKE ALL ON FUNCTION public.purchase_btech_career_market_offer(uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.purchase_btech_career_market_offer(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_btech_career_pilot(p_mech_id uuid,p_pilot_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE owner_company_id uuid;old_pilot uuid;
BEGIN
 SELECT m.company_id INTO owner_company_id FROM btech_career_owned_mechs m JOIN btech_career_companies c ON c.id=m.company_id WHERE m.id=p_mech_id AND m.status<>'destroyed' AND c.user_id=auth.uid() FOR UPDATE OF m;
 IF owner_company_id IS NULL OR NOT EXISTS(SELECT 1 FROM btech_career_pilots p WHERE p.id=p_pilot_id AND p.company_id=owner_company_id AND p.status IN('available','assigned')) THEN RAISE EXCEPTION 'Choose an owned BattleMech and available pilot';END IF;PERFORM 1 FROM btech_career_companies c WHERE c.id=owner_company_id FOR UPDATE;PERFORM btech_career_require_idle(owner_company_id);
 SELECT pilot_id INTO old_pilot FROM btech_career_mech_pilots WHERE mech_id=p_mech_id;DELETE FROM btech_career_mech_pilots WHERE mech_id=p_mech_id OR pilot_id=p_pilot_id;
 IF old_pilot IS NOT NULL AND old_pilot<>p_pilot_id THEN UPDATE btech_career_pilots SET status='available' WHERE id=old_pilot;END IF;
 INSERT INTO btech_career_mech_pilots(mech_id,pilot_id) VALUES(p_mech_id,p_pilot_id);UPDATE btech_career_pilots SET status='assigned' WHERE id=p_pilot_id;
END $$;
REVOKE ALL ON FUNCTION public.assign_btech_career_pilot(uuid,uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.assign_btech_career_pilot(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.advance_btech_career_pilot(p_pilot_id uuid,p_skill text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE owner_company_id uuid;pilot btech_career_pilots%ROWTYPE;current_skill int;cost int;
BEGIN
 IF p_skill NOT IN('gunnery','piloting') THEN RAISE EXCEPTION 'Choose Gunnery or Piloting';END IF;
 SELECT p.* INTO pilot FROM btech_career_pilots p JOIN btech_career_companies c ON c.id=p.company_id WHERE p.id=p_pilot_id AND c.user_id=auth.uid() FOR UPDATE OF p;IF pilot.id IS NULL THEN RAISE EXCEPTION 'Career pilot not found';END IF;owner_company_id:=pilot.company_id;PERFORM 1 FROM btech_career_companies c WHERE c.id=owner_company_id FOR UPDATE;PERFORM btech_career_require_idle(owner_company_id);
 current_skill:=CASE p_skill WHEN 'gunnery' THEN pilot.gunnery ELSE pilot.piloting END;IF current_skill<=0 THEN RAISE EXCEPTION 'This skill is already at its maximum';END IF;cost:=(9-current_skill)*100;IF pilot.experience<cost THEN RAISE EXCEPTION 'This pilot needs % XP to improve %',cost,p_skill;END IF;
 IF p_skill='gunnery' THEN UPDATE btech_career_pilots SET gunnery=gunnery-1,experience=experience-cost WHERE id=pilot.id;ELSE UPDATE btech_career_pilots SET piloting=piloting-1,experience=experience-cost WHERE id=pilot.id;END IF;
 RETURN jsonb_build_object('pilot_id',pilot.id,'skill',p_skill,'new_rating',current_skill-1,'spent_experience',cost);
END $$;
REVOKE ALL ON FUNCTION public.advance_btech_career_pilot(uuid,text) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.advance_btech_career_pilot(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.upgrade_btech_career_capacity()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE company btech_career_companies%ROWTYPE;quote jsonb;
BEGIN
 SELECT * INTO company FROM btech_career_companies WHERE user_id=auth.uid() FOR UPDATE;IF company.id IS NULL THEN RAISE EXCEPTION 'Career company not found';END IF;PERFORM btech_career_require_idle(company.id);quote:=btech_career_capacity_quote(company.id);
 IF NOT coalesce((quote->>'available')::boolean,false) THEN RAISE EXCEPTION 'Company capacity is already at the Career-2 maximum';END IF;IF company.reputation<(quote->>'required_reputation')::int THEN RAISE EXCEPTION 'More reputation is required for this capacity upgrade';END IF;IF company.credits<(quote->>'price')::bigint THEN RAISE EXCEPTION 'Insufficient credits for this capacity upgrade';END IF;
 UPDATE btech_career_companies SET dropship_tonnage=(quote->>'next')::int,credits=credits-(quote->>'price')::bigint,updated_at=now() WHERE id=company.id;INSERT INTO btech_career_ledger(company_id,kind,amount,note) VALUES(company.id,'purchase',-(quote->>'price')::bigint,'Company capacity upgrade');RETURN quote;
END $$;
REVOKE ALL ON FUNCTION public.upgrade_btech_career_capacity() FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.upgrade_btech_career_capacity() TO authenticated;

NOTIFY pgrst,'reload schema';
