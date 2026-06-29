-- Add BatteryFly to the charging_provider_type enum

do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'charging_provider_type' and e.enumlabel = 'batterfly'
  ) then
    alter type public.charging_provider_type add value 'batterfly';
  end if;
end $$;
