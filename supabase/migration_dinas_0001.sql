-- /pemerintah (N-28): an agency asks for a weekly summary of one kab/kota. The agency types its own e-mail; nobody can
-- read the table from the app (no policies); requests go in only through dinas_daftar().

create table if not exists public.langganan_dinas (
  id bigint generated always as identity primary key,
  instansi text not null check (char_length(btrim(instansi)) between 3 and 120),
  wilayah text not null check (wilayah ~ '^[a-z0-9-]{3,80}$'),
  email text not null check (char_length(email) <= 200 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  dibuat timestamptz not null default now(),
  status text not null default 'baru' check (status in ('baru', 'aktif', 'berhenti')),
  uji boolean not null default false
);

create unique index if not exists langganan_dinas_email_wilayah on public.langganan_dinas (lower(email), wilayah);
create index if not exists langganan_dinas_dibuat_idx on public.langganan_dinas (dibuat desc);

alter table public.langganan_dinas enable row level security;
revoke all on public.langganan_dinas from anon, authenticated;

create or replace function public.dinas_daftar(p_instansi text, p_wilayah text, p_email text, p_uji boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  baru bigint;
begin
  if p_instansi is null or char_length(btrim(p_instansi)) not between 3 and 120 then
    return jsonb_build_object('ok', false, 'alasan', 'instansi');
  end if;
  if p_wilayah is null or p_wilayah !~ '^[a-z0-9-]{3,80}$' then
    return jsonb_build_object('ok', false, 'alasan', 'wilayah');
  end if;
  if p_email is null or char_length(p_email) > 200 or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'alasan', 'email');
  end if;
  -- a flood guard for the whole table: at most 50 new requests an hour
  select count(*) into n from public.langganan_dinas where dibuat > now() - interval '1 hour';
  if n >= 50 then
    return jsonb_build_object('ok', false, 'alasan', 'batas');
  end if;
  insert into public.langganan_dinas (instansi, wilayah, email, uji)
  values (btrim(p_instansi), p_wilayah, lower(btrim(p_email)), coalesce(p_uji, false))
  on conflict (lower(email), wilayah) do nothing
  returning id into baru;
  return jsonb_build_object('ok', true, 'sudah', baru is null);
end;
$$;

revoke all on function public.dinas_daftar(text, text, text, boolean) from public;
grant execute on function public.dinas_daftar(text, text, text, boolean) to anon, authenticated;
