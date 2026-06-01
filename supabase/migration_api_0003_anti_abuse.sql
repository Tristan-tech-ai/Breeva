-- api_0003: Developer-API anti-abuse + IP intelligence (soft enforcement).
-- Captures the caller IP per request, enforces a combined per-IP daily quota
-- (the "1 usage power per IP" anti-Sybil cap, the only HARD control — 429),
-- and LOGS anomalies (VPN/proxy/datacenter/tor, multi-account-per-IP, velocity,
-- geo-mismatch) for the dashboard without ever blocking accounts/keys.
-- Provider verdicts (proxycheck.io + IPQualityScore + heuristics) are cached
-- per-IP with a 7-day TTL so paid free-tier quotas track distinct new IPs, not
-- request volume. All writes go through service-role SECURITY DEFINER RPCs; the
-- dashboard reads only its OWN data via auth.uid()-hardwired aggregation RPCs.
-- Phone columns are present but DEFERRED (no SMS flow yet).

-- ─────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────

-- Provider verdict cache (one row per IP). RLS: no select policy → only the
-- service role / DEFINER RPCs read it (blocks reputation enumeration).
create table if not exists public.ip_reputation (
  ip               text primary key,
  is_vpn           boolean not null default false,
  is_proxy         boolean not null default false,
  is_datacenter    boolean not null default false,
  is_tor           boolean not null default false,
  risk_score       integer not null default 0,          -- 0..100, combined
  country          text,                                -- ISO-2
  asn              text,                                -- normalised 'AS15169'
  provider_sources jsonb not null default '{}'::jsonb,  -- {proxycheck, ipqs, heuristics}
  checked_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '7 days'
);
create index if not exists idx_ip_reputation_expires on public.ip_reputation(expires_at);

-- Per-IP usage rollup for the dashboard (endpoint dimension lives in api_key_usage).
create table if not exists public.api_ip_usage (
  user_id       uuid not null references auth.users(id) on delete cascade,
  key_id        uuid not null references public.api_keys(id) on delete cascade,
  day           date not null,
  ip            text not null,
  country       text,
  request_count integer not null default 0,
  error_count   integer not null default 0,
  primary key (key_id, day, ip)
);
create index if not exists idx_api_ip_usage_user_day on public.api_ip_usage(user_id, day);
create index if not exists idx_api_ip_usage_ip_day   on public.api_ip_usage(ip, day);

