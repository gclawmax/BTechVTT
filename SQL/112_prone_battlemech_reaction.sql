-- A prone BattleMech has no torso twist. It still completes a Reaction
-- activation so the phase can advance normally.

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.submit_torso_twist_reaction(uuid,text,integer)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Torso-twist reaction resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('prone_reaction_no_torso_twist_v1' IN source)>0 THEN RETURN;END IF;
 -- Resolver migrations may have reformatted this assignment. Anchor on the
 -- semantic torso-facing calculation rather than on a particular newline.
 patched:=regexp_replace(source,
  'twist_delta[[:space:]]*:=[[:space:]]*[(]p_torso_facing[[:space:]]*-[[:space:]]*leg_facing[[:space:]]*[+]6[)][[:space:]]*%[[:space:]]*6[[:space:]]*;',
  'IF coalesce((mech->>''prone'')::boolean,false) AND p_torso_facing<>leg_facing THEN RAISE EXCEPTION ''A prone BattleMech cannot torso twist'';END IF; /* prone_reaction_no_torso_twist_v1 */ twist_delta:=(p_torso_facing-leg_facing+6)%6;',
  'n');
 IF patched=source OR position('prone_reaction_no_torso_twist_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install the prone torso-twist restriction';END IF;
 EXECUTE patched;
END $$;
