-- Schedule completed-day population only after production parity and backfill
-- coverage have been verified. Idempotent for self-hosted environments without
-- migration history.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname in (
      'enqueue-bydmate-aux-voltage-daily',
      'process-bydmate-aux-voltage-rollups',
      'purge-bydmate-aux-voltage-rollups'
    );

    perform cron.schedule(
      'enqueue-bydmate-aux-voltage-daily',
      '10 0 * * *',
      $cron$select public.bydmate_enqueue_aux_voltage_day()$cron$
    );
    perform cron.schedule(
      'process-bydmate-aux-voltage-rollups',
      '*/5 * * * *',
      $cron$select public.bydmate_process_aux_voltage_rollup_queue(1)$cron$
    );
    perform cron.schedule(
      'purge-bydmate-aux-voltage-rollups',
      '30 3 * * *',
      $cron$select public.purge_old_bydmate_aux_voltage_rollups()$cron$
    );
  end if;
exception
  when undefined_table or undefined_function or invalid_schema_name then
    null;
end;
$$;
