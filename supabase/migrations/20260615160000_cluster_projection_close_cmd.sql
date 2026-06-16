-- Factory dashboard restore command for VoltFlow Dashboard (paired with cluster_projection_cmd)

insert into public.mate_dashboard_secrets (key, value)
values ('cluster_projection_close_cmd', '迪加强关仪表投屏')
on conflict (key) do nothing;
