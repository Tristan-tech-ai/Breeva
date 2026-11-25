-- Own sensors v1 (N-27). A signed-in owner registers a sensor and gets a token once; the device sends readings with
-- sensor_kirim(token, ...). Public sensors show on the map labelled "tidak dipakai model"; private ones only to the
-- owner. Readings of users' sensors never enter the model (decision 25 Nov).

create table if not exists public.sensors (
  id uuid primary key default gen_random_uuid(),
  pemilik uuid references auth.users (id) on delete cascade,
  nama text not null check (char_length(btrim(nama)) between 2 and 60),
  tipe text not null check (tipe in ('sensor_community', 'http', 'airgradient')),
  publik boolean not null default false,
  lat numeric(6, 3) not null check (lat between -11.5 and 6.5),
  lng numeric(6, 3) not null check (lng between 94.5 and 141.5),
  sc_id text check (sc_id is null or sc_id ~ '^[0-9]{1,9}$'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  dibuat timestamptz not null default now(),
  aktif boolean not null default true,
  -- test sensors of the SQL test only: no owner, never public
  uji boolean not null default false,
  check (pemilik is not null or uji)
);

create table if not exists public.sensor_bacaan (
  id bigint generated always as identity primary key,
  sensor_id uuid not null references public.sensors (id) on delete cascade,
  waktu timestamptz not null,
  diterima timestamptz not null default now(),
  pm25 real check (pm25 is null or pm25 between 0 and 1000),
  pm10 real check (pm10 is null or pm10 between 0 and 2000),
  suhu real check (suhu is null or suhu between -20 and 70),
  rh real check (rh is null or rh between 0 and 100)
);
create index if not exists sensor_bacaan_sensor_waktu on public.sensor_bacaan (sensor_id, waktu desc);

alter table public.sensors enable row level security;
alter table public.sensor_bacaan enable row level security;
revoke all on public.sensors, public.sensor_bacaan from anon, authenticated;
grant select (id, pemilik, nama, tipe, publik, lat, lng, sc_id, dibuat, aktif) on public.sensors to authenticated;
grant select on public.sensor_bacaan to authenticated;

drop policy if exists sensors_milik on public.sensors;
create policy sensors_milik on public.sensors for select to authenticated using (pemilik = auth.uid());
drop policy if exists bacaan_milik on public.sensor_bacaan;
create policy bacaan_milik on public.sensor_bacaan for select to authenticated
  using (exists (select 1 from public.sensors s where s.id = sensor_id and s.pemilik = auth.uid()));

-- register: signed in only; returns the plain token ONCE (only its sha256 is stored)
create or replace function public.sensor_daftar(p_nama text, p_tipe text, p_publik boolean, p_lat double precision, p_lng double precision, p_sc_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  tok text := encode(gen_random_bytes(24), 'hex');
  sid uuid;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'alasan', 'masuk'); end if;
  if (select count(*) from public.sensors where pemilik = auth.uid()) >= 10 then return jsonb_build_object('ok', false, 'alasan', 'batas'); end if;
  insert into public.sensors (pemilik, nama, tipe, publik, lat, lng, sc_id, token_hash)
  values (auth.uid(), btrim(p_nama), p_tipe, coalesce(p_publik, false), round(p_lat::numeric, 3), round(p_lng::numeric, 3), nullif(btrim(p_sc_id), ''),
          encode(digest(tok, 'sha256'), 'hex'))
  returning id into sid;
  return jsonb_build_object('ok', true, 'id', sid, 'token', tok);
exception when check_violation then
  return jsonb_build_object('ok', false, 'alasan', 'isian');
end;
$$;
revoke all on function public.sensor_daftar(text, text, boolean, double precision, double precision, text) from public;
grant execute on function public.sensor_daftar(text, text, boolean, double precision, double precision, text) to authenticated;

-- send: the device's token; at most one reading a minute and 1.500 a day per sensor
create or replace function public.sensor_kirim(p_token text, p_pm25 real, p_pm10 real default null, p_suhu real default null, p_rh real default null, p_waktu timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s public.sensors%rowtype;
  w timestamptz := coalesce(p_waktu, now());
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then return jsonb_build_object('ok', false, 'alasan', 'token'); end if;
  select * into s from public.sensors where token_hash = encode(digest(p_token, 'sha256'), 'hex') and aktif;
  if not found then return jsonb_build_object('ok', false, 'alasan', 'token'); end if;
  if w > now() + interval '5 minutes' or w < now() - interval '2 days' then return jsonb_build_object('ok', false, 'alasan', 'waktu'); end if;
  if exists (select 1 from public.sensor_bacaan where sensor_id = s.id and diterima > now() - interval '55 seconds') then
    return jsonb_build_object('ok', false, 'alasan', 'terlalu_cepat');
  end if;
  if (select count(*) from public.sensor_bacaan where sensor_id = s.id and diterima > now() - interval '1 day') >= 1500 then
    return jsonb_build_object('ok', false, 'alasan', 'batas');
  end if;
  insert into public.sensor_bacaan (sensor_id, waktu, pm25, pm10, suhu, rh) values (s.id, w, p_pm25, p_pm10, p_suhu, p_rh);
  return jsonb_build_object('ok', true);
exception when check_violation then
  return jsonb_build_object('ok', false, 'alasan', 'nilai');
end;
$$;
revoke all on function public.sensor_kirim(text, real, real, real, real, timestamptz) from public;
grant execute on function public.sensor_kirim(text, real, real, real, real, timestamptz) to anon, authenticated;

-- public sensors with their latest reading of the last 2 hours (no owner, no token)
create or replace function public.sensor_publik_fn()
returns table (id uuid, nama text, tipe text, lat numeric, lng numeric, pm25 real, waktu timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.nama, s.tipe, s.lat, s.lng, b.pm25, b.waktu
  from public.sensors s
  left join lateral (select pm25, waktu from public.sensor_bacaan where sensor_id = s.id and waktu > now() - interval '2 hours' order by waktu desc limit 1) b on true
  where s.publik and s.aktif and not s.uji;
$$;
revoke all on function public.sensor_publik_fn() from public;
grant execute on function public.sensor_publik_fn() to anon, authenticated;
create or replace view public.sensor_publik with (security_invoker = true) as select * from public.sensor_publik_fn();
grant select on public.sensor_publik to anon, authenticated;
