-- A durable, user-owned display preference. Raw vehicle telemetry remains kPa.
alter table public.profiles
  add column if not exists preferred_pressure_unit text not null default 'kPa';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_preferred_pressure_unit_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_preferred_pressure_unit_check
      check (preferred_pressure_unit in ('kPa', 'psi', 'bar'));
  end if;
end $$;
