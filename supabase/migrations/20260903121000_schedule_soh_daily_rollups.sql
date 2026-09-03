-- Schedule SOH maintenance after parity and backfill coverage are approved.
-- Times are staggered from the auxiliary rollup jobs to avoid aligned raw reads.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname in (
      'enqueue-bydmate-soh-daily',
      'process-bydmate-soh-rollups',
      'purge-bydmate-soh-rollups'
    );

    perform cron.schedule(
      'enqueue-bydmate-soh-daily',
      '15 0 * * *',
      $cron$select public.bydmate_enqueue_soh_day()$cron$
    );
    perform cron.schedule(
      'process-bydmate-soh-rollups',
      '2,7,12,17,22,27,32,37,42,47,52,57 * * * *',
      $cron$select public.bydmate_process_soh_rollup_queue(1)$cron$
    );
    perform cron.schedule(
      'purge-bydmate-soh-rollups',
      '35 3 * * *',
      $cron$select public.purge_old_bydmate_soh_rollups()$cron$
    );
  end if;
exception
  when undefined_table or undefined_function or invalid_schema_name then
    null;
end;
$$;
