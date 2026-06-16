-- Update factory dashboard restore phrase to pair with 迪加强开仪表投屏

update public.mate_dashboard_secrets
set value = '迪加强关仪表投屏', updated_at = now()
where key = 'cluster_projection_close_cmd';

insert into public.mate_dashboard_secrets (key, value)
values ('cluster_projection_close_cmd', '迪加强关仪表投屏')
on conflict (key) do nothing;
