-- One-off audit and cleanup for vehicle commands stranded by the remote-command kill switch.
--
-- Audit boundary, when the static kill-switch bypass merged (PR #15):
--   2026-08-20 19:27:16+00
-- Cleanup cutoff, when command creation was gated (PR #17):
--   2026-08-26 10:42:29+00
-- Adjust literals carrying the same label together if deployment records establish different
-- production-effective times. All comparisons are against timestamptz values in UTC.
--
-- This file is intended for manual review and execution in the Supabase SQL editor.
-- Nothing in this repository runs it automatically.

-- -----------------------------------------------------------------------------
-- AUDIT (read-only)
-- -----------------------------------------------------------------------------

-- Pending count and creation-time range.
select
  count(*) filter (where status = 'pending') as pending_count,
  min(created_at) filter (where status = 'pending') as pending_created_at_min,
  max(created_at) filter (where status = 'pending') as pending_created_at_max
from public.vehicle_commands;

-- Whole-table status breakdown.
select
  status,
  count(*) as command_count,
  min(created_at) as created_at_min,
  max(created_at) as created_at_max
from public.vehicle_commands
group by status
order by status;

-- Pending rows on each side of the kill-switch boundary.
with parameters as (
  select timestamptz '2026-08-20 19:27:16+00' as kill_switch_at -- AUDIT BOUNDARY
)
select
  count(*) filter (where vc.created_at < p.kill_switch_at) as pending_before_kill_switch,
  count(*) filter (where vc.created_at >= p.kill_switch_at) as pending_at_or_after_kill_switch,
  p.kill_switch_at
from public.vehicle_commands as vc
cross join parameters as p
where vc.status = 'pending'
group by p.kill_switch_at;

-- -----------------------------------------------------------------------------
-- CLEANUP (transactional and rollback-by-default)
-- -----------------------------------------------------------------------------
-- Review the preview result and the UPDATE ... RETURNING result before committing.
-- As committed, this script always rolls back. To apply after approval, replace the final
-- ROLLBACK with COMMIT and run this section as one batch. The status predicate also protects
-- a row that is concurrently delivered before this transaction updates it.

begin;

-- Exact preview of the rows eligible for the update below.
select
  vc.id,
  vc.user_id,
  vc.vehicle_id,
  vc.type,
  vc.status,
  vc.created_at,
  vc.executed_at,
  vc.result
from public.vehicle_commands as vc
where vc.status = 'pending'
  and vc.created_at < timestamptz '2026-08-26 10:42:29+00' -- CLEANUP CUTOFF
order by vc.created_at, vc.id;

update public.vehicle_commands as vc
set
  status = 'failed',
  executed_at = now(),
  result = jsonb_build_object(
    'error', 'remote_commands_disabled',
    'timed_out', false,
    'kill_switch', true,
    'never_delivered', true
  )
where vc.status = 'pending'
  and vc.created_at < timestamptz '2026-08-26 10:42:29+00' -- CLEANUP CUTOFF
returning
  vc.id,
  vc.user_id,
  vc.vehicle_id,
  vc.type,
  vc.status,
  vc.created_at,
  vc.executed_at,
  vc.result;

-- Safety default. Replace with COMMIT only after reviewing the results above.
rollback;
