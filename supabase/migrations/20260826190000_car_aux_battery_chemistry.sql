alter table public.cars
  add column if not exists battery_chemistry text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'cars_battery_chemistry_check'
      and conrelid = 'public.cars'::regclass
  ) then
    alter table public.cars
      add constraint cars_battery_chemistry_check
      check (battery_chemistry in ('flooded', 'agm', 'efb', 'lifepo4', 'other'));
  end if;
end
$$;

comment on column public.cars.battery_chemistry is
  'Nullable user override. NULL derives from model_generation (gen1_2024=flooded, gen2_2025=lifepo4).';
