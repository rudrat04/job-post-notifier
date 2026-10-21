-- Jobs that have already been emailed (or marked seen by --bootstrap).
create table if not exists public.seen_jobs (
  id          text primary key,           -- sha1(ats:slug:external_id)
  company     text not null,
  title       text not null,
  url         text not null,
  source      text not null,
  first_seen  timestamptz not null default now()
);

create index if not exists seen_jobs_first_seen_idx on public.seen_jobs (first_seen desc);

-- Only the service role (used by the notifier) can read or write.
alter table public.seen_jobs enable row level security;
