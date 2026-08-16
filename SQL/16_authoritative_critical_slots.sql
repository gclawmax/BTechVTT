-- Authoritative Total Warfare critical-slot resolution for supported units.
-- Generated slot rows mirror js/game/critical-layouts.js exactly.

CREATE TABLE IF NOT EXISTS public.btech_authoritative_critical_slots (
  unit_id text NOT NULL,
  location text NOT NULL,
  slot_index int NOT NULL CHECK (slot_index BETWEEN 0 AND 11),
  label text NOT NULL,
  PRIMARY KEY (unit_id, location, slot_index)
);
ALTER TABLE public.btech_authoritative_critical_slots ENABLE ROW LEVEL SECURITY;

INSERT INTO public.btech_authoritative_critical_slots(unit_id,location,slot_index,label) VALUES
('atlas-as7-d','la',0,'Shoulder'),
 ('atlas-as7-d','la',1,'Upper Arm Actuator'),
 ('atlas-as7-d','la',2,'Lower Arm Actuator'),
 ('atlas-as7-d','la',3,'Hand Actuator'),
 ('atlas-as7-d','la',4,'Heat Sink'),
 ('atlas-as7-d','la',5,'Medium Laser'),
 ('atlas-as7-d','ra',0,'Shoulder'),
 ('atlas-as7-d','ra',1,'Upper Arm Actuator'),
 ('atlas-as7-d','ra',2,'Lower Arm Actuator'),
 ('atlas-as7-d','ra',3,'Hand Actuator'),
 ('atlas-as7-d','ra',4,'Heat Sink'),
 ('atlas-as7-d','ra',5,'Medium Laser'),
 ('atlas-as7-d','lt',0,'Heat Sink'),
 ('atlas-as7-d','lt',1,'LRM 20'),
 ('atlas-as7-d','lt',2,'LRM 20'),
 ('atlas-as7-d','lt',3,'LRM 20'),
 ('atlas-as7-d','lt',4,'LRM 20'),
 ('atlas-as7-d','lt',5,'LRM 20'),
 ('atlas-as7-d','lt',6,'SRM 6'),
 ('atlas-as7-d','lt',7,'SRM 6'),
 ('atlas-as7-d','lt',8,'IS Ammo LRM-20'),
 ('atlas-as7-d','lt',9,'IS Ammo LRM-20'),
 ('atlas-as7-d','lt',10,'IS Ammo SRM-6'),
 ('atlas-as7-d','rt',0,'Autocannon/20'),
 ('atlas-as7-d','rt',1,'Autocannon/20'),
 ('atlas-as7-d','rt',2,'Autocannon/20'),
 ('atlas-as7-d','rt',3,'Autocannon/20'),
 ('atlas-as7-d','rt',4,'Autocannon/20'),
 ('atlas-as7-d','rt',5,'Autocannon/20'),
 ('atlas-as7-d','rt',6,'Autocannon/20'),
 ('atlas-as7-d','rt',7,'Autocannon/20'),
 ('atlas-as7-d','rt',8,'Autocannon/20'),
 ('atlas-as7-d','rt',9,'Autocannon/20'),
 ('atlas-as7-d','rt',10,'IS Ammo AC/20'),
 ('atlas-as7-d','rt',11,'IS Ammo AC/20'),
 ('atlas-as7-d','ct',0,'Fusion Engine'),
 ('atlas-as7-d','ct',1,'Fusion Engine'),
 ('atlas-as7-d','ct',2,'Fusion Engine'),
 ('atlas-as7-d','ct',3,'Gyro'),
 ('atlas-as7-d','ct',4,'Gyro'),
 ('atlas-as7-d','ct',5,'Gyro'),
 ('atlas-as7-d','ct',6,'Gyro'),
 ('atlas-as7-d','ct',7,'Fusion Engine'),
 ('atlas-as7-d','ct',8,'Fusion Engine'),
 ('atlas-as7-d','ct',9,'Fusion Engine'),
 ('atlas-as7-d','ct',10,'Medium Laser (R)'),
 ('atlas-as7-d','ct',11,'Medium Laser (R)'),
 ('atlas-as7-d','head',0,'Life Support'),
 ('atlas-as7-d','head',1,'Sensors'),
 ('atlas-as7-d','head',2,'Cockpit'),
 ('atlas-as7-d','head',3,'Heat Sink'),
 ('atlas-as7-d','head',4,'Sensors'),
 ('atlas-as7-d','head',5,'Life Support'),
 ('atlas-as7-d','ll',0,'Hip'),
 ('atlas-as7-d','ll',1,'Upper Leg Actuator'),
 ('atlas-as7-d','ll',2,'Lower Leg Actuator'),
 ('atlas-as7-d','ll',3,'Foot Actuator'),
 ('atlas-as7-d','ll',4,'Heat Sink'),
 ('atlas-as7-d','ll',5,'Heat Sink'),
 ('atlas-as7-d','rl',0,'Hip'),
 ('atlas-as7-d','rl',1,'Upper Leg Actuator'),
 ('atlas-as7-d','rl',2,'Lower Leg Actuator'),
 ('atlas-as7-d','rl',3,'Foot Actuator'),
 ('atlas-as7-d','rl',4,'Heat Sink'),
 ('atlas-as7-d','rl',5,'Heat Sink'),
 ('hunchback-hbk-4g','la',0,'Shoulder'),
 ('hunchback-hbk-4g','la',1,'Upper Arm Actuator'),
 ('hunchback-hbk-4g','la',2,'Lower Arm Actuator'),
 ('hunchback-hbk-4g','la',3,'Hand Actuator'),
 ('hunchback-hbk-4g','la',4,'Medium Laser'),
 ('hunchback-hbk-4g','ra',0,'Shoulder'),
 ('hunchback-hbk-4g','ra',1,'Upper Arm Actuator'),
 ('hunchback-hbk-4g','ra',2,'Lower Arm Actuator'),
 ('hunchback-hbk-4g','ra',3,'Hand Actuator'),
 ('hunchback-hbk-4g','ra',4,'Medium Laser'),
 ('hunchback-hbk-4g','lt',0,'IS Ammo AC/20'),
 ('hunchback-hbk-4g','lt',1,'IS Ammo AC/20'),
 ('hunchback-hbk-4g','rt',0,'Autocannon/20'),
 ('hunchback-hbk-4g','rt',1,'Autocannon/20'),
 ('hunchback-hbk-4g','rt',2,'Autocannon/20'),
 ('hunchback-hbk-4g','rt',3,'Autocannon/20'),
 ('hunchback-hbk-4g','rt',4,'Autocannon/20'),
 ('hunchback-hbk-4g','rt',5,'Autocannon/20'),
 ('hunchback-hbk-4g','rt',6,'Autocannon/20'),
 ('hunchback-hbk-4g','rt',7,'Autocannon/20'),
 ('hunchback-hbk-4g','rt',8,'Autocannon/20'),
 ('hunchback-hbk-4g','rt',9,'Autocannon/20'),
 ('hunchback-hbk-4g','ct',0,'Fusion Engine'),
 ('hunchback-hbk-4g','ct',1,'Fusion Engine'),
 ('hunchback-hbk-4g','ct',2,'Fusion Engine'),
 ('hunchback-hbk-4g','ct',3,'Gyro'),
 ('hunchback-hbk-4g','ct',4,'Gyro'),
 ('hunchback-hbk-4g','ct',5,'Gyro'),
 ('hunchback-hbk-4g','ct',6,'Gyro'),
 ('hunchback-hbk-4g','ct',7,'Fusion Engine'),
 ('hunchback-hbk-4g','ct',8,'Fusion Engine'),
 ('hunchback-hbk-4g','ct',9,'Fusion Engine'),
 ('hunchback-hbk-4g','ct',10,'Heat Sink'),
 ('hunchback-hbk-4g','head',0,'Life Support'),
 ('hunchback-hbk-4g','head',1,'Sensors'),
 ('hunchback-hbk-4g','head',2,'Cockpit'),
 ('hunchback-hbk-4g','head',3,'Small Laser'),
 ('hunchback-hbk-4g','head',4,'Sensors'),
 ('hunchback-hbk-4g','head',5,'Life Support'),
 ('hunchback-hbk-4g','ll',0,'Hip'),
 ('hunchback-hbk-4g','ll',1,'Upper Leg Actuator'),
 ('hunchback-hbk-4g','ll',2,'Lower Leg Actuator'),
 ('hunchback-hbk-4g','ll',3,'Foot Actuator'),
 ('hunchback-hbk-4g','ll',4,'Heat Sink'),
 ('hunchback-hbk-4g','ll',5,'Heat Sink'),
 ('hunchback-hbk-4g','rl',0,'Hip'),
 ('hunchback-hbk-4g','rl',1,'Upper Leg Actuator'),
 ('hunchback-hbk-4g','rl',2,'Lower Leg Actuator'),
 ('hunchback-hbk-4g','rl',3,'Foot Actuator'),
 ('hunchback-hbk-4g','rl',4,'Heat Sink'),
 ('hunchback-hbk-4g','rl',5,'Heat Sink'),
 ('locust-lct-1v','la',0,'Shoulder'),
 ('locust-lct-1v','la',1,'Upper Arm Actuator'),
 ('locust-lct-1v','la',2,'Machine Gun'),
 ('locust-lct-1v','ra',0,'Shoulder'),
 ('locust-lct-1v','ra',1,'Upper Arm Actuator'),
 ('locust-lct-1v','ra',2,'Machine Gun'),
 ('locust-lct-1v','ct',0,'Fusion Engine'),
 ('locust-lct-1v','ct',1,'Fusion Engine'),
 ('locust-lct-1v','ct',2,'Fusion Engine'),
 ('locust-lct-1v','ct',3,'Gyro'),
 ('locust-lct-1v','ct',4,'Gyro'),
 ('locust-lct-1v','ct',5,'Gyro'),
 ('locust-lct-1v','ct',6,'Gyro'),
 ('locust-lct-1v','ct',7,'Fusion Engine'),
 ('locust-lct-1v','ct',8,'Fusion Engine'),
 ('locust-lct-1v','ct',9,'Fusion Engine'),
 ('locust-lct-1v','ct',10,'Medium Laser'),
 ('locust-lct-1v','ct',11,'IS Ammo MG - Full'),
 ('locust-lct-1v','head',0,'Life Support'),
 ('locust-lct-1v','head',1,'Sensors'),
 ('locust-lct-1v','head',2,'Cockpit'),
 ('locust-lct-1v','head',4,'Sensors'),
 ('locust-lct-1v','head',5,'Life Support'),
 ('locust-lct-1v','ll',0,'Hip'),
 ('locust-lct-1v','ll',1,'Upper Leg Actuator'),
 ('locust-lct-1v','ll',2,'Lower Leg Actuator'),
 ('locust-lct-1v','ll',3,'Foot Actuator'),
 ('locust-lct-1v','ll',4,'Heat Sink'),
 ('locust-lct-1v','ll',5,'Heat Sink'),
 ('locust-lct-1v','rl',0,'Hip'),
 ('locust-lct-1v','rl',1,'Upper Leg Actuator'),
 ('locust-lct-1v','rl',2,'Lower Leg Actuator'),
 ('locust-lct-1v','rl',3,'Foot Actuator'),
 ('locust-lct-1v','rl',4,'Heat Sink'),
 ('locust-lct-1v','rl',5,'Heat Sink'),
 ('marauder-mad-3r','la',0,'Shoulder'),
 ('marauder-mad-3r','la',1,'Upper Arm Actuator'),
 ('marauder-mad-3r','la',2,'Lower Arm Actuator'),
 ('marauder-mad-3r','la',3,'PPC'),
 ('marauder-mad-3r','la',4,'PPC'),
 ('marauder-mad-3r','la',5,'PPC'),
 ('marauder-mad-3r','la',6,'Medium Laser'),
 ('marauder-mad-3r','ra',0,'Shoulder'),
 ('marauder-mad-3r','ra',1,'Upper Arm Actuator'),
 ('marauder-mad-3r','ra',2,'Lower Arm Actuator'),
 ('marauder-mad-3r','ra',3,'PPC'),
 ('marauder-mad-3r','ra',4,'PPC'),
 ('marauder-mad-3r','ra',5,'PPC'),
 ('marauder-mad-3r','ra',6,'Medium Laser'),
 ('marauder-mad-3r','lt',0,'IS Ammo AC/5'),
 ('marauder-mad-3r','rt',0,'Autocannon/5'),
 ('marauder-mad-3r','rt',1,'Autocannon/5'),
 ('marauder-mad-3r','rt',2,'Autocannon/5'),
 ('marauder-mad-3r','rt',3,'Autocannon/5'),
 ('marauder-mad-3r','ct',0,'Fusion Engine'),
 ('marauder-mad-3r','ct',1,'Fusion Engine'),
 ('marauder-mad-3r','ct',2,'Fusion Engine'),
 ('marauder-mad-3r','ct',3,'Gyro'),
 ('marauder-mad-3r','ct',4,'Gyro'),
 ('marauder-mad-3r','ct',5,'Gyro'),
 ('marauder-mad-3r','ct',6,'Gyro'),
 ('marauder-mad-3r','ct',7,'Fusion Engine'),
 ('marauder-mad-3r','ct',8,'Fusion Engine'),
 ('marauder-mad-3r','ct',9,'Fusion Engine'),
 ('marauder-mad-3r','head',0,'Life Support'),
 ('marauder-mad-3r','head',1,'Sensors'),
 ('marauder-mad-3r','head',2,'Cockpit'),
 ('marauder-mad-3r','head',4,'Sensors'),
 ('marauder-mad-3r','head',5,'Life Support'),
 ('marauder-mad-3r','ll',0,'Hip'),
 ('marauder-mad-3r','ll',1,'Upper Leg Actuator'),
 ('marauder-mad-3r','ll',2,'Lower Leg Actuator'),
 ('marauder-mad-3r','ll',3,'Foot Actuator'),
 ('marauder-mad-3r','ll',4,'Heat Sink'),
 ('marauder-mad-3r','ll',5,'Heat Sink'),
 ('marauder-mad-3r','rl',0,'Hip'),
 ('marauder-mad-3r','rl',1,'Upper Leg Actuator'),
 ('marauder-mad-3r','rl',2,'Lower Leg Actuator'),
 ('marauder-mad-3r','rl',3,'Foot Actuator'),
 ('marauder-mad-3r','rl',4,'Heat Sink'),
 ('marauder-mad-3r','rl',5,'Heat Sink'),
 ('enforcer-enf-4r','la',0,'Shoulder'),
 ('enforcer-enf-4r','la',1,'Upper Arm Actuator'),
 ('enforcer-enf-4r','la',2,'Lower Arm Actuator'),
 ('enforcer-enf-4r','la',3,'Large Laser'),
 ('enforcer-enf-4r','la',4,'Large Laser'),
 ('enforcer-enf-4r','ra',0,'Shoulder'),
 ('enforcer-enf-4r','ra',1,'Upper Arm Actuator'),
 ('enforcer-enf-4r','ra',2,'Lower Arm Actuator'),
 ('enforcer-enf-4r','ra',3,'Autocannon/10'),
 ('enforcer-enf-4r','ra',4,'Autocannon/10'),
 ('enforcer-enf-4r','ra',5,'Autocannon/10'),
 ('enforcer-enf-4r','ra',6,'Autocannon/10'),
 ('enforcer-enf-4r','ra',7,'Autocannon/10'),
 ('enforcer-enf-4r','ra',8,'Autocannon/10'),
 ('enforcer-enf-4r','ra',9,'Autocannon/10'),
 ('enforcer-enf-4r','lt',0,'Heat Sink'),
 ('enforcer-enf-4r','lt',1,'Heat Sink'),
 ('enforcer-enf-4r','lt',2,'Small Laser'),
 ('enforcer-enf-4r','rt',0,'Heat Sink'),
 ('enforcer-enf-4r','rt',1,'Heat Sink'),
 ('enforcer-enf-4r','rt',2,'IS Ammo AC/10'),
 ('enforcer-enf-4r','ct',0,'Fusion Engine'),
 ('enforcer-enf-4r','ct',1,'Fusion Engine'),
 ('enforcer-enf-4r','ct',2,'Fusion Engine'),
 ('enforcer-enf-4r','ct',3,'Gyro'),
 ('enforcer-enf-4r','ct',4,'Gyro'),
 ('enforcer-enf-4r','ct',5,'Gyro'),
 ('enforcer-enf-4r','ct',6,'Gyro'),
 ('enforcer-enf-4r','ct',7,'Fusion Engine'),
 ('enforcer-enf-4r','ct',8,'Fusion Engine'),
 ('enforcer-enf-4r','ct',9,'Fusion Engine'),
 ('enforcer-enf-4r','head',0,'Life Support'),
 ('enforcer-enf-4r','head',1,'Sensors'),
 ('enforcer-enf-4r','head',2,'Cockpit'),
 ('enforcer-enf-4r','head',4,'Sensors'),
 ('enforcer-enf-4r','head',5,'Life Support'),
 ('enforcer-enf-4r','ll',0,'Hip'),
 ('enforcer-enf-4r','ll',1,'Upper Leg Actuator'),
 ('enforcer-enf-4r','ll',2,'Lower Leg Actuator'),
 ('enforcer-enf-4r','ll',3,'Foot Actuator'),
 ('enforcer-enf-4r','ll',4,'Jump Jet'),
 ('enforcer-enf-4r','ll',5,'Jump Jet'),
 ('enforcer-enf-4r','rl',0,'Hip'),
 ('enforcer-enf-4r','rl',1,'Upper Leg Actuator'),
 ('enforcer-enf-4r','rl',2,'Lower Leg Actuator'),
 ('enforcer-enf-4r','rl',3,'Foot Actuator'),
 ('enforcer-enf-4r','rl',4,'Jump Jet'),
 ('enforcer-enf-4r','rl',5,'Jump Jet'),
 ('centurion-cn9-a','la',0,'Shoulder'),
 ('centurion-cn9-a','la',1,'Upper Arm Actuator'),
 ('centurion-cn9-a','la',2,'Lower Arm Actuator'),
 ('centurion-cn9-a','la',3,'Hand Actuator'),
 ('centurion-cn9-a','ra',0,'Shoulder'),
 ('centurion-cn9-a','ra',1,'Upper Arm Actuator'),
 ('centurion-cn9-a','ra',2,'Lower Arm Actuator'),
 ('centurion-cn9-a','ra',3,'Autocannon/10'),
 ('centurion-cn9-a','ra',4,'Autocannon/10'),
 ('centurion-cn9-a','ra',5,'Autocannon/10'),
 ('centurion-cn9-a','ra',6,'Autocannon/10'),
 ('centurion-cn9-a','ra',7,'Autocannon/10'),
 ('centurion-cn9-a','ra',8,'Autocannon/10'),
 ('centurion-cn9-a','ra',9,'Autocannon/10'),
 ('centurion-cn9-a','lt',0,'Heat Sink'),
 ('centurion-cn9-a','lt',1,'LRM 10'),
 ('centurion-cn9-a','lt',2,'LRM 10'),
 ('centurion-cn9-a','lt',3,'IS Ammo LRM-10'),
 ('centurion-cn9-a','lt',4,'IS Ammo LRM-10'),
 ('centurion-cn9-a','rt',0,'Heat Sink'),
 ('centurion-cn9-a','rt',1,'IS Ammo AC/10'),
 ('centurion-cn9-a','rt',2,'IS Ammo AC/10'),
 ('centurion-cn9-a','ct',0,'Fusion Engine'),
 ('centurion-cn9-a','ct',1,'Fusion Engine'),
 ('centurion-cn9-a','ct',2,'Fusion Engine'),
 ('centurion-cn9-a','ct',3,'Gyro'),
 ('centurion-cn9-a','ct',4,'Gyro'),
 ('centurion-cn9-a','ct',5,'Gyro'),
 ('centurion-cn9-a','ct',6,'Gyro'),
 ('centurion-cn9-a','ct',7,'Fusion Engine'),
 ('centurion-cn9-a','ct',8,'Fusion Engine'),
 ('centurion-cn9-a','ct',9,'Fusion Engine'),
 ('centurion-cn9-a','ct',10,'Medium Laser'),
 ('centurion-cn9-a','ct',11,'Medium Laser (R)'),
 ('centurion-cn9-a','head',0,'Life Support'),
 ('centurion-cn9-a','head',1,'Sensors'),
 ('centurion-cn9-a','head',2,'Cockpit'),
 ('centurion-cn9-a','head',4,'Sensors'),
 ('centurion-cn9-a','head',5,'Life Support'),
 ('centurion-cn9-a','ll',0,'Hip'),
 ('centurion-cn9-a','ll',1,'Upper Leg Actuator'),
 ('centurion-cn9-a','ll',2,'Lower Leg Actuator'),
 ('centurion-cn9-a','ll',3,'Foot Actuator'),
 ('centurion-cn9-a','rl',0,'Hip'),
 ('centurion-cn9-a','rl',1,'Upper Leg Actuator'),
 ('centurion-cn9-a','rl',2,'Lower Leg Actuator'),
 ('centurion-cn9-a','rl',3,'Foot Actuator')
