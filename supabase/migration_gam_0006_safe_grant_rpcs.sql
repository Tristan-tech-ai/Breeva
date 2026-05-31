-- gam_0006: Server-authoritative grant RPCs so the browser can't mint EcoPoints.
-- Amounts are server-defined (client can't inflate), with idempotency + daily caps
-- via the points_transactions ledger. The add_ecopoints lockdown follows in
-- gam_0007 (after the rewired client ships). Applied 2026-05-31.

-- Generic fixed-amount reward (onboarding / contribution / per-walk bonuses).
CREATE OR REPLACE FUNCTION public.claim_reward(
  p_user_id uuid, p_type text, p_reference_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_amount int; v_cap int; v_needs_ref boolean; v_ref_type text;
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_today_ts timestamptz := (v_today::timestamp AT TIME ZONE 'Asia/Jakarta');
  v_used int;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN RAISE EXCEPTION 'forbidden'; END IF;

  CASE p_type
    WHEN 'onboarding_bonus'  THEN v_amount:=100; v_cap:=1;  v_needs_ref:=false; v_ref_type:='onboarding';
    WHEN 'contribution'      THEN v_amount:=25;  v_cap:=5;  v_needs_ref:=false; v_ref_type:='aqi_report';
    WHEN 'vayu_contribution' THEN v_amount:=5;   v_cap:=20; v_needs_ref:=true;  v_ref_type:='walk';
    WHEN 'aqi_rating'        THEN v_amount:=5;   v_cap:=20; v_needs_ref:=true;  v_ref_type:='walk_rating';
    WHEN 'calibration'       THEN v_amount:=5;   v_cap:=20; v_needs_ref:=true;  v_ref_type:='walk_calib';
    ELSE RETURN 0;
  END CASE;

  IF p_type = 'onboarding_bonus' THEN
    IF EXISTS (SELECT 1 FROM points_transactions
               WHERE user_id=p_user_id AND transaction_type=p_type) THEN RETURN 0; END IF;
  ELSE
    IF v_needs_ref AND p_reference_id IS NULL THEN RETURN 0; END IF;
    IF p_reference_id IS NOT NULL AND EXISTS (SELECT 1 FROM points_transactions
         WHERE user_id=p_user_id AND transaction_type=p_type
           AND reference_type=v_ref_type AND reference_id=p_reference_id) THEN RETURN 0; END IF;
  END IF;

  SELECT COUNT(*) INTO v_used FROM points_transactions
  WHERE user_id=p_user_id AND transaction_type=p_type AND created_at >= v_today_ts;
  IF v_used >= v_cap THEN RETURN 0; END IF;

  PERFORM public.add_ecopoints(p_user_id, v_amount, p_type, 'Reward: '||p_type, v_ref_type, p_reference_id);
  RETURN v_amount;
END; $$;

-- Achievement unlock: re-validates the requirement server-side, then grants the
-- achievement's defined points (client cannot fake the unlock or amount).
CREATE OR REPLACE FUNCTION public.claim_achievement(p_user_id uuid, p_achievement_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE a record; u record; v_met boolean := false;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO a FROM achievements WHERE id=p_achievement_id AND is_active=true;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM user_achievements WHERE user_id=p_user_id AND achievement_id=p_achievement_id) THEN
    RETURN 0;
  END IF;
  SELECT total_walks, total_distance_km, longest_streak, current_streak,
         total_co2_saved_grams, ecopoints_balance INTO u FROM users WHERE id=p_user_id;
  v_met := CASE a.requirement_type
    WHEN 'walks'          THEN u.total_walks >= a.requirement_value
    WHEN 'total_distance' THEN (u.total_distance_km*1000) >= a.requirement_value
    WHEN 'streak'         THEN GREATEST(u.longest_streak, u.current_streak) >= a.requirement_value
    WHEN 'co2_saved'      THEN u.total_co2_saved_grams >= a.requirement_value
    WHEN 'total_points'   THEN u.ecopoints_balance >= a.requirement_value
    ELSE false END;
  IF NOT v_met THEN RETURN 0; END IF;
  INSERT INTO user_achievements (user_id, achievement_id) VALUES (p_user_id, p_achievement_id);
  IF a.points_reward > 0 THEN
    PERFORM public.add_ecopoints(p_user_id, a.points_reward, 'achievement',
      'Achievement: '||a.name, 'achievement', a.id);
  END IF;
  RETURN a.points_reward;
END; $$;

-- Daily login bonus (+3, once/WIB-day) + streak milestone bonus (once/milestone).
CREATE OR REPLACE FUNCTION public.claim_daily_bonus(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_total int := 0; v_streak int; v_ref uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN RAISE EXCEPTION 'forbidden'; END IF;

  v_ref := md5('login:'||p_user_id::text||':'||v_today::text)::uuid;
  IF NOT EXISTS (SELECT 1 FROM points_transactions
                 WHERE user_id=p_user_id AND reference_type='daily_login' AND reference_id=v_ref) THEN
    PERFORM public.add_ecopoints(p_user_id, 3, 'daily_bonus', 'Bonus harian', 'daily_login', v_ref);
    v_total := v_total + 3;
  END IF;

  SELECT current_streak INTO v_streak FROM users WHERE id=p_user_id;
  IF v_streak IN (3,7,14,30,60,100,180,365) THEN
    v_ref := md5('streak:'||p_user_id::text||':'||v_streak::text)::uuid;
    IF NOT EXISTS (SELECT 1 FROM points_transactions
                   WHERE user_id=p_user_id AND reference_type='streak_milestone' AND reference_id=v_ref) THEN
      PERFORM public.add_ecopoints(p_user_id, v_streak*3, 'streak_bonus',
        'Bonus streak '||v_streak||' hari', 'streak_milestone', v_ref);
      v_total := v_total + v_streak*3;
    END IF;
  END IF;

  RETURN v_total;
END; $$;

REVOKE ALL ON FUNCTION public.claim_reward(uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_reward(uuid,text,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_achievement(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_achievement(uuid,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_daily_bonus(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_daily_bonus(uuid) TO authenticated, service_role;
