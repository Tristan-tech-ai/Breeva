-- gam_0008: Region system + region-aware leaderboards (Desa → Kabupaten → Provinsi → Nasional).
-- Applied 2026-06-01.
--
-- Design:
--   * `regions` holds a small DEMO hierarchy (negara→provinsi→kabupaten→kecamatan→desa)
--     covering Breeva's 4 operating metros. Province/city codes are real BPS/Permendagri
--     codes; kecamatan/kelurahan codes are demo-grade. Codes are DOTTED + hierarchical so
--     ancestors are pure string ops (split_part), no recursive joins needed:
--        desa  '31.74.06.1001'  →  kab '31.74'  →  prov '31'
--   * Each level-4 (desa/kelurahan) row carries a center lat/lng + match radius. A walk's
--     origin GPS is mapped to the NEAREST demo desa (haversine, within radius) — the
--     "auto from GPS" region assignment. No boundary polygons required.
--   * `users.region_code` = the user's desa code, set by (a) a walk-completion trigger and
--     (b) a client RPC fed by live geolocation.
--   * `region_leaderboard_weekly` is the collective "region vs region" board, refreshed in
--     lockstep with the per-user `leaderboard_weekly` (every 15 min via the existing cron).
--   * "Active week" = most recent week with a real field (>=8 members), else latest. Keeps
--     the board populated even at the start of a fresh (empty) week and for stale demo data.

