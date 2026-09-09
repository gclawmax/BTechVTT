-- Read only the public display names of commanders in a match you joined.
CREATE OR REPLACE FUNCTION public.get_match_callsigns(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid()) THEN
  RAISE EXCEPTION 'Only match participants may read commander callsigns';
 END IF;
 RETURN coalesce((SELECT jsonb_object_agg(player.seat_number::text,
  coalesce(nullif(btrim(account.raw_user_meta_data->>'callsign'),''),
   nullif(btrim(account.raw_user_meta_data->'career_avatar'->>'callsign'),''),
   nullif(btrim(account.raw_user_meta_data->>'username'),''),
   nullif(btrim(profile.username),''),'Commander '||player.seat_number::text))
  FROM btech_players player LEFT JOIN auth.users account ON account.id=player.user_id
  LEFT JOIN profiles profile ON profile.id=player.user_id
  WHERE player.game_id=p_game_id AND player.role='player'),'{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.get_match_callsigns(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_match_callsigns(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
