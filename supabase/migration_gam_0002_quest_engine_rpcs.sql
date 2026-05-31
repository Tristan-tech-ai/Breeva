-- gam_0002: Quest engine — adaptive generation, progress tracking with
-- replace-on-completion, and XP/level baked into add_ecopoints. All SECURITY
-- DEFINER, WIB-aware. Applied 2026-05-31. (Grants hardened in gam_0003.)

CREATE OR REPLACE FUNCTION public._level_for_xp(p_xp integer) RETURNS integer
  LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog'
  AS $$ SELECT GREATEST(1, floor(sqrt(GREATEST(p_xp,0) / 50.0))::int + 1) $$;

CREATE OR REPLACE FUNCTION public._tier_for_level(p_level integer) RETURNS text
  LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog'
  AS $$ SELECT CASE
    WHEN p_level >= 15 THEN 'forest' WHEN p_level >= 10 THEN 'tree'
    WHEN p_level >= 6 THEN 'sapling' WHEN p_level >= 3 THEN 'sprout' ELSE 'seed' END $$;

CREATE OR REPLACE FUNCTION public._generate_quest_for_slot(
  p_user_id uuid, p_date date, p_slot integer, p_level integer, p_exclude_codes text[] DEFAULT '{}')
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  t public.quest_templates;
  v_target int; v_reward int; v_label text; v_id uuid;
BEGIN
  SELECT * INTO t FROM public.quest_templates qt
  WHERE qt.is_active AND qt.min_level <= p_level
    AND qt.code <> ALL(p_exclude_codes)
    AND NOT EXISTS (
      SELECT 1 FROM public.user_quests uq
      WHERE uq.user_id = p_user_id AND uq.quest_date = p_date AND uq.template_id = qt.id
        AND uq.replaced_at IS NULL AND uq.is_completed = false)
  ORDER BY random() * qt.weight DESC LIMIT 1;

  IF NOT FOUND THEN
    SELECT * INTO t FROM public.quest_templates qt
    WHERE qt.is_active AND qt.min_level <= p_level
    ORDER BY random() * qt.weight DESC LIMIT 1;
  END IF;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_target := LEAST(t.target_max, GREATEST(t.target_min,
              round(t.base_target + t.target_per_level * (p_level - 1))::int));
  v_reward := GREATEST(1, round(t.base_reward + t.reward_per_level * (p_level - 1))::int);

  IF t.unit = 'meters' THEN
    v_label := CASE WHEN v_target >= 1000
      THEN regexp_replace((v_target/1000.0)::numeric(10,2)::text, '\.?0+$', '') || ' km'
      ELSE v_target::text || ' m' END;
  ELSE
    v_label := v_target::text;
  END IF;

  INSERT INTO public.user_quests
    (user_id, template_id, slot, quest_date, current_value, is_completed,
     quest_type, event_type, unit, title, description, icon, target_value, reward_points)
  VALUES
    (p_user_id, t.id, p_slot, p_date, 0, false,
     t.quest_type, t.event_type, t.unit,
     replace(t.title_template, '{t}', v_label),
     replace(t.description_template, '{t}', v_label),
     t.icon, v_target, v_reward)
  ON CONFLICT (user_id, quest_date, slot)
    WHERE template_id IS NOT NULL AND replaced_at IS NULL AND is_completed = false
  DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.ensure_daily_quests(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_level int; v_slot int; v_codes text[];
BEGIN
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

CREATE OR REPLACE FUNCTION public.record_quest_progress(
  p_user_id uuid, p_event_type text, p_value integer DEFAULT 1, p_reference_id uuid DEFAULT NULL)
RETURNS TABLE(quest_id uuid, title text, completed boolean, reward integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_level int; q RECORD; v_codes text[];
BEGIN
  IF p_value IS NULL OR p_value <= 0 THEN RETURN; END IF;
  PERFORM public.ensure_daily_quests(p_user_id);

  FOR q IN
    UPDATE public.user_quests uq
    SET current_value = LEAST(uq.target_value, uq.current_value + p_value)
    WHERE uq.user_id = p_user_id AND uq.quest_date = v_today
      AND uq.template_id IS NOT NULL AND uq.replaced_at IS NULL
      AND uq.is_completed = false AND uq.event_type = p_event_type
    RETURNING uq.id, uq.slot, uq.title AS qtitle, uq.reward_points, uq.current_value, uq.target_value
  LOOP
    IF q.current_value >= q.target_value THEN
      UPDATE public.user_quests SET is_completed = true, completed_at = now() WHERE id = q.id;
      PERFORM public.add_ecopoints(p_user_id, q.reward_points, 'quest',
        'Quest: ' || q.qtitle, 'quest', q.id);   -- is_completed flip = idempotency guard
      SELECT level INTO v_level FROM public.users WHERE id = p_user_id;
      SELECT COALESCE(array_agg(qt.code), '{}') INTO v_codes
      FROM public.user_quests u2 JOIN public.quest_templates qt ON qt.id = u2.template_id
      WHERE u2.user_id = p_user_id AND u2.quest_date = v_today
        AND u2.replaced_at IS NULL AND u2.is_completed = false;
      PERFORM public._generate_quest_for_slot(p_user_id, v_today, q.slot, v_level, v_codes);
      RETURN QUERY SELECT q.id, q.qtitle, true, q.reward_points;
    ELSE
      RETURN QUERY SELECT q.id, q.qtitle, false, 0;
    END IF;
  END LOOP;
  RETURN;
END; $$;

-- add_ecopoints: now also feeds lifetime XP -> level/tier (signature unchanged)
CREATE OR REPLACE FUNCTION public.add_ecopoints(
  p_user_id uuid, p_amount integer, p_type character varying,
  p_description text DEFAULT NULL, p_reference_type character varying DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE new_balance INTEGER;
BEGIN
  IF p_amount > 0 THEN
    UPDATE users SET
      ecopoints_balance = ecopoints_balance + p_amount,
      xp = xp + p_amount,
      level = public._level_for_xp(xp + p_amount),
      tier  = public._tier_for_level(public._level_for_xp(xp + p_amount)),
      updated_at = NOW()
    WHERE id = p_user_id
    RETURNING ecopoints_balance INTO new_balance;
  ELSE
    UPDATE users SET ecopoints_balance = ecopoints_balance + p_amount, updated_at = NOW()
    WHERE id = p_user_id
    RETURNING ecopoints_balance INTO new_balance;
  END IF;

  INSERT INTO points_transactions (user_id, amount, transaction_type, description, reference_type, reference_id)
  VALUES (p_user_id, p_amount, p_type, p_description, p_reference_type, p_reference_id);

  RETURN new_balance;
END; $$;

CREATE OR REPLACE FUNCTION public.get_level_progress(p_user_id uuid)
RETURNS TABLE(level integer, tier text, xp integer, xp_into_level integer, xp_for_next integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_xp int; v_level int;
BEGIN
  SELECT u.xp, u.level INTO v_xp, v_level FROM public.users u WHERE u.id = p_user_id;
  IF v_xp IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT v_level, public._tier_for_level(v_level), v_xp,
    v_xp - (50 * (v_level-1) * (v_level-1)),
    (50 * v_level * v_level) - (50 * (v_level-1) * (v_level-1));
END; $$;
