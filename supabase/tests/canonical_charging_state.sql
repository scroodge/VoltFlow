\set ON_ERROR_STOP on
begin;

do $$
declare
  gun integer;
begin
  -- Owner-car production regression: explicit unplug wins over stale positive status.
  if public.bydmate_canonical_is_charging(
    '{"autoservice":{"gun_state":1},"diplus":{"charge_gun_state":1,"charging_status":1}}'::jsonb
  ) then
    raise exception 'explicit gun 1 must not classify as charging';
  end if;

  -- Autoservice is the preferred source when DiPlus disagrees.
  if public.bydmate_canonical_is_charging(
    '{"autoservice":{"gun_state":1},"diplus":{"charge_gun_state":2,"charging_status":1}}'::jsonb
  ) then
    raise exception 'autoservice gun must win over DiPlus gun';
  end if;

  if not public.bydmate_canonical_is_charging(
    '{"autoservice":{"gun_state":2},"diplus":{"charge_gun_state":1,"charging_status":0}}'::jsonb
  ) then
    raise exception 'autoservice connected gun must win over DiPlus unplug';
  end if;

  -- Leopard 3 reduced payload: status remains a last resort only when no gun is known.
  if not public.bydmate_canonical_is_charging(
    '{"diplus":{"charging_status":1}}'::jsonb
  ) then
    raise exception 'positive charging status must classify as charging when gun is absent';
  end if;

  for gun in 2..5 loop
    if not public.bydmate_canonical_is_charging(
      jsonb_build_object('diplus', jsonb_build_object('charge_gun_state', gun))
    ) then
      raise exception 'connected gun state % must classify as charging', gun;
    end if;
  end loop;

  -- Existing aux/resting and phantom-drain predicate behavior must remain unchanged:
  -- explicit unplug suppresses stale client is_charging and qualifies this stationary row.
  if not public.bydmate_is_parked_unplugged(
    '{"speed_kmh":0,"power_kw":0,"charge_power_kw":0,"is_charging":true}'::jsonb,
    '1'
  ) then
    raise exception 'canonical defense must not fragment parked/resting windows';
  end if;

  -- Real charge power still excludes a row from parked analytics, independent of gun.
  if public.bydmate_is_parked_unplugged(
    '{"speed_kmh":0,"power_kw":0,"charge_power_kw":4,"is_charging":false}'::jsonb,
    '1'
  ) then
    raise exception 'real charging power must remain excluded from parked analytics';
  end if;
end;
$$;

rollback;
