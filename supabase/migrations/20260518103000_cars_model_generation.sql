-- BYD Yuan Up model generation (2024 vs 2025 facelift)
alter table public.cars
  add column if not exists model_generation text not null default 'gen1_2024'
    check (model_generation in ('gen1_2024', 'gen2_2025'));

comment on column public.cars.model_generation is
  'BYD Yuan Up generation: gen1_2024 (2024 MY) or gen2_2025 (2nd gen from 2025).';
