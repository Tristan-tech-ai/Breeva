-- gam_0007: Close the points-minting hole — a signed-in browser could previously
-- call add_ecopoints directly (via PostgREST RPC) to grant itself unlimited
-- EcoPoints. All legitimate grants now flow through SECURITY DEFINER RPCs
-- (claim_reward / claim_achievement / claim_daily_bonus / complete_walk /
-- record_quest_progress / redeem_reward — which call it as the function owner)
-- or the server's service_role. Apply ONLY after the rewired client has shipped.
-- Applied 2026-05-31.
REVOKE ALL ON FUNCTION public.add_ecopoints(uuid, integer, character varying, text, character varying, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_ecopoints(uuid, integer, character varying, text, character varying, uuid)
  TO service_role;