ON CONFLICT (unit_id,location,slot_index) DO UPDATE SET label=EXCLUDED.label;

CREATE OR REPLACE FUNCTION public.btech_critical_slot_is_damaged(p_mech jsonb,p_location text,p_slot int)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT EXISTS (
   SELECT 1 FROM jsonb_array_elements_text(coalesce(p_mech->'criticalSlotDamage'->p_location,'[]'::jsonb)) value
   WHERE value::int=p_slot
 ) $$;

CREATE OR REPLACE FUNCTION public.btech_mark_critical_slot(p_mech jsonb,p_location text,p_slot int)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE m jsonb:=p_mech; damaged jsonb; slots jsonb;
BEGIN
 damaged:=coalesce(m->'criticalSlotDamage','{}'::jsonb);
 slots:=coalesce(damaged->p_location,'[]'::jsonb);
 IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(slots) value WHERE value::int=p_slot) THEN
   slots:=slots||to_jsonb(p_slot); damaged:=jsonb_set(damaged,ARRAY[p_location],slots,true);
   m:=jsonb_set(m,'{criticalSlotDamage}',damaged,true);
 END IF;
 RETURN m;
END $$;

CREATE OR REPLACE FUNCTION public.btech_critical_label_count(p_mech jsonb,p_label text)
RETURNS int LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT count(*)::int FROM btech_authoritative_critical_slots slot
 WHERE slot.unit_id=p_mech->>'unitId'
   AND regexp_replace(slot.label,'[[:space:]]*\([A-Z]\)$','')=p_label
   AND btech_critical_slot_is_damaged(p_mech,slot.location,slot.slot_index) $$;

