-- AI-1 authoritative foundation.
-- Run after SQL/122. AI decisions remain client-generated, but every solo
-- phase snapshot now crosses this guarded server boundary and is auditable.

CREATE TABLE IF NOT EXISTS public.btech_ai_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES public.btech_games(id) ON DELETE CASCADE,
  round integer NOT NULL,
  phase text NOT NULL,
  decision_id text NOT NULL,
  engine_version text NOT NULL,
  difficulty text NOT NULL,
  seed text NOT NULL,
  snapshot_hash text NOT NULL,
  ai_player_id uuid NOT NULL REFERENCES public.btech_players(id) ON DELETE CASCADE,
  controller_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'planned',
  decision jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, decision_id)
);

CREATE INDEX IF NOT EXISTS idx_btech_ai_decisions_game_round
  ON public.btech_ai_decisions(game_id, round, phase, created_at);

ALTER TABLE public.btech_ai_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Participants can view AI decisions" ON public.btech_ai_decisions;
CREATE POLICY "Participants can view AI decisions"
  ON public.btech_ai_decisions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.btech_players participant
    WHERE participant.game_id=btech_ai_decisions.game_id
      AND participant.user_id=auth.uid()
  ));

CREATE OR REPLACE FUNCTION public.submit_ai_phase_state(
  p_game_id uuid,
  p_mech_instances jsonb,
  p_decision jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  g btech_games%ROWTYPE;
  controller btech_players%ROWTYPE;
  active_player btech_players%ROWTYPE;
  st jsonb;
  existing_units jsonb;
  history jsonb;
  decision_actions jsonb;
  decision_id_value text;
  engine_version_value text;
  difficulty_value text;
  seed_value text;
  snapshot_hash_value text;
  status_value text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in before controlling an AI match';END IF;
  IF jsonb_typeof(p_mech_instances)<>'array' THEN RAISE EXCEPTION 'AI phase state must contain a BattleMech array';END IF;
  IF pg_column_size(p_mech_instances)>4194304 THEN RAISE EXCEPTION 'AI phase state is too large';END IF;

  SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
  IF NOT FOUND OR g.status<>'in-progress' THEN RAISE EXCEPTION 'AI match is not in progress';END IF;
  SELECT * INTO controller FROM btech_players
    WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player' AND NOT coalesce(is_ai,false);
  IF NOT FOUND THEN RAISE EXCEPTION 'Only the seated human participant may control this AI match';END IF;

  st:=CASE jsonb_typeof(g.state)
    WHEN 'string' THEN coalesce((g.state#>>'{}')::jsonb,'{}'::jsonb)
    WHEN 'object' THEN g.state ELSE '{}'::jsonb END;
  IF NOT coalesce((st->>'vs_ai_mode')::boolean,false) THEN RAISE EXCEPTION 'This authority gateway accepts Play vs AI matches only';END IF;
  existing_units:=coalesce(st->'mech_instances','[]'::jsonb);

  IF jsonb_array_length(p_mech_instances)<>jsonb_array_length(existing_units) THEN
    RAISE EXCEPTION 'AI phase state cannot add or remove BattleMechs';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_mech_instances) incoming(value) WHERE jsonb_typeof(incoming.value)<>'object' OR nullif(incoming.value->>'instanceId','') IS NULL) THEN
    RAISE EXCEPTION 'Every AI phase BattleMech requires an instance identity';
  END IF;
  IF EXISTS(SELECT incoming.value->>'instanceId' FROM jsonb_array_elements(p_mech_instances) incoming(value) GROUP BY incoming.value->>'instanceId' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'AI phase state contains duplicate BattleMech identities';
  END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_mech_instances) incoming(value)
    LEFT JOIN LATERAL (
      SELECT saved.value FROM jsonb_array_elements(existing_units) saved(value)
      WHERE saved.value->>'instanceId'=incoming.value->>'instanceId' LIMIT 1
    ) original ON true
    WHERE original.value IS NULL
       OR original.value->>'unitId' IS DISTINCT FROM incoming.value->>'unitId'
       OR original.value->>'owner' IS DISTINCT FROM incoming.value->>'owner'
       OR coalesce(original.value->>'catalogueVersion',g.catalogue_version) IS DISTINCT FROM coalesce(incoming.value->>'catalogueVersion',g.catalogue_version)
  ) THEN RAISE EXCEPTION 'AI phase state attempted to replace a deployed BattleMech identity';END IF;

  IF g.active_player_id IS NOT NULL THEN
    SELECT * INTO active_player FROM btech_players WHERE id=g.active_player_id AND game_id=p_game_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'The active AI match seat is invalid';END IF;
  END IF;

  IF p_decision IS NOT NULL THEN
    IF jsonb_typeof(p_decision)<>'object' OR pg_column_size(p_decision)>65536 THEN RAISE EXCEPTION 'AI decision envelope is invalid or too large';END IF;
    IF active_player.id IS NULL OR NOT coalesce(active_player.is_ai,false) THEN RAISE EXCEPTION 'An AI decision was submitted outside the AI turn';END IF;
    decision_id_value:=nullif(p_decision->>'decision_id','');
    engine_version_value:=nullif(p_decision->>'engine_version','');
    difficulty_value:=nullif(p_decision->>'difficulty','');
    seed_value:=nullif(p_decision->>'seed','');
    snapshot_hash_value:=nullif(p_decision->>'snapshot_hash','');
    status_value:=coalesce(nullif(p_decision->>'status',''),'planned');
    decision_actions:=p_decision->'actions';
    IF decision_id_value IS NULL OR engine_version_value IS NULL OR difficulty_value IS NULL OR seed_value IS NULL OR snapshot_hash_value IS NULL OR jsonb_typeof(decision_actions)<>'array' THEN
      RAISE EXCEPTION 'AI decision envelope is incomplete';
    END IF;
    IF coalesce((p_decision->>'round')::int,-1)<>g.current_round OR p_decision->>'phase' IS DISTINCT FROM g.current_phase THEN
      RAISE EXCEPTION 'AI decision does not match the active round and phase';
    END IF;
    IF status_value NOT IN ('planned','completed','failed') THEN RAISE EXCEPTION 'AI decision status is invalid';END IF;
    IF EXISTS(
      SELECT 1 FROM jsonb_array_elements(decision_actions) action(value)
      WHERE nullif(action.value->>'type','') IS NULL OR
        CASE g.current_phase
          WHEN 'movement' THEN action.value->>'type' NOT IN ('move','complete_movement')
          WHEN 'reaction' THEN action.value->>'type' NOT IN ('torso_twist','complete_reaction')
          WHEN 'weapon_attack' THEN action.value->>'type' NOT IN ('attack','no_fire')
          WHEN 'physical_attack' THEN action.value->>'type' NOT IN ('physical_attack','no_physical_attack')
          WHEN 'heat' THEN action.value->>'type'<>'manage_heat'
          ELSE true END
    ) THEN RAISE EXCEPTION 'AI decision contains an action outside the active phase';END IF;
    IF EXISTS(
      SELECT action.value->>'instanceId' FROM jsonb_array_elements(decision_actions) action(value)
      WHERE action.value->>'type'<>'manage_heat'
      GROUP BY action.value->>'instanceId' HAVING count(*)>1
    ) THEN RAISE EXCEPTION 'AI decision contains more than one action for a BattleMech';END IF;
    IF EXISTS(
      SELECT 1 FROM jsonb_array_elements(decision_actions) action(value)
      WHERE action.value->>'type'<>'manage_heat' AND NOT EXISTS(
        SELECT 1 FROM jsonb_array_elements(existing_units) unit(value)
        WHERE unit.value->>'instanceId'=action.value->>'instanceId'
          AND (unit.value->>'owner')::int=active_player.seat_number
      )
    ) THEN RAISE EXCEPTION 'AI decision attempted to act with another seat''s BattleMech';END IF;

    INSERT INTO btech_ai_decisions(
      game_id,round,phase,decision_id,engine_version,difficulty,seed,snapshot_hash,
      ai_player_id,controller_user_id,status,decision
    ) VALUES(
      p_game_id,g.current_round,g.current_phase,decision_id_value,engine_version_value,
      difficulty_value,seed_value,snapshot_hash_value,active_player.id,auth.uid(),status_value,p_decision
    ) ON CONFLICT(game_id,decision_id) DO UPDATE SET
      status=excluded.status,decision=excluded.decision,updated_at=now();

    SELECT coalesce(jsonb_agg(item ORDER BY ordinal), '[]'::jsonb) INTO history
    FROM (
      SELECT item, row_number() OVER () ordinal
      FROM jsonb_array_elements(coalesce(st->'ai_decisions','[]'::jsonb)) existing_decision(item)
      WHERE existing_decision.item->>'decision_id' IS DISTINCT FROM decision_id_value
      UNION ALL SELECT p_decision, 2147483647
    ) retained;
    IF jsonb_array_length(history)>50 THEN
      SELECT jsonb_agg(item ORDER BY ordinal) INTO history
      FROM (SELECT item,ordinal FROM jsonb_array_elements(history) WITH ORDINALITY entries(item,ordinal) ORDER BY ordinal DESC LIMIT 50) newest;
    END IF;
    st:=jsonb_set(st,'{ai_engine_version}',to_jsonb(engine_version_value),true);
    st:=jsonb_set(st,'{ai_last_decision}',p_decision,true);
    st:=jsonb_set(st,'{ai_decisions}',coalesce(history,'[]'::jsonb),true);
  ELSIF active_player.id IS NOT NULL AND coalesce(active_player.is_ai,false) AND g.current_phase IN ('movement','reaction','weapon_attack','physical_attack','heat') THEN
    RAISE EXCEPTION 'The active AI turn requires an auditable decision envelope';
  END IF;

  st:=jsonb_set(st,'{mech_instances}',p_mech_instances,true);
  UPDATE btech_games SET state=st WHERE id=p_game_id;
  RETURN jsonb_build_object('accepted',true,'decision_recorded',p_decision IS NOT NULL,'engine_version',coalesce(engine_version_value,st->>'ai_engine_version'));
END $$;

REVOKE ALL ON FUNCTION public.submit_ai_phase_state(uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_ai_phase_state(uuid,jsonb,jsonb) TO authenticated;

COMMENT ON FUNCTION public.submit_ai_phase_state(uuid,jsonb,jsonb) IS
  'AI-1 guarded persistence boundary for Play vs AI phase state and reproducible decision envelopes.';

DO $$
BEGIN
  IF to_regprocedure('public.submit_ai_phase_state(uuid,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'AI-1 authority gateway was not installed';
  END IF;
END $$;