-- ============================================================
-- 1. REGIONS reference table + demo seed
-- ============================================================
CREATE TABLE IF NOT EXISTS public.regions (
  code            text PRIMARY KEY,
  level           smallint NOT NULL,      -- 0 negara, 1 provinsi, 2 kabupaten/kota, 3 kecamatan, 4 desa/kelurahan
  name            text NOT NULL,
  parent_code     text REFERENCES public.regions(code),
  center_lat      double precision,       -- level-4 only: centroid for GPS matching
  center_lng      double precision,
  match_radius_km double precision,       -- level-4 only: max distance to still count as "in" this region
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_regions_parent ON public.regions(parent_code);
CREATE INDEX IF NOT EXISTS idx_regions_level ON public.regions(level);

-- Seed (idempotent). Centers placed on real walk clusters so the board populates immediately.
INSERT INTO public.regions (code, level, name, parent_code, center_lat, center_lng, match_radius_km) VALUES
  ('ID', 0, 'Indonesia', NULL, NULL, NULL, NULL),
  ('31', 1, 'DKI Jakarta', 'ID', NULL, NULL, NULL),
  ('32', 1, 'Jawa Barat',  'ID', NULL, NULL, NULL),
  ('35', 1, 'Jawa Timur',  'ID', NULL, NULL, NULL),
  ('51', 1, 'Bali',        'ID', NULL, NULL, NULL),
  ('31.71', 2, 'Kota Jakarta Pusat',   '31', NULL, NULL, NULL),
  ('31.74', 2, 'Kota Jakarta Selatan', '31', NULL, NULL, NULL),
  ('32.73', 2, 'Kota Bandung',         '32', NULL, NULL, NULL),
  ('35.78', 2, 'Kota Surabaya',        '35', NULL, NULL, NULL),
  ('51.71', 2, 'Kota Denpasar',        '51', NULL, NULL, NULL),
  ('51.03', 2, 'Kabupaten Badung',     '51', NULL, NULL, NULL),
  ('51.04', 2, 'Kabupaten Gianyar',    '51', NULL, NULL, NULL),
  ('31.71.05', 3, 'Menteng',          '31.71', NULL, NULL, NULL),
  ('31.71.01', 3, 'Gambir',           '31.71', NULL, NULL, NULL),
  ('31.74.06', 3, 'Kebayoran Baru',   '31.74', NULL, NULL, NULL),
  ('31.74.08', 3, 'Cilandak',         '31.74', NULL, NULL, NULL),
  ('32.73.09', 3, 'Coblong',          '32.73', NULL, NULL, NULL),
  ('32.73.06', 3, 'Sukajadi',         '32.73', NULL, NULL, NULL),
  ('32.73.11', 3, 'Lengkong',         '32.73', NULL, NULL, NULL),
  ('35.78.09', 3, 'Gubeng',           '35.78', NULL, NULL, NULL),
  ('35.78.16', 3, 'Wonokromo',        '35.78', NULL, NULL, NULL),
  ('51.71.01', 3, 'Denpasar Selatan', '51.71', NULL, NULL, NULL),
  ('51.71.03', 3, 'Denpasar Barat',   '51.71', NULL, NULL, NULL),
  ('51.03.05', 3, 'Kuta',             '51.03', NULL, NULL, NULL),
  ('51.03.06', 3, 'Kuta Utara',       '51.03', NULL, NULL, NULL),
  ('51.04.06', 3, 'Ubud',             '51.04', NULL, NULL, NULL),
  ('31.71.05.1001', 4, 'Menteng',        '31.71.05', -6.1957, 106.8312, 30),
  ('31.71.01.1003', 4, 'Gambir',         '31.71.01', -6.1754, 106.8272, 30),
  ('31.74.06.1001', 4, 'Senayan',        '31.74.06', -6.2270, 106.8010, 30),
  ('31.74.08.1001', 4, 'Cilandak Barat', '31.74.08', -6.2620, 106.8110, 30),
  ('32.73.09.1001', 4, 'Dago',           '32.73.09', -6.8880, 107.6180, 30),
  ('32.73.06.1001', 4, 'Sukawarna',      '32.73.06', -6.8890, 107.5800, 30),
  ('32.73.11.1001', 4, 'Turangga',       '32.73.11', -6.9250, 107.6260, 30),
  ('35.78.09.1001', 4, 'Airlangga',      '35.78.09', -7.2680, 112.7580, 30),
  ('35.78.16.1001', 4, 'Darmo',          '35.78.16', -7.2950, 112.7380, 30),
  ('51.71.01.2001', 4, 'Sanur',          '51.71.01', -8.6880, 115.2620, 30),
  ('51.71.03.1001', 4, 'Dauh Puri',      '51.71.03', -8.6620, 115.2120, 30),
  ('51.03.05.1001', 4, 'Kuta',           '51.03.05', -8.7220, 115.1730, 30),
  ('51.03.05.1003', 4, 'Seminyak',       '51.03.05', -8.6900, 115.1620, 30),
  ('51.03.06.2001', 4, 'Canggu',         '51.03.06', -8.6480, 115.1380, 30),
  ('51.04.06.2001', 4, 'Ubud',           '51.04.06', -8.5070, 115.2630, 30)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, parent_code = EXCLUDED.parent_code, level = EXCLUDED.level,
  center_lat = EXCLUDED.center_lat, center_lng = EXCLUDED.center_lng,
  match_radius_km = EXCLUDED.match_radius_km;

ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view regions" ON public.regions;
CREATE POLICY "Anyone can view regions" ON public.regions FOR SELECT USING (true);

-- ============================================================
-- 2. users.region_code
-- ============================================================
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS region_code text REFERENCES public.regions(code);
CREATE INDEX IF NOT EXISTS idx_users_region ON public.users(region_code);

-- ============================================================
-- 3. GPS → nearest demo region (haversine)
-- ============================================================
CREATE OR REPLACE FUNCTION public.breeva_nearest_region(p_lat double precision, p_lng double precision)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT code FROM public.regions
  WHERE level = 4 AND center_lat IS NOT NULL
    AND 6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(p_lat)) * cos(radians(center_lat)) * cos(radians(center_lng) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(center_lat))
        ))) <= match_radius_km
  ORDER BY 6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(p_lat)) * cos(radians(center_lat)) * cos(radians(center_lng) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(center_lat))
        ))) ASC
  LIMIT 1;
$fn$;

-- Client-callable: set MY region from a live GPS fix. Returns the assigned code (or NULL).
CREATE OR REPLACE FUNCTION public.set_my_region_from_point(p_lat double precision, p_lng double precision)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_code text;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  v_code := public.breeva_nearest_region(p_lat, p_lng);
  IF v_code IS NOT NULL THEN
    UPDATE public.users SET region_code = v_code, updated_at = now() WHERE id = v_uid;
  END IF;
  RETURN v_code;
END; $fn$;