CREATE OR REPLACE FUNCTION public.btech_apply_internal_damage(p_mech jsonb,p_location text,p_damage int)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE m jsonb:=p_mech;loc text:=p_location;remaining int:=p_damage;now_value int;used int;
 transfer jsonb:='{"la":"lt","ra":"rt","ll":"lt","rl":"rt","lt":"ct","rt":"ct"}'::jsonb;
BEGIN
 WHILE remaining>0 AND loc IS NOT NULL AND NOT coalesce((m->>'destroyed')::boolean,false) LOOP
  now_value:=coalesce((m->'structure'->>loc)::int,0);used:=least(now_value,remaining);
  m:=jsonb_set(m,ARRAY['structure',loc],to_jsonb(now_value-used),true);remaining:=remaining-used;
  IF coalesce((m->'structure'->>loc)::int,0)>0 THEN EXIT; END IF;
  IF loc IN ('head','ct') THEN m:=jsonb_set(m,'{destroyed}','true'::jsonb,true);EXIT;END IF;
  IF loc='lt' THEN m:=jsonb_set(m,'{structure,la}','0'::jsonb,true);END IF;
  IF loc='rt' THEN m:=jsonb_set(m,'{structure,ra}','0'::jsonb,true);END IF;
  loc:=transfer->>loc;
 END LOOP;
 RETURN m;
