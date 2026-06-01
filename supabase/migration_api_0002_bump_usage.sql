-- api_0002: atomic usage increment + last_used_at bump for the Developer API gate.
-- Called fire-and-forget by the serverless gate using the service role (PostgREST can't
-- do request_count = request_count + 1 in a plain upsert, so this RPC does it atomically).

create or replace function public.bump_api_usage(
  p_key_id uuid, p_user_id uuid, p_endpoint text, p_is_error boolean default false
) returns void
language plpgsql security definer set search_path to 'public','pg_catalog'
as $$
begin
  insert into public.api_key_usage(key_id, user_id, day, endpoint, request_count, error_count)
  values (p_key_id, p_user_id, (now() at time zone 'utc')::date, p_endpoint, 1,
          case when p_is_error then 1 else 0 end)
  on conflict (key_id, day, endpoint) do update
    set request_count = api_key_usage.request_count + 1,
        error_count   = api_key_usage.error_count + (case when p_is_error then 1 else 0 end);
  update public.api_keys set last_used_at = now() where id = p_key_id;
end; $$;

revoke all on function public.bump_api_usage(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.bump_api_usage(uuid, uuid, text, boolean) to service_role;
