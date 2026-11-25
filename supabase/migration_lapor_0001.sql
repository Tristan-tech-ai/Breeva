-- Lapor warga v1 (N-12): citizen reports of smoke and burning.
-- Nobody reads the table directly. Reports go in through lapor_kirim() (5 per device per 24 hours) and come out only
-- as counts per 0.01 degree cell, kind and day through laporan_ringkas. The reporter's identity is never shown.

create table if not exists public.laporan (
  id bigint generated always as identity primary key,
  jenis text not null check (jenis in ('sampah', 'kendaraan', 'usaha', 'lahan', 'debu', 'lainnya')),
  lat numeric(6, 3) not null check (lat between -11.5 and 6.5),
  lng numeric(6, 3) not null check (lng between 94.5 and 141.5),
  waktu timestamptz not null default now(),
  perangkat text not null check (perangkat ~ '^[0-9a-f]{32,64}$'),
  user_id uuid references auth.users (id) on delete set null,
  catatan text check (char_length(catatan) <= 280),
  status text not null default 'baru' check (status in ('baru', 'ditinjau', 'ditolak')),
  uji boolean not null default false
);

create index if not exists laporan_waktu_idx on public.laporan (waktu desc);
create index if not exists laporan_perangkat_idx on public.laporan (perangkat, waktu desc);

alter table public.laporan enable row level security;
-- no policies: anon and authenticated cannot select, insert, update or delete rows directly
revoke all on public.laporan from anon, authenticated;

create or replace function public.lapor_kirim(
  p_jenis text, p_lat double precision, p_lng double precision, p_perangkat text,
  p_catatan text default null, p_uji boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if p_jenis is null or p_jenis not in ('sampah', 'kendaraan', 'usaha', 'lahan', 'debu', 'lainnya') then
    return jsonb_build_object('ok', false, 'alasan', 'jenis');
  end if;
  if p_lat is null or p_lng is null or p_lat not between -11.5 and 6.5 or p_lng not between 94.5 and 141.5 then
    return jsonb_build_object('ok', false, 'alasan', 'lokasi');
  end if;
  if p_perangkat is null or p_perangkat !~ '^[0-9a-f]{32,64}$' then
    return jsonb_build_object('ok', false, 'alasan', 'perangkat');
  end if;
  -- one device at a time, so two quick taps cannot both pass the limit
  perform pg_advisory_xact_lock(hashtext(p_perangkat));
  select count(*) into n from public.laporan where perangkat = p_perangkat and waktu > now() - interval '24 hours';
  if n >= 5 then
    return jsonb_build_object('ok', false, 'alasan', 'batas', 'sisa', 0);
  end if;
  insert into public.laporan (jenis, lat, lng, perangkat, user_id, catatan, uji)
  values (p_jenis, round(p_lat::numeric, 3), round(p_lng::numeric, 3), p_perangkat, auth.uid(),
          nullif(btrim(left(p_catatan, 280)), ''), coalesce(p_uji, false));
  return jsonb_build_object('ok', true, 'sisa', 4 - n);
end;
$$;

revoke all on function public.lapor_kirim(text, double precision, double precision, text, text, boolean) from public;
grant execute on function public.lapor_kirim(text, double precision, double precision, text, text, boolean) to anon, authenticated;

-- counts only: cell of 0.01 degree (about 1 km), kind, day (WIB), number of reports and of distinct devices; 7 days;
-- test rows and rejected rows left out
create or replace function public.laporan_ringkas_fn()
returns table (lat numeric, lng numeric, jenis text, hari date, jumlah int, pelapor int)
language sql
stable
security definer
set search_path = public
as $$
  select round(l.lat, 2), round(l.lng, 2), l.jenis, (l.waktu at time zone 'Asia/Jakarta')::date,
         count(*)::int, count(distinct l.perangkat)::int
  from public.laporan l
  where not l.uji and l.status <> 'ditolak' and l.waktu > now() - interval '7 days'
  group by 1, 2, 3, 4;
$$;

revoke all on function public.laporan_ringkas_fn() from public;
grant execute on function public.laporan_ringkas_fn() to anon, authenticated;

create or replace view public.laporan_ringkas with (security_invoker = true) as
  select * from public.laporan_ringkas_fn();

grant select on public.laporan_ringkas to anon, authenticated;
