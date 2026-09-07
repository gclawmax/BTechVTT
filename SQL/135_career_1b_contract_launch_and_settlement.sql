-- Career-1b: deterministic AI contracts and exactly-once Career settlement.
-- Run after SQL/134. Career matches are born server-side from persistent
-- records; skirmishes retain no route into these functions.

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
  (company.id,'Perimeter Security '||(cycle+1),'low','ai',jsonb_build_object('map_id','training-grounds','victory_mode','annihilation','ai_difficulty','beginner','ai_personality','balanced','base_pay',180000,'success_bonus',50000,'reputation',2),'available'),
  (company.id,'Ridge Recon '||(cycle+1),'medium','ai',jsonb_build_object('map_id','ridge-and-ford','victory_mode','annihilation','ai_difficulty','intermediate','ai_personality','aggressive','base_pay',320000,'success_bonus',80000,'reputation',4),'available'),
  (company.id,'Industrial Interdiction '||(cycle+1),'high','ai',jsonb_build_object('map_id','industrial-crossing','victory_mode','control','ai_difficulty','veteran','ai_personality','coordinated','base_pay',520000,'success_bonus',120000,'reputation',6),'available');
END $$;
REVOKE ALL ON FUNCTION public.btech_career_seed_contracts(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.get_btech_career_hq()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE company public.btech_career_companies%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in before opening Company HQ';END IF;
 SELECT * INTO company FROM btech_career_companies WHERE user_id=auth.uid();
 IF NOT FOUND THEN RETURN jsonb_build_object('company',NULL,'mechs','[]'::jsonb,'pilots','[]'::jsonb,'contracts','[]'::jsonb,'ledger','[]'::jsonb,'settlements','[]'::jsonb);END IF;
 PERFORM btech_career_seed_contracts(company.id);
 RETURN jsonb_build_object('company',jsonb_build_object('id',company.id,'name',company.name,'commander_callsign',company.commander_callsign,'affiliation',company.affiliation,'banner_color',company.banner_color,'credits',company.credits,'reputation',company.reputation,'dropship_tonnage',company.dropship_tonnage,'created_at',company.created_at),
  'mechs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'unit_id',m.unit_id,'catalogue_version',m.catalogue_version,'callsign',m.callsign,'status',m.status,'armor',m.armor,'structure',m.structure,'critical_slot_damage',m.critical_slot_damage,'ammo_bins',m.ammo_bins,'pilot_state',m.pilot_state,'battles_fought',m.battles_fought,'pilot_id',mp.pilot_id) ORDER BY m.acquired_at) FROM btech_career_owned_mechs m LEFT JOIN btech_career_mech_pilots mp ON mp.mech_id=m.id WHERE m.company_id=company.id),'[]'::jsonb),
  'pilots',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'callsign',p.callsign,'gunnery',p.gunnery,'piloting',p.piloting,'specialty',p.specialty,'salary',p.salary,'status',p.status,'injuries',p.injuries,'experience',p.experience) ORDER BY p.hired_at) FROM btech_career_pilots p WHERE p.company_id=company.id),'[]'::jsonb),
  'contracts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'tier',c.tier,'opponent_kind',c.opponent_kind,'terms',c.terms,'status',c.status,'expires_at',c.expires_at) ORDER BY c.created_at DESC) FROM btech_career_contracts c WHERE c.company_id=company.id),'[]'::jsonb),
  'ledger',coalesce((SELECT jsonb_agg(rows.item) FROM (SELECT jsonb_build_object('id',l.id,'kind',l.kind,'amount',l.amount,'reference_id',l.reference_id,'note',l.note,'created_at',l.created_at) AS item FROM btech_career_ledger l WHERE l.company_id=company.id ORDER BY l.created_at DESC LIMIT 12) rows),'[]'::jsonb),
  'settlements',coalesce((SELECT jsonb_agg(rows.item) FROM (SELECT jsonb_build_object('id',s.id,'game_id',s.game_id,'contract_id',s.contract_id,'receipt',s.receipt,'settled_at',s.settled_at) AS item FROM btech_career_settlements s WHERE s.company_id=company.id ORDER BY s.settled_at DESC LIMIT 8) rows),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.get_btech_career_hq() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_btech_career_hq() TO authenticated;

CREATE OR REPLACE FUNCTION public.btech_career_instance(p_catalogue text,p_unit_id text,p_owner int,p_instance_id text,p_col int,p_row int,p_facing int,p_condition jsonb,p_pilot jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE definition jsonb;condition jsonb:=coalesce(p_condition,btech_career_fresh_condition(p_catalogue,p_unit_id));
BEGIN
 SELECT cu.definition INTO definition FROM btech_catalogue_units cu WHERE cu.catalogue_version=p_catalogue AND cu.unit_id=p_unit_id AND coalesce((cu.definition->>'supported_by_vtt')::boolean,false);
 IF definition IS NULL THEN RAISE EXCEPTION 'Career BattleMech % is unavailable in catalogue %',p_unit_id,p_catalogue;END IF;
 RETURN jsonb_build_object('instanceId',p_instance_id,'unitId',p_unit_id,'owner',p_owner,'col',p_col,'row',p_row,'facing',p_facing,'torsoFacing',p_facing,'hidden',false,
  'armor',condition->'armor','structure',condition->'structure','ammoBins',coalesce(condition->'ammo_bins','[]'::jsonb),'heat',0,'roundStartingHeat',0,'weaponHeat',0,'movementHeat',0,
  'pilot',jsonb_build_object('id',p_pilot->>'id','name',p_pilot->>'name','gunnery',coalesce((p_pilot->>'gunnery')::int,4),'piloting',coalesce((p_pilot->>'piloting')::int,5),'hits',coalesce((condition->'pilot_state'->>'hits')::int,0),'consciousness',coalesce(condition->'pilot_state'->>'consciousness','conscious')),
  'pilotingSkill',coalesce((p_pilot->>'piloting')::int,5),'criticalSlotDamage',coalesce(condition->'critical_slot_damage','{}'::jsonb),'weaponJams','[]'::jsonb,'catalogueVersion',p_catalogue,'unconfiguredAmmo',false);
END $$;
REVOKE ALL ON FUNCTION public.btech_career_instance(text,text,int,text,int,int,int,jsonb,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.launch_btech_career_contract(p_contract_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE company public.btech_career_companies%ROWTYPE;contract public.btech_career_contracts%ROWTYPE;catalogue text;game_id uuid;new_game_code text;launch_state jsonb;units jsonb:='[]'::jsonb;mapping jsonb:='[]'::jsonb;owned record;candidate record;idx int:=0;ai_idx int:=0;player_id uuid;ai_player_id uuid;map_id text;facing int;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in before launching a Career contract';END IF;
 SELECT * INTO company FROM btech_career_companies WHERE user_id=auth.uid() FOR UPDATE;IF company.id IS NULL THEN RAISE EXCEPTION 'Create a Career company first';END IF;
 SELECT * INTO contract FROM btech_career_contracts WHERE id=p_contract_id AND company_id=company.id FOR UPDATE;IF contract.id IS NULL OR contract.status<>'available' OR contract.opponent_kind<>'ai' THEN RAISE EXCEPTION 'This Career contract is no longer available';END IF;
 IF EXISTS(SELECT 1 FROM btech_career_contracts WHERE company_id=company.id AND status='accepted') THEN RAISE EXCEPTION 'Finish the active Career contract before launching another';END IF;
 SELECT catalogue_version INTO catalogue FROM btech_career_owned_mechs WHERE company_id=company.id AND status='operational' ORDER BY acquired_at LIMIT 1;IF catalogue IS NULL THEN RAISE EXCEPTION 'No operational Career BattleMechs are available';END IF;
 map_id:=coalesce(contract.terms->>'map_id','training-grounds');
 FOR owned IN SELECT m.*,p.id pilot_id,p.name pilot_name,p.gunnery,p.piloting FROM btech_career_owned_mechs m JOIN btech_career_mech_pilots mp ON mp.mech_id=m.id JOIN btech_career_pilots p ON p.id=mp.pilot_id WHERE m.company_id=company.id AND m.status='operational' AND p.status IN ('assigned','injured') ORDER BY m.acquired_at LIMIT 4 LOOP
  idx:=idx+1;units:=units||jsonb_build_array(btech_career_instance(owned.catalogue_version,owned.unit_id,1,'career-'||owned.id::text,1,least(15,2+idx*3),0,jsonb_build_object('armor',owned.armor,'structure',owned.structure,'critical_slot_damage',owned.critical_slot_damage,'ammo_bins',owned.ammo_bins,'pilot_state',owned.pilot_state),jsonb_build_object('id',owned.pilot_id,'name',owned.pilot_name,'gunnery',owned.gunnery,'piloting',owned.piloting)));
  mapping:=mapping||jsonb_build_array(jsonb_build_object('instance_id','career-'||owned.id::text,'mech_id',owned.id,'pilot_id',owned.pilot_id,'unit_id',owned.unit_id,'catalogue_version',owned.catalogue_version));
 END LOOP;
 IF idx=0 THEN RAISE EXCEPTION 'No operational Career BattleMech with an assigned pilot is available';END IF;
 FOR candidate IN SELECT unit_id FROM btech_catalogue_units WHERE catalogue_version=catalogue AND coalesce((definition->>'supported_by_vtt')::boolean,false) ORDER BY CASE contract.tier WHEN 'low' THEN coalesce((definition->>'mass')::int,99) WHEN 'medium' THEN abs(coalesce((definition->>'mass')::int,55)-55) ELSE abs(coalesce((definition->>'mass')::int,75)-75) END,unit_id LIMIT idx LOOP
  ai_idx:=ai_idx+1;facing:=3;units:=units||jsonb_build_array(btech_career_instance(catalogue,candidate.unit_id,2,'career-ai-'||ai_idx,14,least(15,2+ai_idx*3),facing,NULL,jsonb_build_object('id','career-ai-pilot-'||ai_idx,'name','Contract Opposition','gunnery',4,'piloting',5)));
 END LOOP;
 IF ai_idx<>idx THEN RAISE EXCEPTION 'Catalogue cannot build the required Career opposition';END IF;
 LOOP new_game_code:='BT-C'||upper(substr(encode(gen_random_bytes(4),'hex'),1,4));EXIT WHEN NOT EXISTS(SELECT 1 FROM btech_games g WHERE g.game_code=new_game_code);END LOOP;
 launch_state:=jsonb_build_object('map_id',map_id,'map_dimensions',jsonb_build_object('cols',16,'rows',17),'dropship_tonnage',company.dropship_tonnage,'ruleset','advanced_3060','victory_mode',coalesce(contract.terms->>'victory_mode','annihilation'),'objective_hexes',CASE WHEN coalesce(contract.terms->>'victory_mode','annihilation')='control' THEN btech_scenario_objective_hexes(map_id) ELSE '[]'::jsonb END,'objective_scores',jsonb_build_object('1',0,'2',0),'vs_ai_mode',true,'ai_difficulty',coalesce(contract.terms->>'ai_difficulty','intermediate'),'ai_personality',coalesce(contract.terms->>'ai_personality','balanced'),'ai_seed','career:'||contract.id::text,'ai_engine_version','career-1b','catalogue_version',catalogue,'special_ammo_setup_v1',true,'hidden_units_v1',true,'minefield_rules',jsonb_build_object('budget',0,'permitted_types','[]'::jsonb),'rosters',jsonb_build_object('1',(SELECT coalesce(jsonb_agg(value->>'unitId'),'[]'::jsonb) FROM jsonb_array_elements(units) value WHERE (value->>'owner')::int=1),'2',(SELECT coalesce(jsonb_agg(value->>'unitId'),'[]'::jsonb) FROM jsonb_array_elements(units) value WHERE (value->>'owner')::int=2)),'deployment_positions',jsonb_build_object(),'mech_instances',units,'turn',0,'phase','initiative','career_context',jsonb_build_object('version','career-1b','company_id',company.id,'contract_id',contract.id,'persistent_units',mapping));
 INSERT INTO btech_games(game_code,host_id,catalogue_version,match_type,state,status,current_round,current_phase,created_at) VALUES(new_game_code,auth.uid(),catalogue,'career',launch_state,'lobby',1,'initiative',now()) RETURNING id INTO game_id;
 INSERT INTO btech_players(game_id,user_id,seat_number,player_color,role,ready,is_ai) VALUES(game_id,auth.uid(),1,'#c48720','player',true,false) RETURNING id INTO player_id;
 INSERT INTO btech_players(game_id,user_id,seat_number,player_color,role,ready,is_ai) VALUES(game_id,NULL,2,'#3060c4','player',true,true) RETURNING id INTO ai_player_id;
 UPDATE btech_games SET status='in-progress',state=launch_state WHERE id=game_id;
 UPDATE btech_career_contracts SET status='accepted' WHERE id=contract.id;
 RETURN jsonb_build_object('game_id',game_id,'game_code',new_game_code,'contract_id',contract.id,'match_type','career');
END $$;
REVOKE ALL ON FUNCTION public.launch_btech_career_contract(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.launch_btech_career_contract(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.settle_btech_career_contract(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE game btech_games%ROWTYPE;company public.btech_career_companies%ROWTYPE;contract public.btech_career_contracts%ROWTYPE;report public.btech_match_reports%ROWTYPE;context jsonb;entry jsonb;final_unit jsonb;mech public.btech_career_owned_mechs%ROWTYPE;pilot public.btech_career_pilots%ROWTYPE;winner int;reward bigint;rep_delta int;receipt jsonb;existing public.btech_career_settlements%ROWTYPE;updated_count int:=0;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in before settling a Career contract';END IF;
 SELECT * INTO game FROM btech_games WHERE id=p_game_id FOR UPDATE;IF game.id IS NULL THEN RAISE EXCEPTION 'Career match not found';END IF;
 context:=(CASE jsonb_typeof(game.state) WHEN 'string' THEN (game.state#>>'{}')::jsonb ELSE game.state END)->'career_context';
 SELECT * INTO company FROM btech_career_companies WHERE id=(context->>'company_id')::uuid AND user_id=auth.uid() FOR UPDATE;IF company.id IS NULL THEN RAISE EXCEPTION 'Only the owning company may settle this Career match';END IF;
 PERFORM btech_career_require_match(game.id,company.id);
 SELECT * INTO existing FROM btech_career_settlements WHERE game_id=game.id;IF FOUND THEN RETURN existing.receipt;END IF;
 SELECT * INTO report FROM btech_match_reports WHERE game_id=game.id AND match_type='career';IF report.game_id IS NULL THEN RAISE EXCEPTION 'Career settlement waits for the sealed battle report';END IF;
 SELECT * INTO contract FROM btech_career_contracts WHERE id=(context->>'contract_id')::uuid AND company_id=company.id FOR UPDATE;IF contract.id IS NULL OR contract.status<>'accepted' THEN RAISE EXCEPTION 'Career contract is not awaiting settlement';END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(coalesce(context->'persistent_units','[]'::jsonb)) value LOOP
  SELECT * INTO mech FROM btech_career_owned_mechs WHERE id=(entry->>'mech_id')::uuid AND company_id=company.id FOR UPDATE;
  SELECT * INTO pilot FROM btech_career_pilots WHERE id=(entry->>'pilot_id')::uuid AND company_id=company.id FOR UPDATE;
  SELECT value INTO final_unit FROM jsonb_array_elements(coalesce(report.final_state->'mech_instances','[]'::jsonb)) value WHERE value->>'instanceId'=entry->>'instance_id';
  IF mech.id IS NULL OR pilot.id IS NULL OR final_unit IS NULL OR final_unit->>'unitId' IS DISTINCT FROM entry->>'unit_id' OR mech.catalogue_version IS DISTINCT FROM entry->>'catalogue_version' THEN RAISE EXCEPTION 'Sealed Career battle mapping is invalid';END IF;
  UPDATE btech_career_owned_mechs SET armor=coalesce(final_unit->'armor',mech.armor),structure=coalesce(final_unit->'structure',mech.structure),critical_slot_damage=coalesce(final_unit->'criticalSlotDamage',mech.critical_slot_damage),ammo_bins=coalesce(final_unit->'ammoBins',mech.ammo_bins),pilot_state=coalesce(final_unit->'pilot',mech.pilot_state),status=CASE WHEN coalesce((final_unit->>'destroyed')::boolean,false) THEN 'destroyed' WHEN coalesce(final_unit->'armor',mech.armor) IS DISTINCT FROM mech.armor OR coalesce(final_unit->'structure',mech.structure) IS DISTINCT FROM mech.structure OR coalesce(final_unit->'criticalSlotDamage',mech.critical_slot_damage) IS DISTINCT FROM mech.critical_slot_damage THEN 'damaged' ELSE 'operational' END,battles_fought=battles_fought+1 WHERE id=mech.id;
  UPDATE btech_career_pilots SET injuries=coalesce(final_unit->'pilot',pilot.injuries),status=CASE WHEN coalesce((final_unit->'pilot'->>'hits')::int,0)>0 THEN 'injured' ELSE 'assigned' END WHERE id=pilot.id;
  updated_count:=updated_count+1;
 END LOOP;
 IF updated_count=0 THEN RAISE EXCEPTION 'Career match has no persistent BattleMech mapping';END IF;
 winner:=NULLIF(report.result->>'winner_seat','')::int;reward:=coalesce((contract.terms->>'base_pay')::bigint,0)+CASE WHEN winner=1 THEN coalesce((contract.terms->>'success_bonus')::bigint,0) ELSE 0 END;rep_delta:=CASE WHEN winner=1 THEN coalesce((contract.terms->>'reputation')::int,0) ELSE 0 END;
 UPDATE btech_career_companies SET credits=credits+reward,reputation=least(100,reputation+rep_delta),updated_at=now() WHERE id=company.id;
 INSERT INTO btech_career_ledger(company_id,kind,amount,reference_id,note) VALUES(company.id,'contract_pay',coalesce((contract.terms->>'base_pay')::bigint,0),contract.id,'Career contract base pay');
 IF winner=1 AND coalesce((contract.terms->>'success_bonus')::bigint,0)>0 THEN INSERT INTO btech_career_ledger(company_id,kind,amount,reference_id,note) VALUES(company.id,'success_bonus',(contract.terms->>'success_bonus')::bigint,contract.id,'Career contract success bonus');END IF;
 receipt:=jsonb_build_object('version','career-settlement-1','game_id',game.id,'contract_id',contract.id,'result',report.result,'reward',reward,'reputation_delta',rep_delta,'persistent_mechs_updated',updated_count,'settled_at',now());
 INSERT INTO btech_career_settlements(company_id,game_id,contract_id,receipt) VALUES(company.id,game.id,contract.id,receipt);
 UPDATE btech_career_contracts SET status=CASE WHEN winner=1 THEN 'completed' ELSE 'failed' END WHERE id=contract.id;
 UPDATE btech_games SET status='finished' WHERE id=game.id;
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION public.settle_btech_career_contract(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_btech_career_contract(uuid) TO authenticated;

NOTIFY pgrst,'reload schema';
