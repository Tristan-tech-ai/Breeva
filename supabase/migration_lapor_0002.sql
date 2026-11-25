-- Urgency of citizen reports (N-25), per 0.01 degree cell over 7 days:
--   one count per device per cell per day (WIB), weight 1 for a signed-in reporter, 0.5 for a guest;
--   skor = the same weights halved every 3 days of age; the page multiplies by 1.5 near a fire or a high sensor
--   reading and by 1.3 near a school or health facility (those layers live on the CDN, not here).
-- Counts only; test rows are left out unless p_uji (then ONLY test rows, for the SQL test).

create or replace function public.laporan_urgensi_fn(p_uji boolean default false)
returns table (lat numeric, lng numeric, jenis text[], pelapor numeric, skor numeric, terakhir date)
language sql
stable
security definer
set search_path = public
as $$
  with satu as (
    select round(l.lat, 2) as lat, round(l.lng, 2) as lng, l.perangkat,
           (l.waktu at time zone 'Asia/Jakarta')::date as hari,
           bool_or(l.user_id is not null) as akun,
           array_agg(distinct l.jenis) as jenis
    from public.laporan l
    where l.uji = coalesce(p_uji, false) and l.status <> 'ditolak' and l.waktu > now() - interval '7 days'
    group by 1, 2, 3, 4
  ), hari_ini as (select (now() at time zone 'Asia/Jakarta')::date as d)
  select s.lat, s.lng,
         (select array_agg(distinct j) from satu s2, unnest(s2.jenis) j where s2.lat = s.lat and s2.lng = s.lng),
         round(sum(case when s.akun then 1 else 0.5 end)::numeric, 1),
         round(sum((case when s.akun then 1 else 0.5 end) * power(0.5, ((select d from hari_ini) - s.hari) / 3.0))::numeric, 2),
         max(s.hari)
  from satu s
  group by s.lat, s.lng;
$$;

revoke all on function public.laporan_urgensi_fn(boolean) from public;
grant execute on function public.laporan_urgensi_fn(boolean) to anon, authenticated;

create or replace view public.laporan_urgensi with (security_invoker = true) as
  select * from public.laporan_urgensi_fn(false);

grant select on public.laporan_urgensi to anon, authenticated;