END $$;

CREATE OR REPLACE FUNCTION public.btech_resolve_critical_slots(p_mech jsonb,p_location text,p_total int)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE m jsonb:=p_mech;loc text:=p_location;hits int;remaining int;chosen int;slot_label text;
 events jsonb:='[]'::jsonb;transfer jsonb:='{"la":"lt","ra":"rt","ll":"lt","rl":"rt","lt":"ct","rt":"ct"}'::jsonb;
 ammo_type text;ammo_damage int;bin jsonb;pos bigint;shots int;
BEGIN
 IF p_total<=7 THEN RETURN jsonb_build_object('mech',m,'hits',0,'events',events); END IF;
 IF p_total=12 AND loc IN ('head','la','ra','ll','rl') THEN
  m:=jsonb_set(m,ARRAY['structure',loc],'0'::jsonb,true);
  IF loc='head' THEN m:=jsonb_set(m,'{destroyed}','true'::jsonb,true);END IF;
  events:=events||jsonb_build_array(jsonb_build_object('location',loc,'special','blown_off'));
  RETURN jsonb_build_object('mech',m,'hits',0,'events',events);
 END IF;
 hits:=CASE WHEN p_total<=9 THEN 1 WHEN p_total<=11 THEN 2 ELSE 3 END;remaining:=hits;
 WHILE remaining>0 AND loc IS NOT NULL AND NOT coalesce((m->>'destroyed')::boolean,false) LOOP
  SELECT slot_index,label INTO chosen,slot_label FROM btech_authoritative_critical_slots slot
   WHERE slot.unit_id=m->>'unitId' AND slot.location=loc
     AND (loc NOT IN ('head','ll','rl') OR slot.slot_index<6)
     AND slot.label NOT IN ('Endo Steel','Ferro-Fibrous','CASE')
     AND NOT btech_critical_slot_is_damaged(m,loc,slot.slot_index)
   ORDER BY random() LIMIT 1;
  IF NOT FOUND THEN loc:=transfer->>loc;CONTINUE;END IF;
  m:=btech_mark_critical_slot(m,loc,chosen);
  events:=events||jsonb_build_array(jsonb_build_object('location',loc,'slot_index',chosen,'label',slot_label));
  IF regexp_replace(slot_label,'[[:space:]]*\([A-Z]\)$','')='Cockpit' THEN m:=jsonb_set(m,'{destroyed}','true'::jsonb,true);END IF;
  IF regexp_replace(slot_label,'[[:space:]]*\([A-Z]\)$','')='Fusion Engine' AND btech_critical_label_count(m,'Fusion Engine')>=3 THEN m:=jsonb_set(m,'{destroyed}','true'::jsonb,true);END IF;
  ammo_type:=CASE
   WHEN slot_label ILIKE '%Ammo AC/20%' THEN 'ac20' WHEN slot_label ILIKE '%Ammo AC/10%' THEN 'ac10'
   WHEN slot_label ILIKE '%Ammo AC/5%' THEN 'ac5' WHEN slot_label ILIKE '%Ammo LRM-20%' THEN 'lrm20'
   WHEN slot_label ILIKE '%Ammo LRM-10%' THEN 'lrm10' WHEN slot_label ILIKE '%Ammo SRM-6%' THEN 'srm6'
   WHEN slot_label ILIKE '%Ammo MG%' THEN 'machine_gun' END;
  ammo_damage:=CASE ammo_type WHEN 'ac20' THEN 20 WHEN 'ac10' THEN 10 WHEN 'ac5' THEN 5 WHEN 'lrm20' THEN 20 WHEN 'lrm10' THEN 10 WHEN 'srm6' THEN 12 WHEN 'machine_gun' THEN 2 END;
  IF ammo_type IS NOT NULL THEN
   FOR bin,pos IN SELECT value,ordinality FROM jsonb_array_elements(coalesce(m->'ammoBins','[]'::jsonb)) WITH ORDINALITY LOOP
    IF bin->>'type'=ammo_type AND coalesce((bin->>'shots')::int,0)>0 AND NOT coalesce((bin->>'destroyed')::boolean,false) THEN
     shots:=(bin->>'shots')::int;
     m:=jsonb_set(m,ARRAY['ammoBins',(pos-1)::text,'shots'],'0'::jsonb,true);
     m:=jsonb_set(m,ARRAY['ammoBins',(pos-1)::text,'destroyed'],'true'::jsonb,true);
     m:=btech_apply_internal_damage(m,loc,shots*ammo_damage);
     events:=events||jsonb_build_array(jsonb_build_object('location',loc,'ammo_explosion',ammo_type,'damage',shots*ammo_damage));
     EXIT;
    END IF;
   END LOOP;
  END IF;
  remaining:=remaining-1;
 END LOOP;
 m:=jsonb_set(m,'{criticalHits}',to_jsonb(coalesce((m->>'criticalHits')::int,0)+hits-remaining),true);
 RETURN jsonb_build_object('mech',m,'hits',hits-remaining,'events',events);