-- Walk-completion trigger: keep the user's region following where they actually walk.
CREATE OR REPLACE FUNCTION public.breeva_walk_set_region()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_code text;
BEGIN
  IF NEW.status = 'completed' THEN
    v_code := public.breeva_nearest_region(NEW.origin_lat::double precision, NEW.origin_lng::double precision);
    IF v_code IS NOT NULL THEN
      UPDATE public.users SET region_code = v_code WHERE id = NEW.user_id;
    END IF;
  END IF;
  RETURN NEW;
END; $fn$;

DROP TRIGGER IF EXISTS trg_walk_set_region ON public.walks;
CREATE TRIGGER trg_walk_set_region
AFTER INSERT OR UPDATE OF status ON public.walks
FOR EACH ROW EXECUTE FUNCTION public.breeva_walk_set_region();

-- Backfill existing users from their most-recent completed walk.
WITH latest AS (
  SELECT DISTINCT ON (user_id) user_id, origin_lat, origin_lng
  FROM public.walks
  WHERE status = 'completed'
  ORDER BY user_id, completed_at DESC NULLS LAST, created_at DESC
)
UPDATE public.users u
SET region_code = public.breeva_nearest_region(l.origin_lat::double precision, l.origin_lng::double precision)
FROM latest l
WHERE l.user_id = u.id
  AND public.breeva_nearest_region(l.origin_lat::double precision, l.origin_lng::double precision) IS NOT NULL;

-- ============================================================
-- 4. region_leaderboard_weekly (collective "region vs region")
-- ============================================================
CREATE TABLE IF NOT EXISTS public.region_leaderboard_weekly (
  region_code            text NOT NULL REFERENCES public.regions(code),
  level                  smallint NOT NULL,
  week_start             date NOT NULL,
  total_points           integer DEFAULT 0,
  total_distance_meters  integer DEFAULT 0,
  total_walks            integer DEFAULT 0,
  member_count           integer DEFAULT 0,
  rank                   integer,
  updated_at             timestamptz DEFAULT now(),
  PRIMARY KEY (region_code, week_start)
);
CREATE INDEX IF NOT EXISTS idx_region_lb_week_level ON public.region_leaderboard_weekly(week_start, level, rank);

ALTER TABLE public.region_leaderboard_weekly ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view region leaderboard" ON public.region_leaderboard_weekly;
CREATE POLICY "Anyone can view region leaderboard" ON public.region_leaderboard_weekly FOR SELECT USING (true);

ALTER TABLE public.region_leaderboard_weekly REPLICA IDENTITY FULL;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.region_leaderboard_weekly;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 5. Active-week helper + refreshes
-- ============================================================
CREATE OR REPLACE FUNCTION public.breeva_active_leaderboard_week()
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT week_start FROM (
    SELECT week_start, count(*) AS c FROM public.leaderboard_weekly GROUP BY week_start
  ) s ORDER BY (c >= 8) DESC, week_start DESC LIMIT 1;
$fn$;
GRANT EXECUTE ON FUNCTION public.breeva_active_leaderboard_week() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refresh_region_leaderboard()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_week date := public.breeva_active_leaderboard_week();
  v_count int := 0;
BEGIN
  IF v_week IS NULL THEN RETURN 0; END IF;
  DELETE FROM public.region_leaderboard_weekly;
  WITH base AS (
    SELECT u.region_code AS desa,
           split_part(u.region_code, '.', 1) AS prov,
           split_part(u.region_code, '.', 1) || '.' || split_part(u.region_code, '.', 2) AS kab,
           lw.total_points_earned AS pts, lw.total_distance_meters AS dist, lw.total_walks AS walks
    FROM public.leaderboard_weekly lw
    JOIN public.users u ON u.id = lw.user_id
    WHERE lw.week_start = v_week AND u.region_code IS NOT NULL
  ),
  agg AS (
    SELECT 4::smallint AS level, desa AS code, sum(pts)::int pts, sum(dist)::int dist, sum(walks)::int walks, count(*)::int members FROM base GROUP BY desa
    UNION ALL
    SELECT 2::smallint, kab, sum(pts)::int, sum(dist)::int, sum(walks)::int, count(*)::int FROM base GROUP BY kab
    UNION ALL
    SELECT 1::smallint, prov, sum(pts)::int, sum(dist)::int, sum(walks)::int, count(*)::int FROM base GROUP BY prov
  ),
  ranked AS (
    SELECT level, code, pts, dist, walks, members,
           RANK() OVER (PARTITION BY level ORDER BY pts DESC, dist DESC) AS rnk
    FROM agg
  )
  INSERT INTO public.region_leaderboard_weekly
    (region_code, level, week_start, total_points, total_distance_meters, total_walks, member_count, rank, updated_at)
  SELECT code, level, v_week, pts, dist, walks, members, rnk, now() FROM ranked;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $fn$;