-- Logged anomalies (append-only; deduped per (ip,flag_type,day) by the writers).
create table if not exists public.api_abuse_flags (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  key_id      uuid references public.api_keys(id) on delete set null,
  ip          text,
  flag_type   text not null check (flag_type in
                ('vpn','proxy','datacenter','tor','multi_account_ip','velocity','geo_mismatch','per_ip_cap','high_risk_ip')),
  severity    smallint not null default 1 check (severity between 1 and 3),
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists idx_abuse_flags_user_created on public.api_abuse_flags(user_id, created_at desc);
create index if not exists idx_abuse_flags_ip on public.api_abuse_flags(ip);

-- Per-developer metadata. phone/phone_verified_at are nullable + DEFERRED.
create table if not exists public.developer_identity (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  signup_ip         text,
  signup_country    text,
  signup_asn        text,
  phone             text,
  phone_verified_at timestamptz,
  flagged           boolean not null default false,
  flag_reason       text,
  risk_score        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- RLS — owner-select only; no client write paths anywhere.
-- ─────────────────────────────────────────────────────────────
alter table public.ip_reputation      enable row level security;  -- service_role / DEFINER only
alter table public.api_ip_usage       enable row level security;
alter table public.api_abuse_flags    enable row level security;
alter table public.developer_identity enable row level security;

drop policy if exists api_ip_usage_owner_select on public.api_ip_usage;
create policy api_ip_usage_owner_select on public.api_ip_usage for select using (auth.uid() = user_id);
drop policy if exists abuse_flags_owner_select on public.api_abuse_flags;
create policy abuse_flags_owner_select on public.api_abuse_flags for select using (auth.uid() = user_id);
drop policy if exists dev_identity_owner_select on public.developer_identity;
create policy dev_identity_owner_select on public.developer_identity for select using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- Writer RPCs (service_role only — called by the gate fire-and-forget)
-- ─────────────────────────────────────────────────────────────

-- Atomic per-IP usage increment + the cross-user multi-account check folded in
-- (one round trip). Flags multi_account_ip at most once per (ip, day).
create or replace function public.bump_ip_usage(
  p_key_id uuid, p_user_id uuid, p_ip text, p_country text, p_is_error boolean default false
) returns void
language plpgsql security definer set search_path to 'public','pg_catalog'
as $$
declare v_distinct int;
begin
  insert into public.api_ip_usage(user_id, key_id, day, ip, country, request_count, error_count)
  values (p_user_id, p_key_id, (now() at time zone 'utc')::date, p_ip, p_country, 1,
          case when p_is_error then 1 else 0 end)
  on conflict (key_id, day, ip) do update
    set request_count = api_ip_usage.request_count + 1,
        error_count   = api_ip_usage.error_count + (case when p_is_error then 1 else 0 end),
        country       = coalesce(excluded.country, api_ip_usage.country);

  select count(distinct user_id) into v_distinct
    from public.api_ip_usage
   where ip = p_ip and day >= (now() at time zone 'utc')::date - 7;

  if v_distinct >= 3 and not exists (
        select 1 from public.api_abuse_flags
         where ip = p_ip and flag_type = 'multi_account_ip'
           and created_at >= (now() at time zone 'utc')::date) then
    insert into public.api_abuse_flags(user_id, key_id, ip, flag_type, severity, detail)
    values (p_user_id, p_key_id, p_ip, 'multi_account_ip', 2,
            jsonb_build_object('distinct_users', v_distinct, 'window_days', 7));
  end if;
end; $$;
revoke all on function public.bump_ip_usage(uuid,uuid,text,text,boolean) from public, anon, authenticated;
grant execute on function public.bump_ip_usage(uuid,uuid,text,text,boolean) to service_role;

-- Generic anomaly flag insert (vpn/datacenter/per_ip_cap/high_risk_ip/...).
create or replace function public.log_abuse_flag(
  p_user_id uuid, p_key_id uuid, p_ip text, p_flag_type text, p_severity smallint, p_detail jsonb
) returns void
language plpgsql security definer set search_path to 'public','pg_catalog'
as $$
begin
  insert into public.api_abuse_flags(user_id, key_id, ip, flag_type, severity, detail)
  values (p_user_id, p_key_id, p_ip, p_flag_type, coalesce(p_severity, 1::smallint), coalesce(p_detail, '{}'::jsonb));
end; $$;
revoke all on function public.log_abuse_flag(uuid,uuid,text,text,smallint,jsonb) from public, anon, authenticated;
grant execute on function public.log_abuse_flag(uuid,uuid,text,text,smallint,jsonb) to service_role;

-- Persist a provider verdict (cache) with a TTL.
create or replace function public.upsert_ip_reputation(
  p_ip text, p_is_vpn boolean, p_is_proxy boolean, p_is_datacenter boolean, p_is_tor boolean,
  p_risk_score int, p_country text, p_asn text, p_sources jsonb, p_ttl_days int default 7
) returns void
language plpgsql security definer set search_path to 'public','pg_catalog'
as $$
begin
  insert into public.ip_reputation(ip,is_vpn,is_proxy,is_datacenter,is_tor,risk_score,country,asn,provider_sources,checked_at,expires_at)
  values (p_ip, coalesce(p_is_vpn,false), coalesce(p_is_proxy,false), coalesce(p_is_datacenter,false), coalesce(p_is_tor,false),
          coalesce(p_risk_score,0), p_country, p_asn, coalesce(p_sources,'{}'::jsonb),
          now(), now() + make_interval(days => greatest(1, p_ttl_days)))
  on conflict (ip) do update set
    is_vpn=excluded.is_vpn, is_proxy=excluded.is_proxy, is_datacenter=excluded.is_datacenter,
    is_tor=excluded.is_tor, risk_score=excluded.risk_score, country=excluded.country, asn=excluded.asn,
    provider_sources=excluded.provider_sources, checked_at=now(), expires_at=excluded.expires_at;
end; $$;
revoke all on function public.upsert_ip_reputation(text,boolean,boolean,boolean,boolean,int,text,text,jsonb,int) from public, anon, authenticated;
grant execute on function public.upsert_ip_reputation(text,boolean,boolean,boolean,boolean,int,text,text,jsonb,int) to service_role;

-- First-call signup capture (idempotent — first observed call's IP sticks).
create or replace function public.ensure_developer_identity(
  p_user_id uuid, p_ip text, p_country text, p_asn text, p_risk int
) returns void
language plpgsql security definer set search_path to 'public','pg_catalog'
as $$
begin
  insert into public.developer_identity(user_id, signup_ip, signup_country, signup_asn, risk_score)
  values (p_user_id, p_ip, p_country, p_asn, coalesce(p_risk, 0))
  on conflict (user_id) do nothing;
end; $$;
revoke all on function public.ensure_developer_identity(uuid,text,text,text,int) from public, anon, authenticated;
grant execute on function public.ensure_developer_identity(uuid,text,text,text,int) to service_role;

-- Prune long-expired reputation rows (called by the sweep).
create or replace function public.prune_ip_reputation() returns void
language sql security definer set search_path to 'public','pg_catalog'
as $$ delete from public.ip_reputation where expires_at < now() - interval '30 days'; $$;
revoke all on function public.prune_ip_reputation() from public, anon, authenticated;
grant execute on function public.prune_ip_reputation() to service_role;

-- ─────────────────────────────────────────────────────────────
-- Aggregation RPCs (DEFINER, auth.uid()-hardwired → no cross-tenant reads).
-- The dashboard's ONLY path to usage / IP / flag data.
-- ─────────────────────────────────────────────────────────────
create or replace function public.dev_usage_timeseries(p_days int default 30)
returns table(day date, endpoint text, request_count bigint, error_count bigint)
language sql security definer set search_path to 'public','pg_catalog' stable
as $$
  select day, endpoint, sum(request_count)::bigint, sum(error_count)::bigint
    from public.api_key_usage
   where user_id = auth.uid()
     and day >= (now() at time zone 'utc')::date - greatest(1, p_days)
   group by day, endpoint
   order by day; $$;

create or replace function public.dev_recent_flags(p_limit int default 50)
returns table(id uuid, key_id uuid, ip text, flag_type text, severity smallint, detail jsonb, created_at timestamptz)
language sql security definer set search_path to 'public','pg_catalog' stable
as $$
  select id, key_id, ip, flag_type, severity, detail, created_at
    from public.api_abuse_flags
   where user_id = auth.uid()
   order by created_at desc
   limit greatest(1, least(p_limit, 200)); $$;

create or replace function public.dev_ip_summary(p_days int default 30)
returns table(ip text, country text, request_count bigint, error_count bigint,
              is_vpn boolean, is_datacenter boolean, risk_score int, asn text, last_seen date)
language sql security definer set search_path to 'public','pg_catalog' stable
as $$
  with u as (
    select ip, max(country) country, sum(request_count)::bigint rc, sum(error_count)::bigint ec, max(day) last_seen
      from public.api_ip_usage
     where user_id = auth.uid()
       and day >= (now() at time zone 'utc')::date - greatest(1, p_days)
     group by ip)
  select u.ip, coalesce(r.country, u.country), u.rc, u.ec,
         coalesce(r.is_vpn, false), coalesce(r.is_datacenter, false), coalesce(r.risk_score, 0), r.asn, u.last_seen
    from u left join public.ip_reputation r on r.ip = u.ip
   order by u.rc desc
   limit 100; $$;

revoke all on function public.dev_usage_timeseries(int) from public, anon;
revoke all on function public.dev_recent_flags(int)     from public, anon;
revoke all on function public.dev_ip_summary(int)       from public, anon;
grant execute on function public.dev_usage_timeseries(int) to authenticated, service_role;
grant execute on function public.dev_recent_flags(int)     to authenticated, service_role;
grant execute on function public.dev_ip_summary(int)       to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- Daily sweep (velocity + geo_mismatch + flagged rollup + prune). Soft only.
-- ─────────────────────────────────────────────────────────────
create or replace function public.sweep_api_abuse() returns int
language plpgsql security definer set search_path to 'public','pg_catalog'
as $$
declare v_n int := 0;
begin
  -- velocity: >=5 keys minted today behind one signup_ip
  insert into public.api_abuse_flags(user_id, key_id, ip, flag_type, severity, detail)
  select di.user_id, null, di.signup_ip, 'velocity', 2,
         jsonb_build_object('keys_today', c.cnt, 'window', '1d')
    from (select di2.signup_ip, count(*) cnt
            from public.developer_identity di2
            join public.api_keys k on k.user_id = di2.user_id
           where k.created_at >= now() - interval '1 day' and di2.signup_ip is not null
           group by di2.signup_ip having count(*) >= 5) c
    join public.developer_identity di on di.signup_ip = c.signup_ip
   where not exists (select 1 from public.api_abuse_flags f
                      where f.flag_type = 'velocity' and f.ip = di.signup_ip
                        and f.created_at::date = (now() at time zone 'utc')::date);

  -- geo_mismatch: signup_country <> most-recent call country
  insert into public.api_abuse_flags(user_id, key_id, ip, flag_type, severity, detail)
  select di.user_id, null, null, 'geo_mismatch', 1,
         jsonb_build_object('signup_country', di.signup_country, 'recent_country', u.country)
    from public.developer_identity di
    join lateral (select country from public.api_ip_usage
                   where user_id = di.user_id and country is not null
                   order by day desc limit 1) u on true
   where di.signup_country is not null and u.country is not null
     and di.signup_country <> u.country
     and not exists (select 1 from public.api_abuse_flags f
                      where f.flag_type = 'geo_mismatch' and f.user_id = di.user_id
                        and f.created_at >= now() - interval '1 day');

  -- mark developer_identity.flagged from high-severity flags in the last 7d
  update public.developer_identity di
     set flagged = true,
         flag_reason = (select string_agg(distinct f.flag_type, ',')
                          from public.api_abuse_flags f
                         where f.user_id = di.user_id and f.severity >= 2
                           and f.created_at >= now() - interval '7 days'),
         updated_at = now()
   where exists (select 1 from public.api_abuse_flags f
                  where f.user_id = di.user_id and f.severity >= 2
                    and f.created_at >= now() - interval '7 days');

  get diagnostics v_n = row_count;
  perform public.prune_ip_reputation();
  return v_n;
end; $$;
revoke all on function public.sweep_api_abuse() from public, anon, authenticated;
grant execute on function public.sweep_api_abuse() to service_role;

-- 01:00 UTC daily (offset from the 17:00-UTC quest reset). Idempotent by name.
select cron.schedule('breeva-api-abuse-sweep', '0 1 * * *', $$select public.sweep_api_abuse()$$);
