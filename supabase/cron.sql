-- Ative Supabase Cron (pg_cron) no Dashboard > Integrations > Cron.
-- Depois execute:
select cron.schedule(
  'expire-barbershop-tenants',
  '*/5 * * * *',
  $$ select public.expire_due_tenants(); $$
);
