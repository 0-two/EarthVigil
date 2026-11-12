-- Vigil · the 15-minute alert sweep, scheduled from inside Supabase (free on every plan).
-- Vercel's free plan only allows a once-a-day cron, so Postgres does the ticking instead.
-- This also keeps the free Supabase project active, so it never auto-pauses.
--
-- Before running: replace the two placeholders below.
--   https://YOUR-APP.vercel.app  → your production URL
--   YOUR_CRON_SECRET             → the CRON_SECRET you set in Vercel

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- remove an older copy of the job if you are re-running this file
select cron.unschedule(jobid) from cron.job where jobname = 'vigil-sweep';

select cron.schedule(
  'vigil-sweep',
  '*/15 * * * *',
  $$
  select net.http_get(
    url     := 'https://YOUR-APP.vercel.app/api/cron/sweep',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET'),
    timeout_milliseconds := 60000
  );
  $$
);

-- Check it is firing (status 200 rows should appear every 15 minutes):
--   select status_code, left(content::text, 120), created from net._http_response order by created desc limit 5;
