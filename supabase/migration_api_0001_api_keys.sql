-- api_0001: Developer API — keys + usage for the self-serve /developers portal.
-- Keys are minted via a SECURITY DEFINER RPC (plaintext returned ONCE); only the SHA-256
-- hash is stored. The serverless gate (road-aqi/route-score/exposure ?v1=1) hashes the
-- incoming key and looks it up via the service role. RLS lets a user see only their own
-- keys + usage. No new Vercel function: key management is client->Supabase RPC.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  prefix       text not null,                -- shown in portal, e.g. 'brv_live_ab12cd'
  key_hash     text not null unique,         -- sha256(full key), hex
  tier         text not null default 'free' check (tier in ('free','pro','enterprise')),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists idx_api_keys_user on public.api_keys(user_id);
create index if not exists idx_api_keys_hash_active on public.api_keys(key_hash) where revoked_at is null;

create table if not exists public.api_key_usage (
  key_id        uuid not null references public.api_keys(id) on delete cascade,
  user_id       uuid not null,
  day           date not null,
  endpoint      text not null,
  request_count integer not null default 0,
  error_count   integer not null default 0,
  primary key (key_id, day, endpoint)
);
create index if not exists idx_api_key_usage_user_day on public.api_key_usage(user_id, day);

alter table public.api_keys enable row level security;
alter table public.api_key_usage enable row level security;

drop policy if exists api_keys_owner_select on public.api_keys;
create policy api_keys_owner_select on public.api_keys for select using (auth.uid() = user_id);
drop policy if exists api_key_usage_owner_select on public.api_key_usage;
create policy api_key_usage_owner_select on public.api_key_usage for select using (auth.uid() = user_id);

-- Mint a key: returns the plaintext ONCE (store only the hash). Caller = the authed user.
create or replace function public.mint_api_key(p_name text, p_tier text default 'free')
returns table(id uuid, api_key text, prefix text)
language plpgsql security definer set search_path to 'public','extensions','pg_catalog'
as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
  v_prefix text;
  v_id uuid;
  v_active int;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if p_tier not in ('free','pro','enterprise') then p_tier := 'free'; end if;
  select count(*) into v_active from public.api_keys where user_id = v_uid and revoked_at is null;
  if v_active >= 10 then raise exception 'key_limit_reached'; end if;
  v_key := 'brv_live_' || encode(gen_random_bytes(24), 'hex');
  v_prefix := left(v_key, 16);
  insert into public.api_keys(user_id, name, prefix, key_hash, tier)
  values (v_uid, coalesce(nullif(btrim(p_name), ''), 'My API key'), v_prefix,
          encode(digest(v_key, 'sha256'), 'hex'), p_tier)
  returning api_keys.id into v_id;
  return query select v_id, v_key, v_prefix;
end; $$;
revoke all on function public.mint_api_key(text, text) from public, anon;
grant execute on function public.mint_api_key(text, text) to authenticated;

-- Revoke (soft-delete) a key the caller owns.
create or replace function public.revoke_api_key(p_key_id uuid)
returns boolean
language plpgsql security definer set search_path to 'public','pg_catalog'
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  update public.api_keys set revoked_at = now()
   where id = p_key_id and user_id = v_uid and revoked_at is null;
  return found;
end; $$;
revoke all on function public.revoke_api_key(uuid) from public, anon;
grant execute on function public.revoke_api_key(uuid) to authenticated;
