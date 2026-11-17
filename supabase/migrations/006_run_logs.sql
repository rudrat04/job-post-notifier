-- One row per run of any script (jobs, leads, events, prospects), written at the end of
-- the run, including runs that crashed or found nothing new. Use it to see which sources
-- failed on days when no email went out.
create table if not exists public.run_logs (
  id           bigint generated always as identity primary key,
  script       text not null,              -- jobs | leads | events | prospects
  mode         text not null,              -- normal | dry-run | bootstrap | test-email
  status       text not null,              -- ok | partial (some sources failed) | failed (crashed)
  started_at   timestamptz not null,
  finished_at  timestamptz not null default now(),
  duration_ms  integer not null,
  counts       jsonb not null default '{}'::jsonb,  -- e.g. {"matching": 12, "new": 3, "emailed": 3}
  failures     jsonb not null default '[]'::jsonb,  -- ["JSearch \"gtm engineer\" in India (timed out after 60s ...)"]
  error        text                        -- why the run crashed, when status = failed
);

create index if not exists run_logs_started_at_idx on public.run_logs (started_at desc);
create index if not exists run_logs_script_idx on public.run_logs (script, started_at desc);

alter table public.run_logs enable row level security;

-- Example: the last two weeks of failures.
--   select started_at, script, status, failures, error
--   from run_logs
--   where status <> 'ok' and started_at > now() - interval '14 days'
--   order by started_at desc;
