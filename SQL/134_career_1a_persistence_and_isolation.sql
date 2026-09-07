-- Career-1a: persistent company records only. Run after SQL/133.
-- This migration intentionally does NOT connect skirmish resolution to Career
-- data. Career-1b is the first slice allowed to launch or settle a career game.

CREATE TABLE IF NOT EXISTS public.btech_career_companies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
 name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 48),
 commander_callsign text NOT NULL CHECK (char_length(btrim(commander_callsign)) BETWEEN 1 AND 32),
 affiliation text NOT NULL DEFAULT 'Independent' CHECK (affiliation IN ('Independent','Inner Sphere','Clan')),
 banner_color text NOT NULL DEFAULT '#d4800a' CHECK (banner_color ~ '^#[0-9A-Fa-f]{6}$'),
 credits bigint NOT NULL DEFAULT 1000000 CHECK (credits >= 0),
 reputation integer NOT NULL DEFAULT 10 CHECK (reputation BETWEEN 0 AND 100),
 dropship_tonnage integer NOT NULL DEFAULT 300 CHECK (dropship_tonnage BETWEEN 100 AND 1000),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.btech_career_owned_mechs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.btech_career_companies(id) ON DELETE CASCADE,
 unit_id text NOT NULL,catalogue_version text NOT NULL,callsign text NOT NULL DEFAULT 'New Acquisition' CHECK(char_length(btrim(callsign)) BETWEEN 1 AND 48),
 status text NOT NULL DEFAULT 'operational' CHECK(status IN ('operational','damaged','destroyed','in_repair')),
 armor jsonb NOT NULL DEFAULT '{}'::jsonb,structure jsonb NOT NULL DEFAULT '{}'::jsonb,critical_slot_damage jsonb NOT NULL DEFAULT '{}'::jsonb,
 ammo_bins jsonb NOT NULL DEFAULT '[]'::jsonb,pilot_state jsonb NOT NULL DEFAULT '{"hits":0,"consciousness":"conscious"}'::jsonb,
 battles_fought integer NOT NULL DEFAULT 0 CHECK(battles_fought>=0),acquired_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,unit_id,callsign)
);
CREATE INDEX IF NOT EXISTS idx_btech_career_owned_mechs_company ON public.btech_career_owned_mechs(company_id);

