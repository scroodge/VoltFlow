-- B-03 contract test for bydmate_resolve_vehicle_key / bydmate_merge_vehicle_key.
-- psql ... -v test_user_id=<uuid> -f <this file>
-- Uses only zz_b03_* keys and random uids on the given account; all writes roll back.
-- To dry-run the migration itself on prod, put `\i` of the migration after `begin;`.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '30s';
set local lock_timeout = '3s';
create temporary table b03_scope(user_id uuid) on commit drop;
insert into b03_scope values (:'test_user_id'::uuid);

do $$
declare
  u uuid := (select user_id from b03_scope);
  uid1 uuid := gen_random_uuid();
  uid2 uuid := gen_random_uuid();
  k text;
  n integer;
  counts jsonb;
begin
  -- Privileges: resolve is service-role only, merge is operator only.
  if has_function_privilege('anon', 'public.bydmate_resolve_vehicle_key(uuid,uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.bydmate_resolve_vehicle_key(uuid,uuid,text)', 'execute')
     or not has_function_privilege('service_role', 'public.bydmate_resolve_vehicle_key(uuid,uuid,text)', 'execute') then
    raise exception 'resolve privileges wrong';
  end if;
  if has_function_privilege('anon', 'public.bydmate_merge_vehicle_key(uuid,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.bydmate_merge_vehicle_key(uuid,text,text)', 'execute')
     or has_function_privilege('service_role', 'public.bydmate_merge_vehicle_key(uuid,text,text)', 'execute') then
    raise exception 'merge privileges wrong';
  end if;

  -- Older APK: no uid, the name is the key, nothing recorded.
  if bydmate_resolve_vehicle_key(u, null, ' zz_b03_legacy ') <> 'zz_b03_legacy' then
    raise exception 'legacy path must return the trimmed name';
  end if;

  -- First contact binds the uid to the name it arrives with.
  k := bydmate_resolve_vehicle_key(u, uid1, 'zz_b03_car');
  if k <> 'zz_b03_car' then raise exception 'bind returned %', k; end if;
  select count(*) into n from bydmate_vehicle_identity_events where vehicle_uid = uid1 and kind = 'bound';
  if n <> 1 then raise exception 'expected one bound event, got %', n; end if;

  -- Rename: same key, new mate_name, one renamed event; repeating it records nothing.
  k := bydmate_resolve_vehicle_key(u, uid1, 'zz_b03_car renamed');
  if k <> 'zz_b03_car' then raise exception 'rename changed the key to %', k; end if;
  k := bydmate_resolve_vehicle_key(u, uid1, 'zz_b03_car renamed');
  select count(*) into n from bydmate_vehicle_identity_events
    where vehicle_uid = uid1 and kind = 'renamed' and old_name = 'zz_b03_car' and new_name = 'zz_b03_car renamed';
  if n <> 1 then raise exception 'expected one renamed event, got %', n; end if;
  if (select mate_name from bydmate_vehicle_uids where vehicle_uid = uid1) <> 'zz_b03_car renamed' then
    raise exception 'mate_name not updated';
  end if;

  -- A second car on the same account stays separate.
  if bydmate_resolve_vehicle_key(u, uid2, 'zz_b03_other') <> 'zz_b03_other' then
    raise exception 'second car must get its own key';
  end if;

  -- Merge an orphaned old name into the car: rows move, today's row wins a shared slot.
  insert into bydmate_route_labels (user_id, vehicle_id, route_id, name) values
    (u, 'zz_b03_old', 'r-shared', 'old'), (u, 'zz_b03_old', 'r-old-only', 'old'),
    (u, 'zz_b03_car', 'r-shared', 'today');
  insert into bydmate_telemetry_hourly (user_id, vehicle_id, hour_start) values
    (u, 'zz_b03_old', '2001-01-01T00:00:00Z'), (u, 'zz_b03_old', '2001-01-01T01:00:00Z'),
    (u, 'zz_b03_car', '2001-01-01T01:00:00Z');
  counts := bydmate_merge_vehicle_key(u, 'zz_b03_old', 'zz_b03_car');
  if (counts->>'route_labels')::int <> 1 or (counts->>'telemetry_hourly')::int <> 1 then
    raise exception 'unexpected merge counts %', counts;
  end if;
  select count(*) into n from bydmate_route_labels where user_id = u and vehicle_id = 'zz_b03_old';
  if n <> 0 then raise exception 'old key rows left behind'; end if;
  select count(*) into n from bydmate_route_labels where user_id = u and vehicle_id = 'zz_b03_car';
  if n <> 2 then raise exception 'expected 2 labels on the merged key, got %', n; end if;
  if (select name from bydmate_route_labels where user_id = u and vehicle_id = 'zz_b03_car'
      and route_id = 'r-shared') <> 'today' then
    raise exception 'the current car''s label must win a shared route';
  end if;
  select count(*) into n from bydmate_telemetry_hourly where user_id = u and vehicle_id = 'zz_b03_car';
  if n <> 2 then raise exception 'expected 2 hourly rows on the merged key, got %', n; end if;
  select count(*) into n from bydmate_vehicle_identity_events
    where user_id = u and kind = 'merged' and old_name = 'zz_b03_old' and new_name = 'zz_b03_car';
  if n <> 1 then raise exception 'merge event missing'; end if;

  begin
    perform bydmate_merge_vehicle_key(u, 'zz_b03_car', 'zz_b03_car');
    raise exception 'self-merge must be refused';
  exception when raise_exception then
    if sqlerrm = 'self-merge must be refused' then raise; end if;
  end;

  raise notice 'vehicle_identity: all checks passed';
end;
$$;

rollback;