END $$;

CREATE OR REPLACE FUNCTION public.btech_apply_direct_damage(p_mech jsonb,p_damage int,p_location text,p_rear boolean)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE m jsonb:=p_mech;loc text:=p_location;armor_loc text;remaining int:=p_damage;value_now int;used int;
 transfer jsonb:='{"la":"lt","ra":"rt","ll":"lt","rl":"rt","lt":"ct","rt":"ct","head":"ct"}'::jsonb;
 crits jsonb:='[]'::jsonb;da int;db int;critical_result jsonb;
BEGIN
 WHILE remaining>0 AND loc IS NOT NULL AND NOT coalesce((m->>'destroyed')::boolean,false) LOOP
  armor_loc:=CASE WHEN p_rear AND loc IN ('ct','lt','rt') THEN loc||'_rear' ELSE loc END;
  value_now:=coalesce((m->'armor'->>armor_loc)::int,0);used:=least(value_now,remaining);
  m:=jsonb_set(m,ARRAY['armor',armor_loc],to_jsonb(value_now-used),true);remaining:=remaining-used;
  IF remaining=0 THEN EXIT;END IF;
  value_now:=coalesce((m->'structure'->>loc)::int,0);used:=least(value_now,remaining);
  m:=jsonb_set(m,ARRAY['structure',loc],to_jsonb(value_now-used),true);remaining:=remaining-used;
  IF used>0 THEN
   da:=floor(random()*6+1);db:=floor(random()*6+1);critical_result:=btech_resolve_critical_slots(m,loc,da+db);m:=critical_result->'mech';
   crits:=crits||jsonb_build_array(jsonb_build_object('location',loc,'die_a',da,'die_b',db,'total',da+db,'hits',critical_result->'hits','events',critical_result->'events'));
  END IF;
  IF coalesce((m->'structure'->>loc)::int,0)>0 THEN EXIT;END IF;
  IF loc IN ('head','ct') THEN m:=jsonb_set(m,'{destroyed}','true'::jsonb,true);EXIT;END IF;
  IF loc='lt' THEN m:=jsonb_set(m,'{structure,la}','0'::jsonb,true);END IF;
  IF loc='rt' THEN m:=jsonb_set(m,'{structure,ra}','0'::jsonb,true);END IF;
  loc:=transfer->>loc;p_rear:=false;
 END LOOP;
 RETURN jsonb_build_object('mech',m,'critical_checks',crits);