REVOKE ALL ON FUNCTION public.refresh_region_leaderboard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_region_leaderboard() TO service_role;

-- Chain region refresh onto the existing per-user refresh (keeps gam_0005 body intact).
CREATE OR REPLACE FUNCTION public.refresh_weekly_leaderboard()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_week_start date := date_trunc('week', (now() AT TIME ZONE 'Asia/Jakarta'))::date;
  v_week_ts timestamptz := (v_week_start::timestamp AT TIME ZONE 'Asia/Jakarta');
  v_count int;
BEGIN
  WITH wk AS (
    SELECT u.id AS user_id, COALESCE(w.dist, 0) AS dist, COALESCE(w.cnt, 0) AS cnt, COALESCE(p.pts, 0) AS pts
    FROM public.users u
    LEFT JOIN (
      SELECT user_id, SUM(distance_meters)::int AS dist, COUNT(*)::int AS cnt
      FROM public.walks WHERE status = 'completed' AND completed_at >= v_week_ts GROUP BY user_id
    ) w ON w.user_id = u.id
    LEFT JOIN (
      SELECT user_id, SUM(amount)::int AS pts
      FROM public.points_transactions WHERE amount > 0 AND created_at >= v_week_ts GROUP BY user_id
    ) p ON p.user_id = u.id
  ),
  ranked AS (
    SELECT user_id, dist, cnt, pts, RANK() OVER (ORDER BY pts DESC, dist DESC) AS rnk
    FROM wk WHERE pts > 0 OR cnt > 0
  )
  INSERT INTO public.leaderboard_weekly
    (user_id, week_start, total_distance_meters, total_walks, total_points_earned, rank, updated_at)
  SELECT user_id, v_week_start, dist, cnt, pts, rnk, now() FROM ranked
  ON CONFLICT (user_id, week_start) DO UPDATE SET
    total_distance_meters = EXCLUDED.total_distance_meters,
    total_walks = EXCLUDED.total_walks,
    total_points_earned = EXCLUDED.total_points_earned,
    rank = EXCLUDED.rank, updated_at = now();
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Region rollup derived from the per-user board.
  PERFORM public.refresh_region_leaderboard();

  RETURN v_count;
END; $$;

REVOKE ALL ON FUNCTION public.refresh_weekly_leaderboard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_weekly_leaderboard() TO service_role;

-- ============================================================
-- 6. Client RPCs
-- ============================================================

