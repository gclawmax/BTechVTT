-- Career-1c: authoritative repair bay and reload actions.
-- Run after SQL/135. These RPCs mutate only the calling user's persistent
-- company; skirmishes and replay imports have no route to them.

CREATE OR REPLACE FUNCTION public.btech_career_ammo_round_cost(p_type text)
RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE
  WHEN p_type='machine_gun' THEN 2 WHEN p_type='ams' THEN 25
  WHEN p_type IN ('lrm5','lrm10','lrm15','lrm20','streak_lrm5','streak_lrm10','streak_lrm15','streak_lrm20') THEN 35
  WHEN p_type IN ('srm2','srm4','srm6','streak_srm2','narc') THEN 45
  WHEN p_type IN ('ac2','ac5','uac2','uac5','rac2','rac5','lb5x','lb10x') THEN 75
  WHEN p_type IN ('ac10','uac10','rac10') THEN 125 WHEN p_type IN ('ac20','uac20','rac20') THEN 200
  WHEN p_type IN ('gauss','light_gauss','heavy_gauss','hag20','ap_gauss') THEN 150
  WHEN p_type IN ('atm3','atm6','atm9','atm12','tbolt5','tbolt10','tbolt15','tbolt20') THEN 90
  ELSE 50 END
$$;
REVOKE ALL ON FUNCTION public.btech_career_ammo_round_cost(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_career_component_replacement_cost(p_label text)
RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE
  WHEN public.btech_equipment_label_key(p_label)='fusionengine' THEN 100000 WHEN public.btech_equipment_label_key(p_label)='gyro' THEN 50000 WHEN public.btech_equipment_label_key(p_label)='cockpit' THEN 500000
  WHEN public.btech_equipment_label_key(p_label)='sensors' THEN 15000 WHEN public.btech_equipment_label_key(p_label)='lifesupport' THEN 5000
  WHEN public.btech_equipment_label_key(p_label) IN ('shoulder','hip') THEN 12000 WHEN public.btech_equipment_label_key(p_label) IN ('upperarmactuator','upperlegactuator') THEN 7000
  WHEN public.btech_equipment_label_key(p_label) IN ('lowerarmactuator','lowerlegactuator','handactuator','footactuator') THEN 4000
  WHEN public.btech_equipment_label_key(p_label)='heatsink' THEN 2000 WHEN public.btech_equipment_label_key(p_label)='doubleheatsink' THEN 5000
  WHEN public.btech_equipment_label_key(p_label)='case' THEN 3000 ELSE 12000 END
$$;
REVOKE ALL ON FUNCTION public.btech_career_component_replacement_cost(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_career_service_quote_for_mech(p_mech_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE mech public.btech_career_owned_mechs%ROWTYPE;fresh jsonb;armor_points integer:=0;structure_points integer:=0;
 critical_slots integer:=0;reload_rounds integer:=0;reload_bins integer:=0;component_cost bigint:=0;reload_cost bigint:=0;row record;
BEGIN
 SELECT m.* INTO mech FROM btech_career_owned_mechs m JOIN btech_career_companies c ON c.id=m.company_id
 WHERE m.id=p_mech_id AND c.user_id=auth.uid();
 IF mech.id IS NULL THEN RAISE EXCEPTION 'Career BattleMech not found';END IF;
 fresh:=btech_career_fresh_condition(mech.catalogue_version,mech.unit_id);
 SELECT coalesce(sum(greatest(0,(maxima.value #>> '{}')::int-coalesce((mech.armor->>maxima.key)::int,0))),0)::int INTO armor_points FROM jsonb_each(fresh->'armor') maxima;
 SELECT coalesce(sum(greatest(0,(maxima.value #>> '{}')::int-coalesce((mech.structure->>maxima.key)::int,0))),0)::int INTO structure_points FROM jsonb_each(fresh->'structure') maxima;
 FOR row IN
  SELECT slot.label FROM jsonb_each(coalesce(mech.critical_slot_damage,'{}'::jsonb)) damaged
  CROSS JOIN LATERAL jsonb_array_elements_text(damaged.value) idx
  JOIN btech_catalogue_critical_slots slot ON slot.catalogue_version=mech.catalogue_version AND slot.unit_id=mech.unit_id
   AND slot.location=damaged.key AND slot.slot_index=idx::integer
 LOOP
  critical_slots:=critical_slots+1;component_cost:=component_cost+btech_career_component_replacement_cost(row.label);
 END LOOP;
 FOR row IN SELECT value FROM jsonb_array_elements(coalesce(mech.ammo_bins,'[]'::jsonb)) value LOOP
  IF NOT coalesce((row.value->>'destroyed')::boolean,false) THEN
   reload_rounds:=reload_rounds+greatest(0,coalesce((row.value->>'maxShots')::int,0)-coalesce((row.value->>'shots')::int,0));
   IF coalesce((row.value->>'maxShots')::int,0)>coalesce((row.value->>'shots')::int,0) THEN reload_bins:=reload_bins+1;END IF;
   reload_cost:=reload_cost+greatest(0,coalesce((row.value->>'maxShots')::int,0)-coalesce((row.value->>'shots')::int,0))*btech_career_ammo_round_cost(row.value->>'type');
  END IF;
 END LOOP;
 RETURN jsonb_build_object(
  'mech_id',mech.id,'status',mech.status,'serviceable',mech.status<>'destroyed',
  'repair',jsonb_build_object('armor_points',armor_points,'armor_cost',armor_points*10,'structure_points',structure_points,'structure_cost',structure_points*50,'critical_slots',critical_slots,'component_cost',component_cost,'total',armor_points*10+structure_points*50+component_cost),
  'reload',jsonb_build_object('rounds',reload_rounds,'bins',reload_bins,'total',reload_cost)
 );
END $$;
REVOKE ALL ON FUNCTION public.btech_career_service_quote_for_mech(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.btech_career_service_quote_for_mech(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_btech_career_service(p_mech_id uuid,p_service text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE company public.btech_career_companies%ROWTYPE;mech public.btech_career_owned_mechs%ROWTYPE;quote jsonb;cost bigint;fresh jsonb;restored_bins jsonb;
BEGIN
 IF p_service NOT IN ('repair','reload') THEN RAISE EXCEPTION 'Choose repair or reload';END IF;
 SELECT c.* INTO company FROM btech_career_companies c WHERE c.user_id=auth.uid() FOR UPDATE;
 IF company.id IS NULL THEN RAISE EXCEPTION 'Create a Career company first';END IF;
 IF EXISTS(SELECT 1 FROM btech_career_contracts WHERE company_id=company.id AND status='accepted') THEN RAISE EXCEPTION 'Finish the active Career contract before servicing the hangar';END IF;
 SELECT * INTO mech FROM btech_career_owned_mechs WHERE id=p_mech_id AND company_id=company.id FOR UPDATE;
 IF mech.id IS NULL THEN RAISE EXCEPTION 'Career BattleMech not found';END IF;
 IF mech.status='destroyed' THEN RAISE EXCEPTION 'Destroyed BattleMechs are recoverable wrecks and cannot be restored by the Career-1 repair bay';END IF;
 quote:=btech_career_service_quote_for_mech(mech.id);cost:=coalesce((quote->p_service->>'total')::bigint,0);
 IF cost<=0 THEN RETURN jsonb_build_object('service',p_service,'charged',0,'message','No service is required','quote',quote);END IF;
 IF company.credits<cost THEN RAISE EXCEPTION 'Insufficient credits for this % service',p_service;END IF;
 IF p_service='repair' THEN
  fresh:=btech_career_fresh_condition(mech.catalogue_version,mech.unit_id);
  SELECT coalesce(jsonb_agg(jsonb_set(value,'{destroyed}','false'::jsonb,true) ORDER BY ordinality),'[]'::jsonb) INTO restored_bins
  FROM jsonb_array_elements(coalesce(mech.ammo_bins,'[]'::jsonb)) WITH ORDINALITY bins(value,ordinality);
  UPDATE btech_career_owned_mechs SET armor=fresh->'armor',structure=fresh->'structure',critical_slot_damage='{}'::jsonb,ammo_bins=restored_bins,status='operational' WHERE id=mech.id;
  IF (quote->'repair'->>'armor_cost')::bigint>0 THEN INSERT INTO btech_career_ledger(company_id,kind,amount,reference_id,note) VALUES(company.id,'repair_armour',-(quote->'repair'->>'armor_cost')::bigint,mech.id,'Repair Bay: armour restoration');END IF;
  IF (quote->'repair'->>'structure_cost')::bigint>0 THEN INSERT INTO btech_career_ledger(company_id,kind,amount,reference_id,note) VALUES(company.id,'repair_structure',-(quote->'repair'->>'structure_cost')::bigint,mech.id,'Repair Bay: internal structure restoration');END IF;
  IF (quote->'repair'->>'component_cost')::bigint>0 THEN INSERT INTO btech_career_ledger(company_id,kind,amount,reference_id,note) VALUES(company.id,'repair_component',-(quote->'repair'->>'component_cost')::bigint,mech.id,'Repair Bay: critical component replacement');END IF;
 ELSE
  SELECT coalesce(jsonb_agg(CASE WHEN coalesce((value->>'destroyed')::boolean,false) THEN value ELSE jsonb_set(value,'{shots}',to_jsonb(coalesce((value->>'maxShots')::int,0)),true) END ORDER BY ordinality),'[]'::jsonb) INTO restored_bins
  FROM jsonb_array_elements(coalesce(mech.ammo_bins,'[]'::jsonb)) WITH ORDINALITY bins(value,ordinality);
  UPDATE btech_career_owned_mechs SET ammo_bins=restored_bins WHERE id=mech.id;
  INSERT INTO btech_career_ledger(company_id,kind,amount,reference_id,note) VALUES(company.id,'reload_ammo',-cost,mech.id,'Repair Bay: ammunition reload');
 END IF;
 UPDATE btech_career_companies SET credits=credits-cost,updated_at=now() WHERE id=company.id;
 RETURN jsonb_build_object('service',p_service,'charged',cost,'quote',quote,'remaining_credits',company.credits-cost);
END $$;
REVOKE ALL ON FUNCTION public.confirm_btech_career_service(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_btech_career_service(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_btech_career_hq()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE company public.btech_career_companies%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in before opening Company HQ';END IF;
 SELECT * INTO company FROM btech_career_companies WHERE user_id=auth.uid();
 IF NOT FOUND THEN RETURN jsonb_build_object('company',NULL,'mechs','[]'::jsonb,'pilots','[]'::jsonb,'contracts','[]'::jsonb,'ledger','[]'::jsonb,'settlements','[]'::jsonb);END IF;
 PERFORM btech_career_seed_contracts(company.id);
 RETURN jsonb_build_object('company',jsonb_build_object('id',company.id,'name',company.name,'commander_callsign',company.commander_callsign,'affiliation',company.affiliation,'banner_color',company.banner_color,'credits',company.credits,'reputation',company.reputation,'dropship_tonnage',company.dropship_tonnage,'created_at',company.created_at),
  'mechs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'unit_id',m.unit_id,'catalogue_version',m.catalogue_version,'callsign',m.callsign,'status',m.status,'armor',m.armor,'structure',m.structure,'critical_slot_damage',m.critical_slot_damage,'ammo_bins',m.ammo_bins,'pilot_state',m.pilot_state,'battles_fought',m.battles_fought,'pilot_id',mp.pilot_id,'service_quote',btech_career_service_quote_for_mech(m.id)) ORDER BY m.acquired_at) FROM btech_career_owned_mechs m LEFT JOIN btech_career_mech_pilots mp ON mp.mech_id=m.id WHERE m.company_id=company.id),'[]'::jsonb),
  'pilots',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'callsign',p.callsign,'gunnery',p.gunnery,'piloting',p.piloting,'specialty',p.specialty,'salary',p.salary,'status',p.status,'injuries',p.injuries,'experience',p.experience) ORDER BY p.hired_at) FROM btech_career_pilots p WHERE p.company_id=company.id),'[]'::jsonb),
  'contracts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'tier',c.tier,'opponent_kind',c.opponent_kind,'terms',c.terms,'status',c.status,'expires_at',c.expires_at) ORDER BY c.created_at DESC) FROM btech_career_contracts c WHERE c.company_id=company.id),'[]'::jsonb),
  'ledger',coalesce((SELECT jsonb_agg(rows.item) FROM (SELECT jsonb_build_object('id',l.id,'kind',l.kind,'amount',l.amount,'reference_id',l.reference_id,'note',l.note,'created_at',l.created_at) AS item FROM btech_career_ledger l WHERE l.company_id=company.id ORDER BY l.created_at DESC LIMIT 20) rows),'[]'::jsonb),
  'settlements',coalesce((SELECT jsonb_agg(rows.item) FROM (SELECT jsonb_build_object('id',s.id,'game_id',s.game_id,'contract_id',s.contract_id,'receipt',s.receipt,'settled_at',s.settled_at) AS item FROM btech_career_settlements s WHERE s.company_id=company.id ORDER BY s.settled_at DESC LIMIT 8) rows),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.get_btech_career_hq() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_btech_career_hq() TO authenticated;

NOTIFY pgrst,'reload schema';
