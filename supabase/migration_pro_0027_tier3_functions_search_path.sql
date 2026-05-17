-- Pin search_path for Tier 3/4 functions to suppress the function_search_path_mutable
-- WARN. Without this, a hijacked schema can shadow built-in names with a malicious
-- public.* function. We only ever resolve identifiers against public + pg_catalog.

ALTER FUNCTION public.build_gcn_graph(TEXT, REAL, REAL, INT)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.attach_station_ground_truth(REAL, INT)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.get_gcn_deltas(BIGINT[])
  SET search_path = public, pg_catalog;
