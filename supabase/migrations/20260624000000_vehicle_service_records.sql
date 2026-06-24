-- Vehicle service / maintenance log
-- Tracks repairs, maintenance, modifications, parts purchases with cost breakdown.

create table if not exists public.vehicle_service_records (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  car_id            uuid not null references public.cars (id) on delete cascade,
  title             text not null,
  category          text not null default 'other',
  service_type      text not null default 'maintenance',
  performed_date    date not null default current_date,
  odometer_km       numeric,
  vendor_name       text,
  vendor_location   text,
  parts_cost        numeric default 0,
  labor_cost        numeric default 0,
  total_cost        numeric default 0,
  currency          text default 'EUR',
  notes             text,
  receipt_url       text,
  photo_urls        jsonb default '[]'::jsonb,
  next_due_date     date,
  next_due_km       numeric,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists set_vehicle_service_records_updated_at on public.vehicle_service_records;
create trigger set_vehicle_service_records_updated_at
before update on public.vehicle_service_records
for each row execute procedure public.set_updated_at();

alter table public.vehicle_service_records enable row level security;

create policy "vehicle_service_records_select_own"
  on public.vehicle_service_records for select
  using (auth.uid() = user_id);

create policy "vehicle_service_records_insert_own"
  on public.vehicle_service_records for insert
  with check (auth.uid() = user_id);

create policy "vehicle_service_records_update_own"
  on public.vehicle_service_records for update
  using (auth.uid() = user_id);

create policy "vehicle_service_records_delete_own"
  on public.vehicle_service_records for delete
  using (auth.uid() = user_id);

create index if not exists idx_service_records_car_date
  on public.vehicle_service_records (car_id, performed_date desc);

create index if not exists idx_service_records_car_category
  on public.vehicle_service_records (car_id, category);

-- Service reminders (auto-created from records, or manual)

create table if not exists public.vehicle_service_reminders (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  car_id            uuid not null references public.cars (id) on delete cascade,
  service_record_id uuid references public.vehicle_service_records (id) on delete set null,
  title             text not null,
  category          text not null,
  due_date          date,
  due_km            numeric,
  interval_days     integer,
  interval_km       numeric,
  auto_renew        boolean default false,
  last_completed_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists set_vehicle_service_reminders_updated_at on public.vehicle_service_reminders;
create trigger set_vehicle_service_reminders_updated_at
before update on public.vehicle_service_reminders
for each row execute procedure public.set_updated_at();

alter table public.vehicle_service_reminders enable row level security;

create policy "vehicle_service_reminders_select_own"
  on public.vehicle_service_reminders for select
  using (auth.uid() = user_id);

create policy "vehicle_service_reminders_insert_own"
  on public.vehicle_service_reminders for insert
  with check (auth.uid() = user_id);

create policy "vehicle_service_reminders_update_own"
  on public.vehicle_service_reminders for update
  using (auth.uid() = user_id);

create policy "vehicle_service_reminders_delete_own"
  on public.vehicle_service_reminders for delete
  using (auth.uid() = user_id);

create index if not exists idx_service_reminders_car_due
  on public.vehicle_service_reminders (car_id, due_date);

-- Storage bucket for receipt / photo attachments

insert into storage.buckets (id, name, public)
values ('service-attachments', 'service-attachments', true)
on conflict (id) do nothing;