END $$;

-- Keep the SQL 15 resolver as the locked mutation core, and place critical
-- component validation in front of it for every subsequent declaration.
DO $$ BEGIN
 IF to_regprocedure('public.resolve_standard_weapon_attack_core(uuid,text,text,text[])') IS NULL THEN
  ALTER FUNCTION public.resolve_standard_weapon_attack(uuid,text,text,text[])
    RENAME TO resolve_standard_weapon_attack_core;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.resolve_standard_weapon_attack_core(uuid,text,text,text[]) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public.resolve_standard_weapon_attack(p_game_id uuid,p_attacker_instance_id text,p_target_instance_id text,p_weapon_mounts text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;st jsonb;attacker jsonb;v_mount_id text;mount btech_authoritative_mounts%ROWTYPE;
 weapon btech_authoritative_weapons%ROWTYPE;loc text;critical_label text;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 SELECT value INTO attacker FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=p_attacker_instance_id;
 IF attacker IS NULL THEN RAISE EXCEPTION 'Attacker was not found';END IF;
 IF btech_critical_label_count(attacker,'Sensors')>=2 THEN RAISE EXCEPTION 'Destroyed sensors prevent weapon attacks';END IF;
 FOREACH v_mount_id IN ARRAY coalesce(p_weapon_mounts,ARRAY[]::text[]) LOOP
  SELECT * INTO mount FROM btech_authoritative_mounts authoritative_mount WHERE authoritative_mount.unit_id=attacker->>'unitId' AND authoritative_mount.mount_id=v_mount_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unsupported or invalid direct-fire mount: %',v_mount_id;END IF;
  SELECT * INTO weapon FROM btech_authoritative_weapons WHERE weapon_key=mount.weapon_key;
  loc:=CASE mount.location WHEN 'Left Arm' THEN 'la' WHEN 'Right Arm' THEN 'ra' WHEN 'Left Torso' THEN 'lt' WHEN 'Right Torso' THEN 'rt' WHEN 'Center Torso' THEN 'ct' WHEN 'Head' THEN 'head' END;
  critical_label:=CASE weapon.weapon_key WHEN 'ac20' THEN 'Autocannon/20' WHEN 'ac10' THEN 'Autocannon/10' WHEN 'ac5' THEN 'Autocannon/5' ELSE weapon.name END;
  IF EXISTS (SELECT 1 FROM btech_authoritative_critical_slots slot WHERE slot.unit_id=attacker->>'unitId' AND slot.location=loc
    AND (regexp_replace(slot.label,'[[:space:]]*\([A-Z]\)$','')=critical_label OR (loc IN ('la','ra') AND slot.label='Shoulder'))
    AND btech_critical_slot_is_damaged(attacker,loc,slot.slot_index)) THEN
   RAISE EXCEPTION '% was destroyed by a critical hit',weapon.name;
  END IF;
 END LOOP;
 RETURN public.resolve_standard_weapon_attack_core(p_game_id,p_attacker_instance_id,p_target_instance_id,p_weapon_mounts);
END $$;

REVOKE ALL ON FUNCTION public.resolve_standard_weapon_attack(uuid,text,text,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_standard_weapon_attack(uuid,text,text,text[]) TO authenticated;
