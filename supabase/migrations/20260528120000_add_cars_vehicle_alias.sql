alter table public.cars
  add column if not exists vehicle_alias text;

create index if not exists cars_user_vehicle_alias_idx
  on public.cars (user_id, vehicle_alias)
  where vehicle_alias is not null;