CREATE TABLE IF NOT EXISTS public.btech_career_pilots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.btech_career_companies(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(char_length(btrim(name)) BETWEEN 1 AND 48),callsign text, gunnery integer NOT NULL CHECK(gunnery BETWEEN 0 AND 8),piloting integer NOT NULL CHECK(piloting BETWEEN 0 AND 8),
 specialty text NOT NULL DEFAULT 'none' CHECK(specialty IN ('none','sniper','brawler','scout','commander')),
 salary bigint NOT NULL DEFAULT 0 CHECK(salary>=0),status text NOT NULL DEFAULT 'available' CHECK(status IN ('available','assigned','injured','killed','departed')),
 injuries jsonb NOT NULL DEFAULT '{"hits":0,"consciousness":"conscious"}'::jsonb,experience integer NOT NULL DEFAULT 0 CHECK(experience>=0),hired_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_btech_career_pilots_company ON public.btech_career_pilots(company_id);

CREATE TABLE IF NOT EXISTS public.btech_career_mech_pilots (
 mech_id uuid PRIMARY KEY REFERENCES public.btech_career_owned_mechs(id) ON DELETE CASCADE,
 pilot_id uuid NOT NULL UNIQUE REFERENCES public.btech_career_pilots(id) ON DELETE CASCADE,assigned_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.btech_career_contracts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.btech_career_companies(id) ON DELETE CASCADE,
 title text NOT NULL CHECK(char_length(btrim(title)) BETWEEN 1 AND 100),tier text NOT NULL CHECK(tier IN ('low','medium','high')),
 opponent_kind text NOT NULL DEFAULT 'ai' CHECK(opponent_kind IN ('ai','player')),terms jsonb NOT NULL DEFAULT '{}'::jsonb,
 status text NOT NULL DEFAULT 'available' CHECK(status IN ('available','accepted','completed','failed','expired')),created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_btech_career_contracts_company_status ON public.btech_career_contracts(company_id,status);

CREATE TABLE IF NOT EXISTS public.btech_career_ledger (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,company_id uuid NOT NULL REFERENCES public.btech_career_companies(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('starting_funds','purchase','repair_armour','repair_structure','repair_component','reload_ammo','rebuild','hire','salary','contract_pay','bounty','success_bonus','penalty','other')),
 amount bigint NOT NULL,reference_id uuid,note text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_btech_career_ledger_company_time ON public.btech_career_ledger(company_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.btech_career_settlements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.btech_career_companies(id) ON DELETE CASCADE,
 game_id uuid NOT NULL UNIQUE REFERENCES public.btech_games(id) ON DELETE RESTRICT,contract_id uuid REFERENCES public.btech_career_contracts(id) ON DELETE SET NULL,
 receipt jsonb NOT NULL DEFAULT '{}'::jsonb,settled_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_btech_career_settlements_company ON public.btech_career_settlements(company_id,settled_at DESC);

ALTER TABLE public.btech_career_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.btech_career_owned_mechs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.btech_career_pilots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.btech_career_mech_pilots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.btech_career_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.btech_career_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.btech_career_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.btech_career_companies,public.btech_career_owned_mechs,public.btech_career_pilots,public.btech_career_mech_pilots,public.btech_career_contracts,public.btech_career_ledger,public.btech_career_settlements FROM PUBLIC,anon,authenticated;

-- No direct client write policy exists. Owner-only reads are provided by the
-- narrow HQ RPC below; these policies additionally protect service queries.
DROP POLICY IF EXISTS "Career company owner read" ON public.btech_career_companies;
CREATE POLICY "Career company owner read" ON public.btech_career_companies FOR SELECT USING(user_id=auth.uid());
DROP POLICY IF EXISTS "Career mech owner read" ON public.btech_career_owned_mechs;
CREATE POLICY "Career mech owner read" ON public.btech_career_owned_mechs FOR SELECT USING(EXISTS(SELECT 1 FROM public.btech_career_companies c WHERE c.id=company_id AND c.user_id=auth.uid()));
DROP POLICY IF EXISTS "Career pilot owner read" ON public.btech_career_pilots;
CREATE POLICY "Career pilot owner read" ON public.btech_career_pilots FOR SELECT USING(EXISTS(SELECT 1 FROM public.btech_career_companies c WHERE c.id=company_id AND c.user_id=auth.uid()));
DROP POLICY IF EXISTS "Career contract owner read" ON public.btech_career_contracts;
CREATE POLICY "Career contract owner read" ON public.btech_career_contracts FOR SELECT USING(EXISTS(SELECT 1 FROM public.btech_career_companies c WHERE c.id=company_id AND c.user_id=auth.uid()));
DROP POLICY IF EXISTS "Career ledger owner read" ON public.btech_career_ledger;
CREATE POLICY "Career ledger owner read" ON public.btech_career_ledger FOR SELECT USING(EXISTS(SELECT 1 FROM public.btech_career_companies c WHERE c.id=company_id AND c.user_id=auth.uid()));
DROP POLICY IF EXISTS "Career settlement owner read" ON public.btech_career_settlements;
CREATE POLICY "Career settlement owner read" ON public.btech_career_settlements FOR SELECT USING(EXISTS(SELECT 1 FROM public.btech_career_companies c WHERE c.id=company_id AND c.user_id=auth.uid()));

CREATE OR REPLACE FUNCTION public.btech_career_fresh_condition(p_catalogue_version text,p_unit_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE definition jsonb;bins jsonb;
BEGIN
 SELECT unit.definition INTO definition FROM btech_catalogue_units unit WHERE unit.catalogue_version=p_catalogue_version AND unit.unit_id=p_unit_id AND coalesce((unit.definition->>'supported_by_vtt')::boolean,false);
 IF definition IS NULL THEN RAISE EXCEPTION 'Starter BattleMech % is not available in catalogue %',p_unit_id,p_catalogue_version;END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',bin.bin_id,'type',bin.ammo_type,'location',bin.location,'shots',bin.shots,'maxShots',bin.shots,'loadType','standard') ORDER BY bin.bin_id),'[]'::jsonb) INTO bins FROM btech_catalogue_ammo_bins bin WHERE bin.catalogue_version=p_catalogue_version AND bin.unit_id=p_unit_id;
 RETURN jsonb_build_object('armor',coalesce(definition->'armor','{}'::jsonb),'structure',coalesce(definition->'structure','{}'::jsonb),'critical_slot_damage','{}'::jsonb,'ammo_bins',bins,'pilot_state',jsonb_build_object('hits',0,'consciousness','conscious'));
END $$;
REVOKE ALL ON FUNCTION public.btech_career_fresh_condition(text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.create_btech_career_company(p_name text,p_commander_callsign text,p_affiliation text,p_banner_color text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE company public.btech_career_companies%ROWTYPE;catalogue text;starter_one text;starter_two text;mech_one uuid;mech_two uuid;pilot_one uuid;pilot_two uuid;condition jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in before starting a Career';END IF;
 IF length(btrim(coalesce(p_name,''))) NOT BETWEEN 1 AND 48 OR length(btrim(coalesce(p_commander_callsign,''))) NOT BETWEEN 1 AND 32 THEN RAISE EXCEPTION 'Company name and commander callsign are required';END IF;
 IF coalesce(p_affiliation,'') NOT IN ('Independent','Inner Sphere','Clan') OR coalesce(p_banner_color,'') !~ '^#[0-9A-Fa-f]{6}$' THEN RAISE EXCEPTION 'Choose a supported affiliation and command colour';END IF;
 SELECT * INTO company FROM btech_career_companies WHERE user_id=auth.uid() FOR UPDATE;
 IF FOUND THEN
  UPDATE btech_career_companies SET name=btrim(p_name),commander_callsign=btrim(p_commander_callsign),affiliation=p_affiliation,banner_color=p_banner_color,updated_at=now() WHERE id=company.id;
  RETURN jsonb_build_object('company_id',company.id,'created',false);
 END IF;
 SELECT version INTO catalogue FROM btech_catalogue_releases ORDER BY generated_at DESC,version DESC LIMIT 1;IF catalogue IS NULL THEN RAISE EXCEPTION 'No supported BattleMech catalogue is installed';END IF;
 SELECT unit_id INTO starter_one FROM btech_catalogue_units WHERE catalogue_version=catalogue AND unit_id='wolverine-wvr-6r' AND coalesce((definition->>'supported_by_vtt')::boolean,false) LIMIT 1;
 SELECT unit_id INTO starter_two FROM btech_catalogue_units WHERE catalogue_version=catalogue AND unit_id='panther-pnt-9r' AND coalesce((definition->>'supported_by_vtt')::boolean,false) LIMIT 1;
 IF starter_one IS NULL THEN SELECT unit_id INTO starter_one FROM btech_catalogue_units WHERE catalogue_version=catalogue AND coalesce((definition->>'supported_by_vtt')::boolean,false) AND coalesce((definition->>'mass')::int,999)<=55 ORDER BY unit_id LIMIT 1;END IF;
 IF starter_two IS NULL THEN SELECT unit_id INTO starter_two FROM btech_catalogue_units WHERE catalogue_version=catalogue AND coalesce((definition->>'supported_by_vtt')::boolean,false) AND unit_id<>starter_one ORDER BY coalesce((definition->>'mass')::int,999),unit_id LIMIT 1;END IF;
 IF starter_one IS NULL OR starter_two IS NULL THEN RAISE EXCEPTION 'The catalogue has too few supported BattleMechs to seed a Career company';END IF;
 INSERT INTO btech_career_companies(user_id,name,commander_callsign,affiliation,banner_color) VALUES(auth.uid(),btrim(p_name),btrim(p_commander_callsign),p_affiliation,p_banner_color) RETURNING * INTO company;
 condition:=btech_career_fresh_condition(catalogue,starter_one);INSERT INTO btech_career_owned_mechs(company_id,unit_id,catalogue_version,callsign,armor,structure,critical_slot_damage,ammo_bins,pilot_state) VALUES(company.id,starter_one,catalogue,'First Lance',condition->'armor',condition->'structure',condition->'critical_slot_damage',condition->'ammo_bins',condition->'pilot_state') RETURNING id INTO mech_one;
 condition:=btech_career_fresh_condition(catalogue,starter_two);INSERT INTO btech_career_owned_mechs(company_id,unit_id,catalogue_version,callsign,armor,structure,critical_slot_damage,ammo_bins,pilot_state) VALUES(company.id,starter_two,catalogue,'Second Lance',condition->'armor',condition->'structure',condition->'critical_slot_damage',condition->'ammo_bins',condition->'pilot_state') RETURNING id INTO mech_two;
 INSERT INTO btech_career_pilots(company_id,name,callsign,gunnery,piloting,specialty,salary) VALUES(company.id,btrim(p_commander_callsign),btrim(p_commander_callsign),4,5,'commander',0) RETURNING id INTO pilot_one;
 INSERT INTO btech_career_pilots(company_id,name,callsign,gunnery,piloting,specialty,salary) VALUES(company.id,'MechWarrior',NULL,4,5,'none',25000) RETURNING id INTO pilot_two;
 INSERT INTO btech_career_mech_pilots(mech_id,pilot_id) VALUES(mech_one,pilot_one),(mech_two,pilot_two);
 UPDATE btech_career_pilots SET status='assigned' WHERE id IN(pilot_one,pilot_two);
 INSERT INTO btech_career_ledger(company_id,kind,amount,note) VALUES(company.id,'starting_funds',company.credits,'Career founding reserve');
 RETURN jsonb_build_object('company_id',company.id,'created',true,'catalogue_version',catalogue,'starter_units',jsonb_build_array(starter_one,starter_two));
END $$;
REVOKE ALL ON FUNCTION public.create_btech_career_company(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_btech_career_company(text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_btech_career_hq()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE company public.btech_career_companies%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in before opening Company HQ';END IF;
 SELECT * INTO company FROM btech_career_companies WHERE user_id=auth.uid();
 IF NOT FOUND THEN RETURN jsonb_build_object('company',NULL,'mechs','[]'::jsonb,'pilots','[]'::jsonb,'contracts','[]'::jsonb,'ledger','[]'::jsonb,'settlements','[]'::jsonb);END IF;
 RETURN jsonb_build_object('company',jsonb_build_object('id',company.id,'name',company.name,'commander_callsign',company.commander_callsign,'affiliation',company.affiliation,'banner_color',company.banner_color,'credits',company.credits,'reputation',company.reputation,'dropship_tonnage',company.dropship_tonnage,'created_at',company.created_at),
  'mechs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'unit_id',m.unit_id,'catalogue_version',m.catalogue_version,'callsign',m.callsign,'status',m.status,'armor',m.armor,'structure',m.structure,'critical_slot_damage',m.critical_slot_damage,'ammo_bins',m.ammo_bins,'pilot_state',m.pilot_state,'battles_fought',m.battles_fought,'pilot_id',mp.pilot_id) ORDER BY m.acquired_at) FROM btech_career_owned_mechs m LEFT JOIN btech_career_mech_pilots mp ON mp.mech_id=m.id WHERE m.company_id=company.id),'[]'::jsonb),
  'pilots',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'callsign',p.callsign,'gunnery',p.gunnery,'piloting',p.piloting,'specialty',p.specialty,'salary',p.salary,'status',p.status,'injuries',p.injuries,'experience',p.experience) ORDER BY p.hired_at) FROM btech_career_pilots p WHERE p.company_id=company.id),'[]'::jsonb),
  'contracts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'tier',c.tier,'opponent_kind',c.opponent_kind,'terms',c.terms,'status',c.status,'expires_at',c.expires_at) ORDER BY c.created_at DESC) FROM btech_career_contracts c WHERE c.company_id=company.id),'[]'::jsonb),
  'ledger',coalesce((SELECT jsonb_agg(rows.item) FROM (SELECT jsonb_build_object('id',l.id,'kind',l.kind,'amount',l.amount,'reference_id',l.reference_id,'note',l.note,'created_at',l.created_at) AS item FROM btech_career_ledger l WHERE l.company_id=company.id ORDER BY l.created_at DESC LIMIT 12) rows),'[]'::jsonb),
  'settlements',coalesce((SELECT jsonb_agg(rows.item) FROM (SELECT jsonb_build_object('id',s.id,'game_id',s.game_id,'contract_id',s.contract_id,'receipt',s.receipt,'settled_at',s.settled_at) AS item FROM btech_career_settlements s WHERE s.company_id=company.id ORDER BY s.settled_at DESC LIMIT 8) rows),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.get_btech_career_hq() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_btech_career_hq() TO authenticated;

-- All later Career mutations must call this guard. There is deliberately no
-- trigger or resolver hook here: a skirmish has no code path to these tables.
CREATE OR REPLACE FUNCTION public.btech_career_require_match(p_game_id uuid,p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE game_match_type text;company_owner uuid;
BEGIN
 SELECT match_type INTO game_match_type FROM btech_games WHERE id=p_game_id;SELECT user_id INTO company_owner FROM btech_career_companies WHERE id=p_company_id;
 IF game_match_type IS DISTINCT FROM 'career' THEN RAISE EXCEPTION 'Only an explicit Career match may mutate Career records';END IF;
 IF company_owner IS NULL THEN RAISE EXCEPTION 'Career company not found';END IF;
END $$;
REVOKE ALL ON FUNCTION public.btech_career_require_match(uuid,uuid) FROM PUBLIC;

NOTIFY pgrst,'reload schema';
