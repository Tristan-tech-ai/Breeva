-- gam_0003: Lock the quest writers to service_role (Supabase default privileges
-- auto-grant EXECUTE to anon/authenticated, so REVOKE FROM PUBLIC alone left
-- record_quest_progress callable by signed-in users — a points-minting hole).
-- Also adds an own-user guard to the user-facing reads. Applied 2026-05-31.

REVOKE ALL ON FUNCTION public._generate_quest_for_slot(uuid,date,integer,integer,text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._generate_quest_for_slot(uuid,date,integer,integer,text[]) TO service_role;
REVOKE ALL ON FUNCTION public.record_quest_progress(uuid,text,integer,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_quest_progress(uuid,text,integer,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_daily_quests(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_level int; v_slot int; v_codes text[];
BEGIN
  -- service_role (no JWT) has uid NULL; signed-in users may only target themselves
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT level INTO v_level FROM public.users WHERE id = p_user_id;
  IF v_level IS NULL THEN RETURN; END IF;
  FOR v_slot IN 1..3 LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.user_quests
      WHERE user_id = p_user_id AND quest_date = v_today AND slot = v_slot
        AND template_id IS NOT NULL AND replaced_at IS NULL AND is_completed = false) THEN
      SELECT COALESCE(array_agg(qt.code), '{}') INTO v_codes
      FROM public.user_quests uq JOIN public.quest_templates qt ON qt.id = uq.template_id
      WHERE uq.user_id = p_user_id AND uq.quest_date = v_today
        AND uq.replaced_at IS NULL AND uq.is_completed = false;
      PERFORM public._generate_quest_for_slot(p_user_id, v_today, v_slot, v_level, v_codes);
    END IF;
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.get_level_progress(p_user_id uuid)
RETURNS TABLE(level integer, tier text, xp integer, xp_into_level integer, xp_for_next integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_xp int; v_level int;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT u.xp, u.level INTO v_xp, v_level FROM public.users u WHERE u.id = p_user_id;
  IF v_xp IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT v_level, public._tier_for_level(v_level), v_xp,
    v_xp - (50 * (v_level-1) * (v_level-1)),
    (50 * v_level * v_level) - (50 * (v_level-1) * (v_level-1));
END; $$;

REVOKE ALL ON FUNCTION public.ensure_daily_quests(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_daily_quests(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_level_progress(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_level_progress(uuid) TO authenticated, service_role;