-- My region (codes + names at each level) for the header card / default scope.
CREATE OR REPLACE FUNCTION public.get_my_region()
RETURNS TABLE(region_code text, desa_name text, kab_code text, kab_name text, prov_code text, prov_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  WITH me AS (SELECT u.region_code AS rc FROM public.users u WHERE u.id = auth.uid())
  SELECT me.rc, d.name,
         split_part(me.rc, '.', 1) || '.' || split_part(me.rc, '.', 2), kb.name,
         split_part(me.rc, '.', 1), pv.name
  FROM me
  LEFT JOIN public.regions d  ON d.code  = me.rc
  LEFT JOIN public.regions kb ON kb.code = split_part(me.rc, '.', 1) || '.' || split_part(me.rc, '.', 2)
  LEFT JOIN public.regions pv ON pv.code = split_part(me.rc, '.', 1);
$fn$;

-- Ranking of USERS within the caller's region at a chosen scope.
-- p_scope ∈ ('desa','kabupaten','provinsi','nasional'); p_metric ∈ ('points','distance').
CREATE OR REPLACE FUNCTION public.get_region_leaderboard(p_scope text, p_metric text DEFAULT 'points')
RETURNS TABLE(user_id uuid, full_name text, avatar_url text, total_points integer,
              total_distance_meters integer, total_walks integer, rank integer, is_me boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_week date := public.breeva_active_leaderboard_week();
  v_my text; v_prov text; v_kab text;
BEGIN
  SELECT u.region_code INTO v_my FROM public.users u WHERE u.id = v_uid;
  v_prov := split_part(v_my, '.', 1);
  v_kab  := split_part(v_my, '.', 1) || '.' || split_part(v_my, '.', 2);
  RETURN QUERY
  WITH pool AS (
    SELECT u.id, u.full_name, u.avatar_url, u.region_code AS rc,
           lw.total_points_earned AS pts, lw.total_distance_meters AS dist, lw.total_walks AS wlk
    FROM public.leaderboard_weekly lw
    JOIN public.users u ON u.id = lw.user_id
    WHERE lw.week_start = v_week
      AND (
        p_scope = 'nasional'
        OR (v_my IS NOT NULL AND p_scope = 'provinsi'  AND split_part(u.region_code, '.', 1) = v_prov)
        OR (v_my IS NOT NULL AND p_scope = 'kabupaten' AND split_part(u.region_code, '.', 1) || '.' || split_part(u.region_code, '.', 2) = v_kab)
        OR (v_my IS NOT NULL AND p_scope = 'desa'      AND u.region_code = v_my)
      )
  ),
  ranked AS (
    SELECT p.*, RANK() OVER (
      ORDER BY CASE WHEN p_metric = 'distance' THEN p.dist ELSE p.pts END DESC,
               CASE WHEN p_metric = 'distance' THEN p.pts ELSE p.dist END DESC
    ) AS rnk
    FROM pool p
  )
  SELECT r.id, COALESCE(r.full_name, 'Green Walker')::text, r.avatar_url::text,
         r.pts, r.dist, r.wlk, r.rnk::int, (r.id = v_uid)
  FROM ranked r ORDER BY r.rnk LIMIT 100;
END; $fn$;

-- Collective "region vs region" standings at a level.
-- p_level ∈ ('desa','kabupaten','provinsi'); p_metric ∈ ('points','distance').
CREATE OR REPLACE FUNCTION public.get_region_standings(p_level text, p_metric text DEFAULT 'points')
RETURNS TABLE(region_code text, name text, parent_name text, member_count integer,
              total_points integer, total_distance_meters integer, rank integer, is_mine boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_week date := public.breeva_active_leaderboard_week();
  v_level smallint := CASE p_level WHEN 'provinsi' THEN 1 WHEN 'kabupaten' THEN 2 ELSE 4 END;
  v_my text; v_mine text;
BEGIN
  SELECT u.region_code INTO v_my FROM public.users u WHERE u.id = v_uid;
  v_mine := CASE v_level
              WHEN 1 THEN split_part(v_my, '.', 1)
              WHEN 2 THEN split_part(v_my, '.', 1) || '.' || split_part(v_my, '.', 2)
              ELSE v_my END;
  RETURN QUERY
  SELECT r.region_code, reg.name, par.name, r.member_count, r.total_points, r.total_distance_meters,
         RANK() OVER (ORDER BY CASE WHEN p_metric = 'distance' THEN r.total_distance_meters ELSE r.total_points END DESC)::int,
         (r.region_code = v_mine)
  FROM public.region_leaderboard_weekly r
  JOIN public.regions reg ON reg.code = r.region_code
  LEFT JOIN public.regions par ON par.code = reg.parent_code
  WHERE r.week_start = v_week AND r.level = v_level
  ORDER BY CASE WHEN p_metric = 'distance' THEN r.total_distance_meters ELSE r.total_points END DESC
  LIMIT 100;
END; $fn$;

REVOKE ALL ON FUNCTION public.get_my_region() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_region_leaderboard(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_region_standings(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_my_region_from_point(double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_region() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_region_leaderboard(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_region_standings(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_region_from_point(double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.breeva_nearest_region(double precision, double precision) TO authenticated, service_role;

-- ============================================================
-- 7. Populate now
-- ============================================================
SELECT public.refresh_weekly_leaderboard();
