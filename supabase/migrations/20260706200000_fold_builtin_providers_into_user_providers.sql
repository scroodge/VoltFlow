-- Providers are user-owned data, not app-wide hardcoded constants + a per-user
-- override table. Fold the built-in providers (Home, Malanka, Evika!, forEVo,
-- Zaryadka, BatteryFly) into `user_providers` as ordinary seeded rows every user
-- can reprice or delete — except Home, which is permanent (is_default).
--
-- Seed prices below must match PROVIDER_TARIFF_PRESETS in src/lib/charging-tariffs.ts.

alter table public.user_providers
  add column if not exists is_default boolean not null default false;

-- Seed existing users. ON CONFLICT (user_id, label) is a no-op if the user
-- already has a provider with that label (e.g. re-running this migration, or a
-- pre-existing custom provider that happens to share the name).
insert into public.user_providers
  (user_id, label, home_price_per_kwh, commercial_ac_price_per_kwh, fast_dc_price_per_kwh, is_default)
select
  p.id,
  'Home',
  coalesce(pt.home_price_per_kwh, 0.15),
  coalesce(pt.commercial_ac_price_per_kwh, 0.54),
  coalesce(pt.fast_dc_price_per_kwh, 0.54),
  true
from public.profiles p
left join public.provider_tariffs pt on pt.user_id = p.id and pt.provider_type = 'home'
on conflict (user_id, label) do nothing;

insert into public.user_providers
  (user_id, label, home_price_per_kwh, commercial_ac_price_per_kwh, fast_dc_price_per_kwh, is_default)
select
  p.id,
  'Malanka',
  coalesce(pt.home_price_per_kwh, 0.55),
  coalesce(pt.commercial_ac_price_per_kwh, 0.55),
  coalesce(pt.fast_dc_price_per_kwh, 0.73),
  false
from public.profiles p
left join public.provider_tariffs pt on pt.user_id = p.id and pt.provider_type = 'malanka'
on conflict (user_id, label) do nothing;

insert into public.user_providers
  (user_id, label, home_price_per_kwh, commercial_ac_price_per_kwh, fast_dc_price_per_kwh, is_default)
select
  p.id,
  'Evika!',
  coalesce(pt.home_price_per_kwh, 0.54),
  coalesce(pt.commercial_ac_price_per_kwh, 0.54),
  coalesce(pt.fast_dc_price_per_kwh, 0.72),
  false
from public.profiles p
left join public.provider_tariffs pt on pt.user_id = p.id and pt.provider_type = 'evika'
on conflict (user_id, label) do nothing;

insert into public.user_providers
  (user_id, label, home_price_per_kwh, commercial_ac_price_per_kwh, fast_dc_price_per_kwh, is_default)
select
  p.id,
  'forEVo',
  coalesce(pt.home_price_per_kwh, 0.46),
  coalesce(pt.commercial_ac_price_per_kwh, 0.46),
  coalesce(pt.fast_dc_price_per_kwh, 0.61),
  false
from public.profiles p
left join public.provider_tariffs pt on pt.user_id = p.id and pt.provider_type = 'forevo'
on conflict (user_id, label) do nothing;

insert into public.user_providers
  (user_id, label, home_price_per_kwh, commercial_ac_price_per_kwh, fast_dc_price_per_kwh, is_default)
select
  p.id,
  'Zaryadka',
  coalesce(pt.home_price_per_kwh, 0.48),
  coalesce(pt.commercial_ac_price_per_kwh, 0.48),
  coalesce(pt.fast_dc_price_per_kwh, 0.61),
  false
from public.profiles p
left join public.provider_tariffs pt on pt.user_id = p.id and pt.provider_type = 'zaryadka'
on conflict (user_id, label) do nothing;

insert into public.user_providers
  (user_id, label, home_price_per_kwh, commercial_ac_price_per_kwh, fast_dc_price_per_kwh, is_default)
select
  p.id,
  'BatteryFly',
  coalesce(pt.home_price_per_kwh, 0.50),
  coalesce(pt.commercial_ac_price_per_kwh, 0.50),
  coalesce(pt.fast_dc_price_per_kwh, 0.45),
  false
from public.profiles p
left join public.provider_tariffs pt on pt.user_id = p.id and pt.provider_type = 'batterfly'
on conflict (user_id, label) do nothing;

-- Repoint existing saved GPS tariff locations from the bare built-in enum values
-- to the newly-seeded user_providers rows, so auto-resolution keeps using each
-- user's (possibly customized) price instead of silently reverting to the
-- hardcoded PROVIDER_TARIFF_PRESETS default once provider_tariffs is dropped below.
update public.charging_tariff_locations ctl
set provider_type = 'user_provider', user_provider_id = up.id
from public.user_providers up
where up.user_id = ctl.user_id
  and ctl.user_provider_id is null
  and ctl.provider_type in ('home', 'malanka', 'evika', 'forevo', 'zaryadka', 'batterfly')
  and up.label = case ctl.provider_type
    when 'home' then 'Home'
    when 'malanka' then 'Malanka'
    when 'evika' then 'Evika!'
    when 'forevo' then 'forEVo'
    when 'zaryadka' then 'Zaryadka'
    when 'batterfly' then 'BatteryFly'
  end;

-- provider_tariffs is now folded into user_providers; charging_sessions rows keep
-- their historical bare provider_type enum value and are read via the hardcoded
-- PROVIDER_TARIFF_PRESETS fallback in resolveProviderTariff (unchanged behavior
-- for already-closed sessions, which don't re-resolve their price live anyway).
drop table if exists public.provider_tariffs;
