-- Pin search_path for 19 pre-existing functions to suppress
-- function_search_path_mutable advisor WARN. Zero behavior change — the linter
-- just wants every function to explicitly resolve identifiers against a known
-- schema list rather than the caller's (mutable) session search_path.

ALTER FUNCTION public.add_ecopoints(uuid, integer, character varying, text, character varying, uuid)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.breeva_trigger_vercel(text, text)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.cleanup_old_forecasts()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.complete_walk(uuid, integer, integer, integer)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.find_aqi_optimal_route(double precision, double precision, double precision, double precision, double precision)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.find_nearby_roads(double precision, double precision, integer, integer)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.find_roads_along_route(text, double precision)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.find_roads_in_bbox(double precision, double precision, double precision, double precision, integer, double precision, character varying[])
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.find_through_gang_roads(double precision, double precision, double precision, double precision, integer, double precision)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.get_nearby_merchants(numeric, numeric, numeric)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.get_top_tier_roads_for_narrative(text, integer)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.handle_new_user()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.purge_dead_tiles()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.purge_old_contributions()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.redeem_reward(uuid, uuid)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.update_merchant_rating()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.update_user_streak(uuid)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.upgrade_merchant_sponsor(uuid, uuid, character varying, integer)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.upsert_aqi_tile(character varying, double precision, double precision, integer, numeric, numeric, numeric, numeric, numeric, numeric, smallint, integer)
  SET search_path = public, pg_catalog;
